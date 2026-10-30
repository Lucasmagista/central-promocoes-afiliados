-- =============================================================================
-- 020 — IA (OpenRouter), importador do feed da Shopee e coletor do navegador
--
-- IA: a legenda (manchete com emoji + uma linha de benefício) é gerada pelo worker com a chave do OpenRouter
--     guardada no cofre (só escrita; nunca volta ao navegador) e fica na oferta. {{title}} usa a manchete da IA
--     quando existe (senão o nome curto) e {{ai_text}} é a linha de benefício. Termos proibidos continuam
--     barrados: a legenda que contiver algum é descartada.
-- Coletor: o token do coletor do navegador é guardado só como hash (SHA-256); o valor aparece uma única vez.
-- Domínios de afiliado novos (shope.ee, meli.la) entram na lista de links permitidos.
-- Funções redefinidas por inteiro (idempotente), sem remendo de texto.
-- =============================================================================

alter table public.offers
  add column if not exists ai_headline text,
  add column if not exists ai_body text,
  add column if not exists ai_model text,
  add column if not exists ai_at timestamptz;

-- ---------- chave do OpenRouter (só escrita) ----------
create or replace function public.set_ai_key(p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  perform public.require_admin();
  if v !~ '^[A-Za-z0-9_.-]{20,200}$' then raise exception 'Chave inválida (de 20 a 200 caracteres, sem espaços)'; end if;
  insert into public.integration_secrets (key, value, hint, updated_by) values ('openrouter_api_key', v, right(v, 4), auth.uid())
  on conflict (key) do update set value = excluded.value, hint = excluded.hint, updated_at = now(), updated_by = excluded.updated_by;
  perform public.log_audit('integration_secret_set', 'integration', 'openrouter_api_key', '{}'::jsonb);   -- nunca o valor
end $$;

create or replace function public.clear_ai_key() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.integration_secrets where key = 'openrouter_api_key';
  perform public.log_audit('integration_secret_cleared', 'integration', 'openrouter_api_key', '{}'::jsonb);
end $$;

create or replace function public.ai_key_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_build_object('is_set', true, 'hint', hint, 'updated_at', updated_at) from public.integration_secrets where key = 'openrouter_api_key'),
                  jsonb_build_object('is_set', false));
end $$;

-- ---------- token do coletor do navegador (guardado só como hash) ----------
create or replace function public.rotate_ingest_token() returns text
language plpgsql security definer set search_path = public as $$
declare v text := 'ing_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform public.require_admin();
  insert into public.integration_secrets (key, value, hint, updated_by) values ('ingest_token_hash', encode(sha256(convert_to(v, 'utf8')), 'hex'), right(v, 4), auth.uid())
  on conflict (key) do update set value = excluded.value, hint = excluded.hint, updated_at = now(), updated_by = excluded.updated_by;
  perform public.log_audit('integration_secret_set', 'integration', 'ingest_token', '{}'::jsonb);
  return v;
end $$;

create or replace function public.ingest_token_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_build_object('is_set', true, 'hint', hint, 'updated_at', updated_at) from public.integration_secrets where key = 'ingest_token_hash'),
                  jsonb_build_object('is_set', false));
end $$;

-- ---------- leituras e gravações do worker ----------
create or replace function public.worker_setting(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key not in ('ai_config', 'feed_config', 'collector_config', 'banned_terms') then raise exception 'Configuração não liberada'; end if;
  return (select value from public.settings where key = p_key);
end $$;

create or replace function public.worker_set_status(p_key text, p_status jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key not in ('ai', 'feed', 'collector') then raise exception 'Estado desconhecido'; end if;
  if jsonb_typeof(p_status) <> 'object' or length(p_status::text) > 8000 then raise exception 'Estado inválido ou grande demais'; end if;
  insert into public.settings (key, value) values ('int_status_' || p_key, p_status || jsonb_build_object('checked_at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ofertas em revisão que ainda não ganharam legenda da IA (as de maior score primeiro: são as que o modo automático aprova antes)
create or replace function public.list_offers_for_ai(p_limit integer default 5) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(s.x), '[]'::jsonb) from (
    select jsonb_build_object('id', o.id, 'title', pr.title, 'platform', pr.platform, 'category', pr.category, 'seller', pr.seller_name,
             'price', o.current_price, 'previous_price', o.previous_price, 'discount_pct', o.discount_pct,
             'coupon', case when o.coupon_confirmed then o.coupon_code end) as x
      from public.offers o join public.products pr on pr.id = o.product_id
     where o.ai_headline is null and o.status = 'needs_review' and o.created_at > now() - interval '3 days'
     order by o.score desc nulls last, o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 5), 20))) s
