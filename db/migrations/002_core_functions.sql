-- ============================================================================
-- 002_core_functions.sql — regras que NÃO podem falhar ficam no banco.
-- Chamadores humanos (painel) usam o papel `authenticated` e passam por RBAC.
-- O n8n usa `service_role` (auth.uid() nulo). `anon` nunca executa nada.
-- ============================================================================

-- ---------- Helpers de acesso ----------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

create or replace function public.can_operate() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin', 'operator'), false)
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null
$$;

-- Humano sem permissão é barrado; service_role (auth.uid() nulo) passa.
create or replace function public.require_operator() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_operate() then
    raise exception 'Permissão negada: requer perfil operador ou administrador' using errcode = '42501';
  end if;
end $$;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Permissão negada: requer perfil administrador' using errcode = '42501';
  end if;
end $$;

-- ---------- Configurações ---------------------------------------------------
create or replace function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key
$$;

create or replace function public.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::integer from public.settings where key = p_key), p_default)
$$;

create or replace function public.setting_bool(p_key text, p_default boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = p_key), p_default)
$$;

create or replace function public.setting_text(p_key text, p_default text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from public.settings where key = p_key), p_default)
$$;

-- ---------- Auditoria (com redação de segredos) -----------------------------
create or replace function public.scrub(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(
    jsonb_object_agg(
      k,
      case when k ~* '(token|secret|password|senha|api_?key|cookie|authorization)'
           then '"[redigido]"'::jsonb else v end),
    '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb)) as t(k, v)
$$;

create or replace function public.log_audit(
  p_action text, p_entity_type text default null, p_entity_id text default null,
  p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (actor_type, actor_id, action, entity_type, entity_id, metadata)
  values (case when auth.uid() is null then 'system' else 'admin' end,
          auth.uid(), p_action, p_entity_type, p_entity_id, public.scrub(p_meta));
end $$;

-- Trigger genérico: registra alterações feitas diretamente em tabelas de configuração.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and (v_old -> k) is distinct from (v_new -> k) then
        v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('de', v_old -> k, 'para', v_new -> k));
      end if;
    end loop;
    if v_changed = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    v_changed := public.scrub(v_new);
  else
    v_changed := public.scrub(v_old);
  end if;
  perform public.log_audit(
    lower(tg_op) || '_' || tg_table_name, tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'key'),
    jsonb_build_object('campos', v_changed));
  return coalesce(new, old);
end $$;

-- ---------- Utilitários de URL e texto --------------------------------------
create or replace function public.url_host(p_url text) returns text
language sql immutable as $$
  select lower(substring(p_url from '^https?://([^/:?#@]+)(?::[0-9]+)?(?:[/?#]|$)'))
$$;

create or replace function public.normalize_url(p_url text) returns text
language sql immutable as $$
  select case when public.url_host(p_url) is null then null
    else 'https://' || public.url_host(p_url) ||
         regexp_replace(coalesce(substring(split_part(split_part(p_url, '#', 1), '?', 1)
                                           from '^https?://[^/]+(/.*)$'), ''), '/+$', '')
  end
$$;

-- Melhor esforço: o ID externo só ajuda na deduplicação. Se não casar, retorna nulo.
create or replace function public.extract_external_id(p_platform text, p_url text) returns text
language sql immutable as $$
  select case p_platform
    when 'amazon' then upper(substring(p_url from '/(?:dp|gp/product)/([A-Za-z0-9]{10})'))
    when 'mercadolivre' then replace(upper(substring(p_url from '(?i)(MLB-?[0-9]+)')), '-', '')
    when 'shopee' then substring(p_url from 'i\.([0-9]+\.[0-9]+)')
  end
$$;

create or replace function public.host_allowed(p_platform text, p_url text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select bool_or(public.url_host(p_url) = lower(d) or right(public.url_host(p_url), length(d) + 1) = '.' || lower(d))
    from jsonb_array_elements_text(coalesce(public.setting('allowed_domains') -> p_platform, '[]'::jsonb)) as t(d)
    where public.url_host(p_url) is not null
  ), false)
$$;

