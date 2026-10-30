\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 17. Contas de afiliado (012): tokens só do worker, código do OAuth descartável,
--     ações novas, config de conector (keywords/link_template) e runtime do worker
-- ============================================================================
do $$
declare v_job uuid; v_job2 uuid; j jsonb; v_run uuid;
begin
  -- tokens: o painel não grava nem lê; só o worker (service_role)
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.store_integration_token('ml_access_token', 'APP_USR-1234567890-abcdef')$f$, 'permission denied');
  perform test.as_role('service_role');
  perform public.store_integration_token('ml_access_token', 'APP_USR-1234567890-abcdef');
  perform public.store_integration_token('ml_refresh_token', 'TG-abcdef1234567890');
  perform test.fails($f$select public.store_integration_token('evolution_api_key', 'abcdefghij1234567890')$f$, 'Token desconhecido');
  perform test.fails($f$select public.store_integration_token('ml_access_token', 'tem espaço')$f$, 'inválido');
  assert (public.get_integration_runtime() -> 'secrets' ->> 'ml_access_token') = 'APP_USR-1234567890-abcdef', 'worker lê o token';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  assert public.list_integration_secrets()::text not like '%APP_USR%' and public.list_integration_secrets()::text not like '%TG-abcdef%', 'painel nunca recebe token';
  perform test.fails($f$select value from public.integration_secrets$f$, 'permission denied');
  perform test.as_role('service_role');
  perform public.store_integration_token('ml_access_token', '');
  assert not exists (select 1 from public.integration_secrets where key = 'ml_access_token'), 'valor vazio apaga o token';
  perform public.store_integration_token('ml_refresh_token', '');

  -- ações novas do Mercado Livre e da Shopee
  update public.channel_jobs set requested_at = now() - interval '1 hour';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_integration_action('mercadolivre', 'exchange_code', '{"code":"curto"}')$f$, 'Código de autorização inválido');
  perform test.fails($f$select public.request_integration_action('mercadolivre', 'exchange_code', '{"code":"TG-abcdef1234567890","redirect_uri":"http://x.com/a"}')$f$, 'redirecionamento inválido');
  perform test.fails($f$select public.request_integration_action('shopee', 'exchange_code', '{"code":"TG-abcdef1234567890"}')$f$, 'Ação não existe');
  perform test.fails($f$select public.request_integration_action('magalu', 'collect')$f$, 'Ação não existe');
  v_job := public.request_integration_action('mercadolivre', 'exchange_code', '{"code":"TG-abcdef1234567890","redirect_uri":"https://painel.exemplo.com/oauth/mercadolivre"}');
  v_job2 := public.request_integration_action('mercadolivre', 'exchange_code', '{"code":"TG-abcdef1234567891","redirect_uri":"https://painel.exemplo.com/oauth/mercadolivre"}');
  assert v_job <> v_job2, 'cada código vira uma tarefa própria (nunca é reaproveitado)';
  assert (select payload ->> 'code' from public.channel_jobs where id = v_job) = 'TG-abcdef1234567890';
  -- terminou (ou falhou): o código some da tarefa
  perform test.as_role('service_role');
  update public.channel_jobs set status = 'done' where id = v_job;
  update public.channel_jobs set status = 'failed' where id = v_job2;
  assert not (select payload ? 'code' from public.channel_jobs where id = v_job), 'código apagado ao concluir';
  assert not (select payload ? 'code' from public.channel_jobs where id = v_job2), 'código apagado ao falhar';
  assert (select payload ->> 'action' from public.channel_jobs where id = v_job) = 'exchange_code', 'o resto da tarefa continua';

  -- coleta exige conector ativo; a amostra não
  update public.channel_jobs set requested_at = now() - interval '1 hour';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  update public.connectors set mode = 'disabled' where platform = 'shopee';
  perform test.fails($f$select public.request_integration_action('shopee', 'collect')$f$, 'Ative a coleta');
  assert public.request_integration_action('shopee', 'preview') is not null, 'amostra é permitida com o conector desligado';
  update public.connectors set mode = 'manual_only' where platform = 'shopee';
  assert public.request_integration_action('shopee', 'collect') is not null, 'coleta liberada quando o conector está ativo';

  -- config do conector: termos de busca e modelo do link
  perform test.fails($f$update public.connectors set config = '{"keywords":["a"]}' where platform = 'shopee'$f$, 'termo de busca');
  perform test.fails($f$update public.connectors set config = '{"keywords":"fone"}' where platform = 'shopee'$f$, 'lista de até 12');
  perform test.fails($f$update public.connectors set config = '{"link_template":"https://x.com/a b/{url}"}' where platform = 'mercadolivre'$f$, 'link_template');
  perform test.fails($f$update public.connectors set config = '{"link_template":"https://x.com/sem-marcador"}' where platform = 'mercadolivre'$f$, 'link_template');
  perform test.fails($f$update public.connectors set config = '{"link_template":"ftp://x.com/{url}"}' where platform = 'mercadolivre'$f$, 'link_template');
  perform test.fails($f$update public.connectors set config = '{"api_token":"abc"}' where platform = 'mercadolivre'$f$, 'Não guarde segredos');
  update public.connectors set config = '{"keywords":["fone bluetooth","air fryer"],"link_template":"{url}?matt_tool=abc123","app_id":"1234567890123456"}' where platform = 'mercadolivre';

  -- runtime do worker: última execução e status por integração
  perform test.as_role('service_role');
  perform public.report_integration_status('mercadolivre', '{"ok":true,"connected":true}');
  j := public.get_integration_runtime();
  assert (j -> 'connectors' -> 'mercadolivre') ? 'last_run_at', 'runtime informa a última execução do conector';
  assert (j -> 'status' -> 'mercadolivre' ->> 'connected') = 'true', 'runtime devolve o status gravado (int_status_*)';
  assert (j -> 'connectors' -> 'mercadolivre' -> 'config' -> 'keywords' ->> 0) = 'fone bluetooth', 'runtime devolve a config do conector';

  -- coleta ponta a ponta: execução + oferta da API entram na fila de revisão com preço anterior confiável
  v_run := public.start_run('shopee');
  j := public.ingest_offer('{"platform":"shopee","external_id":"9.55","original_url":"https://shopee.com.br/product/9/55","affiliate_url":"https://s.shopee.com.br/abc","title":"Caixa de Som","price":75,"previous_price":150,"source_kind":"api","source_layer":"A","source_name":"Shopee Open API","availability":"unknown"}'::jsonb);
  assert j ->> 'status' = 'created', 'oferta da API é criada: ' || j::text;
  assert (select previous_price_source from public.offers where id = (j ->> 'offer_id')::uuid) = 'api', 'preço anterior vindo da API é confiável';
  assert (select discount_pct from public.offers where id = (j ->> 'offer_id')::uuid) = 50;
  perform public.finish_run(v_run, 'success', 1, 1, 0, null);
  assert (select status from public.runs where id = v_run) = 'success';
  assert (public.ingest_offer('{"platform":"shopee","external_id":"9.55","original_url":"https://shopee.com.br/product/9/55","title":"Caixa de Som","price":75,"source_kind":"api"}'::jsonb) ->> 'status') = 'duplicate', 'segunda coleta não duplica';
