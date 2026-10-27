-- ============================================================================
-- 006_chats.sql — Conversas e grupos (WhatsApp/Telegram): espelho para o painel
-- O n8n alimenta (webhooks da Evolution API e do Telegram); o painel só lê e
-- enfileira respostas manuais (outbox), que o worker envia respeitando a pausa.
-- ============================================================================

create table public.chats (
  id                   uuid primary key default gen_random_uuid(),
  channel              text not null check (channel in ('telegram', 'whatsapp')),
  external_id          text not null,
  kind                 text not null default 'group' check (kind in ('group', 'channel', 'private')),
  title                text not null,
  username             text,
  description          text,
  participant_count    integer check (participant_count is null or participant_count >= 0),
  we_are_admin         boolean not null default false,
  destination_id       uuid references public.destinations (id) on delete set null,
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         integer not null default 0 check (unread_count >= 0),
  archived             boolean not null default false,
  muted                boolean not null default false,
  metadata             jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (channel, external_id)
);
create index chats_list_idx on public.chats (channel, archived, last_message_at desc nulls last);
create trigger trg_chats_updated before update on public.chats
  for each row execute function public.set_updated_at();

create table public.chat_participants (
  chat_id      uuid not null references public.chats (id) on delete cascade,
  external_id  text not null,
  display_name text,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz,
  primary key (chat_id, external_id)
);

