-- ============================================================================
-- 012 — Contas de afiliado: conexão do Mercado Livre (OAuth), prévia e coleta real
--
--   * tokens da conta (access/refresh) ficam no cofre integration_secrets; só o worker os grava/lê;
--   * o código de autorização do OAuth (de uso único) é apagado da tarefa assim que ela termina;
--   * novas ações: exchange_code, disconnect, preview, collect;
--   * novos campos de conector: keywords (termos de busca) e link_template (modelo do link de afiliado);
--   * get_integration_runtime passa a informar a última execução de cada conector (agendamento da coleta).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tokens da conta (só service_role). Valor vazio apaga.
-- ---------------------------------------------------------------------------
create or replace function public.store_integration_token(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  if p_key not in ('ml_access_token', 'ml_refresh_token', 'ml_token_expires_at') then raise exception 'Token desconhecido'; end if;
  if v = '' then
    delete from public.integration_secrets where key = p_key;
    return;
  end if;
  if length(v) > 600 or v ~ '\s' then raise exception 'Valor de token inválido'; end if;
  insert into public.integration_secrets (key, value, hint, updated_by) values (p_key, v, right(v, 4), null)
  on conflict (key) do update set value = excluded.value, hint = excluded.hint, updated_at = now();
end $$;

revoke all on function public.store_integration_token(text, text) from public, anon, authenticated;
grant execute on function public.store_integration_token(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. O código do OAuth não fica guardado depois de usado (ou de falhar/cancelar)
-- ---------------------------------------------------------------------------
create or replace function public.scrub_job_payload() returns trigger
language plpgsql as $$
begin
  if new.status in ('done', 'failed', 'cancelled') and new.payload ? 'code' then
    new.payload := new.payload - 'code';
  end if;
  return new;
end $$;
drop trigger if exists trg_channel_jobs_scrub on public.channel_jobs;
create trigger trg_channel_jobs_scrub before update on public.channel_jobs
  for each row execute function public.scrub_job_payload();

-- ---------------------------------------------------------------------------
-- 3. Runtime do worker: inclui a última execução de cada conector
--    (a versão 011 usava 'int\\_status\\_%', que não casa com int_status_*; aqui o filtro é por prefixo)
-- ---------------------------------------------------------------------------
create or replace function public.get_integration_runtime() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evolution', coalesce((select value from public.settings where key = 'int_evolution'), '{}'::jsonb),
    'telegram',  coalesce((select value from public.settings where key = 'int_telegram'),  '{}'::jsonb),
    'n8n',       coalesce((select value from public.settings where key = 'int_n8n'),       '{}'::jsonb),
    'database',  coalesce((select value from public.settings where key = 'int_database'),  '{}'::jsonb),
    'paused',    public.setting_bool('paused', false),
    'status',    coalesce((select jsonb_object_agg(substr(key, 12), value) from public.settings where left(key, 11) = 'int_status_'), '{}'::jsonb),
    'secrets',   coalesce((select jsonb_object_agg(key, value) from public.integration_secrets), '{}'::jsonb),
    'connectors', coalesce((select jsonb_object_agg(c.platform, jsonb_build_object(
        'mode', c.mode, 'config', c.config,
        'last_run_at', (select max(r.started_at) from public.runs r where r.connector_id = c.id)))
      from public.connectors c), '{}'::jsonb))
$$;
revoke all on function public.get_integration_runtime() from public, anon;
grant execute on function public.get_integration_runtime() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Ações pedidas pelo painel
-- ---------------------------------------------------------------------------
create or replace function public.request_integration_action(p_provider text, p_action text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok boolean; v_text text; v_payload jsonb := '{}'::jsonb; v_to text; v_ch text; v_mode text;
begin
  perform public.require_admin();
  v_ok := case p_provider
    when 'evolution' then p_action in ('status', 'connect', 'restart', 'logout', 'set_webhook', 'create_instance', 'list_instances', 'send_test')
    when 'telegram' then p_action in ('check', 'set_webhook', 'delete_webhook', 'send_test')
    when 'mercadolivre' then p_action in ('check', 'exchange_code', 'disconnect', 'preview', 'collect')
    when 'shopee' then p_action in ('check', 'preview', 'collect')
    when 'amazon' then p_action = 'check'
    when 'n8n' then p_action in ('selftest', 'webhook_check', 'run_monitor', 'run_sender')
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
  elsif p_provider = 'evolution' and p_action = 'connect' then
    v_to := regexp_replace(coalesce(p_payload ->> 'pairing_number', ''), '\D', '', 'g');
    if v_to <> '' and v_to !~ '^\d{10,15}$' then raise exception 'Número para código de pareamento inválido'; end if;
    if v_to <> '' then v_payload := jsonb_build_object('pairing_number', v_to); end if;
  end if;

  -- repetição de clique: reaproveita a tarefa idêntica em andamento (o código do OAuth nunca é reaproveitado)
  if p_action <> 'exchange_code' then
    select id into v_id from public.channel_jobs
     where kind = 'integration' and status in ('pending', 'claimed') and payload ->> 'provider' = p_provider and payload ->> 'action' = p_action
       and requested_at > now() - interval '60 seconds' limit 1;
    if found then return v_id; end if;
  end if;
  if (select count(*) from public.channel_jobs where kind = 'integration' and requested_by = auth.uid() and requested_at > now() - interval '1 minute') >= 12 then
    raise exception 'Muitas ações seguidas. Aguarde um minuto';
  end if;
  -- QR codes antigos não ficam guardados
  update public.channel_jobs set result = null where kind = 'integration' and result ? 'qr' and finished_at < now() - interval '10 minutes';
  insert into public.channel_jobs (kind, channel, payload, requested_by)
  values ('integration', v_ch, jsonb_build_object('provider', p_provider, 'action', p_action) || v_payload, auth.uid()) returning id into v_id;
  perform public.log_audit('integration_action', 'integration', p_provider || ':' || p_action, '{}'::jsonb);
  return v_id;
end $$;

revoke all on function public.request_integration_action(text, text, jsonb) from public, anon;
grant execute on function public.request_integration_action(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Configuração dos conectores: + keywords e link_template (continua sem segredos)
-- ---------------------------------------------------------------------------
create or replace function public.validate_connector_config() returns trigger
language plpgsql as $$
declare k text; v jsonb; n numeric;
begin
  for k, v in select * from jsonb_each(coalesce(new.config, '{}'::jsonb)) loop
    if k ~* '(secret|token|passw|senha|api_?key|authorization|bearer)' then
      raise exception 'Não guarde segredos aqui (campo "%"). Use o campo de chave secreta, que é só de escrita.', k;
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
  foreach k in array array['app_id', 'client_id', 'partner_tag', 'affiliate_id', 'affiliate_tag'] loop
    if new.config ? k and jsonb_typeof(new.config -> k) = 'string' and (new.config ->> k) !~ '^[A-Za-z0-9._:-]{2,120}$' then
      raise exception '"%" deve ter de 2 a 120 caracteres (letras, números, ponto, - _ :), sem espaços', k;
    end if;
  end loop;
  foreach k in array array['redirect_uri', 'api_endpoint'] loop
    if new.config ? k and (new.config ->> k) <> '' and not public.valid_https_url(new.config ->> k) then
      raise exception '"%" precisa ser um endereço https válido', k;
    end if;
  end loop;
  if new.config ? 'marketplace' and (new.config ->> 'marketplace') !~ '^[A-Za-z0-9._-]{2,40}$' then
    raise exception '"marketplace" inválido';
  end if;
  if new.config ? 'categories' then
    if jsonb_typeof(new.config -> 'categories') <> 'array' then raise exception '"categories" precisa ser uma lista'; end if;
    if exists (select 1 from jsonb_array_elements_text(new.config -> 'categories') s where s not in (select slug from public.product_categories)) then
      raise exception 'Categoria desconhecida em "categories"';
    end if;
  end if;
  if new.config ? 'keywords' then
    if jsonb_typeof(new.config -> 'keywords') <> 'array' or jsonb_array_length(new.config -> 'keywords') > 12 then
      raise exception '"keywords" precisa ser uma lista de até 12 termos de busca';
    end if;
    if exists (select 1 from jsonb_array_elements(new.config -> 'keywords') s
                where jsonb_typeof(s) <> 'string' or length(btrim(s #>> '{}')) not between 2 and 60 or (s #>> '{}') ~ '[<>{}\\]') then
      raise exception 'Cada termo de busca precisa ter de 2 a 60 caracteres, sem < > { } \';
    end if;
  end if;
  if new.config ? 'link_template' and coalesce(new.config ->> 'link_template', '') <> '' then
    v := new.config -> 'link_template';
    if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 300 or (v #>> '{}') ~ '\s' or position('{url}' in (v #>> '{}')) = 0
       or (v #>> '{}') !~ '^(\{url\}|https://)' then
      raise exception '"link_template" precisa conter {url}, começar com {url} ou https:// e não ter espaços';
    end if;
  end if;
  return new;
end $$;
