\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 10. Integrações: segredos write-only, configuração validada, ações via worker
-- ============================================================================
do $$
declare v_job uuid; v_job2 uuid; j jsonb; n integer; v_cfg jsonb;
begin
  -- admin salva configuração da Evolution
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.save_integration('evolution', '{"base_url":"https://whatsapp.hubly.software/","instance":"central-promo","send_delay_min_s":5,"send_delay_max_s":15}');
  select value into v_cfg from settings where key = 'int_evolution';
  assert v_cfg ->> 'base_url' = 'https://whatsapp.hubly.software', 'barra final removida';
  assert v_cfg ->> 'instance' = 'central-promo';
  perform test.fails($f$select public.save_integration('evolution', '{"base_url":"http://whatsapp.hubly.software"}')$f$, 'Endereço da Evolution inválido');
  perform test.fails($f$select public.save_integration('evolution', '{"base_url":"https://user:pass@x.com"}')$f$, 'Endereço da Evolution inválido');
  perform test.fails($f$select public.save_integration('evolution', '{"instance":"nome com espaço"}')$f$, 'Nome da instância');
  perform test.fails($f$select public.save_integration('evolution', '{"send_delay_min_s":20,"send_delay_max_s":10}')$f$, 'intervalo mínimo');
  perform test.fails($f$select public.save_integration('evolution', '{"api_key":"abc"}')$f$, 'Campo desconhecido');
  perform test.fails($f$select public.save_integration('evolution', '{"alert_numbers":["123"]}')$f$, 'Números de alerta');
  perform public.save_integration('telegram', '{"enabled":true,"admin_chat_id":"@meu_canal","mode":"polling"}');
  perform test.fails($f$select public.save_integration('telegram', '{"mode":"webhook"}')$f$, 'informe o endereço do webhook');
  perform public.save_integration('telegram', '{"mode":"webhook","webhook_url":"https://worker.hubly.software/hook/telegram-abc"}');
  perform test.fails($f$select public.save_integration('telegram', '{"mode":"magia"}')$f$, 'polling ou webhook');

  -- segredos: validação, escrita, ninguém lê
  perform public.set_integration_secret('evolution_api_key', 'abcdefghij1234567890');
  perform test.fails($f$select public.set_integration_secret('telegram_bot_token', 'isto-nao-e-token')$f$, 'Token do bot inválido');
  perform test.fails($f$select public.set_integration_secret('evolution_api_key', 'curta')$f$, '12 a 200');
  perform test.fails($f$select public.set_integration_secret('desconhecido', 'abcdefghij1234567890')$f$, 'Segredo desconhecido');
  perform public.set_integration_secret('telegram_bot_token', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
  perform public.rotate_telegram_webhook_secret();
  j := public.list_integration_secrets();
  assert (select count(*) from jsonb_array_elements(j) e where (e ->> 'is_set')::boolean) = 3, 'três segredos gravados';
  assert j::text not like '%abcdefghij1234567890%' and j::text not like '%AAHdqTcvCH1%', 'lista nunca devolve o valor';
  assert (select e ->> 'hint' from jsonb_array_elements(j) e where e ->> 'key' = 'evolution_api_key') = '7890';
  perform test.fails($f$select value from public.integration_secrets$f$, 'permission denied');
  assert not exists (select 1 from audit_events where metadata::text like '%abcdefghij%'), 'auditoria não guarda segredo';

  -- operador e leitor não mexem
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$select public.set_integration_secret('evolution_api_key', 'abcdefghij1234567890')$f$, 'administrador');
  perform test.fails($f$select public.save_integration('evolution', '{"instance":"x1"}')$f$, 'administrador');
  perform test.fails($f$select public.request_integration_action('evolution', 'status')$f$, 'administrador');
  assert jsonb_array_length(public.list_integration_secrets()) = 7, 'membros veem se está definido';
  perform test.as_role('anon');
  perform test.fails($f$select public.list_integration_secrets()$f$, 'permission denied');

  -- ações: validação, deduplicação, execução pelo worker
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_integration_action('evolution', 'apagar_tudo')$f$, 'Ação não existe');
  perform test.fails($f$select public.request_integration_action('evolution', 'send_test', '{"to":"123"}')$f$, 'Número inválido');
  perform test.fails($f$select public.request_integration_action('telegram', 'send_test', '{"to":"abc"}')$f$, 'Destino inválido');
  perform test.fails($f$select public.request_integration_action('evolution', 'send_test', '{"to":"5511999990001","text":"garantido!"}')$f$, 'termos proibidos');
  v_job := public.request_integration_action('evolution', 'status');
  v_job2 := public.request_integration_action('evolution', 'status');
  assert v_job = v_job2, 'clique repetido reaproveita a tarefa';
  v_job2 := public.request_integration_action('evolution', 'connect', '{"pairing_number":"+55 (11) 99999-0001"}');
  assert (select payload ->> 'pairing_number' from channel_jobs where id = v_job2) = '5511999990001';
  v_job2 := public.request_integration_action('mercadolivre', 'check');
  assert (select channel is null from channel_jobs where id = v_job2);
  v_job2 := public.request_integration_action('evolution', 'send_test', '{"to":"+55 11 99999-0001"}');
  assert (select payload ->> 'to' from channel_jobs where id = v_job2) = '5511999990001';

  -- pausa global: teste de envio fica retido, diagnóstico continua
  perform test.as_role('service_role');
  update settings set value = 'true' where key = 'paused';
  n := 0;
  loop
    j := public.claim_channel_job('w1');
    exit when j is null;
    assert j #>> '{payload,action}' <> 'send_test', 'send_test não sai durante a pausa';
    perform public.complete_channel_job((j ->> 'id')::uuid, '{"state":"open"}');
    n := n + 1;
  end loop;
  assert n >= 3, 'diagnósticos rodam durante a pausa';
  update settings set value = 'false' where key = 'paused';
  j := public.claim_channel_job('w1');
  assert j #>> '{payload,action}' = 'send_test', 'send_test sai depois da retomada';
  perform public.fail_channel_job((j ->> 'id')::uuid, 'teste');

  -- worker lê o runtime e devolve o estado
  j := public.get_integration_runtime();
  assert j #>> '{secrets,evolution_api_key}' = 'abcdefghij1234567890', 'worker enxerga o segredo';
  assert j #>> '{evolution,instance}' = 'central-promo';
  perform public.report_integration_status('evolution', '{"state":"open","phone":"5511999990001"}');
  perform public.report_integration_status('shopee', '{"ok":true}');
  perform test.fails($f$select public.report_integration_status('outra', '{}')$f$, 'Integração desconhecida');
  assert (select value ->> 'state' from settings where key = 'int_status_evolution') = 'open';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.get_integration_runtime()$f$, 'permission denied');

  -- conectores: id do aplicativo sim, segredo não
  update connectors set config = '{"app_id":"1234567890","client_id":"amzn1.application-oa2-client.abc123","partner_tag":"minhaloja-20","marketplace":"www.amazon.com.br"}' where platform = 'amazon';
  perform test.fails($f$update connectors set config = '{"client_secret":"abc"}' where platform = 'amazon'$f$, 'Não guarde segredos');
  perform test.fails($f$update connectors set config = '{"app_id":"com espaço"}' where platform = 'shopee'$f$, 'app_id');
  perform test.fails($f$update connectors set config = '{"redirect_uri":"http://x.com/cb"}' where platform = 'mercadolivre'$f$, 'https');
  raise notice 'ok 24: integrações (config validada, segredos write-only, ações e pausa)';
end $$;
