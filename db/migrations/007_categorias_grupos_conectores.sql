-- 007 — Categorias de produto por destino, descoberta/criação de grupos, config de conectores, histórico de templates
-- Aplique depois de 006. Idempotente onde possível.

-- ---------------------------------------------------------------------------
-- 1. Taxonomia de categorias (fonte única de verdade)
-- ---------------------------------------------------------------------------
create table if not exists public.product_categories (
  slug     text primary key check (slug ~ '^[a-z0-9-]{2,30}$'),
  label    text not null,
  icon     text not null default 'tag',
  sort     integer not null default 100,
  keywords text[] not null default '{}'
);

insert into public.product_categories (slug, label, icon, sort, keywords) values
  ('eletronicos',  'Eletrônicos',               'smartphone', 10, '{eletronico,audio,fone,smartphone,celular,tv,camera,smartwatch,wearable,caixa de som}'),
  ('informatica',  'Informática',               'laptop',     20, '{informatica,computador,notebook,periferico,teclado,mouse,monitor,impressora,ssd,roteador}'),
  ('games',        'Games',                     'gamepad',    30, '{game,games,console,videogame,playstation,xbox,nintendo}'),
  ('casa',         'Casa e decoração',          'home',       40, '{casa,decoracao,movel,moveis,iluminacao,jardim,limpeza,utilidades domesticas,cama mesa banho}'),
  ('cozinha',      'Cozinha e eletrodomésticos','utensils',   50, '{cozinha,eletrodomestico,panela,airfryer,air fryer,cafeteira,liquidificador,geladeira}'),
  ('automotivo',   'Carro e moto',              'car',        60, '{automotivo,carro,moto,veiculo,pneu,som automotivo,acessorio automotivo,capacete}'),
  ('moda',         'Moda e acessórios',         'shirt',      70, '{moda,roupa,calcado,tenis,bolsa,relogio,acessorio,mochila}'),
  ('beleza',       'Beleza e perfumaria',       'sparkles',   80, '{beleza,perfume,maquiagem,cabelo,skincare,barbear}'),
  ('saude',        'Saúde e bem-estar',         'heart',      90, '{saude,vitamina,suplemento,bem estar,massageador}'),
  ('esporte',      'Esporte e lazer',           'dumbbell',  100, '{esporte,fitness,academia,ciclismo,bicicleta,camping,lazer,pesca}'),
  ('bebes',        'Bebês e crianças',          'baby',      110, '{bebe,bebes,infantil,crianca,maternidade}'),
  ('brinquedos',   'Brinquedos',                'puzzle',    120, '{brinquedo,boneca,lego,jogo de tabuleiro}'),
  ('ferramentas',  'Ferramentas e construção',  'wrench',    130, '{ferramenta,construcao,eletrica,obra,furadeira,parafusadeira}'),
  ('pet',          'Pet',                       'paw',       140, '{pet,animal,cachorro,gato,racao}'),
  ('mercado',      'Mercado e bebidas',         'cart',      150, '{supermercado,mercado,alimento,bebida,cafe}'),
  ('livros',       'Livros e papelaria',        'book',      160, '{livro,papelaria,escritorio,caderno}'),
  ('outros',       'Outros',                    'tag',       999, '{}')
on conflict (slug) do nothing;

