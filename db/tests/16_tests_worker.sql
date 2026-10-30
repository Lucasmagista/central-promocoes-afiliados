\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 16. Testes do worker pelo painel: ações aceitas, pausa e permissões
-- ============================================================================
do $$
declare v1 uuid; v2 uuid; j jsonb; n integer := 0;
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  v1 := public.request_integration_action('worker', 'selftest');
  assert v1 = public.request_integration_action('worker', 'selftest'), 'clique repetido reaproveita a tarefa';
  perform public.request_integration_action('worker', 'webhook_check');
  perform public.request_integration_action('worker', 'run_monitor');
  perform test.fails($f$select public.request_integration_action('worker', 'apagar_tudo')$f$, 'Ação não existe');
  perform test.fails($f$select public.request_integration_action('worker', 'send_test')$f$, 'Ação não existe');

  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$select public.request_integration_action('worker', 'selftest')$f$, 'administrador');

  -- pausa: diagnósticos continuam, ciclo de envio não
  perform test.as_role('service_role');
  update settings set value = 'true' where key = 'paused';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_integration_action('worker', 'run_sender')$f$, 'pausados');
  perform test.as_role('service_role');
  loop
    j := public.claim_channel_job('worker'); exit when j is null;
    if j ->> 'kind' = 'integration' and j #>> '{payload,provider}' = 'worker' then n := n + 1; end if;
    if j ->> 'kind' = 'group_action' then perform public.complete_channel_job((j ->> 'id')::uuid, '{}');
    elsif j ->> 'kind' = 'integration' then perform public.complete_channel_job((j ->> 'id')::uuid, '{"ok":true,"checks":[]}');
    else perform public.fail_channel_job((j ->> 'id')::uuid, 'teste'); end if;
  end loop;
  assert n = 3, 'autoteste, webhooks e monitor rodam mesmo pausado';
  assert (select result ->> 'ok' from channel_jobs where id = v1) = 'true';
  perform public.report_integration_status('worker', '{"ok":true}');
  assert (select value ->> 'ok' from settings where key = 'int_status_worker') = 'true';
  update settings set value = 'false' where key = 'paused';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.request_integration_action('worker', 'run_sender');
  raise notice 'ok 26: ações de teste do worker (permissões, pausa, repetição)';
end $$;