end $$;

-- ============================================================================
-- 18. Novas plataformas (013): AliExpress, Magalu e Amazon pela Creators API
-- ============================================================================
do $$
declare j jsonb;
begin
  perform test.as_role('service_role');
  update public.channel_jobs set requested_at = now() - interval '1 hour';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.set_integration_secret('aliexpress_app_secret', 'abcdef0123456789abcdef0123456789');
  perform public.set_integration_secret('amazon_client_secret', 'ab~cd!ef#0123456789xyz?');
  perform test.fails($f$select public.set_integration_secret('aliexpress_app_secret', 'curta')$f$, 'inválida');
  perform test.fails($f$select public.set_integration_secret('amazon_client_secret', 'tem espaço mesmo assim longo')$f$, 'espaços');
  assert public.list_integration_secrets()::text not like '%abcdef0123456789%', 'painel não recebe o segredo da AliExpress';
  update public.connectors set mode = 'manual_only' where platform in ('amazon', 'aliexpress', 'magalu');
  assert public.request_integration_action('amazon', 'collect') is not null, 'Amazon coleta pela API';
  assert public.request_integration_action('aliexpress', 'preview') is not null;
  assert public.request_integration_action('magalu', 'check') is not null;
  perform test.fails($f$select public.request_integration_action('magalu', 'collect')$f$, 'Ação não existe');
  update public.connectors set config = '{"client_id":"abc123","partner_tag":"lucas-20","credential_version":"3.1","marketplace":"www.amazon.com.br"}' where platform = 'amazon';
  update public.connectors set config = '{"app_id":"123456","tracking_id":"meu_trk"}' where platform = 'aliexpress';
  perform test.fails($f$update public.connectors set config = '{"credential_version":"2.1"}' where platform = 'amazon'$f$, 'credential_version');
  perform test.fails($f$update public.connectors set config = '{"tracking_id":"com espaço"}' where platform = 'aliexpress'$f$, 'tracking_id');

  perform test.as_role('service_role');
  perform public.report_integration_status('aliexpress', '{"ok":true,"connected":true}');
  perform public.report_integration_status('magalu', '{"ok":true,"partial":true}');
  j := public.ingest_offer('{"platform":"aliexpress","external_id":"1005001","original_url":"https://pt.aliexpress.com/item/1005001.html","affiliate_url":"https://s.click.aliexpress.com/e/_abc","title":"Fone TWS","price":39.9,"previous_price":79.8,"source_kind":"api"}'::jsonb);
  assert j ->> 'status' = 'created', 'AliExpress entra: ' || j::text;
  j := public.ingest_offer('{"platform":"aliexpress","original_url":"https://pt.aliexpress.com/item/1005001.html","title":"Fone TWS","price":39.9,"source_kind":"api"}'::jsonb);
  assert j ->> 'status' = 'duplicate', 'AliExpress deduplica pelo ID extraído da URL';
  j := public.ingest_offer('{"platform":"magalu","original_url":"https://www.magazineluiza.com.br/smart-tv/p/237578300/et/tv/","affiliate_url":"https://www.magazinevoce.com.br/magazinelucas/x/p/237578300/","title":"Smart TV","price":1999,"source_kind":"admin_declared"}'::jsonb);
  assert j ->> 'status' = 'created', 'Magalu entra manualmente: ' || j::text;
  j := public.ingest_offer('{"platform":"amazon","external_id":"B0TEST0001","original_url":"https://www.amazon.com.br/dp/B0TEST0001","affiliate_url":"https://www.amazon.com.br/dp/B0TEST0001?tag=lucas-20","title":"Echo Dot","price":249.9,"previous_price":449.9,"source_kind":"api"}'::jsonb);
  assert j ->> 'status' = 'created', 'Amazon entra pela API: ' || j::text;
  assert (select discount_pct from public.offers where product_id = (select id from public.products where external_id = 'B0TEST0001')) > 44, 'desconto da Amazon vem do preço de referência da API';
  assert public.extract_external_id('aliexpress', 'https://www.aliexpress.com/item/1005006123456789.html?x=1') = '1005006123456789';
  assert (select count(*) from public.connectors where platform in ('aliexpress', 'magalu')) = 2, 'conectores criados';
  assert (public.get_integration_runtime() -> 'connectors') ? 'aliexpress', 'runtime inclui AliExpress';
end $$;

-- ============================================================================
-- 19. Webhook interno da Evolution (014)
-- ============================================================================
do $$
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.save_integration('evolution', '{"webhook_url":"http://promo-worker:8787/hook/whatsapp-abc123"}');
  assert (select value ->> 'webhook_url' from settings where key = 'int_evolution') = 'http://promo-worker:8787/hook/whatsapp-abc123', 'Evolution aceita endereço interno do Docker';
  perform public.save_integration('evolution', '{"webhook_url":"https://worker.hubly.software/hook/whatsapp-abc123"}');
  perform test.fails($f$select public.save_integration('evolution', '{"webhook_url":"http://exemplo.com:8787/hook/x"}')$f$, 'Endereço do webhook inválido');
  perform test.fails($f$select public.save_integration('evolution', '{"webhook_url":"http://10.0.0.5:8787/x"}')$f$, 'Endereço do webhook inválido');
  perform test.fails($f$select public.save_integration('evolution', '{"base_url":"http://promo-worker:8787"}')$f$, 'Endereço da Evolution inválido');
  perform test.fails($f$select public.save_integration('telegram', '{"mode":"webhook","webhook_url":"http://promo-worker:8787/hook/telegram-x"}')$f$, 'precisa ser https');
end $$;
