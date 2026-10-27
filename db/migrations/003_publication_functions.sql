-- ============================================================================
-- 003_publication_functions.sql — fila, entrega, idempotência e operação.
-- Regra de ouro: a tentativa é gravada ANTES do envio; timeout ambíguo vira
-- `unknown` e nunca é reenviado automaticamente.
-- ============================================================================

-- ---------- Pausa global e configurações ------------------------------------
create or replace function public.set_paused(p_paused boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  if not p_paused then perform public.require_admin(); end if;
  insert into public.settings (key, value, updated_by)
  values ('paused', to_jsonb(p_paused), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit(case when p_paused then 'global_pause' else 'global_resume' end,
    'settings', 'paused', jsonb_build_object('motivo', p_reason));
end $$;

create or replace function public.set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  perform public.require_admin();
  if p_key = 'paused' then raise exception 'Use set_paused para a pausa global'; end if;
  if p_key = 'mode' and (p_value #>> '{}') not in ('simulation', 'review', 'auto') then
    raise exception 'Modo inválido (use simulation, review ou auto)';
  end if;
  select value into v_old from public.settings where key = p_key;
  insert into public.settings (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('setting_changed', 'settings', p_key,
    jsonb_build_object('de', v_old, 'para', p_value));
end $$;

-- ---------- Fila: reservar o próximo envio ------------------------------------
create or replace function public.claim_next_publication(p_worker text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; d record; v_mode text; v_now_local time;
  v_hour integer; v_day integer; v_last timestamptz; v_quiet boolean;
  v_lock integer := public.setting_int('claim_lock_seconds', 120);
  v_tz text := public.setting_text('timezone', 'America/Sao_Paulo');
  v_claimed public.publications;
begin
  if public.setting_bool('paused', false) then return null; end if;
  v_mode := public.setting_text('mode', 'simulation');
  v_now_local := (now() at time zone v_tz)::time;

  for r in
    select p.id, p.destination_id
      from public.publications p
      join public.offers o on o.id = p.offer_id
      join public.destinations dd on dd.id = p.destination_id
     where p.status in ('pending', 'retry_scheduled')
       and p.next_attempt_at <= now()
       and dd.enabled
       and (o.expires_at is null or o.expires_at > now())
       and o.status in ('scheduled', 'approved')
       and (o.is_simulated or v_mode in ('review', 'auto'))
     order by p.next_attempt_at, p.created_at
       for update of p skip locked
  loop
    -- Serializa a avaliação de limites por destino (evita estourar o limite sob concorrência).
    if not pg_try_advisory_xact_lock(hashtextextended(r.destination_id::text, 7)) then continue; end if;

    select * into d from public.destinations where id = r.destination_id;
    if d.quiet_start is not null and d.quiet_end is not null then
      v_quiet := case when d.quiet_start < d.quiet_end
                      then v_now_local >= d.quiet_start and v_now_local < d.quiet_end
                      else v_now_local >= d.quiet_start or v_now_local < d.quiet_end end;
      if v_quiet then continue; end if;
    end if;

    select count(*) filter (where coalesce(sent_at, claimed_at) > now() - interval '1 hour'),
           count(*) filter (where coalesce(sent_at, claimed_at) > now() - interval '24 hours'),
           max(coalesce(sent_at, claimed_at))
      into v_hour, v_day, v_last
      from public.publications
     where destination_id = r.destination_id and status in ('claimed', 'sent', 'unknown');
    if v_hour >= d.max_per_hour or v_day >= d.max_per_day then continue; end if;
    if v_last is not null and v_last > now() - make_interval(secs => d.min_interval_s) then continue; end if;

    update public.publications
       set status = 'claimed', attempt_count = attempt_count + 1, claimed_at = now(),
           locked_by = p_worker, locked_until = now() + make_interval(secs => v_lock)
     where id = r.id
    returning * into v_claimed;

    return (
      select jsonb_build_object(
        'publication_id', v_claimed.id, 'offer_id', v_claimed.offer_id,
        'destination_id', v_claimed.destination_id, 'channel', d.channel,
        'external_chat_id', d.external_id, 'rendered_text', v_claimed.rendered_text,
        'idempotency_key', v_claimed.idempotency_key, 'attempt', v_claimed.attempt_count,
        'is_simulated', o.is_simulated, 'image_url', pr.image_url, 'title', pr.title)
      from public.offers o join public.products pr on pr.id = o.product_id
      where o.id = v_claimed.offer_id);
  end loop;
  return null;
end $$;

-- ---------- Resultado do envio -------------------------------------------------
create or replace function public.complete_publication(p_id uuid, p_external_message_id text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_offer uuid;
begin
  update public.publications
     set status = 'sent', sent_at = now(), external_message_id = p_external_message_id,
         locked_by = null, locked_until = null, last_error_code = null
   where id = p_id and status in ('claimed', 'unknown')
  returning offer_id into v_offer;
  if not found then raise exception 'Publicação % não está em estado de conclusão', p_id; end if;
  update public.offers set status = 'published' where id = v_offer and status in ('scheduled', 'approved');
  perform public.log_audit('publication_sent', 'publication', p_id::text,
    jsonb_build_object('mensagem', p_external_message_id));
end $$;

create or replace function public.fail_publication(
  p_id uuid, p_error_code text, p_permanent boolean default false, p_retry_in_seconds integer default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_attempts integer; v_max integer := public.setting_int('max_attempts', 5); v_status text; v_delay integer;
begin
  select attempt_count into v_attempts from public.publications where id = p_id and status = 'claimed' for update;
  if not found then raise exception 'Publicação % não está reservada', p_id; end if;
  if p_permanent or v_attempts >= v_max then
    v_status := 'failed_permanent';
    update public.publications
       set status = v_status, last_error_code = left(p_error_code, 120), locked_by = null, locked_until = null
     where id = p_id;
  else
    v_status := 'retry_scheduled';
    -- backoff exponencial com jitter de até 20 %, teto de 1 h
    v_delay := coalesce(p_retry_in_seconds,
      least(3600, (30 * power(2, v_attempts - 1) * (1 + random() * 0.2))::integer));
    update public.publications
       set status = v_status, last_error_code = left(p_error_code, 120), locked_by = null, locked_until = null,
           next_attempt_at = now() + make_interval(secs => v_delay)
     where id = p_id;
  end if;
  perform public.log_audit('publication_failed', 'publication', p_id::text,
    jsonb_build_object('codigo', left(p_error_code, 120), 'status', v_status, 'tentativa', v_attempts));
  return v_status;
end $$;

-- Resultado ambíguo (timeout, resposta perdida): NUNCA reenviar sozinho.
create or replace function public.mark_publication_unknown(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.publications
     set status = 'unknown', note = left(p_note, 300), locked_by = null, locked_until = null
   where id = p_id and status = 'claimed';
  if not found then raise exception 'Publicação % não está reservada', p_id; end if;
  perform public.log_audit('publication_unknown', 'publication', p_id::text, jsonb_build_object('nota', p_note));
end $$;

-- Recuperação após reinício de worker: reserva vencida vira `unknown`, nunca `pending`.
create or replace function public.release_stale_claims() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with s as (
    update public.publications
       set status = 'unknown', note = 'Reserva expirou sem confirmação do worker',
           locked_by = null, locked_until = null
     where status = 'claimed' and locked_until < now()
    returning id)
  select count(*) into v_n from s;
  if v_n > 0 then
    perform public.log_audit('stale_claims_released', 'publication', null, jsonb_build_object('quantidade', v_n));
  end if;
  return v_n;
end $$;

-- ---------- Ações humanas sobre publicações ------------------------------------
create or replace function public.resolve_unknown(
  p_id uuid, p_resolution text, p_external_message_id text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_offer uuid;
begin
  perform public.require_operator();
  if p_resolution not in ('sent', 'cancelled') then raise exception 'Resolução inválida'; end if;
  update public.publications
     set status = p_resolution,
         sent_at = case when p_resolution = 'sent' then now() else sent_at end,
         external_message_id = coalesce(p_external_message_id, external_message_id),
         note = 'Reconciliado manualmente'
   where id = p_id and status = 'unknown'
  returning offer_id into v_offer;
  if not found then raise exception 'Publicação não está em estado unknown'; end if;
  if p_resolution = 'sent' then
    update public.offers set status = 'published' where id = v_offer and status in ('scheduled', 'approved');
  end if;
  perform public.log_audit('unknown_resolved', 'publication', p_id::text, jsonb_build_object('resolucao', p_resolution));
end $$;

create or replace function public.cancel_publication(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  update public.publications set status = 'cancelled', note = 'Cancelada manualmente'
   where id = p_id and status in ('pending', 'retry_scheduled');
  if not found then raise exception 'Só é possível cancelar publicações pendentes ou em nova tentativa'; end if;
  perform public.log_audit('publication_cancelled', 'publication', p_id::text);
end $$;

create or replace function public.retry_publication(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  update public.publications
     set status = 'pending', next_attempt_at = now(), attempt_count = 0, last_error_code = null,
         note = 'Reenfileirada manualmente'
   where id = p_id and status = 'failed_permanent';
  if not found then raise exception 'Só é possível reenfileirar publicações com falha permanente'; end if;
  perform public.log_audit('publication_requeued', 'publication', p_id::text);
end $$;

create or replace function public.edit_publication_text(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare v_viol text[];
begin
  perform public.require_operator();
  v_viol := public.text_violations(p_text);
  if cardinality(v_viol) > 0 then raise exception 'Texto contém termos proibidos: %', array_to_string(v_viol, ', '); end if;
  if coalesce(btrim(p_text), '') = '' then raise exception 'Texto vazio'; end if;
  update public.publications set rendered_text = p_text, note = 'Texto editado manualmente'
   where id = p_id and status in ('pending', 'retry_scheduled');
  if not found then raise exception 'Só é possível editar o texto de publicações ainda não enviadas'; end if;
  perform public.log_audit('publication_text_edited', 'publication', p_id::text);
end $$;

-- ---------- Redirecionador ------------------------------------------------------
create or replace function public.record_click(
  p_code text, p_visitor_hash text default null, p_ua_family text default null, p_referrer_host text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare v_target text;
begin
  select target_url into v_target from public.short_links where code = p_code and not disabled;
  if v_target is null then return null; end if;
  insert into public.click_events (code, visitor_hash, ua_family, referrer_host)
  values (p_code, left(p_visitor_hash, 64), left(p_ua_family, 40), left(p_referrer_host, 120));
  return v_target;
end $$;

-- ---------- Saúde, coletas e testes de destino -----------------------------------
create or replace function public.heartbeat(p_service text, p_status text default 'ok', p_details jsonb default '{}')
returns void
language sql security definer set search_path = public as $$
  insert into public.heartbeats (service, last_seen, status, details)
  values (p_service, now(), p_status, public.scrub(p_details))
  on conflict (service) do update set last_seen = now(), status = excluded.status, details = excluded.details
$$;

create or replace function public.start_run(p_platform text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_conn uuid; v_mode text; v_id uuid;
begin
  select id, mode into v_conn, v_mode from public.connectors where platform = p_platform;
  if v_conn is null then raise exception 'Conector % inexistente', p_platform; end if;
  if v_mode in ('disabled', 'paused_policy', 'error') then
    raise exception 'Conector % não pode coletar no estado %', p_platform, v_mode;
  end if;
  insert into public.runs (connector_id) values (v_conn) returning id into v_id;
  return v_id;
end $$;

create or replace function public.finish_run(
  p_run uuid, p_status text, p_seen integer, p_accepted integer, p_rejected integer, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_conn uuid;
begin
  update public.runs
     set finished_at = now(), status = p_status, items_seen = p_seen, items_accepted = p_accepted,
         items_rejected = p_rejected, error_summary = left(p_error, 500)
   where id = p_run returning connector_id into v_conn;
  if p_status = 'success' then
    update public.connectors set last_success_at = now() where id = v_conn;
  elsif p_status = 'error' then
    update public.connectors set last_error_at = now(), last_error = left(p_error, 300) where id = v_conn;
  end if;
end $$;

create or replace function public.request_destination_test(p_destination uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_operator();
  if not exists (select 1 from public.destinations where id = p_destination) then
    raise exception 'Destino inexistente';
  end if;
  insert into public.destination_tests (destination_id, requested_by) values (p_destination, auth.uid())
  returning id into v_id;
  perform public.log_audit('destination_test_requested', 'destination', p_destination::text);
  return v_id;
end $$;

create or replace function public.claim_destination_test() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.destination_tests where status = 'pending'
   order by requested_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.destination_tests set status = 'claimed' where id = t.id;
  return (select jsonb_build_object('test_id', t.id, 'destination_id', d.id, 'channel', d.channel,
                                    'external_chat_id', d.external_id, 'name', d.name)
          from public.destinations d where d.id = t.destination_id);
end $$;

create or replace function public.complete_destination_test(p_test uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_dest uuid;
begin
  update public.destination_tests
     set status = case when p_ok then 'ok' else 'failed' end, completed_at = now(), error = left(p_error, 300)
   where id = p_test and status = 'claimed' returning destination_id into v_dest;
  if not found then raise exception 'Teste não está em andamento'; end if;
  if p_ok then update public.destinations set tested_at = now() where id = v_dest; end if;
  perform public.log_audit('destination_test_done', 'destination', v_dest::text,
    jsonb_build_object('ok', p_ok, 'erro', p_error));
end $$;

-- ---------- Usuários do painel ------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function public.set_profile(p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_admins integer;
begin
  perform public.require_admin();
  if p_role not in ('admin', 'operator', 'viewer') then raise exception 'Perfil inválido'; end if;
  select count(*) into v_admins from public.profiles where role = 'admin' and active and user_id <> p_user;
  if v_admins = 0 and not (p_role = 'admin' and p_active) then
    raise exception 'Operação deixaria o sistema sem nenhum administrador ativo';
  end if;
  update public.profiles set role = p_role, active = p_active where user_id = p_user;
  if not found then raise exception 'Usuário inexistente'; end if;
end $$;

-- Primeiro administrador: rode UMA vez no SQL Editor, com o e-mail já cadastrado.
create or replace function public.bootstrap_admin(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'Já existe administrador ativo';
  end if;
  update public.profiles set role = 'admin', active = true where lower(email) = lower(p_email);
  if not found then raise exception 'Cadastre-se no painel com esse e-mail antes de promovê-lo'; end if;
end $$;
