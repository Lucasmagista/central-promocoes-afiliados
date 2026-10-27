-- ============================================================================
-- 009 — Gerenciamento de grupos (WhatsApp/Telegram) e padrões de criação de grupo
--
-- O painel nunca fala com a Evolution/Telegram: grava uma tarefa "group_action" e o n8n executa.
--   * leituras (info, participantes, link de convite) funcionam mesmo com a pausa global;
--   * alterações (nome, descrição, permissões, participantes, sair) respeitam a pausa;
--   * alteração interrompida (reserva vencida) NUNCA é repetida sozinha: falha e pede conferência;
--   * limites: 30 alterações / 10 min por usuário e 200 participantes adicionados / 24 h.
-- ============================================================================

alter table public.channel_jobs drop constraint if exists channel_jobs_kind_check;
alter table public.channel_jobs add constraint channel_jobs_kind_check
  check (kind in ('refresh_groups', 'create_group', 'verify_chat', 'integration', 'group_action'));

-- ---------------------------------------------------------------------------
-- Padrões aplicados a grupos novos
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('int_groups', '{"whatsapp":{"only_admins_send":true,"lock_info":true,"ephemeral_seconds":0,"add_disclosure":true,"add_batch_size":20,"add_delay_s":6,"invite_after_create":true},"telegram":{"restrict_members_send":false,"add_disclosure":true}}')
on conflict (key) do nothing;