create or replace function public.fmt_brl(p_value numeric) returns text
language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(p_value, 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.')
$$;

create or replace function public.text_violations(p_text text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t), '{}')
  from jsonb_array_elements_text(coalesce(public.setting('banned_terms'), '[]'::jsonb)) as x(t)
  where p_text ~* ('\m' || regexp_replace(t, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')
$$;

-- ---------- Histórico próprio de preço --------------------------------------
-- Só vira "preço anterior" se houver observações suficientes de fonte confiável.
create or replace function public.own_history_previous(p_product uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_min_obs integer := public.setting_int('min_history_observations', 5);
  v_min_days integer := public.setting_int('min_history_days', 3);
  v_count integer; v_days integer; v_max numeric;
begin
  select count(*), count(distinct (observed_at at time zone 'America/Sao_Paulo')::date), max(price)
    into v_count, v_days, v_max
  from public.price_observations
  where product_id = p_product
    and source_kind in ('api', 'feed')
    and observed_at > now() - interval '30 days';
  if v_count >= v_min_obs and v_days >= v_min_days then return v_max; end if;
  return null;
end $$;

-- ---------- Pontuação --------------------------------------------------------
create or replace function public.score_offer(p_offer uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o record; obs record;
  v_score integer := 0; v_reasons jsonb := '[]'::jsonb; v_age numeric; v_pts integer;
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

  -- Desconto comprovado (até 35): 1 ponto por 1 % de queda
  if o.discount_pct is not null then
    v_pts := least(35, floor(o.discount_pct))::integer;
    v_score := v_score + v_pts;
    v_reasons := v_reasons || jsonb_build_object('code', 'discount', 'points', v_pts,
      'label', 'Queda de ' || o.discount_pct || '% (' ||
               case o.previous_price_source when 'own_history' then 'histórico próprio' else 'fonte oficial' end || ')');
  else
    v_reasons := v_reasons || jsonb_build_object('code', 'discount', 'points', 0,
      'label', 'Sem desconto comprovado');
  end if;

  -- Link de afiliado válido (5)
  if o.affiliate_url is not null and public.host_allowed(
       (select platform from public.products where id = o.product_id), o.affiliate_url) then
    v_score := v_score + 5;
    v_reasons := v_reasons || jsonb_build_object('code', 'link', 'points', 5, 'label', 'Link de afiliado presente');
  else
    v_reasons := v_reasons || jsonb_build_object('code', 'link', 'points', 0,
      'label', 'Link de afiliado ausente ou não confirmado');
  end if;

  v_score := least(100, v_score);
  update public.offers set score = v_score, score_reasons = v_reasons where id = p_offer;
  return v_score;
end $$;

-- ---------- Entrada única de ofertas (painel manual e n8n) -------------------
create or replace function public.ingest_offer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_platform text := p ->> 'platform';
  v_orig text := nullif(btrim(p ->> 'original_url'), '');
  v_aff text := nullif(btrim(coalesce(p ->> 'affiliate_url', '')), '');
  v_title text := nullif(btrim(coalesce(p ->> 'title', '')), '');
  v_price numeric := nullif(p ->> 'price', '')::numeric;
  v_prev numeric := nullif(p ->> 'previous_price', '')::numeric;
  v_kind text := coalesce(p ->> 'source_kind', 'admin_declared');
  v_layer text := coalesce(p ->> 'source_layer', 'A');
  v_obs_at timestamptz := coalesce(nullif(p ->> 'observed_at', '')::timestamptz, now());
  v_avail text := coalesce(p ->> 'availability', 'unknown');
  v_expires timestamptz := nullif(p ->> 'expires_at', '')::timestamptz;
  v_sim boolean := coalesce((p ->> 'is_simulated')::boolean, false);
  v_max_age integer := public.setting_int('max_price_age_minutes', 720);
  v_window integer := public.setting_int('dedupe_window_hours', 72);
  v_drop numeric := public.setting_int('republish_drop_pct', 10);
  v_fail jsonb := '[]'::jsonb; v_notes jsonb := '[]'::jsonb;
  v_canon text; v_ext text; v_product uuid; v_obs bigint; v_offer uuid;
  v_prev_final numeric; v_prev_src text; v_disc numeric; v_hist numeric;
  v_existing record; v_last record; v_score integer;
begin
  perform public.require_operator();

  if v_platform is null or v_platform not in ('mercadolivre', 'shopee', 'amazon') then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'platform_invalid', 'message', 'Plataforma inválida'));
  end if;
  if v_title is null or length(v_title) > 300 then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'title_invalid', 'message', 'Título ausente ou maior que 300 caracteres'));
  end if;
  if v_orig is null or not public.host_allowed(v_platform, v_orig) then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'domain_not_allowed', 'message', 'URL do produto fora dos domínios permitidos da plataforma'));
  end if;
  if v_aff is not null and not public.host_allowed(v_platform, v_aff) then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'affiliate_host_not_allowed', 'message', 'Link de afiliado fora dos domínios permitidos (confirme o domínio oficial e cadastre em Configurações)'));
  end if;
  if v_price is null or v_price <= 0 then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'price_invalid', 'message', 'Preço ausente ou não positivo'));
  end if;
  if v_kind not in ('api', 'feed', 'admin_declared') then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'source_invalid', 'message', 'Tipo de fonte inválido'));
  end if;
  if v_avail not in ('in_stock', 'out_of_stock', 'unknown') then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'availability_invalid', 'message', 'Disponibilidade inválida'));
  elsif v_avail = 'out_of_stock' then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'out_of_stock', 'message', 'Produto sem estoque'));
  end if;
  if v_obs_at > now() + interval '5 minutes' then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'observed_in_future', 'message', 'Horário da observação no futuro'));
  elsif extract(epoch from (now() - v_obs_at)) / 60 > v_max_age then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'price_too_old', 'message', 'Preço observado há mais de ' || v_max_age || ' min'));
  end if;
  if v_expires is not null and v_expires <= now() then
    v_fail := v_fail || jsonb_build_array(jsonb_build_object('code', 'expired', 'message', 'Oferta já vencida'));
  end if;

  if jsonb_array_length(v_fail) > 0 then
    perform public.log_audit('offer_ingest_rejected', 'offer', null,
      jsonb_build_object('plataforma', v_platform, 'titulo', left(coalesce(v_title, ''), 80),
                         'host', public.url_host(v_orig), 'falhas', v_fail));
    return jsonb_build_object('status', 'rejected', 'failures', v_fail);
  end if;

  v_canon := public.normalize_url(v_orig);
  v_ext := coalesce(nullif(p ->> 'external_id', ''), public.extract_external_id(v_platform, v_orig));

  select id into v_product from public.products
   where platform = v_platform
     and ((v_ext is not null and external_id = v_ext) or canonical_url = v_canon)
   limit 1;

  if v_product is not null then
    select id, status into v_existing from public.offers
     where product_id = v_product and status in ('discovered', 'needs_review', 'approved', 'scheduled')
     order by created_at desc limit 1;
    if found then
      return jsonb_build_object('status', 'duplicate', 'reason', 'open_offer', 'offer_id', v_existing.id);
    end if;

    select o.id, o.current_price into v_last
      from public.offers o
      join public.publications pu on pu.offer_id = o.id and pu.status in ('pending', 'claimed', 'sent', 'unknown', 'retry_scheduled')
     where o.product_id = v_product and pu.created_at > now() - make_interval(hours => v_window)
     order by pu.created_at desc limit 1;
    if found and not (v_price <= v_last.current_price * (1 - v_drop / 100.0)) then
      return jsonb_build_object('status', 'duplicate', 'reason', 'recently_published', 'offer_id', v_last.id);
    elsif found then
      v_notes := v_notes || jsonb_build_array('Republicação permitida: queda material de preço desde o último envio');
    end if;

    update public.products set
      title = v_title,
      category = coalesce(nullif(p ->> 'category', ''), category),
      image_url = coalesce(nullif(p ->> 'image_url', ''), image_url),
      seller_name = coalesce(nullif(p ->> 'seller_name', ''), seller_name)
     where id = v_product;
  else
    insert into public.products (platform, external_id, canonical_url, title, category, image_url, seller_name)
    values (v_platform, v_ext, v_canon, v_title, nullif(p ->> 'category', ''),
            nullif(p ->> 'image_url', ''), nullif(p ->> 'seller_name', ''))
    returning id into v_product;
  end if;

  -- Preço anterior: só de fonte confiável (API/feed) ou do histórico próprio.
  if v_kind in ('api', 'feed') and v_prev is not null and v_prev > v_price then
    v_prev_final := v_prev; v_prev_src := v_kind;
  else
    if v_prev is not null and v_kind = 'admin_declared' then
      v_notes := v_notes || jsonb_build_array('Preço anterior declarado manualmente foi ignorado (fonte não confiável)');
    end if;
    v_hist := public.own_history_previous(v_product);
    if v_hist is not null and v_hist > v_price then
      v_prev_final := v_hist; v_prev_src := 'own_history';
    end if;
  end if;
  if v_prev_final is not null then
    v_disc := least(99.99, round((v_prev_final - v_price) / v_prev_final * 100, 2));
  end if;

  insert into public.price_observations
    (product_id, price, claimed_previous_price, availability, source_kind, source_name, observed_at, evidence)
  values (v_product, v_price, v_prev, v_avail, v_kind, p ->> 'source_name', v_obs_at,
          public.scrub(coalesce(p -> 'evidence', '{}'::jsonb)))
  returning id into v_obs;

  if v_aff is null then
    v_notes := v_notes || jsonb_build_array('Link de afiliado ausente: obtenha no painel oficial antes de aprovar');
  end if;

  insert into public.offers
    (product_id, observation_id, status, source_layer, source_name, original_url, affiliate_url,
     current_price, previous_price, previous_price_source, discount_pct, coupon_code, coupon_confirmed,
     availability, price_observed_at, expires_at, validation_notes, is_simulated, created_by)
  values (v_product, v_obs, 'needs_review', v_layer, p ->> 'source_name', v_orig, v_aff,
          v_price, v_prev_final, v_prev_src, v_disc, nullif(p ->> 'coupon_code', ''),
          nullif(p ->> 'coupon_code', '') is not null
            and (v_kind in ('api', 'feed') or coalesce((p ->> 'coupon_confirmed')::boolean, false)),
          v_avail, v_obs_at, v_expires, v_notes, v_sim, auth.uid())
  returning id into v_offer;

  v_score := public.score_offer(v_offer);
  perform public.log_audit('offer_ingested', 'offer', v_offer::text,
    jsonb_build_object('plataforma', v_platform, 'camada', v_layer, 'fonte', v_kind, 'score', v_score,
                       'simulada', v_sim));
  return jsonb_build_object('status', 'created', 'offer_id', v_offer, 'score', v_score, 'notes', v_notes);
