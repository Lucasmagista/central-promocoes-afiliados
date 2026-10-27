-- ============================================================================
-- 008 — Integrações: Evolution API (WhatsApp), Telegram e APIs das plataformas
--
-- O painel NUNCA fala com a Evolution, o Telegram ou as lojas. Ele:
--   * guarda a configuração (settings int_*), sem segredo;
--   * guarda segredos em integration_secrets, só de ESCRITA (ninguém lê pelo painel;
--     só o n8n, com service_role, lê);
--   * pede ações (QR code, testar, verificar bot…) em channel_jobs (kind = 'integration');
--   * lê o estado que o n8n devolve (settings int_status_*).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. channel_jobs aceita ações de integração (sem canal)
-- ---------------------------------------------------------------------------
alter table public.channel_jobs drop constraint if exists channel_jobs_kind_check;
alter table public.channel_jobs drop constraint if exists channel_jobs_channel_check;
alter table public.channel_jobs alter column channel drop not null;
alter table public.channel_jobs add constraint channel_jobs_kind_check
  check (kind in ('refresh_groups', 'create_group', 'verify_chat', 'integration'));
alter table public.channel_jobs add constraint channel_jobs_channel_check
  check (channel is null or channel in ('telegram', 'whatsapp'));

-- ---------------------------------------------------------------------------
-- 2. Segredos (write-only)
-- ---------------------------------------------------------------------------
create table if not exists public.integration_secrets (
  key        text primary key,
  value      text not null,
  hint       text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.integration_secrets enable row level security;   -- sem policy: ninguém lê pela API
revoke all on public.integration_secrets from public, anon, authenticated;
grant all on public.integration_secrets to service_role;

create or replace function public.integration_secret_keys() returns text[]
language sql immutable as $$
  select array['evolution_api_key', 'telegram_bot_token', 'telegram_webhook_secret', 'ml_client_secret', 'shopee_secret', 'amazon_client_secret']
$$;

create or replace function public.set_integration_secret(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  perform public.require_admin();
  if not (p_key = any (public.integration_secret_keys())) then raise exception 'Segredo desconhecido'; end if;
  if v ~ '\s' then raise exception 'O valor não pode ter espaços ou quebras de linha'; end if;
  if p_key = 'telegram_bot_token' and v !~ '^\d{6,12}:[A-Za-z0-9_-]{30,50}$' then
    raise exception 'Token do bot inválido. O formato é 123456789:AAxxxxxxxx (copie do @BotFather)';
  elsif p_key = 'telegram_webhook_secret' and v !~ '^[A-Za-z0-9_-]{16,256}$' then
    raise exception 'O segredo do webhook usa só letras, números, - e _ (16 a 256 caracteres)';
  elsif p_key = 'evolution_api_key' and length(v) not between 12 and 200 then
    raise exception 'A chave da Evolution deve ter de 12 a 200 caracteres';
  elsif p_key in ('ml_client_secret', 'shopee_secret', 'amazon_client_secret') and v !~ '^[A-Za-z0-9_.+=/-]{16,200}$' then
    raise exception 'Chave secreta inválida (16 a 200 caracteres, sem espaços)';
  end if;
  insert into public.integration_secrets (key, value, hint, updated_by) values (p_key, v, right(v, 4), auth.uid())
  on conflict (key) do update set value = excluded.value, hint = excluded.hint, updated_at = now(), updated_by = excluded.updated_by;
  perform public.log_audit('integration_secret_set', 'integration', p_key, '{}'::jsonb);   -- nunca o valor
end $$;

create or replace function public.clear_integration_secret(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.integration_secrets where key = p_key;
  perform public.log_audit('integration_secret_cleared', 'integration', p_key, '{}'::jsonb);
end $$;

create or replace function public.list_integration_secrets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', k, 'is_set', s.key is not null, 'hint', s.hint, 'updated_at', s.updated_at) order by k)
    from unnest(public.integration_secret_keys()) k left join public.integration_secrets s on s.key = k), '[]'::jsonb);
end $$;

-- gera e guarda um segredo aleatório para o webhook do Telegram (o painel nunca o vê)
create or replace function public.rotate_telegram_webhook_secret() returns void
language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform public.require_admin();
  insert into public.integration_secrets (key, value, hint, updated_by) values ('telegram_webhook_secret', v, right(v, 4), auth.uid())
  on conflict (key) do update set value = excluded.value, hint = excluded.hint, updated_at = now(), updated_by = excluded.updated_by;
  perform public.log_audit('integration_secret_rotated', 'integration', 'telegram_webhook_secret', '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Configuração (sem segredo) e estado
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('int_evolution', '{"base_url":"https://whatsapp.hubly.software","instance":"","webhook_url":"","send_delay_min_s":4,"send_delay_max_s":12,"alert_numbers":[],"alerts":true}'),
  ('int_telegram',  '{"enabled":false,"mode":"polling","webhook_url":"","admin_chat_id":"","alerts":true}'),
  ('int_n8n',       '{"base_url":""}')
on conflict (key) do nothing;

create or replace function public.valid_https_url(p text) returns boolean
language sql immutable as $$
  select p ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/[A-Za-z0-9._~%/-]*)?$'
$$;

create or replace function public.save_integration(p_provider text, p_config jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; k text; v jsonb; s text; n numeric; v_key text := 'int_' || p_provider;
begin
  perform public.require_admin();
  if p_provider not in ('evolution', 'telegram', 'n8n') then raise exception 'Integração desconhecida'; end if;
  if jsonb_typeof(p_config) <> 'object' then raise exception 'Configuração inválida'; end if;
  select value into v_old from public.settings where key = v_key;
  v_new := coalesce(v_old, '{}'::jsonb);
  for k, v in select * from jsonb_each(p_config) loop
    if p_provider = 'evolution' then
      if k = 'base_url' then
        s := regexp_replace(btrim(v #>> '{}'), '/+$', '');
        if not public.valid_https_url(s) then raise exception 'Endereço da Evolution inválido: use https://dominio (sem usuário, senha ou parâmetros)'; end if;
        v := to_jsonb(s);
      elsif k = 'instance' then
        s := btrim(v #>> '{}');
        if s <> '' and s !~ '^[A-Za-z0-9_-]{2,40}$' then raise exception 'Nome da instância: 2 a 40 letras, números, - ou _'; end if;
        v := to_jsonb(s);
      elsif k = 'webhook_url' then
        s := btrim(v #>> '{}');
        if s <> '' and not public.valid_https_url(s) then raise exception 'Endereço do webhook inválido (precisa ser https)'; end if;
        v := to_jsonb(s);
      elsif k in ('send_delay_min_s', 'send_delay_max_s') then
        if jsonb_typeof(v) <> 'number' then raise exception '% precisa ser número', k; end if;
        n := (v #>> '{}')::numeric;
        if n < 1 or n > 120 then raise exception 'Intervalo de envio: entre 1 e 120 segundos'; end if;
      elsif k = 'alerts' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '"alerts" precisa ser verdadeiro ou falso'; end if;
      elsif k = 'alert_numbers' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 5 then raise exception 'Até 5 números para alertas'; end if;
        if exists (select 1 from jsonb_array_elements_text(v) x where x !~ '^\d{10,15}$') then raise exception 'Números de alerta: só dígitos com DDI e DDD (10 a 15)'; end if;
      else raise exception 'Campo desconhecido: %', k;
      end if;
    elsif p_provider = 'telegram' then
      if k = 'enabled' or k = 'alerts' then
        if jsonb_typeof(v) <> 'boolean' then raise exception '"%" precisa ser verdadeiro ou falso', k; end if;
      elsif k = 'mode' then
        if (v #>> '{}') not in ('polling', 'webhook') then raise exception 'Modo deve ser polling ou webhook'; end if;
      elsif k = 'webhook_url' then
        s := btrim(v #>> '{}');
        if s <> '' and not public.valid_https_url(s) then raise exception 'Endereço do webhook inválido (precisa ser https)'; end if;
        v := to_jsonb(s);
      elsif k = 'admin_chat_id' then
        s := btrim(v #>> '{}');
        if s <> '' and s !~ '^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$' then raise exception 'Chat do administrador: ID numérico ou @usuario'; end if;
        v := to_jsonb(s);
      else raise exception 'Campo desconhecido: %', k;
      end if;
    else
      if k = 'base_url' then
        s := regexp_replace(btrim(v #>> '{}'), '/+$', '');
        if s <> '' and not public.valid_https_url(s) then raise exception 'Endereço do n8n inválido (https)'; end if;
        v := to_jsonb(s);
      else raise exception 'Campo desconhecido: %', k;
      end if;
    end if;
    v_new := v_new || jsonb_build_object(k, v);
  end loop;
  if p_provider = 'evolution' and coalesce((v_new ->> 'send_delay_min_s')::numeric, 0) > coalesce((v_new ->> 'send_delay_max_s')::numeric, 999) then
    raise exception 'O intervalo mínimo não pode ser maior que o máximo';
  end if;
  if p_provider = 'telegram' and v_new ->> 'mode' = 'webhook' and coalesce(v_new ->> 'webhook_url', '') = '' then
    raise exception 'No modo webhook informe o endereço do webhook (https)';
  end if;
  insert into public.settings (key, value, updated_by) values (v_key, v_new, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('integration_saved', 'integration', p_provider, jsonb_build_object('campos', (select jsonb_agg(x) from jsonb_object_keys(p_config) x)));
end $$;

-- o n8n devolve o estado observado (instância, bot, API de loja). Nunca grava segredo aqui.
create or replace function public.report_integration_status(p_provider text, p_status jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_provider not in ('evolution', 'telegram', 'n8n', 'mercadolivre', 'shopee', 'amazon') then raise exception 'Integração desconhecida'; end if;
  if jsonb_typeof(p_status) <> 'object' or length(p_status::text) > 8000 then raise exception 'Estado inválido ou grande demais'; end if;
  insert into public.settings (key, value) values ('int_status_' || p_provider, p_status || jsonb_build_object('checked_at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- tudo o que o n8n precisa para trabalhar, numa chamada só (service_role)
create or replace function public.get_integration_runtime() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evolution', coalesce((select value from public.settings where key = 'int_evolution'), '{}'::jsonb),
    'telegram',  coalesce((select value from public.settings where key = 'int_telegram'),  '{}'::jsonb),
    'n8n',       coalesce((select value from public.settings where key = 'int_n8n'),       '{}'::jsonb),
    'paused',    public.setting_bool('paused', false),
    'status',    coalesce((select jsonb_object_agg(substr(key, 12), value) from public.settings where key like 'int\_status\_%'), '{}'::jsonb),
    'secrets',   coalesce((select jsonb_object_agg(key, value) from public.integration_secrets), '{}'::jsonb),
    'connectors', coalesce((select jsonb_object_agg(platform, jsonb_build_object('mode', mode, 'config', config)) from public.connectors), '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 4. Conectores: formato das credenciais de aplicativo (só o identificador; o segredo vai em integration_secrets)
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
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Ações pedidas pelo painel (executadas pelo n8n)
-- ---------------------------------------------------------------------------
create or replace function public.request_integration_action(p_provider text, p_action text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok boolean; v_text text; v_payload jsonb := '{}'::jsonb; v_to text; v_ch text;
begin
  perform public.require_admin();
  v_ok := case p_provider
    when 'evolution' then p_action in ('status', 'connect', 'restart', 'logout', 'set_webhook', 'create_instance', 'list_instances', 'send_test')
    when 'telegram' then p_action in ('check', 'set_webhook', 'delete_webhook', 'send_test')
    when 'mercadolivre' then p_action = 'check'
    when 'shopee' then p_action = 'check'
    when 'amazon' then p_action = 'check'
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Ação não existe para esta integração'; end if;
  v_ch := case p_provider when 'evolution' then 'whatsapp' when 'telegram' then 'telegram' else null end;

  if p_action = 'send_test' then
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

  -- repetição de clique: reaproveita a tarefa idêntica em andamento
  select id into v_id from public.channel_jobs
   where kind = 'integration' and status in ('pending', 'claimed') and payload ->> 'provider' = p_provider and payload ->> 'action' = p_action
     and requested_at > now() - interval '60 seconds' limit 1;
  if found then return v_id; end if;
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

-- claim: ações de integração leem/diagnosticam e continuam mesmo com a pausa global; só o teste de envio é bloqueado
create or replace function public.claim_channel_job(p_worker text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  -- reserva vencida: criação de grupo e teste de envio NUNCA repetem (poderiam duplicar)
  update public.channel_jobs set status = 'failed', finished_at = now(), locked_until = null,
         last_error = 'reserva vencida: confira no aplicativo se a ação foi concluída antes de tentar de novo'
   where status = 'claimed' and locked_until < now() and (kind = 'create_group' or (kind = 'integration' and payload ->> 'action' = 'send_test'));
  update public.channel_jobs set status = 'pending', locked_until = null where status = 'claimed' and locked_until < now();
  select * into v from public.channel_jobs
   where status = 'pending'
     and (kind in ('refresh_groups', 'verify_chat') or (kind = 'integration' and payload ->> 'action' <> 'send_test')
          or not public.setting_bool('paused', false))
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
  elsif j.kind = 'integration' then
    if length(coalesce(p_result::text, '')) > 600000 then raise exception 'Resultado grande demais'; end if;
    update public.channel_jobs set result = coalesce(p_result, '{}'::jsonb) where id = p_id;
  else
    v_chat := public.upsert_chat((p_result -> 'chat') || jsonb_build_object('channel', j.channel));
    update public.channel_jobs set result = jsonb_build_object('chat_id', v_chat) where id = p_id;
  end if;
  update public.channel_jobs set status = 'done', finished_at = now(), locked_until = null where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.integration_secret_keys(), public.set_integration_secret(text, text), public.clear_integration_secret(text),
  public.list_integration_secrets(), public.rotate_telegram_webhook_secret(), public.valid_https_url(text), public.save_integration(text, jsonb),
  public.report_integration_status(text, jsonb), public.get_integration_runtime(), public.request_integration_action(text, text, jsonb) from public, anon;
grant execute on function public.set_integration_secret(text, text), public.clear_integration_secret(text), public.list_integration_secrets(),
  public.rotate_telegram_webhook_secret(), public.save_integration(text, jsonb), public.request_integration_action(text, text, jsonb) to authenticated;
grant execute on function public.valid_https_url(text) to authenticated;
grant execute on function public.report_integration_status(text, jsonb), public.get_integration_runtime(), public.integration_secret_keys(),
  public.valid_https_url(text) to service_role;
grant execute on function public.claim_channel_job(text), public.complete_channel_job(uuid, jsonb) to service_role;
