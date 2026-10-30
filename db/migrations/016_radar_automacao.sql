-- ============================================================================
-- 016 — Radar de grupos, automação, medição e operação
--
--  0. variação de texto nos templates ([[opção 1|opção 2]]);
--  1. sinais da oferta (comissão, vendas, nota, nº de fontes) e score v2 com checagem de "de/por" inflado;
--  2. revalidação do preço antes do envio (reprice_offer, contexto da publicação, link por destino);
--  3. Radar: fontes monitoradas, links capturados, cache de links e fila de mensagens;
--  4. roteamento por regras e aprovação automática de verdade;
--  5. lista de produtos acompanhados (queda de preço);
--  6. comissões (relatórios das lojas), alertas com intervalo e limpeza periódica.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Variação de texto: "[[A|B|C]]" vira uma das opções, sorteada a cada renderização
-- ---------------------------------------------------------------------------
create or replace function public.spin_text(t text) returns text
language plpgsql volatile as $$
declare m text[]; opts text[]; v_out text := coalesce(t, ''); v_pick text; v_guard integer := 0;
begin
  loop
    m := regexp_match(v_out, '\[\[([^\[\]]+)\]\]');
    exit when m is null or v_guard > 50;
    opts := string_to_array(m[1], '|');
    v_pick := replace(opts[1 + floor(random() * array_length(opts, 1))::integer], '\', '\\');
    v_out := regexp_replace(v_out, '\[\[[^\[\]]+\]\]', v_pick);
    v_guard := v_guard + 1;
  end loop;
  return v_out;
end $$;

do $$
declare d text; old constant text := $a$if t is null then raise exception 'Sem template ativo de oferta para %', d.channel; end if;$a$;
begin
  d := pg_get_functiondef('public.render_offer_text(uuid,uuid,text)'::regprocedure);
  if position('spin_text' in d) > 0 then return; end if;
  if position(old in d) = 0 then raise exception 'Migração 016: trecho esperado não encontrado em render_offer_text'; end if;
  execute replace(d, old, old || E'\n  t := public.spin_text(t);');
end $$;

-- templates de fábrica ganham variação (só onde ainda não há)
update public.templates set body = replace(body, '💰 {{price}}', '[[💰|🏷️|💸]] {{price}}')
 where body like '%💰 {{price}}%' and body not like '%[[%';

-- ---------------------------------------------------------------------------
-- 1. Sinais da oferta e score v2
-- ---------------------------------------------------------------------------
alter table public.offers
  add column if not exists commission_pct numeric(5, 2),
  add column if not exists sold_count     integer,
  add column if not exists rating         numeric(3, 2),
  add column if not exists source_count   integer not null default 1,
  add column if not exists auto_ok        boolean not null default false,
  add column if not exists revalidated_at timestamptz;

alter table public.destinations add column if not exists sub_id text default ('g' || substr(md5(random()::text), 1, 6));
update public.destinations set sub_id = 'g' || substr(md5(id::text), 1, 6) where sub_id is null;

create or replace function public.score_offer(p_offer uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o record; obs record;
  v_score integer := 0; v_reasons jsonb := '[]'::jsonb; v_age numeric; v_pts integer;
  v_hmax numeric; v_hcnt integer; v_hdays integer; v_inflated boolean := false;
begin
  select * into o from public.offers where id = p_offer;
  if not found then raise exception 'oferta inexistente'; end if;
  select * into obs from public.price_observations where id = o.observation_id;

  -- Confiança da fonte (até 40)
  v_pts := case obs.source_kind when 'api' then 40 when 'feed' then 30 else 20 end;
  v_score := v_score + v_pts;
  v_reasons := v_reasons || jsonb_build_object('code', 'source', 'points', v_pts,
    'label', case obs.source_kind when 'api' then 'Fonte oficial (API)' when 'feed' then 'Feed de oferta'
                                  else 'Dado declarado por você' end);

  -- Frescor do dado (até 20)
  v_age := extract(epoch from (now() - o.price_observed_at)) / 60;
  v_pts := case when v_age <= 60 then 20 when v_age <= 360 then 10 else 0 end;
  v_score := v_score + v_pts;
  v_reasons := v_reasons || jsonb_build_object('code', 'freshness', 'points', v_pts,
    'label', case when v_pts = 20 then 'Preço observado há menos de 1 h'
                  when v_pts = 10 then 'Preço observado há menos de 6 h'
                  else 'Dado com mais de 6 h' end);

  -- "De/por" inflado: o preço anterior da loja está muito acima do que a gente mesmo já viu
  if o.previous_price is not null and o.previous_price_source in ('api', 'feed') then
    select max(price), count(*), count(distinct (observed_at at time zone 'America/Sao_Paulo')::date)
      into v_hmax, v_hcnt, v_hdays
      from public.price_observations
     where product_id = o.product_id and id <> coalesce(o.observation_id, -1)
       and source_kind in ('api', 'feed') and observed_at > now() - interval '30 days';
    v_inflated := v_hcnt >= 2 and v_hdays >= 2 and o.previous_price > v_hmax * 1.25;
  end if;

  -- Desconto comprovado (até 35): 1 ponto por 1 % de queda; metade se o "de" parece inflado
  if o.discount_pct is not null then
    v_pts := least(35, floor(o.discount_pct))::integer;
    if v_inflated then v_pts := v_pts / 2; end if;
    v_score := v_score + v_pts;
    v_reasons := v_reasons || jsonb_build_object('code', 'discount', 'points', v_pts,
      'label', 'Queda de ' || o.discount_pct || '% (' ||
               case o.previous_price_source when 'own_history' then 'histórico próprio' else 'fonte oficial' end || ')');
  else
    v_reasons := v_reasons || jsonb_build_object('code', 'discount', 'points', 0, 'label', 'Sem desconto comprovado');
  end if;
  if v_inflated then
    v_score := v_score - 10;
    v_reasons := v_reasons || jsonb_build_object('code', 'inflated', 'points', -10,
      'label', 'O preço anterior da loja está acima do histórico próprio (possível "de/por" inflado)');
  end if;

  -- Link de afiliado válido (5)
  if o.affiliate_url is not null and public.host_allowed(
       (select platform from public.products where id = o.product_id), o.affiliate_url) then
    v_score := v_score + 5;
    v_reasons := v_reasons || jsonb_build_object('code', 'link', 'points', 5, 'label', 'Link de afiliado presente');
  else
    v_reasons := v_reasons || jsonb_build_object('code', 'link', 'points', 0, 'label', 'Link de afiliado ausente ou não confirmado');
  end if;

  -- Sinais extras (só somam quando existem)
  if o.commission_pct is not null then
    v_pts := case when o.commission_pct >= 8 then 5 when o.commission_pct >= 4 then 3 else 0 end;
    if v_pts > 0 then v_score := v_score + v_pts; v_reasons := v_reasons || jsonb_build_object('code', 'commission', 'points', v_pts, 'label', 'Comissão de ' || o.commission_pct || '%'); end if;
  end if;
  if o.sold_count is not null then
    v_pts := case when o.sold_count >= 500 then 5 when o.sold_count >= 100 then 3 else 0 end;
    if v_pts > 0 then v_score := v_score + v_pts; v_reasons := v_reasons || jsonb_build_object('code', 'sales', 'points', v_pts, 'label', o.sold_count || ' vendidos'); end if;
  end if;
  if o.rating is not null and o.rating >= 4.7 then
    v_score := v_score + 3; v_reasons := v_reasons || jsonb_build_object('code', 'rating', 'points', 3, 'label', 'Nota ' || o.rating);
  end if;
  if o.source_count >= 2 then
    v_pts := case when o.source_count >= 3 then 8 else 5 end;
    v_score := v_score + v_pts; v_reasons := v_reasons || jsonb_build_object('code', 'sources', 'points', v_pts, 'label', 'Visto em ' || o.source_count || ' fontes');
  end if;

  v_score := greatest(0, least(100, v_score));
  update public.offers set score = v_score, score_reasons = v_reasons where id = p_offer;
  return v_score;
end $$;

-- sinais vindos das lojas / do Radar (service_role) e rescore
create or replace function public.set_offer_signals(p_offer uuid, p_commission numeric, p_sold integer, p_rating numeric, p_auto_ok boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.offers set commission_pct = coalesce(p_commission, commission_pct), sold_count = coalesce(p_sold, sold_count),
         rating = coalesce(p_rating, rating), auto_ok = coalesce(p_auto_ok, auto_ok) where id = p_offer;
  perform public.score_offer(p_offer);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Revalidação antes do envio e link por destino
-- ---------------------------------------------------------------------------
create or replace function public.get_publication_context(p_pub uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'publication_id', pu.id, 'offer_id', o.id, 'platform', pr.platform, 'external_id', pr.external_id, 'title', pr.title,
    'current_price', o.current_price, 'availability', o.availability, 'original_url', o.original_url, 'affiliate_url', o.affiliate_url,
    'revalidated_at', o.revalidated_at, 'sub_id', d.sub_id, 'destination', d.name, 'is_simulated', o.is_simulated,
    'short_code', (select sl.code from public.short_links sl where sl.publication_id = pu.id limit 1))
  from public.publications pu join public.offers o on o.id = pu.offer_id join public.products pr on pr.id = o.product_id
  join public.destinations d on d.id = pu.destination_id where pu.id = p_pub
$$;

create or replace function public.mark_offer_revalidated(p_offer uuid) returns void
language sql security definer set search_path = public as $$
  update public.offers set revalidated_at = now() where id = p_offer
$$;

-- Preço mudou ou acabou: registra a observação, devolve a oferta para revisão e cancela os envios pendentes.
create or replace function public.reprice_offer(p_offer uuid, p_price numeric, p_available boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare o record; v_obs bigint; v_disc numeric;
begin
  perform public.require_operator();
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'Oferta inexistente'; end if;
  if p_price is not null and p_price > 0 then
    insert into public.price_observations (product_id, price, availability, source_kind, source_name, observed_at)
    values (o.product_id, p_price, case when p_available then 'in_stock' else 'out_of_stock' end, 'api', 'revalidação antes do envio', now())
    returning id into v_obs;
    v_disc := case when o.previous_price is not null and o.previous_price > p_price
                   then least(99.99, round((o.previous_price - p_price) / o.previous_price * 100, 2)) end;
    update public.offers set current_price = p_price, observation_id = v_obs, price_observed_at = now(), discount_pct = v_disc,
           availability = case when p_available then 'in_stock' else 'out_of_stock' end where id = p_offer;
  end if;
  update public.offers set status = case when p_available then 'needs_review' else 'expired' end, revalidated_at = now(),
         validation_notes = validation_notes || jsonb_build_array(left(coalesce(p_note, 'Preço revalidado'), 200)) where id = p_offer;
  update public.publications set status = 'cancelled', note = 'Preço mudou antes do envio: oferta voltou para revisão',
         locked_by = null, locked_until = null
   where offer_id = p_offer and status in ('pending', 'retry_scheduled', 'claimed');
  perform public.score_offer(p_offer);
  perform public.log_audit('offer_repriced', 'offer', p_offer::text, jsonb_build_object('preco', p_price, 'disponivel', p_available));
end $$;

-- link rastreável por destino: o texto leva o código curto; aqui troca o destino final do redirecionador
create or replace function public.set_short_link_target(p_pub uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare v_platform text;
begin
  select pr.platform into v_platform from public.publications pu join public.offers o on o.id = pu.offer_id
    join public.products pr on pr.id = o.product_id where pu.id = p_pub;
  if v_platform is null then raise exception 'Publicação inexistente'; end if;
  if not public.host_allowed(v_platform, btrim(p_url)) then raise exception 'Link fora dos domínios permitidos'; end if;
  update public.short_links set target_url = btrim(p_url) where publication_id = p_pub;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Radar de grupos
-- ---------------------------------------------------------------------------
create table if not exists public.promo_sources (
  id               uuid primary key default gen_random_uuid(),
  chat_id          uuid not null unique references public.chats (id) on delete cascade,
  enabled          boolean not null default true,
  mode             text not null default 'review' check (mode in ('review', 'auto')),
  platforms        text[] not null default '{}',
  min_discount_pct numeric(5, 2) check (min_discount_pct is null or min_discount_pct between 0 and 95),
  blocked_words    text[] not null default '{}',
  max_per_hour     integer not null default 20 check (max_per_hour between 1 and 200),
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_promo_sources_updated on public.promo_sources;
create trigger trg_promo_sources_updated before update on public.promo_sources for each row execute function public.set_updated_at();

create table if not exists public.captured_links (
  id              bigint generated always as identity primary key,
  source_id       uuid references public.promo_sources (id) on delete cascade,
  chat_message_id uuid references public.chat_messages (id) on delete set null,
  original_url    text not null,
  final_url       text,
  platform        text,
  external_id     text,
  status          text not null check (status in ('new', 'ineligible', 'offer_created', 'duplicate', 'filtered', 'error', 'ignored')),
  reason          text,
  offer_id        uuid references public.offers (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists captured_links_source_idx on public.captured_links (source_id, created_at desc);
create index if not exists captured_links_time_idx on public.captured_links (created_at desc);

create table if not exists public.link_cache (
  url_hash    text primary key,
  final_url   text,
  platform    text,
  external_id text,
  resolved_at timestamptz not null default now()
);

create table if not exists public.offer_sources (
  offer_id  uuid not null references public.offers (id) on delete cascade,
  source_id uuid not null references public.promo_sources (id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (offer_id, source_id)
);

alter table public.chat_messages add column if not exists radar_done boolean not null default false;
create index if not exists chat_messages_radar_idx on public.chat_messages (sent_at) where not radar_done and direction = 'in';

-- mensagens novas das fontes (com link), nunca de grupos que também são destinos (anti-eco)
create or replace function public.claim_radar_messages(p_limit integer default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select cm.id from public.chat_messages cm join public.promo_sources ps on ps.chat_id = cm.chat_id and ps.enabled
     where cm.direction = 'in' and not cm.radar_done and cm.sent_at > now() - interval '2 hours' and cm.body ~* 'https?://'
       and not exists (select 1 from public.chats c2 join public.destinations d on d.channel = c2.channel and d.external_id = c2.external_id where c2.id = cm.chat_id)
     order by cm.sent_at limit least(greatest(p_limit, 1), 100) for update of cm skip locked),
  upd as (
    update public.chat_messages m set radar_done = true from picked where m.id = picked.id
    returning m.id, m.chat_id, m.body, m.sender_name, m.sent_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'sent_at', u.sent_at, 'chat_title', c.title, 'channel', c.channel,
      'source', jsonb_build_object('id', ps.id, 'mode', ps.mode, 'platforms', to_jsonb(ps.platforms), 'min_discount_pct', ps.min_discount_pct,
        'blocked_words', to_jsonb(ps.blocked_words), 'max_per_hour', ps.max_per_hour,
        'created_last_hour', (select count(*) from public.captured_links cl where cl.source_id = ps.id and cl.status = 'offer_created' and cl.created_at > now() - interval '1 hour'))) order by u.sent_at), '[]'::jsonb)
    into v
    from upd u join public.promo_sources ps on ps.chat_id = u.chat_id join public.chats c on c.id = u.chat_id;
  return v;
end $$;

create or replace function public.record_captured_link(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.captured_links (source_id, chat_message_id, original_url, final_url, platform, external_id, status, reason, offer_id)
  values (nullif(p ->> 'source_id', '')::uuid, nullif(p ->> 'chat_message_id', '')::uuid, left(p ->> 'original_url', 1000), left(p ->> 'final_url', 1000),
          p ->> 'platform', left(p ->> 'external_id', 120), coalesce(p ->> 'status', 'new'), left(p ->> 'reason', 300), nullif(p ->> 'offer_id', '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.link_cache_get(p_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('final_url', final_url, 'platform', platform, 'external_id', external_id)
    from public.link_cache where url_hash = p_hash and resolved_at > now() - interval '7 days'
$$;
create or replace function public.link_cache_put(p_hash text, p_final text, p_platform text, p_external text) returns void
language sql security definer set search_path = public as $$
  insert into public.link_cache (url_hash, final_url, platform, external_id) values (p_hash, left(p_final, 1000), p_platform, left(p_external, 120))
  on conflict (url_hash) do update set final_url = excluded.final_url, platform = excluded.platform, external_id = excluded.external_id, resolved_at = now()
$$;

-- mesmo produto visto em outra fonte: soma ao contador e rescore (sinal de oferta quente)
create or replace function public.register_offer_source(p_offer uuid, p_source uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer; v_ins integer;
begin
  insert into public.offer_sources (offer_id, source_id) values (p_offer, p_source) on conflict do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_n from public.offer_sources where offer_id = p_offer;
  if v_ins = 1 then
    update public.offers set source_count = greatest(1, v_n) where id = p_offer and status in ('needs_review', 'approved', 'scheduled');
    perform public.score_offer(p_offer);
  end if;
  return v_n;
end $$;

-- ---- painel
create or replace function public.save_promo_source(p_chat uuid, p_config jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_mode text := coalesce(p_config ->> 'mode', 'review'); v_pl text[]; v_bw text[]; v_min numeric := nullif(p_config ->> 'min_discount_pct', '')::numeric; v_max integer := coalesce(nullif(p_config ->> 'max_per_hour', '')::integer, 20);
begin
  perform public.require_admin();
  if not exists (select 1 from public.chats where id = p_chat and kind in ('group', 'channel')) then raise exception 'Escolha um grupo ou canal'; end if;
  if exists (select 1 from public.destinations d join public.chats c on c.channel = d.channel and c.external_id = d.external_id where c.id = p_chat) then
    raise exception 'Este grupo é um dos seus destinos: não pode ser fonte do Radar (evita repostar as próprias ofertas)';
  end if;
  if v_mode not in ('review', 'auto') then raise exception 'Modo inválido'; end if;
  select coalesce(array_agg(x), '{}') into v_pl from jsonb_array_elements_text(coalesce(p_config -> 'platforms', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_pl) x where x not in ('mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu')) then raise exception 'Plataforma inválida'; end if;
  select coalesce(array_agg(lower(btrim(x))), '{}') into v_bw from jsonb_array_elements_text(coalesce(p_config -> 'blocked_words', '[]'::jsonb)) x where btrim(x) <> '';
  if cardinality(v_bw) > 40 then raise exception 'No máximo 40 palavras bloqueadas'; end if;
  if v_min is not null and (v_min < 0 or v_min > 95) then raise exception 'Desconto mínimo entre 0 e 95'; end if;
  if v_max < 1 or v_max > 200 then raise exception 'Limite por hora entre 1 e 200'; end if;
  insert into public.promo_sources (chat_id, enabled, mode, platforms, min_discount_pct, blocked_words, max_per_hour, notes, created_by)
  values (p_chat, coalesce((p_config ->> 'enabled')::boolean, true), v_mode, v_pl, v_min, v_bw, v_max, left(p_config ->> 'notes', 300), auth.uid())
  on conflict (chat_id) do update set enabled = excluded.enabled, mode = excluded.mode, platforms = excluded.platforms,
    min_discount_pct = excluded.min_discount_pct, blocked_words = excluded.blocked_words, max_per_hour = excluded.max_per_hour, notes = excluded.notes
  returning id into v_id;
  perform public.log_audit('promo_source_saved', 'promo_source', v_id::text, jsonb_build_object('modo', v_mode, 'plataformas', to_jsonb(v_pl)));
  return v_id;
end $$;

create or replace function public.delete_promo_source(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.promo_sources where chat_id = p_chat;
  perform public.log_audit('promo_source_deleted', 'chat', p_chat::text);
end $$;

create or replace function public.list_promo_sources() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', ps.id, 'chat_id', ps.chat_id, 'title', c.title, 'channel', c.channel, 'kind', c.kind, 'we_are_admin', c.we_are_admin,
      'enabled', ps.enabled, 'mode', ps.mode, 'platforms', to_jsonb(ps.platforms), 'min_discount_pct', ps.min_discount_pct,
      'blocked_words', to_jsonb(ps.blocked_words), 'max_per_hour', ps.max_per_hour, 'notes', ps.notes,
      'seen_7d', (select count(*) from public.captured_links cl where cl.source_id = ps.id and cl.created_at > now() - interval '7 days'),
      'offers_7d', (select count(*) from public.captured_links cl where cl.source_id = ps.id and cl.status = 'offer_created' and cl.created_at > now() - interval '7 days'),
      'duplicates_7d', (select count(*) from public.captured_links cl where cl.source_id = ps.id and cl.status = 'duplicate' and cl.created_at > now() - interval '7 days'),
      'ineligible_7d', (select count(*) from public.captured_links cl where cl.source_id = ps.id and cl.status = 'ineligible' and cl.created_at > now() - interval '7 days'),
      'published_7d', (select count(distinct pu.offer_id) from public.captured_links cl join public.publications pu on pu.offer_id = cl.offer_id and pu.status = 'sent'
                        where cl.source_id = ps.id and cl.created_at > now() - interval '7 days'),
      'clicks_7d', (select count(*) from public.captured_links cl join public.publications pu on pu.offer_id = cl.offer_id join public.short_links sl on sl.publication_id = pu.id
                      join public.click_events ce on ce.code = sl.code where cl.source_id = ps.id and cl.created_at > now() - interval '7 days'))
      order by c.title)
    from public.promo_sources ps join public.chats c on c.id = ps.chat_id), '[]'::jsonb);
end $$;

create or replace function public.list_captured_links(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select cl.id, cl.created_at, cl.status, cl.reason, cl.platform, cl.original_url, c.title as source_title, c.channel,
           pr.title as product_title, o.id as offer_id, o.status as offer_status, o.score
      from public.captured_links cl left join public.promo_sources ps on ps.id = cl.source_id left join public.chats c on c.id = ps.chat_id
      left join public.offers o on o.id = cl.offer_id left join public.products pr on pr.id = o.product_id
     order by cl.created_at desc limit least(greatest(p_limit, 1), 300)) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Roteamento por regras e aprovação automática
-- ---------------------------------------------------------------------------
create table if not exists public.routing_rules (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 2 and 80),
  enabled          boolean not null default true,
  priority         integer not null default 100,
  platforms        text[] not null default '{}',
  categories       text[] not null default '{}',
  min_score        integer not null default 0 check (min_score between 0 and 100),
  min_discount_pct numeric(5, 2) not null default 0 check (min_discount_pct between 0 and 95),
  destinations     uuid[] not null default '{}',
  auto_approve     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_routing_rules_updated on public.routing_rules;
create trigger trg_routing_rules_updated before update on public.routing_rules for each row execute function public.set_updated_at();

insert into public.settings (key, value) values
  ('max_price_drift_pct', '3'), ('revalidate_before_send', 'true'), ('auto_approve_max_per_day', '20'),
  ('radar_auto_min_score', '70'), ('search_terms', '{}'), ('alert_cooldown_min', '120')
on conflict (key) do nothing;

create or replace function public.save_routing_rule(p_id uuid, p_config jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_pl text[]; v_cat text[]; v_dest uuid[];
begin
  perform public.require_admin();
  select coalesce(array_agg(x), '{}') into v_pl from jsonb_array_elements_text(coalesce(p_config -> 'platforms', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_pl) x where x not in ('mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu')) then raise exception 'Plataforma inválida'; end if;
  select coalesce(array_agg(x), '{}') into v_cat from jsonb_array_elements_text(coalesce(p_config -> 'categories', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_cat) x where x not in (select slug from public.product_categories)) then raise exception 'Categoria desconhecida'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_dest from jsonb_array_elements_text(coalesce(p_config -> 'destinations', '[]'::jsonb)) x;
  if exists (select 1 from unnest(v_dest) x where x not in (select id from public.destinations)) then raise exception 'Destino inexistente'; end if;
  if v_id is null then
    insert into public.routing_rules (name, enabled, priority, platforms, categories, min_score, min_discount_pct, destinations, auto_approve)
    values (btrim(p_config ->> 'name'), coalesce((p_config ->> 'enabled')::boolean, true), coalesce((p_config ->> 'priority')::integer, 100), v_pl, v_cat,
            coalesce((p_config ->> 'min_score')::integer, 0), coalesce((p_config ->> 'min_discount_pct')::numeric, 0), v_dest, coalesce((p_config ->> 'auto_approve')::boolean, false))
    returning id into v_id;
  else
    update public.routing_rules set name = btrim(p_config ->> 'name'), enabled = coalesce((p_config ->> 'enabled')::boolean, enabled),
           priority = coalesce((p_config ->> 'priority')::integer, priority), platforms = v_pl, categories = v_cat,
           min_score = coalesce((p_config ->> 'min_score')::integer, 0), min_discount_pct = coalesce((p_config ->> 'min_discount_pct')::numeric, 0),
           destinations = v_dest, auto_approve = coalesce((p_config ->> 'auto_approve')::boolean, false) where id = v_id;
    if not found then raise exception 'Regra inexistente'; end if;
  end if;
  perform public.log_audit('routing_rule_saved', 'routing_rule', v_id::text, jsonb_build_object('nome', p_config ->> 'name'));
  return v_id;
end $$;

create or replace function public.delete_routing_rule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.routing_rules where id = p_id;
  perform public.log_audit('routing_rule_deleted', 'routing_rule', p_id::text);
end $$;

create or replace function public.auto_route_offer(p_offer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o record; pr record; v_slug text; v_dests uuid[] := '{}'; v_auto boolean := false; r record;
  v_thr integer := public.setting_int('auto_approve_threshold', 90); v_rthr integer := public.setting_int('radar_auto_min_score', 70);
begin
  select * into o from public.offers where id = p_offer;
  select * into pr from public.products where id = o.product_id;
  v_slug := public.category_slug(pr.category);
  for r in select * from public.routing_rules where enabled order by priority, created_at loop
    if (cardinality(r.platforms) = 0 or pr.platform = any (r.platforms))
       and (cardinality(r.categories) = 0 or v_slug = any (r.categories))
       and coalesce(o.score, 0) >= r.min_score and coalesce(o.discount_pct, 0) >= r.min_discount_pct then
      v_dests := v_dests || r.destinations;
      if r.auto_approve then v_auto := true; end if;
    end if;
  end loop;
  if not v_auto and o.auto_ok and coalesce(o.score, 0) >= v_rthr then v_auto := true; end if;
  if not v_auto and public.setting_bool('auto_approve_enabled', false) and coalesce(o.score, 0) >= v_thr then v_auto := true; end if;
  if cardinality(v_dests) = 0 then select coalesce(array_agg(id), '{}') into v_dests from public.destinations where enabled; end if;
  select coalesce(array_agg(distinct dd.id), '{}') into v_dests from public.destinations dd
   where dd.id = any (v_dests) and dd.enabled and (cardinality(dd.categories) = 0 or (v_slug is not null and v_slug = any (dd.categories)));
  return jsonb_build_object('auto', v_auto, 'destinations', to_jsonb(v_dests));
end $$;

create or replace function public.run_auto_approve(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; v_route jsonb; v_dests uuid[]; v_n integer := 0; v_err integer := 0;
  v_cap integer := public.setting_int('auto_approve_max_per_day', 20); v_today integer;
begin
  perform public.require_operator();
  if public.setting_bool('paused', false) or public.setting_text('mode', 'simulation') = 'simulation' then
    return jsonb_build_object('approved', 0, 'skipped', 'modo simulação ou pausa');
  end if;
  select count(*) into v_today from public.offers where approved_by is null
     and approved_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') and status in ('scheduled', 'approved', 'published');
  for o in select id from public.offers where status = 'needs_review' and not is_simulated and affiliate_url is not null and availability <> 'out_of_stock'
              and validation_notes::text not like '%Aprovação automática falhou%'
            order by score desc nulls last, created_at limit least(greatest(p_limit, 1), 50) loop
    exit when v_today >= v_cap;
    v_route := public.auto_route_offer(o.id);
    continue when not (v_route ->> 'auto')::boolean;
    select coalesce(array_agg(x::uuid), '{}') into v_dests from jsonb_array_elements_text(v_route -> 'destinations') x;
    continue when cardinality(v_dests) = 0;
    begin
      perform public.approve_offer(o.id, v_dests, null);
      v_n := v_n + 1; v_today := v_today + 1;
    exception when others then
      v_err := v_err + 1;
      update public.offers set auto_ok = false, validation_notes = validation_notes || jsonb_build_array('Aprovação automática falhou: ' || left(sqlerrm, 160)) where id = o.id;
    end;
  end loop;
  return jsonb_build_object('approved', v_n, 'errors', v_err);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Produtos acompanhados (queda de preço)
-- ---------------------------------------------------------------------------
create table if not exists public.watchlist (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null check (platform in ('mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu')),
  external_id     text not null,
  url             text not null,
  title           text,
  target_price    numeric(12, 2) check (target_price is null or target_price > 0),
  min_drop_pct    numeric(5, 2) not null default 10 check (min_drop_pct between 1 and 90),
  active          boolean not null default true,
  last_price      numeric(12, 2),
  last_checked_at timestamptz,
  last_offer_at   timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (platform, external_id)
);

create or replace function public.save_watch_item(p_url text, p_target numeric, p_drop numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_platform text; v_found text; v_ext text; v_id uuid; v_url text := btrim(coalesce(p_url, ''));
begin
  perform public.require_operator();
  foreach v_platform in array array['mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu'] loop
    if public.host_allowed(v_platform, v_url) then v_found := v_platform; exit; end if;
  end loop;
  if v_found is null then raise exception 'Endereço fora dos domínios permitidos das lojas'; end if;
  v_ext := public.extract_external_id(v_found, v_url);
  if v_ext is null then raise exception 'Não consegui identificar o produto neste endereço'; end if;
  insert into public.watchlist (platform, external_id, url, target_price, min_drop_pct, created_by)
  values (v_found, v_ext, public.normalize_url(v_url), p_target, coalesce(p_drop, 10), auth.uid())
  on conflict (platform, external_id) do update set target_price = excluded.target_price, min_drop_pct = excluded.min_drop_pct, active = true
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_watch_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_operator();
  delete from public.watchlist where id = p_id;
end $$;

create or replace function public.watchlist_due(p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) from (
    select id, platform, external_id, url, title, target_price, min_drop_pct, last_price from public.watchlist
     where active and (last_checked_at is null or last_checked_at < now() - interval '30 minutes')
     order by last_checked_at nulls first limit least(greatest(p_limit, 1), 30)) w
$$;

create or replace function public.watchlist_update(p_id uuid, p_price numeric, p_title text, p_offer boolean) returns void
language sql security definer set search_path = public as $$
  update public.watchlist set last_price = coalesce(p_price, last_price), title = coalesce(left(p_title, 300), title), last_checked_at = now(),
         last_offer_at = case when p_offer then now() else last_offer_at end where id = p_id
$$;

-- ---------------------------------------------------------------------------
-- 6. Comissões, alertas e limpeza
-- ---------------------------------------------------------------------------
create table if not exists public.commissions (
  id           bigint generated always as identity primary key,
  platform     text not null,
  external_ref text not null,
  purchased_at timestamptz not null,
  amount       numeric(12, 2) not null default 0,
  status       text,
  sub_id       text,
  raw          jsonb not null default '{}'::jsonb,
  unique (platform, external_ref)
);
create index if not exists commissions_time_idx on public.commissions (purchased_at desc);

create or replace function public.upsert_commissions(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    insert into public.commissions (platform, external_ref, purchased_at, amount, status, sub_id, raw)
    values (r ->> 'platform', left(r ->> 'external_ref', 120), (r ->> 'purchased_at')::timestamptz, coalesce((r ->> 'amount')::numeric, 0), left(r ->> 'status', 40), left(r ->> 'sub_id', 80),
            public.scrub(coalesce(r -> 'raw', '{}'::jsonb)))
    on conflict (platform, external_ref) do update set amount = excluded.amount, status = excluded.status, sub_id = coalesce(excluded.sub_id, public.commissions.sub_id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.commission_summary(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(days => least(greatest(p_days, 1), 365));
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return jsonb_build_object(
    'total', coalesce((select sum(amount) from public.commissions where purchased_at >= v_from), 0),
    'orders', (select count(*) from public.commissions where purchased_at >= v_from),
    'by_platform', coalesce((select jsonb_agg(jsonb_build_object('platform', platform, 'amount', a, 'orders', n) order by a desc)
        from (select platform, sum(amount) a, count(*) n from public.commissions where purchased_at >= v_from group by platform) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'amount', a) order by d)
        from (select (purchased_at at time zone 'America/Sao_Paulo')::date d, sum(amount) a from public.commissions where purchased_at >= v_from group by 1) x), '[]'::jsonb),
    'by_sub', coalesce((select jsonb_agg(jsonb_build_object('sub_id', coalesce(x.sub_id, '—'), 'destination', (select d.name from public.destinations d where d.sub_id = x.sub_id), 'amount', a, 'orders', n) order by a desc)
        from (select sub_id, sum(amount) a, count(*) n from public.commissions where purchased_at >= v_from group by sub_id) x), '[]'::jsonb));
end $$;

create table if not exists public.alert_state (
  key          text primary key,
  last_sent_at timestamptz not null default now(),
  detail       text
);
create or replace function public.alert_should_send(p_key text, p_detail text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_cool integer := public.setting_int('alert_cooldown_min', 120); v_last timestamptz;
begin
  select last_sent_at into v_last from public.alert_state where key = p_key;
  if v_last is not null and v_last > now() - make_interval(mins => v_cool) then return false; end if;
  insert into public.alert_state (key, last_sent_at, detail) values (p_key, now(), left(p_detail, 300))
  on conflict (key) do update set last_sent_at = now(), detail = excluded.detail;
  return true;
end $$;
create or replace function public.alert_clear(p_key text) returns void
language sql security definer set search_path = public as $$ delete from public.alert_state where key = p_key $$;

-- indicadores para alertas do worker
create or replace function public.ops_snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pending_old', (select count(*) from public.publications p join public.destinations d on d.id = p.destination_id
                     where p.status in ('pending', 'retry_scheduled') and p.next_attempt_at < now() - interval '45 minutes' and d.enabled),
    'unknown', (select count(*) from public.publications where status = 'unknown'),
    'failed_24h', (select count(*) from public.publications where status = 'failed_permanent' and updated_at > now() - interval '24 hours'),
    'review_waiting', (select count(*) from public.offers where status = 'needs_review' and not is_simulated),
    'destinations_enabled', (select count(*) from public.destinations where enabled),
    'collect_errors', (select coalesce(jsonb_agg(jsonb_build_object('platform', c.platform, 'error', left(c.last_error, 120))), '[]'::jsonb)
                         from public.connectors c where c.mode = 'api_ready' and c.last_error_at > now() - interval '2 hours'
                          and (c.last_success_at is null or c.last_success_at < c.last_error_at)))
$$;

create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_exp integer; v_msg integer; v_cap integer; v_cache integer; v_clk integer; v_src integer; v_alert integer;
begin
  v_exp := public.expire_offers();
  v_msg := public.purge_old_messages();
  delete from public.chat_messages m using public.promo_sources ps where m.chat_id = ps.chat_id and m.publication_id is null and m.sent_at < now() - interval '7 days';
  get diagnostics v_src = row_count;
  delete from public.captured_links where created_at < now() - interval '30 days'; get diagnostics v_cap = row_count;
  delete from public.link_cache where resolved_at < now() - interval '7 days'; get diagnostics v_cache = row_count;
  delete from public.click_events where clicked_at < now() - make_interval(days => public.setting_int('retention_days_clicks', 180)); get diagnostics v_clk = row_count;
  delete from public.alert_state where last_sent_at < now() - interval '7 days' and key not like 'job:%'; get diagnostics v_alert = row_count;
  return jsonb_build_object('ofertas_expiradas', v_exp, 'mensagens_apagadas', v_msg, 'mensagens_fontes_apagadas', v_src, 'links_capturados_apagados', v_cap, 'cache_apagado', v_cache, 'cliques_apagados', v_clk);
end $$;

-- ---------------------------------------------------------------------------
-- Runtime do worker: + termos de busca editáveis e ajustes
-- ---------------------------------------------------------------------------
create or replace function public.get_integration_runtime() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evolution', coalesce((select value from public.settings where key = 'int_evolution'), '{}'::jsonb),
    'telegram',  coalesce((select value from public.settings where key = 'int_telegram'),  '{}'::jsonb),
    'database',  coalesce((select value from public.settings where key = 'int_database'),  '{}'::jsonb),
    'paused',    public.setting_bool('paused', false),
    'status',    coalesce((select jsonb_object_agg(substr(key, 12), value) from public.settings where left(key, 11) = 'int_status_'), '{}'::jsonb),
    'secrets',   coalesce((select jsonb_object_agg(key, value) from public.integration_secrets), '{}'::jsonb),
    'search_terms', coalesce((select value from public.settings where key = 'search_terms'), '{}'::jsonb),
    'tuning',    coalesce((select jsonb_object_agg(key, value) from public.settings where key in ('max_price_drift_pct', 'revalidate_before_send', 'radar_auto_min_score')), '{}'::jsonb),
    'connectors', coalesce((select jsonb_object_agg(c.platform, jsonb_build_object(
        'mode', c.mode, 'config', c.config,
        'last_run_at', (select max(r.started_at) from public.runs r where r.connector_id = c.id)))
      from public.connectors c), '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.promo_sources  enable row level security;
alter table public.captured_links enable row level security;
alter table public.link_cache     enable row level security;
alter table public.offer_sources  enable row level security;
alter table public.routing_rules  enable row level security;
alter table public.watchlist      enable row level security;
alter table public.commissions    enable row level security;
alter table public.alert_state    enable row level security;
do $$ begin
  create policy read_member on public.promo_sources  for select to authenticated using (public.is_member());
  create policy read_member on public.captured_links for select to authenticated using (public.is_member());
  create policy read_member on public.routing_rules  for select to authenticated using (public.is_member());
  create policy read_member on public.watchlist      for select to authenticated using (public.is_member());
  create policy read_member on public.commissions    for select to authenticated using (public.is_member());
exception when duplicate_object then null; end $$;
revoke all on public.promo_sources, public.captured_links, public.link_cache, public.offer_sources, public.routing_rules, public.watchlist, public.commissions, public.alert_state from anon, authenticated;
grant select on public.promo_sources, public.captured_links, public.routing_rules, public.watchlist, public.commissions to authenticated;
grant all on public.promo_sources, public.captured_links, public.link_cache, public.offer_sources, public.routing_rules, public.watchlist, public.commissions, public.alert_state to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.spin_text(text), public.set_offer_signals(uuid, numeric, integer, numeric, boolean), public.get_publication_context(uuid), public.mark_offer_revalidated(uuid),
  public.reprice_offer(uuid, numeric, boolean, text), public.set_short_link_target(uuid, text), public.claim_radar_messages(integer), public.record_captured_link(jsonb),
  public.link_cache_get(text), public.link_cache_put(text, text, text, text), public.register_offer_source(uuid, uuid), public.save_promo_source(uuid, jsonb),
  public.delete_promo_source(uuid), public.list_promo_sources(), public.list_captured_links(integer), public.save_routing_rule(uuid, jsonb), public.delete_routing_rule(uuid),
  public.auto_route_offer(uuid), public.run_auto_approve(integer), public.save_watch_item(text, numeric, numeric), public.delete_watch_item(uuid), public.watchlist_due(integer),
  public.watchlist_update(uuid, numeric, text, boolean), public.upsert_commissions(jsonb), public.commission_summary(integer), public.alert_should_send(text, text),
  public.alert_clear(text), public.ops_snapshot(), public.housekeeping(), public.score_offer(uuid), public.get_integration_runtime() from public, anon;
grant execute on function public.spin_text(text), public.set_offer_signals(uuid, numeric, integer, numeric, boolean), public.get_publication_context(uuid), public.mark_offer_revalidated(uuid),
  public.reprice_offer(uuid, numeric, boolean, text), public.set_short_link_target(uuid, text), public.claim_radar_messages(integer), public.record_captured_link(jsonb),
  public.link_cache_get(text), public.link_cache_put(text, text, text, text), public.register_offer_source(uuid, uuid), public.auto_route_offer(uuid), public.run_auto_approve(integer),
  public.watchlist_due(integer), public.watchlist_update(uuid, numeric, text, boolean), public.upsert_commissions(jsonb), public.alert_should_send(text, text),
  public.alert_clear(text), public.ops_snapshot(), public.housekeeping(), public.score_offer(uuid), public.get_integration_runtime() to service_role;
grant execute on function public.save_promo_source(uuid, jsonb), public.delete_promo_source(uuid), public.list_promo_sources(), public.list_captured_links(integer),
  public.save_routing_rule(uuid, jsonb), public.delete_routing_rule(uuid), public.save_watch_item(text, numeric, numeric), public.delete_watch_item(uuid),
  public.commission_summary(integer), public.reprice_offer(uuid, numeric, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Tarefas periódicas do worker (intervalo mínimo entre execuções) e redirecionador sem contar clique
-- ---------------------------------------------------------------------------
create or replace function public.job_should_run(p_key text, p_every_min integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
begin
  select last_sent_at into v_last from public.alert_state where key = 'job:' || p_key;
  if v_last is not null and v_last > now() - make_interval(mins => greatest(p_every_min, 1)) then return false; end if;
  insert into public.alert_state (key, last_sent_at, detail) values ('job:' || p_key, now(), null)
  on conflict (key) do update set last_sent_at = now();
  return true;
end $$;

-- visitas de robôs de pré-visualização (WhatsApp, Telegram…) não contam como clique
create or replace function public.resolve_short_link(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select target_url from public.short_links where code = p_code and not disabled
$$;

revoke all on function public.job_should_run(text, integer), public.resolve_short_link(text) from public, anon;
grant execute on function public.job_should_run(text, integer), public.resolve_short_link(text) to service_role;

-- ---------------------------------------------------------------------------
-- Categoria pelo título (o worker usa quando a busca não trouxe categoria) e teste de link do Radar
-- ---------------------------------------------------------------------------
create or replace function public.category_guess(p_text text) returns text
language sql stable security definer set search_path = public as $$
  select public.category_slug(p_text)
$$;
revoke all on function public.category_guess(text) from public, anon;
grant execute on function public.category_guess(text) to service_role;

-- Função completa (e não por substituição de texto): vale para qualquer versão anterior que esteja no banco.
CREATE OR REPLACE FUNCTION public.request_integration_action(p_provider text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_ok boolean; v_text text; v_payload jsonb := '{}'::jsonb; v_to text; v_ch text; v_mode text;
begin
  perform public.require_admin();
  v_ok := case p_provider
    when 'evolution' then p_action in ('status', 'connect', 'restart', 'logout', 'set_webhook', 'create_instance', 'list_instances', 'send_test', 'connect_poll')
    when 'telegram' then p_action in ('check', 'connect', 'set_webhook', 'delete_webhook', 'send_test')
    when 'mercadolivre' then p_action in ('check', 'exchange_code', 'disconnect', 'preview', 'collect')
    when 'shopee' then p_action in ('check', 'preview', 'collect')
    when 'amazon' then p_action in ('check', 'preview', 'collect') when 'aliexpress' then p_action in ('check', 'preview', 'collect') when 'magalu' then p_action = 'check'
    when 'worker' then p_action in ('selftest', 'webhook_check', 'run_monitor', 'run_sender', 'radar_test')
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Ação não existe para esta integração'; end if;
  v_ch := case p_provider when 'evolution' then 'whatsapp' when 'telegram' then 'telegram' else null end;

  if p_action = 'run_sender' and public.setting_bool('paused', false) then raise exception 'Envios pausados: retome antes de rodar o ciclo de envio'; end if;

  if p_action = 'collect' then
    select mode into v_mode from public.connectors where platform = p_provider;
    if v_mode is null or v_mode in ('disabled', 'paused_policy', 'error') then
      raise exception 'Ative a coleta deste conector antes de coletar (modo atual: %). Para só ver uma amostra, use "Ver amostra".', coalesce(v_mode, 'inexistente');
    end if;
  end if;

  if p_action = 'exchange_code' then
    v_to := btrim(coalesce(p_payload ->> 'code', ''));
    if v_to !~ '^[A-Za-z0-9_.-]{10,200}$' then raise exception 'Código de autorização inválido. Clique em "Conectar conta" de novo.'; end if;
    v_payload := jsonb_build_object('code', v_to);
    v_text := btrim(coalesce(p_payload ->> 'redirect_uri', ''));
    if v_text <> '' then
      if not public.valid_https_url(v_text) then raise exception 'Endereço de redirecionamento inválido (precisa ser https)'; end if;
      v_payload := v_payload || jsonb_build_object('redirect_uri', v_text);
    end if;
  elsif p_action = 'radar_test' then
    v_to := btrim(coalesce(p_payload ->> 'url', ''));
    if v_to !~ '^https?://[^[:space:]]+$' or length(v_to) > 500 then raise exception 'Informe um endereço (http ou https) de até 500 caracteres'; end if;
    v_payload := jsonb_build_object('url', v_to);
  elsif p_action = 'send_test' then
    if public.setting_bool('paused', false) then raise exception 'Envios pausados: retome antes de enviar o teste'; end if;
    v_to := btrim(coalesce(p_payload ->> 'to', ''));
    if p_provider = 'evolution' then
      v_to := regexp_replace(v_to, '\D', '', 'g');
      if v_to !~ '^\d{10,15}$' then raise exception 'Número inválido. Use DDI + DDD + número, só dígitos (ex.: 5511999990001)'; end if;
    elsif v_to !~ '^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$' then raise exception 'Destino inválido: ID numérico do chat ou @canal';
    end if;
    v_text := left(btrim(coalesce(p_payload ->> 'text', 'Teste da Central de Promoções: a integração está funcionando.')), 500);
    if array_length(public.text_violations(v_text), 1) > 0 then raise exception 'O texto contém termos proibidos'; end if;
    v_payload := jsonb_build_object('to', v_to, 'text', v_text);
  elsif p_provider = 'evolution' and p_action in ('connect', 'connect_poll') then
    v_to := regexp_replace(coalesce(p_payload ->> 'pairing_number', ''), '\D', '', 'g');
    if v_to <> '' and v_to !~ '^\d{10,15}$' then raise exception 'Número para código de pareamento inválido'; end if;
    if v_to <> '' then v_payload := jsonb_build_object('pairing_number', v_to); end if;
  end if;

  -- repetição de clique: reaproveita a tarefa idêntica em andamento (o código do OAuth nunca é reaproveitado)
  if p_action not in ('exchange_code', 'radar_test') then
    select id into v_id from public.channel_jobs
     where kind = 'integration' and status in ('pending', 'claimed') and payload ->> 'provider' = p_provider and payload ->> 'action' = p_action
       and requested_at > now() - interval '60 seconds' limit 1;
    if found then return v_id; end if;
  end if;
  if (select count(*) from public.channel_jobs where kind = 'integration' and requested_by = auth.uid() and requested_at > now() - interval '1 minute') >= 30 then
    raise exception 'Muitas ações seguidas. Aguarde um minuto';
  end if;
  -- QR codes antigos não ficam guardados
  update public.channel_jobs set result = null where kind = 'integration' and result ? 'qr' and finished_at < now() - interval '10 minutes';
  insert into public.channel_jobs (kind, channel, payload, requested_by)
  values ('integration', v_ch, jsonb_build_object('provider', p_provider, 'action', p_action) || v_payload, auth.uid()) returning id into v_id;
  perform public.log_audit('integration_action', 'integration', p_provider || ':' || p_action, '{}'::jsonb);
  return v_id;
end $function$;