create table public.chat_messages (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            uuid not null references public.chats (id) on delete cascade,
  direction          text not null check (direction in ('in', 'out')),
  external_id        text,
  sender_external_id text,
  sender_name        text,
  kind               text not null default 'text'
                     check (kind in ('text', 'image', 'video', 'audio', 'document', 'sticker', 'system', 'offer')),
  body               text not null default '',
  reply_to           text,
  publication_id     uuid references public.publications (id) on delete set null,
  outbox_id          uuid,
  sent_at            timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create unique index chat_messages_ext_uidx on public.chat_messages (chat_id, external_id) where external_id is not null;
create index chat_messages_chat_idx on public.chat_messages (chat_id, sent_at desc);
create unique index chat_messages_pub_uidx on public.chat_messages (publication_id) where publication_id is not null;

create table public.chat_outbox (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             uuid not null references public.chats (id) on delete cascade,
  body                text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  status              text not null default 'pending'
                      check (status in ('pending', 'claimed', 'sent', 'failed', 'cancelled')),
  idempotency_key     text not null unique,
  requested_by        uuid,
  attempt_count       integer not null default 0,
  locked_until        timestamptz,
  external_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index chat_outbox_queue_idx on public.chat_outbox (status, created_at);

insert into public.settings (key, value) values ('retention_days_messages', '90') on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Funções do worker (service_role; auth.uid() é nulo)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_chat(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_channel text := p ->> 'channel'; v_ext text := p ->> 'external_id'; v_dest uuid;
begin
  if v_channel not in ('telegram', 'whatsapp') or coalesce(btrim(v_ext), '') = '' then
    raise exception 'channel/external_id inválidos';
  end if;
  select id into v_dest from public.destinations where channel = v_channel and external_id = v_ext;
  insert into public.chats (channel, external_id, kind, title, username, description, participant_count, we_are_admin, destination_id, metadata)
  values (v_channel, v_ext, coalesce(p ->> 'kind', 'group'), left(coalesce(nullif(btrim(p ->> 'title'), ''), v_ext), 200),
          p ->> 'username', left(p ->> 'description', 1000), (p ->> 'participant_count')::integer,
          coalesce((p ->> 'we_are_admin')::boolean, false), v_dest, public.scrub(coalesce(p -> 'metadata', '{}'::jsonb)))
  on conflict (channel, external_id) do update set
    kind = coalesce(p ->> 'kind', chats.kind),
    title = left(coalesce(nullif(btrim(p ->> 'title'), ''), chats.title), 200),
    username = coalesce(p ->> 'username', chats.username),
    description = coalesce(left(p ->> 'description', 1000), chats.description),
    participant_count = coalesce((p ->> 'participant_count')::integer, chats.participant_count),
    we_are_admin = coalesce((p ->> 'we_are_admin')::boolean, chats.we_are_admin),
    destination_id = coalesce(chats.destination_id, v_dest)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ingest_chat_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chat uuid; v_msg uuid; v_ext text := nullif(p ->> 'external_id', '');
  v_dir text := coalesce(p ->> 'direction', 'in'); v_body text := left(coalesce(p ->> 'body', ''), 4000);
  v_kind text := coalesce(p ->> 'kind', 'text'); v_at timestamptz := coalesce((p ->> 'sent_at')::timestamptz, now());
begin
  if v_dir not in ('in', 'out') then raise exception 'direction inválida'; end if;
  v_chat := public.upsert_chat(p -> 'chat');
  if v_ext is not null and exists (select 1 from public.chat_messages where chat_id = v_chat and external_id = v_ext) then
    return jsonb_build_object('status', 'duplicate', 'chat_id', v_chat);
  end if;
  insert into public.chat_messages (chat_id, direction, external_id, sender_external_id, sender_name, kind, body, reply_to, sent_at)
  values (v_chat, v_dir, v_ext, p ->> 'sender_external_id', left(p ->> 'sender_name', 120), v_kind, v_body, p ->> 'reply_to', v_at)
  returning id into v_msg;
  update public.chats set
    last_message_at = greatest(coalesce(last_message_at, v_at), v_at),
    last_message_preview = case when v_at >= coalesce(last_message_at, v_at) then left(regexp_replace(v_body, '\s+', ' ', 'g'), 140) else last_message_preview end,
    unread_count = case when v_dir = 'in' then unread_count + 1 else unread_count end
  where id = v_chat;
  return jsonb_build_object('status', 'created', 'chat_id', v_chat, 'message_id', v_msg);
end $$;

create or replace function public.sync_chat_participants(p_chat uuid, p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from public.chat_participants where chat_id = p_chat;
  insert into public.chat_participants (chat_id, external_id, display_name, role, joined_at)
  select p_chat, x ->> 'external_id', left(x ->> 'display_name', 120), coalesce(x ->> 'role', 'member'), (x ->> 'joined_at')::timestamptz
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
  where coalesce(x ->> 'external_id', '') <> ''
  on conflict do nothing;
  get diagnostics v_n = row_count;
  update public.chats set participant_count = greatest(v_n, 0) where id = p_chat;
  return v_n;
end $$;

-- Mensagem que saiu pela fila de publicações aparece como "oferta" na conversa do destino.
create or replace function public.mirror_publication_to_chat() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dest record; v_chat uuid;
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    select * into v_dest from public.destinations where id = new.destination_id;
    insert into public.chats (channel, external_id, kind, title, destination_id)
    values (v_dest.channel, v_dest.external_id, case when v_dest.channel = 'telegram' then 'channel' else 'group' end, v_dest.name, v_dest.id)
    on conflict (channel, external_id) do update set destination_id = coalesce(chats.destination_id, excluded.destination_id)
    returning id into v_chat;
    insert into public.chat_messages (chat_id, direction, external_id, kind, body, publication_id, sender_name, sent_at)
    values (v_chat, 'out', new.external_message_id, 'offer', new.rendered_text, new.id, 'Central de Promoções', coalesce(new.sent_at, now()))
    on conflict do nothing;
    update public.chats set last_message_at = coalesce(new.sent_at, now()),
      last_message_preview = left(regexp_replace(new.rendered_text, '<[^>]+>|\s+', ' ', 'g'), 140)
    where id = v_chat;
  end if;
  return new;
end $$;
create trigger trg_publications_mirror after insert or update of status on public.publications
  for each row execute function public.mirror_publication_to_chat();

create or replace function public.claim_chat_outbox(p_worker text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if public.setting_bool('paused', false) then return null; end if;
  update public.chat_outbox set status = 'failed', last_error = 'reserva vencida: confirme no canal antes de reenviar'
   where status = 'claimed' and locked_until < now();
  select o.*, c.channel, c.external_id as chat_external_id into v
    from public.chat_outbox o join public.chats c on c.id = o.chat_id
   where o.status = 'pending' order by o.created_at for update of o skip locked limit 1;
  if not found then return null; end if;
  update public.chat_outbox set status = 'claimed', attempt_count = attempt_count + 1,
         locked_until = now() + make_interval(secs => public.setting_int('claim_lock_seconds', 120))
   where id = v.id;
  return jsonb_build_object('outbox_id', v.id, 'chat_id', v.chat_id, 'channel', v.channel,
                            'chat_external_id', v.chat_external_id, 'text', v.body, 'worker', p_worker);
end $$;

create or replace function public.complete_chat_outbox(p_id uuid, p_external_message_id text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  update public.chat_outbox set status = 'sent', sent_at = now(), external_message_id = p_external_message_id, locked_until = null
   where id = p_id and status = 'claimed' returning * into v;
  if not found then raise exception 'Mensagem não está reservada'; end if;
  insert into public.chat_messages (chat_id, direction, external_id, kind, body, outbox_id, sender_name)
  values (v.chat_id, 'out', p_external_message_id, 'text', v.body, v.id, 'Painel') on conflict do nothing;
  update public.chats set last_message_at = now(), last_message_preview = left(regexp_replace(v.body, '\s+', ' ', 'g'), 140) where id = v.chat_id;
end $$;

create or replace function public.fail_chat_outbox(p_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.chat_outbox set status = 'failed', last_error = left(p_error, 300), locked_until = null where id = p_id and status = 'claimed'
$$;

create or replace function public.purge_old_messages() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from public.chat_messages where publication_id is null
    and sent_at < now() - make_interval(days => public.setting_int('retention_days_messages', 90));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Funções do painel (RBAC dentro de cada uma)
-- ---------------------------------------------------------------------------
create or replace function public.mark_chat_read(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_member() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.chats set unread_count = 0 where id = p_chat and unread_count > 0;
end $$;

create or replace function public.set_chat_flags(p_chat uuid, p_archived boolean, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  update public.chats set archived = coalesce(p_archived, archived), muted = coalesce(p_muted, muted) where id = p_chat;
  if not found then raise exception 'Conversa inexistente'; end if;
  perform public.log_audit('chat_flags', 'chat', p_chat::text, jsonb_build_object('archived', p_archived, 'muted', p_muted));
end $$;

create or replace function public.link_chat_destination(p_chat uuid, p_destination uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_chat record; v_dest record;
begin
  perform public.require_admin();
  select * into v_chat from public.chats where id = p_chat;
  if not found then raise exception 'Conversa inexistente'; end if;
  if p_destination is not null then
    select * into v_dest from public.destinations where id = p_destination;
    if not found then raise exception 'Destino inexistente'; end if;
    if v_dest.channel <> v_chat.channel then raise exception 'Destino de outro canal'; end if;
  end if;
  update public.chats set destination_id = p_destination where id = p_chat;
  perform public.log_audit('chat_linked', 'chat', p_chat::text, jsonb_build_object('destination', p_destination));
end $$;

create or replace function public.queue_chat_message(p_chat uuid, p_text text, p_key text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_chat record; v_id uuid; v_text text := btrim(coalesce(p_text, '')); v_viol text[]; v_limit integer;
begin
  perform public.require_operator();
  select * into v_chat from public.chats where id = p_chat;
  if not found then raise exception 'Conversa inexistente'; end if;
  if v_text = '' then raise exception 'Mensagem vazia'; end if;
  v_limit := case when v_chat.channel = 'telegram' then 4096 else 4000 end;
  if length(v_text) > v_limit then raise exception 'Mensagem maior que % caracteres', v_limit; end if;
  v_viol := public.text_violations(v_text);
  if array_length(v_viol, 1) > 0 then raise exception 'Texto contém termos proibidos: %', array_to_string(v_viol, ', '); end if;
  if v_chat.kind = 'channel' and not v_chat.we_are_admin then raise exception 'Não somos administradores deste canal'; end if;
  if (select count(*) from public.chat_outbox where chat_id = p_chat and status in ('pending', 'claimed')) >= 5 then
    raise exception 'Há mensagens demais aguardando envio nesta conversa';
  end if;
  insert into public.chat_outbox (chat_id, body, idempotency_key, requested_by)
  values (p_chat, v_text, coalesce(p_key, gen_random_uuid()::text), auth.uid())
  on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
  returning id into v_id;
  perform public.log_audit('chat_message_queued', 'chat', p_chat::text, jsonb_build_object('outbox', v_id, 'chars', length(v_text)));
  return v_id;
end $$;

create or replace function public.cancel_chat_outbox(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  update public.chat_outbox set status = 'cancelled' where id = p_id and status = 'pending';
  if not found then raise exception 'Só é possível cancelar mensagens ainda na fila'; end if;
  perform public.log_audit('chat_message_cancelled', 'chat', p_id::text);
end $$;

create or replace function public.channel_overview(p_channel text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'chats', (select count(*) from public.chats where channel = p_channel and not archived),
    'groups', (select count(*) from public.chats where channel = p_channel and not archived and kind in ('group', 'channel')),
    'participants', (select coalesce(sum(participant_count), 0) from public.chats where channel = p_channel and not archived),
    'unread', (select coalesce(sum(unread_count), 0) from public.chats where channel = p_channel and not archived and not muted),
    'messages_in_24h', (select count(*) from public.chat_messages m join public.chats c on c.id = m.chat_id
                         where c.channel = p_channel and m.direction = 'in' and m.sent_at > now() - interval '24 hours'),
    'messages_out_24h', (select count(*) from public.chat_messages m join public.chats c on c.id = m.chat_id
                          where c.channel = p_channel and m.direction = 'out' and m.sent_at > now() - interval '24 hours'),
    'outbox_pending', (select count(*) from public.chat_outbox o join public.chats c on c.id = o.chat_id
                        where c.channel = p_channel and o.status in ('pending', 'claimed')),
    'linked_destinations', (select count(*) from public.chats where channel = p_channel and destination_id is not null));
end $$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.chats             enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.chat_outbox       enable row level security;
create policy read_member on public.chats             for select to authenticated using (public.is_member());
create policy read_member on public.chat_participants for select to authenticated using (public.is_member());
create policy read_member on public.chat_messages     for select to authenticated using (public.is_member());
create policy read_member on public.chat_outbox       for select to authenticated using (public.is_member());

revoke all on public.chats, public.chat_participants, public.chat_messages, public.chat_outbox from anon;
grant select on public.chats, public.chat_participants, public.chat_messages, public.chat_outbox to authenticated;
grant all on public.chats, public.chat_participants, public.chat_messages, public.chat_outbox to service_role;

revoke all on function public.upsert_chat(jsonb), public.ingest_chat_message(jsonb), public.sync_chat_participants(uuid, jsonb),
  public.claim_chat_outbox(text), public.complete_chat_outbox(uuid, text), public.fail_chat_outbox(uuid, text),
  public.purge_old_messages(), public.mark_chat_read(uuid), public.set_chat_flags(uuid, boolean, boolean),
  public.link_chat_destination(uuid, uuid), public.queue_chat_message(uuid, text, text), public.cancel_chat_outbox(uuid),
  public.channel_overview(text), public.mirror_publication_to_chat() from public, anon;
grant execute on function public.upsert_chat(jsonb), public.ingest_chat_message(jsonb), public.sync_chat_participants(uuid, jsonb),
  public.claim_chat_outbox(text), public.complete_chat_outbox(uuid, text), public.fail_chat_outbox(uuid, text),
  public.purge_old_messages(), public.mark_chat_read(uuid), public.set_chat_flags(uuid, boolean, boolean),
  public.link_chat_destination(uuid, uuid), public.queue_chat_message(uuid, text, text), public.cancel_chat_outbox(uuid),
  public.channel_overview(text) to service_role;
grant execute on function public.mark_chat_read(uuid), public.set_chat_flags(uuid, boolean, boolean),
  public.link_chat_destination(uuid, uuid), public.queue_chat_message(uuid, text, text), public.cancel_chat_outbox(uuid),
  public.channel_overview(text) to authenticated;