end $$;

-- ---------- Renderização (prévia = exatamente o que será enviado) -----------
create or replace function public.render_offer_text(
  p_offer uuid, p_destination uuid, p_short_code text default null
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  o record; pr record; d record; c record;
  t text; v_vars jsonb; v_line text; v_out text[] := '{}'; v_drop boolean; v_res text; m record;
  v_val text; v_base text; v_url text; v_prevline text; v_disc text; v_esc boolean; v_tz text := 'America/Sao_Paulo';
begin
  select * into o from public.offers where id = p_offer;
  select * into d from public.destinations where id = p_destination;
  if o.id is null or d.id is null then raise exception 'oferta ou destino inexistente'; end if;
  select * into pr from public.products where id = o.product_id;
  select * into c from public.connectors where platform = pr.platform;
  select body into t from public.templates where channel = d.channel and kind = 'offer' and active;
  if t is null then raise exception 'Sem template ativo de oferta para %', d.channel; end if;

  v_base := public.setting_text('shortlink_base', '');
  if coalesce(c.use_short_link, true) and v_base <> '' then
    v_url := rtrim(v_base, '/') || '/' || coalesce(p_short_code, 'abc123xy');
  else
    v_url := o.affiliate_url;
  end if;

  v_prevline := '';
  if o.previous_price is not null and o.discount_pct is not null then
    v_prevline := case o.previous_price_source
      when 'own_history' then 'Já registramos por ' || public.fmt_brl(o.previous_price)
      else 'Antes: ' || public.fmt_brl(o.previous_price) end
      || ' (-' || trim(trailing '.' from trim(trailing '0' from o.discount_pct::text)) || '%)';
  end if;

  v_vars := jsonb_build_object(
    'title', pr.title,
    'price', public.fmt_brl(o.current_price),
    'previous_line', v_prevline,
    'coupon_line', case when o.coupon_code is not null and o.coupon_confirmed then 'Cupom: ' || o.coupon_code else '' end,
    'observed_at', to_char(o.price_observed_at at time zone v_tz, 'DD/MM "às" HH24:MI'),
    'url', coalesce(v_url, ''),
    'disclosure', public.setting_text('affiliate_disclosure', ''),
    'category', coalesce(pr.category, ''),
    'seller', coalesce(pr.seller_name, ''));

  v_esc := d.channel = 'telegram';
  foreach v_line in array string_to_array(t, E'\n') loop
    v_drop := false; v_res := v_line;
    for m in select distinct (regexp_matches(v_line, '\{\{([a-z_]+)\}\}', 'g'))[1] as name loop
      v_val := coalesce(v_vars ->> m.name, '');
      if v_val = '' then v_drop := true; exit; end if;
      if v_esc then
        v_val := replace(replace(replace(replace(v_val, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
      end if;
      v_res := replace(v_res, '{{' || m.name || '}}', v_val);
    end loop;
    if not v_drop then v_out := v_out || v_res; end if;
  end loop;

  v_res := array_to_string(v_out, E'\n');
  if position('{{disclosure}}' in t) = 0 and (v_vars ->> 'disclosure') <> '' then
    v_res := v_res || E'\n\n' || case when v_esc then '<i>' || (v_vars ->> 'disclosure') || '</i>' else (v_vars ->> 'disclosure') end;
  end if;
  v_res := btrim(regexp_replace(v_res, E'\n{3,}', E'\n\n', 'g'));
  return v_res;
end $$;

-- ---------- Aprovação / rejeição ---------------------------------------------
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
    if cardinality(d.categories) > 0 and (pr.category is null or not (pr.category = any (d.categories))) then
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

create or replace function public.reject_offer(p_offer uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  perform public.require_operator();
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Informe o motivo da rejeição'; end if;
  select status into v_status from public.offers where id = p_offer for update;
  if not found then raise exception 'Oferta inexistente'; end if;
  if v_status in ('published', 'rejected', 'expired') then
    raise exception 'Oferta em estado % não pode ser rejeitada', v_status;
  end if;
  update public.offers set status = 'rejected', rejected_reason = btrim(p_reason) where id = p_offer;
  update public.publications set status = 'cancelled', note = 'Oferta rejeitada'
   where offer_id = p_offer and status in ('pending', 'retry_scheduled');
  perform public.log_audit('offer_rejected', 'offer', p_offer::text, jsonb_build_object('motivo', btrim(p_reason)));
end $$;

create or replace function public.expire_offers() returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  with ex as (
    update public.offers set status = 'expired'
     where expires_at is not null and expires_at <= now()
       and status in ('needs_review', 'approved', 'scheduled')
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ex;
  update public.publications set status = 'cancelled', note = 'Oferta expirada'
   where offer_id = any (v_ids) and status in ('pending', 'retry_scheduled');
  return cardinality(v_ids);
end $$;

-- Painel: colar o link de afiliado obtido no programa oficial (nunca montar link por suposição).
create or replace function public.set_offer_affiliate_url(p_offer uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare v_platform text; v_status text;
begin
  perform public.require_operator();
  select pr.platform, o.status into v_platform, v_status
    from public.offers o join public.products pr on pr.id = o.product_id where o.id = p_offer for update of o;
  if not found then raise exception 'Oferta inexistente'; end if;
  if v_status not in ('needs_review', 'approved') then
    raise exception 'Oferta em estado % não permite alterar o link', v_status;
  end if;
  if not public.host_allowed(v_platform, btrim(p_url)) then
    raise exception 'Link fora dos domínios permitidos para % (confirme o domínio oficial e cadastre em Configurações)', v_platform;
  end if;
  update public.offers set affiliate_url = btrim(p_url) where id = p_offer;
  perform public.score_offer(p_offer);
  perform public.log_audit('offer_link_set', 'offer', p_offer::text, jsonb_build_object('host', public.url_host(p_url)));
end $$;