create or replace function public.category_norm(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Devolve o slug da categoria para um texto livre ('Eletrônicos', 'Carro e moto', 'fone bluetooth'…).
-- Texto vazio → null. Texto sem correspondência → 'outros'.
create or replace function public.category_slug(t text) returns text
language plpgsql stable set search_path = public as $$
declare n text := public.category_norm(t); v text;
begin
  if n = '' then return null; end if;
  select pc.slug into v from public.product_categories pc
   where pc.slug <> 'outros' and (
     n = public.category_norm(pc.label) or n = replace(pc.slug, '-', ' ')
     or exists (select 1 from unnest(pc.keywords) k
                where (' ' || n || ' ') ~ (' ' || public.category_norm(k) || 's? ')))
   order by pc.sort limit 1;
  return coalesce(v, 'outros');
end $$;

-- Destinos passam a guardar SLUGS. Converte o que já existia.
update public.destinations d set categories = coalesce((
  select array_agg(distinct s) from (select public.category_slug(c) s from unnest(d.categories) c) x where s is not null), '{}')
 where cardinality(categories) > 0;

create or replace function public.validate_destination_categories() returns trigger
language plpgsql as $$
declare c text;
begin
  foreach c in array coalesce(new.categories, '{}') loop
    if not exists (select 1 from public.product_categories where slug = c) then
      raise exception 'Categoria desconhecida: %', c;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_destinations_categories on public.destinations;
create trigger trg_destinations_categories before insert or update of categories on public.destinations
  for each row execute function public.validate_destination_categories();

-- approve_offer agora compara por slug (uma oferta "Casa" entra em destino "casa", etc.)
create or replace function public.approve_offer(
  p_offer uuid, p_destinations uuid[], p_scheduled_for timestamptz default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o record; pr record; d record; c record;
  v_count integer := 0; v_id uuid; v_code text; v_text text; v_viol text[]; v_key text;
  v_base text := public.setting_text('shortlink_base', ''); v_dest uuid; v_ins integer; v_limit integer;
begin
  perform public.require_operator();
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'Oferta inexistente'; end if;
  if o.status not in ('needs_review', 'approved', 'scheduled') then
    raise exception 'Oferta em estado % não pode ser aprovada', o.status;
  end if;
  if o.affiliate_url is null then raise exception 'Oferta sem link de afiliado'; end if;
  select * into pr from public.products where id = o.product_id;
  if not public.host_allowed(pr.platform, o.affiliate_url) then
    raise exception 'Link de afiliado fora dos domínios permitidos';
  end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'Oferta vencida'; end if;
  if o.availability = 'out_of_stock' then raise exception 'Oferta sem estoque'; end if;
  if p_destinations is null or cardinality(p_destinations) = 0 then
    raise exception 'Selecione ao menos um destino';
  end if;
  select * into c from public.connectors where platform = pr.platform;
  if not o.is_simulated and (c.id is null or c.mode in ('disabled', 'paused_policy', 'error')) then
    raise exception 'Conector de % indisponível (estado: %)', pr.platform, coalesce(c.mode, 'inexistente');
  end if;

  foreach v_dest in array p_destinations loop
    select * into d from public.destinations where id = v_dest;
    if not found then raise exception 'Destino inexistente'; end if;
    if not d.enabled then raise exception 'Destino "%" está desabilitado', d.name; end if;
    if cardinality(d.categories) > 0 and (public.category_slug(pr.category) is null or not (public.category_slug(pr.category) = any (d.categories))) then
      raise exception 'Categoria da oferta não é aceita pelo destino "%"', d.name;
    end if;

    v_key := p_offer::text || ':' || v_dest::text || ':1';
    if exists (select 1 from public.publications where idempotency_key = v_key) then continue; end if;

    v_id := gen_random_uuid();
    v_code := substr(md5(random()::text || clock_timestamp()::text || v_id::text), 1, 8);
    v_text := public.render_offer_text(p_offer, v_dest, v_code);
    v_viol := public.text_violations(v_text);
    if cardinality(v_viol) > 0 then
      raise exception 'Texto contém termos proibidos: %', array_to_string(v_viol, ', ');
    end if;
    v_limit := case when pr.image_url is not null then 1024 else 4096 end;
    if d.channel = 'telegram' and length(v_text) > v_limit then
      raise exception 'Texto excede o limite do Telegram (% de % caracteres)', length(v_text), v_limit;
    end if;

    insert into public.publications
      (id, offer_id, destination_id, content_version, rendered_text, status, idempotency_key,
       scheduled_for, next_attempt_at)
    values (v_id, p_offer, v_dest, 1, v_text, 'pending', v_key,
            coalesce(p_scheduled_for, now()), coalesce(p_scheduled_for, now()))
    on conflict (idempotency_key) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 1 then
      if coalesce(c.use_short_link, true) and v_base <> '' then
        insert into public.short_links (code, publication_id, target_url) values (v_code, v_id, o.affiliate_url);
      end if;
      v_count := v_count + 1;
    end if;
  end loop;

  update public.offers
     set status = 'scheduled', approved_by = coalesce(auth.uid(), approved_by), approved_at = now()
   where id = p_offer;
  perform public.log_audit('offer_approved', 'offer', p_offer::text,
    jsonb_build_object('destinos', to_jsonb(p_destinations), 'publicacoes_criadas', v_count,
                       'agendada_para', p_scheduled_for));
  return v_count;
end $$;


create or replace function public.set_offer_category(p_offer uuid, p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare v_label text; v_prod uuid; v_status text;
begin
  perform public.require_operator();
  select label into v_label from public.product_categories where slug = p_slug;
  if v_label is null then raise exception 'Categoria desconhecida'; end if;
  select product_id, status into v_prod, v_status from public.offers where id = p_offer for update;
  if not found then raise exception 'Oferta inexistente'; end if;
  if v_status in ('published', 'rejected', 'expired') then raise exception 'Oferta em estado % não pode mudar de categoria', v_status; end if;
  update public.products set category = v_label where id = v_prod;
  perform public.log_audit('offer_category_set', 'offer', p_offer::text, jsonb_build_object('categoria', p_slug));
end $$;

create or replace function public.reopen_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  update public.offers set status = 'needs_review', rejected_reason = null where id = p_offer and status = 'rejected';
  if not found then raise exception 'Só é possível reabrir ofertas rejeitadas'; end if;
  perform public.log_audit('offer_reopened', 'offer', p_offer::text);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tarefas de canal: buscar grupos, criar grupo, verificar chat
-- ---------------------------------------------------------------------------
create table if not exists public.channel_jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('refresh_groups', 'create_group', 'verify_chat')),
  channel         text not null check (channel in ('telegram', 'whatsapp')),
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed', 'cancelled')),
  result          jsonb,
  last_error      text,
  idempotency_key text unique,
  requested_by    uuid,
  requested_at    timestamptz not null default now(),
  claimed_at      timestamptz,
  locked_until    timestamptz,
  finished_at     timestamptz
);
create index if not exists channel_jobs_pending_idx on public.channel_jobs (requested_at) where status in ('pending', 'claimed');

create or replace function public.request_group_refresh(p_channel text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_operator();
  if p_channel not in ('telegram', 'whatsapp') then raise exception 'Canal inválido'; end if;
  select id into v_id from public.channel_jobs
   where kind = 'refresh_groups' and channel = p_channel and status in ('pending', 'claimed') order by requested_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.channel_jobs (kind, channel, requested_by) values ('refresh_groups', p_channel, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.request_group_creation(p_channel text, p_name text, p_description text, p_participants jsonb, p_key text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, '')); v_parts jsonb; v_viol text[]; v_max integer := public.setting_int('max_group_creations_per_day', 3);
begin
  perform public.require_admin();
  if p_channel <> 'whatsapp' then
    raise exception 'O Telegram não permite que bots criem grupos ou canais. Crie no aplicativo, adicione o bot como administrador e use "Buscar grupos".';
  end if;
  if length(v_name) < 3 or length(v_name) > 100 then raise exception 'O nome do grupo precisa ter de 3 a 100 caracteres'; end if;
  v_viol := public.text_violations(v_name || ' ' || coalesce(p_description, ''));
  if cardinality(v_viol) > 0 then raise exception 'Nome/descrição contém termos proibidos: %', array_to_string(v_viol, ', '); end if;
  if length(coalesce(p_description, '')) > 500 then raise exception 'Descrição longa demais (máx. 500)'; end if;
  select coalesce(jsonb_agg(distinct d), '[]'::jsonb) into v_parts from (
    select regexp_replace(x ->> 'external_id', '\D', '', 'g') as d from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) x) q
   where d ~ '^\d{10,15}$';
  if jsonb_array_length(v_parts) < 1 then raise exception 'Selecione ao menos 1 participante com número válido (DDI+DDD+número)'; end if;
  if jsonb_array_length(v_parts) > 256 then raise exception 'Máximo de 256 participantes na criação'; end if;
  if coalesce(btrim(p_key), '') <> '' then
    select id into v_id from public.channel_jobs where idempotency_key = p_key;
    if v_id is not null then return v_id; end if;
  end if;
  if (select count(*) from public.channel_jobs where kind = 'create_group' and channel = p_channel
        and status <> 'cancelled' and requested_at > now() - interval '24 hours') >= v_max then
    raise exception 'Limite de % criações de grupo por dia atingido (proteção contra bloqueio do número)', v_max;
  end if;
  insert into public.channel_jobs (kind, channel, payload, idempotency_key, requested_by)
  values ('create_group', p_channel, jsonb_build_object('name', v_name, 'description', nullif(btrim(coalesce(p_description, '')), ''), 'participants', v_parts),
          nullif(btrim(p_key), ''), auth.uid()) returning id into v_id;
  perform public.log_audit('group_creation_requested', 'channel_job', v_id::text, jsonb_build_object('nome', v_name, 'participantes', jsonb_array_length(v_parts)));
  return v_id;
end $$;

create or replace function public.request_chat_verify(p_channel text, p_ref text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text := btrim(coalesce(p_ref, ''));
begin
  perform public.require_operator();
  if p_channel <> 'telegram' then raise exception 'Verificação por referência só existe para o Telegram'; end if;
  if v_ref !~ '^(@[A-Za-z0-9_]{5,32}|-?[0-9]{5,20})$' then raise exception 'Informe @usuario do canal/grupo ou o ID numérico (ex.: -1001234567890)'; end if;
  insert into public.channel_jobs (kind, channel, payload, requested_by) values ('verify_chat', p_channel, jsonb_build_object('ref', v_ref), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_channel_job(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  update public.channel_jobs set status = 'cancelled', finished_at = now() where id = p_id and status = 'pending';
  if not found then raise exception 'Só é possível cancelar tarefas que ainda não começaram'; end if;
end $$;

-- Worker (n8n)
create or replace function public.claim_channel_job(p_worker text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  -- reserva vencida: criação de grupo NUNCA repete (poderia duplicar); as demais voltam para a fila
  update public.channel_jobs set status = 'failed', finished_at = now(), locked_until = null,
         last_error = 'reserva vencida: confira no aplicativo se o grupo foi criado antes de tentar de novo'
   where status = 'claimed' and locked_until < now() and kind = 'create_group';
  update public.channel_jobs set status = 'pending', locked_until = null where status = 'claimed' and locked_until < now();
  select * into v from public.channel_jobs
   where status = 'pending' and (kind = 'refresh_groups' or not public.setting_bool('paused', false))
   order by requested_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.channel_jobs set status = 'claimed', claimed_at = now(), locked_until = now() + interval '180 seconds' where id = v.id;
  return jsonb_build_object('id', v.id, 'kind', v.kind, 'channel', v.channel, 'payload', v.payload);
end $$;

create or replace function public.complete_channel_job(p_id uuid, p_result jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare j record; g jsonb; v_chat uuid; v_n integer := 0;
begin
  select * into j from public.channel_jobs where id = p_id and status = 'claimed' for update;
  if not found then raise exception 'Tarefa não está reservada'; end if;
  if j.kind = 'refresh_groups' then
    for g in select * from jsonb_array_elements(coalesce(p_result -> 'groups', '[]'::jsonb)) loop
      perform public.upsert_chat(g || jsonb_build_object('channel', j.channel)); v_n := v_n + 1;
    end loop;
    update public.channel_jobs set result = jsonb_build_object('groups', v_n) where id = p_id;
  elsif j.kind = 'create_group' then
    if coalesce(p_result ->> 'external_id', '') = '' then raise exception 'Resultado sem external_id do grupo'; end if;
    v_chat := public.upsert_chat(jsonb_build_object('channel', j.channel, 'external_id', p_result ->> 'external_id', 'kind', 'group',
      'title', coalesce(p_result ->> 'title', j.payload ->> 'name'), 'description', j.payload ->> 'description',
      'participant_count', jsonb_array_length(coalesce(p_result -> 'participants', '[]'::jsonb)), 'we_are_admin', true));
    perform public.sync_chat_participants(v_chat, coalesce(p_result -> 'participants', '[]'::jsonb));
    update public.channel_jobs set result = jsonb_build_object('chat_id', v_chat, 'external_id', p_result ->> 'external_id') where id = p_id;
  else
    v_chat := public.upsert_chat((p_result -> 'chat') || jsonb_build_object('channel', j.channel));
    update public.channel_jobs set result = jsonb_build_object('chat_id', v_chat) where id = p_id;
  end if;
  update public.channel_jobs set status = 'done', finished_at = now(), locked_until = null where id = p_id;
end $$;

create or replace function public.fail_channel_job(p_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.channel_jobs set status = 'failed', last_error = left(p_error, 300), finished_at = now(), locked_until = null
   where id = p_id and status = 'claimed'
$$;

-- Leituras do painel
create or replace function public.list_discovered_groups(p_channel text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'chat_id', c.id, 'external_id', c.external_id, 'title', c.title, 'kind', c.kind, 'username', c.username,
      'participant_count', c.participant_count, 'we_are_admin', c.we_are_admin,
      'destination_id', d.id, 'destination_name', d.name) order by c.title)
    from public.chats c left join public.destinations d on d.channel = c.channel and d.external_id = c.external_id
   where c.channel = p_channel and c.kind in ('group', 'channel') and not c.archived), '[]'::jsonb);
end $$;

create or replace function public.list_contacts(p_channel text, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('external_id', x.eid, 'display_name', x.name) order by x.name) from (
      select distinct on (eid) eid, name from (
        select c.external_id as eid, c.title as name from public.chats c where c.channel = p_channel and c.kind = 'private'
        union all
        select cp.external_id, coalesce(cp.display_name, cp.external_id) from public.chat_participants cp join public.chats c on c.id = cp.chat_id
         where c.channel = p_channel and cp.role <> 'owner') u
      where coalesce(p_q, '') = '' or u.name ilike '%' || p_q || '%' or u.eid ilike '%' || p_q || '%'
      order by eid, name) x limit 300), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Configuração dos conectores (sem segredos!)
-- ---------------------------------------------------------------------------
create or replace function public.validate_connector_config() returns trigger
language plpgsql as $$
declare k text; v jsonb; n numeric;
begin
  for k, v in select * from jsonb_each(coalesce(new.config, '{}'::jsonb)) loop
    if k ~* '(secret|token|passw|senha|api_?key|authorization|bearer)' then
      raise exception 'Não guarde segredos no painel (campo "%"). Guarde a credencial no n8n e informe só o nome dela em credential_ref.', k;
    end if;
    if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^(sk-|eyJ|AKIA|xox[bp]-|ghp_)' then
      raise exception 'O valor de "%" parece um segredo; não é permitido guardá-lo aqui', k;
    end if;
  end loop;
  foreach k in array array['poll_minutes', 'min_discount_pct', 'min_score', 'max_items_per_run', 'max_price', 'min_price'] loop
    if new.config ? k then
      if jsonb_typeof(new.config -> k) <> 'number' then raise exception '"%" precisa ser número', k; end if;
      n := (new.config ->> k)::numeric;
      if k = 'poll_minutes' and (n < 5 or n > 1440) then raise exception 'poll_minutes deve ficar entre 5 e 1440'; end if;
      if k = 'min_discount_pct' and (n < 0 or n > 95) then raise exception 'min_discount_pct deve ficar entre 0 e 95'; end if;
      if k = 'min_score' and (n < 0 or n > 100) then raise exception 'min_score deve ficar entre 0 e 100'; end if;
      if k = 'max_items_per_run' and (n < 1 or n > 500) then raise exception 'max_items_per_run deve ficar entre 1 e 500'; end if;
      if k in ('max_price', 'min_price') and n < 0 then raise exception '% não pode ser negativo', k; end if;
    end if;
  end loop;
  if new.config ? 'categories' then
    if jsonb_typeof(new.config -> 'categories') <> 'array' then raise exception '"categories" precisa ser uma lista'; end if;
    if exists (select 1 from jsonb_array_elements_text(new.config -> 'categories') s where s not in (select slug from public.product_categories)) then
      raise exception 'Categoria desconhecida em "categories"';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_connectors_config on public.connectors;
create trigger trg_connectors_config before insert or update of config on public.connectors
  for each row execute function public.validate_connector_config();

-- ---------------------------------------------------------------------------
-- 4. Histórico de versões dos templates
-- ---------------------------------------------------------------------------
create table if not exists public.template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  version     integer not null,
  body        text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  unique (template_id, version)
);
insert into public.template_versions (template_id, version, body) select id, version, body from public.templates on conflict do nothing;
create or replace function public.log_template_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.body is distinct from old.body then
    insert into public.template_versions (template_id, version, body, changed_by) values (new.id, new.version, new.body, auth.uid())
    on conflict (template_id, version) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_templates_history on public.templates;
create trigger trg_templates_history after insert or update of body on public.templates
  for each row execute function public.log_template_version();

-- ---------------------------------------------------------------------------
-- 5. Reagendar publicação
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_publication(p_id uuid, p_when timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  if p_when is null or p_when < now() - interval '1 minute' or p_when > now() + interval '30 days' then
    raise exception 'Escolha um horário entre agora e 30 dias';
  end if;
  update public.publications set scheduled_for = greatest(p_when, now()), next_attempt_at = greatest(p_when, now()), note = 'Reagendada manualmente'
   where id = p_id and status in ('pending', 'retry_scheduled');
  if not found then raise exception 'Só é possível reagendar publicações pendentes ou em nova tentativa'; end if;
  perform public.log_audit('publication_rescheduled', 'publication', p_id::text, jsonb_build_object('para', p_when));
end $$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.channel_jobs       enable row level security;
alter table public.template_versions  enable row level security;
create policy read_member on public.product_categories for select to authenticated using (public.is_member());
create policy read_member on public.channel_jobs       for select to authenticated using (public.is_member());
create policy read_member on public.template_versions for select to authenticated using (public.is_member());
revoke all on public.product_categories, public.channel_jobs, public.template_versions from anon;
grant select on public.product_categories, public.channel_jobs, public.template_versions to authenticated;
grant all on public.product_categories, public.channel_jobs, public.template_versions to service_role;

revoke all on function public.category_norm(text), public.category_slug(text), public.set_offer_category(uuid, text), public.reopen_offer(uuid),
  public.request_group_refresh(text), public.request_group_creation(text, text, text, jsonb, text), public.request_chat_verify(text, text),
  public.cancel_channel_job(uuid), public.claim_channel_job(text), public.complete_channel_job(uuid, jsonb), public.fail_channel_job(uuid, text),
  public.list_discovered_groups(text), public.list_contacts(text, text), public.reschedule_publication(uuid, timestamptz),
  public.approve_offer(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.category_norm(text), public.category_slug(text), public.claim_channel_job(text),
  public.complete_channel_job(uuid, jsonb), public.fail_channel_job(uuid, text) to service_role;
grant execute on function public.category_slug(text), public.set_offer_category(uuid, text), public.reopen_offer(uuid),
  public.request_group_refresh(text), public.request_group_creation(text, text, text, jsonb, text), public.request_chat_verify(text, text),
  public.cancel_channel_job(uuid), public.list_discovered_groups(text), public.list_contacts(text, text),
  public.reschedule_publication(uuid, timestamptz), public.approve_offer(uuid, uuid[], timestamptz) to authenticated;
grant execute on function public.approve_offer(uuid, uuid[], timestamptz) to service_role;