create or replace function public.save_group_defaults(p_config jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb; ch text; k text; v jsonb; n numeric;
begin
  perform public.require_admin();
  if jsonb_typeof(p_config) <> 'object' then raise exception 'Configuração inválida'; end if;
  select value into v_old from public.settings where key = 'int_groups';
  v_new := coalesce(v_old, '{}'::jsonb);
  for ch in select jsonb_object_keys(p_config) loop
    if ch not in ('whatsapp', 'telegram') then raise exception 'Canal desconhecido: %', ch; end if;
    if jsonb_typeof(p_config -> ch) <> 'object' then raise exception 'Configuração de % inválida', ch; end if;
    v_new := v_new || jsonb_build_object(ch, coalesce(v_new -> ch, '{}'::jsonb));
    for k, v in select * from jsonb_each(p_config -> ch) loop
      if ch = 'whatsapp' and k in ('only_admins_send', 'lock_info', 'add_disclosure', 'invite_after_create') then
        if jsonb_typeof(v) <> 'boolean' then raise exception '"%" precisa ser verdadeiro ou falso', k; end if;
      elsif ch = 'whatsapp' and k = 'ephemeral_seconds' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (0, 86400, 604800, 7776000) then raise exception 'Mensagens temporárias: desligado, 24 horas, 7 dias ou 90 dias'; end if;
      elsif ch = 'whatsapp' and k = 'add_batch_size' then
        if jsonb_typeof(v) <> 'number' then raise exception '"%" precisa ser número', k; end if;
        n := (v #>> '{}')::numeric; if n < 1 or n > 50 or n <> trunc(n) then raise exception 'Participantes por lote: de 1 a 50'; end if;
      elsif ch = 'whatsapp' and k = 'add_delay_s' then
        if jsonb_typeof(v) <> 'number' then raise exception '"%" precisa ser número', k; end if;
        n := (v #>> '{}')::numeric; if n < 2 or n > 60 then raise exception 'Espera entre lotes: de 2 a 60 segundos'; end if;
      elsif ch = 'telegram' and k in ('restrict_members_send', 'add_disclosure') then
        if jsonb_typeof(v) <> 'boolean' then raise exception '"%" precisa ser verdadeiro ou falso', k; end if;
      else raise exception 'Campo desconhecido em %: %', ch, k;
      end if;
      v_new := jsonb_set(v_new, array[ch, k], v, true);
    end loop;
  end loop;
  insert into public.settings (key, value) values ('int_groups', v_new) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.log_audit('group_defaults_saved', 'settings', 'int_groups', '{}'::jsonb);
end $$;

-- o worker lê os padrões junto com o resto da configuração
create or replace function public.get_integration_runtime() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evolution', coalesce((select value from public.settings where key = 'int_evolution'), '{}'::jsonb),
    'telegram',  coalesce((select value from public.settings where key = 'int_telegram'),  '{}'::jsonb),
    'n8n',       coalesce((select value from public.settings where key = 'int_n8n'),       '{}'::jsonb),
    'groups',    coalesce((select value from public.settings where key = 'int_groups'),    '{}'::jsonb),
    'disclosure', coalesce((select value #>> '{}' from public.settings where key = 'affiliate_disclosure'), ''),
    'paused',    public.setting_bool('paused', false),
    'status',    coalesce((select jsonb_object_agg(substr(key, 12), value) from public.settings where key like 'int\_status\_%'), '{}'::jsonb),
    'secrets',   coalesce((select jsonb_object_agg(key, value) from public.integration_secrets), '{}'::jsonb),
    'connectors', coalesce((select jsonb_object_agg(platform, jsonb_build_object('mode', mode, 'config', config)) from public.connectors), '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Pedido de ação em um grupo
-- ---------------------------------------------------------------------------
create or replace function public.group_action_is_read(p_action text) returns boolean
language sql immutable as $$ select p_action in ('info', 'participants', 'invite_code', 'admins') $$;

create or replace function public.request_group_action(p_channel text, p_external_id text, p_action text, p_params jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_ext text := btrim(coalesce(p_external_id, '')); v_p jsonb := '{}'::jsonb; v_text text; v_nums jsonb; v_viol text[];
  v_read boolean := public.group_action_is_read(p_action); v_ok boolean; v_adds integer; v_max integer; v_cap integer := public.setting_int('max_participant_adds_per_day', 200);
begin
  perform public.require_admin();
  if p_channel not in ('whatsapp', 'telegram') then raise exception 'Canal inválido'; end if;
  if p_channel = 'whatsapp' and v_ext !~ '^\d{5,25}(-\d{5,20})?@g\.us$' then raise exception 'Identificador de grupo do WhatsApp inválido'; end if;
  if p_channel = 'telegram' and v_ext !~ '^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$' then raise exception 'Identificador do chat do Telegram inválido'; end if;
  v_ok := case p_channel
    when 'whatsapp' then p_action in ('info', 'participants', 'invite_code', 'revoke_invite', 'set_subject', 'set_description', 'set_only_admins_send', 'set_lock_info',
                                      'set_ephemeral', 'add_participants', 'remove_participants', 'promote', 'demote', 'send_invite', 'leave', 'apply_defaults')
    else p_action in ('info', 'admins', 'create_invite', 'revoke_invite', 'set_title', 'set_description', 'set_permissions', 'leave') end;
  if not coalesce(v_ok, false) then raise exception 'Esta ação não existe para o %', case p_channel when 'whatsapp' then 'WhatsApp' else 'Telegram' end; end if;
  if not v_read and public.setting_bool('paused', false) then raise exception 'Envios pausados: retome antes de alterar grupos'; end if;
  p_params := coalesce(p_params, '{}'::jsonb);

  if p_action in ('set_subject', 'set_title') then
    v_text := btrim(coalesce(p_params ->> 'subject', ''));
    if length(v_text) < 1 or length(v_text) > 100 then raise exception 'O nome precisa ter de 1 a 100 caracteres'; end if;
    v_viol := public.text_violations(v_text);
    if cardinality(v_viol) > 0 then raise exception 'O nome contém termos proibidos: %', array_to_string(v_viol, ', '); end if;
    v_p := jsonb_build_object('subject', v_text);
  elsif p_action = 'set_description' then
    v_text := btrim(coalesce(p_params ->> 'description', ''));
    v_max := (case p_channel when 'telegram' then 255 else 2048 end);
    if length(v_text) > v_max then raise exception 'Descrição longa demais (máx. % caracteres)', v_max; end if;
    v_viol := public.text_violations(v_text);
    if cardinality(v_viol) > 0 then raise exception 'A descrição contém termos proibidos: %', array_to_string(v_viol, ', '); end if;
    v_p := jsonb_build_object('description', v_text);
  elsif p_action in ('set_only_admins_send', 'set_lock_info') then
    if jsonb_typeof(p_params -> 'value') <> 'boolean' then raise exception 'Informe verdadeiro ou falso'; end if;
    v_p := jsonb_build_object('value', p_params -> 'value');
  elsif p_action = 'set_permissions' then
    if jsonb_typeof(p_params -> 'can_send_messages') <> 'boolean' then raise exception 'Informe verdadeiro ou falso'; end if;
    v_p := jsonb_build_object('can_send_messages', p_params -> 'can_send_messages');
  elsif p_action = 'set_ephemeral' then
    if jsonb_typeof(p_params -> 'seconds') <> 'number' or (p_params ->> 'seconds')::numeric not in (0, 86400, 604800, 7776000) then raise exception 'Mensagens temporárias: desligado, 24 horas, 7 dias ou 90 dias'; end if;
    v_p := jsonb_build_object('seconds', (p_params ->> 'seconds')::integer);
  elsif p_action in ('add_participants', 'remove_participants', 'promote', 'demote', 'send_invite') then
    select coalesce(jsonb_agg(distinct d), '[]'::jsonb) into v_nums from (
      select regexp_replace(x, '\D', '', 'g') as d from jsonb_array_elements_text(coalesce(p_params -> 'numbers', '[]'::jsonb)) x) q where d ~ '^\d{10,15}$';
    if jsonb_array_length(v_nums) < 1 then raise exception 'Informe ao menos 1 número válido (DDI+DDD+número)'; end if;
    if jsonb_array_length(v_nums) > 50 then raise exception 'No máximo 50 números por vez'; end if;
    if p_action = 'add_participants' then
      select coalesce(sum(jsonb_array_length(payload -> 'params' -> 'numbers')), 0) into v_adds from public.channel_jobs
       where kind = 'group_action' and payload ->> 'action' = 'add_participants' and status <> 'cancelled' and requested_at > now() - interval '24 hours';
      if v_adds + jsonb_array_length(v_nums) > v_cap then raise exception 'Limite de % participantes adicionados em 24 horas (proteção contra bloqueio do número). Já pedidos: %', v_cap, v_adds; end if;
    end if;
    v_p := jsonb_build_object('numbers', v_nums);
    if p_action = 'send_invite' then v_p := v_p || jsonb_build_object('text', left(btrim(coalesce(p_params ->> 'text', '')), 300)); end if;
  elsif p_action = 'revoke_invite' and p_channel = 'telegram' then
    v_text := btrim(coalesce(p_params ->> 'link', ''));
    if v_text !~ '^https://t\.me/[A-Za-z0-9_+/-]{4,100}$' then raise exception 'Link de convite do Telegram inválido'; end if;
    v_p := jsonb_build_object('link', v_text);
  elsif p_action = 'leave' then
    if (p_params ->> 'confirm') is distinct from 'true' then raise exception 'Confirme que o sistema deve sair deste grupo'; end if;
    v_p := jsonb_build_object('confirm', true);
  end if;

  if not v_read then
    if (select count(*) from public.channel_jobs where kind = 'group_action' and requested_by = auth.uid() and not public.group_action_is_read(payload ->> 'action')
          and requested_at > now() - interval '10 minutes') >= 30 then
      raise exception 'Muitas alterações seguidas. Aguarde alguns minutos';
    end if;
  end if;
  -- clique repetido: reaproveita a tarefa idêntica em andamento
  select id into v_id from public.channel_jobs
   where kind = 'group_action' and channel = p_channel and status in ('pending', 'claimed') and requested_at > now() - interval '60 seconds'
     and payload = jsonb_build_object('external_id', v_ext, 'action', p_action, 'params', v_p) limit 1;
  if found then return v_id; end if;
  -- links de convite antigos não ficam guardados
  update public.channel_jobs set result = result - 'invite_url' where kind in ('group_action', 'create_group') and result ? 'invite_url' and finished_at < now() - interval '1 day';
  insert into public.channel_jobs (kind, channel, payload, requested_by)
  values ('group_action', p_channel, jsonb_build_object('external_id', v_ext, 'action', p_action, 'params', v_p), auth.uid()) returning id into v_id;
  if not v_read then perform public.log_audit('group_action_requested', 'channel_job', v_id::text, jsonb_build_object('canal', p_channel, 'acao', p_action, 'grupo', v_ext)); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- claim / complete
-- ---------------------------------------------------------------------------
create or replace function public.claim_channel_job(p_worker text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  -- reserva vencida: ações que alteram algo NUNCA repetem (poderiam duplicar ou desfazer)
  update public.channel_jobs set status = 'failed', finished_at = now(), locked_until = null,
         last_error = 'reserva vencida: confira no aplicativo se a ação foi concluída antes de tentar de novo'
   where status = 'claimed' and locked_until < now()
     and (kind = 'create_group' or (kind = 'integration' and payload ->> 'action' = 'send_test')
          or (kind = 'group_action' and not public.group_action_is_read(payload ->> 'action')));
  update public.channel_jobs set status = 'pending', locked_until = null where status = 'claimed' and locked_until < now();
  select * into v from public.channel_jobs
   where status = 'pending'
     and (kind in ('refresh_groups', 'verify_chat') or (kind = 'integration' and payload ->> 'action' <> 'send_test')
          or (kind = 'group_action' and public.group_action_is_read(payload ->> 'action'))
          or not public.setting_bool('paused', false))
   order by requested_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.channel_jobs set status = 'claimed', claimed_at = now(), locked_until = now() + interval '240 seconds' where id = v.id;
  return jsonb_build_object('id', v.id, 'kind', v.kind, 'channel', v.channel, 'payload', v.payload);
end $$;

create or replace function public.complete_channel_job(p_id uuid, p_result jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare j record; g jsonb; v_chat uuid; v_n integer := 0; v_res jsonb;
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
    update public.channel_jobs set result = jsonb_strip_nulls(jsonb_build_object('chat_id', v_chat, 'external_id', p_result ->> 'external_id',
      'invite_url', p_result ->> 'invite_url', 'applied', p_result -> 'applied', 'pending_numbers', p_result -> 'pending_numbers')) where id = p_id;
  elsif j.kind = 'integration' then
    if length(coalesce(p_result::text, '')) > 600000 then raise exception 'Resultado grande demais'; end if;
    update public.channel_jobs set result = coalesce(p_result, '{}'::jsonb) where id = p_id;
  elsif j.kind = 'group_action' then
    if length(coalesce(p_result::text, '')) > 600000 then raise exception 'Resultado grande demais'; end if;
    v_res := coalesce(p_result, '{}'::jsonb) - 'chat';
    if p_result ? 'chat' and coalesce(p_result -> 'chat' ->> 'external_id', '') <> '' then
      v_chat := public.upsert_chat((p_result -> 'chat') || jsonb_build_object('channel', j.channel));
      v_res := v_res || jsonb_build_object('chat_id', v_chat);
      if jsonb_typeof(p_result -> 'participants') = 'array' then perform public.sync_chat_participants(v_chat, p_result -> 'participants'); end if;
    end if;
    if p_result ->> 'left' = 'true' then
      update public.chats set archived = true, we_are_admin = false where channel = j.channel and external_id = j.payload ->> 'external_id';
    end if;
    update public.channel_jobs set result = v_res where id = p_id;
  else
    v_chat := public.upsert_chat((p_result -> 'chat') || jsonb_build_object('channel', j.channel));
    update public.channel_jobs set result = jsonb_build_object('chat_id', v_chat) where id = p_id;
  end if;
  update public.channel_jobs set status = 'done', finished_at = now(), locked_until = null where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.save_group_defaults(jsonb), public.group_action_is_read(text), public.request_group_action(text, text, text, jsonb),
  public.get_integration_runtime(), public.claim_channel_job(text), public.complete_channel_job(uuid, jsonb) from public, anon;
grant execute on function public.save_group_defaults(jsonb), public.request_group_action(text, text, text, jsonb) to authenticated;
grant execute on function public.group_action_is_read(text) to authenticated, service_role;
grant execute on function public.get_integration_runtime(), public.claim_channel_job(text), public.complete_channel_job(uuid, jsonb) to service_role;