$$;

create or replace function public.set_offer_ai_text(p_offer uuid, p_headline text, p_body text, p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text := btrim(regexp_replace(coalesce(p_headline, ''), '\s+', ' ', 'g')); b text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')); v text[];
begin
  if length(h) < 3 or length(h) > 160 then return jsonb_build_object('ok', false, 'error', 'manchete fora do tamanho'); end if;
  if length(b) > 240 then b := left(b, 240); end if;
  if h ~* 'https?://|www\.' or b ~* 'https?://|www\.' then return jsonb_build_object('ok', false, 'error', 'a legenda não pode ter endereço'); end if;
  v := public.text_violations(h || ' ' || b);
  if array_length(v, 1) > 0 then return jsonb_build_object('ok', false, 'violations', to_jsonb(v)); end if;
  update public.offers set ai_headline = h, ai_body = nullif(b, ''), ai_model = left(coalesce(p_model, ''), 80), ai_at = now() where id = p_offer;
  return jsonb_build_object('ok', true);
end $$;

-- a IA não conseguiu: marca para não tentar de novo (o nome curto é usado)
create or replace function public.skip_offer_ai(p_offer uuid) returns void
language sql security definer set search_path = public as $$
  update public.offers set ai_headline = '', ai_at = now() where id = p_offer and ai_headline is null
$$;

-- o dono pode pedir uma legenda nova para uma oferta
create or replace function public.reset_offer_ai(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  update public.offers set ai_headline = null, ai_body = null, ai_model = null, ai_at = null where id = p_offer;
end $$;

revoke all on function public.set_ai_key(text), public.clear_ai_key(), public.ai_key_status(), public.rotate_ingest_token(), public.ingest_token_status(),
  public.worker_setting(text), public.worker_set_status(text, jsonb), public.list_offers_for_ai(integer), public.set_offer_ai_text(uuid, text, text, text),
  public.skip_offer_ai(uuid), public.reset_offer_ai(uuid) from public, anon;
grant execute on function public.set_ai_key(text), public.clear_ai_key(), public.ai_key_status(), public.rotate_ingest_token(), public.ingest_token_status(), public.reset_offer_ai(uuid) to authenticated, service_role;
grant execute on function public.worker_setting(text), public.worker_set_status(text, jsonb), public.list_offers_for_ai(integer), public.set_offer_ai_text(uuid, text, text, text), public.skip_offer_ai(uuid) to service_role;

-- ---------- links de afiliado desses canais são aceitos ----------
do $$
declare v jsonb; k text; add jsonb := '{"mercadolivre": ["meli.la"], "shopee": ["shope.ee", "s.shopee.com.br"]}'::jsonb; cur jsonb;
begin
  select value into v from public.settings where key = 'allowed_domains';
  if v is null then return; end if;
  for k in select jsonb_object_keys(add) loop
    cur := coalesce(v -> k, '[]'::jsonb);
    v := jsonb_set(v, array[k], (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(cur || (add -> k)) x), true);
  end loop;
  update public.settings set value = v where key = 'allowed_domains';
end $$;

-- ---------- modelo de mensagem: a linha de benefício da IA entra logo abaixo do título (some se estiver vazia) ----------
update public.templates set body = regexp_replace(body, '^([^\n]*\{\{title\}\}[^\n]*)', E'\\1\n{{ai_text}}')
 where kind = 'offer' and body not like '%{{ai_text}}%' and body ~ '^[^\n]*\{\{title\}\}';

create or replace function public.render_offer_text(p_offer uuid, p_destination uuid, p_short_code text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  t := public.spin_text(t);

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
    'title', coalesce(nullif(btrim(o.ai_headline), ''), public.short_title(pr.title, public.setting_int('title_max_chars', 70))),
    'ai_text', coalesce(btrim(o.ai_body), ''),
    'full_title', pr.title,
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
end $function$;;

create or replace function public.request_integration_action(p_provider text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
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
    when 'shopee' then p_action in ('check', 'preview', 'collect', 'import_feed')
    when 'ai' then p_action = 'test'
    when 'collector' then p_action = 'status'
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
  elsif p_provider = 'ai' and p_action = 'test' then
    v_to := left(btrim(coalesce(p_payload ->> 'title', '')), 200);
    if v_to <> '' then v_payload := jsonb_build_object('title', v_to); end if;
  elsif p_provider = 'shopee' and p_action = 'import_feed' then
    v_payload := jsonb_build_object('dry', coalesce(p_payload ->> 'dry', 'false') = 'true');
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
  if p_action not in ('exchange_code', 'radar_test', 'test', 'import_feed') then
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
