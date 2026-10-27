-- ============================================================================
-- 010 — Testes do n8n pelo painel (autoteste, webhooks de entrada, monitor e ciclo de envio)
-- Só amplia a lista de ações aceitas por request_integration_action.
-- ============================================================================

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
    when 'n8n' then p_action in ('selftest', 'webhook_check', 'run_monitor', 'run_sender')
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Ação não existe para esta integração'; end if;
  v_ch := case p_provider when 'evolution' then 'whatsapp' when 'telegram' then 'telegram' else null end;

  if p_action = 'run_sender' and public.setting_bool('paused', false) then raise exception 'Envios pausados: retome antes de rodar o ciclo de envio'; end if;

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

revoke all on function public.request_integration_action(text, text, jsonb) from public, anon;
grant execute on function public.request_integration_action(text, text, jsonb) to authenticated;
