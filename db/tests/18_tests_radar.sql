\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 18. Radar, automação, revalidação, acompanhamento, comissões e operação (016)
-- ============================================================================
do $$
declare
  v_dest uuid; v_dest_chat uuid; v_chat1 uuid; v_chat2 uuid; v_src1 uuid; v_src2 uuid; j jsonb; v_off uuid; v_score integer; v_score2 integer;
  v_pub uuid; v_rule uuid; v_w uuid; v_w2 uuid; v_n integer;
begin
  -- variação de texto
  perform test.as_role('service_role');
  for i in 1 .. 30 loop assert public.spin_text('A [[x|y|z]] B') ~ '^A [xyz] B$', 'spin_text sorteia uma das opções'; end loop;
  assert public.spin_text('sem opção') = 'sem opção';
  assert public.spin_text('[[a|b]] e [[c|d]]') ~ '^[ab] e [cd]$', 'várias variações no mesmo texto';

  -- fixtures
  update public.connectors set mode = 'manual_only' where platform in ('shopee', 'amazon');
  perform public.set_setting('mode', '"review"'::jsonb);
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('telegram', '-100555900', 'Destino Radar', true, now()) returning id into v_dest;
  insert into public.chats (channel, external_id, kind, title) values ('telegram', '-100555900', 'group', 'Destino Radar') returning id into v_dest_chat;
  insert into public.chats (channel, external_id, kind, title) values ('telegram', '-100555111', 'group', 'Fonte A') returning id into v_chat1;
  insert into public.chats (channel, external_id, kind, title) values ('whatsapp', '120363555555555111@g.us', 'group', 'Fonte B') returning id into v_chat2;

  -- fontes do Radar (só admin; nunca um destino)
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$select public.save_promo_source(gen_random_uuid(), '{}')$f$, 'administrador');
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails(format($f$select public.save_promo_source(%L, '{}')$f$, v_dest_chat), 'um dos seus destinos');
  perform test.fails(format($f$select public.save_promo_source(%L, '{"mode":"magia"}')$f$, v_chat1), 'Modo inválido');
  perform test.fails(format($f$select public.save_promo_source(%L, '{"platforms":["ebay"]}')$f$, v_chat1), 'Plataforma inválida');
  v_src1 := public.save_promo_source(v_chat1, '{"mode":"review","platforms":["shopee","amazon"],"blocked_words":["Réplica"," usado "],"max_per_hour":5}');
  v_src2 := public.save_promo_source(v_chat2, '{"mode":"auto"}');
  assert (select blocked_words from public.promo_sources where id = v_src1) = array['réplica', 'usado'], 'palavras bloqueadas normalizadas';
  assert jsonb_array_length(public.list_promo_sources()) = 2;

  -- fila de mensagens do Radar: só com link, só de fontes, nunca de destinos
  perform test.as_role('service_role');
  insert into public.chat_messages (chat_id, direction, external_id, kind, body, sent_at) values
    (v_chat1, 'in', 'm1', 'text', 'Olha essa: https://s.shopee.com.br/abc por R$ 50', now()),
    (v_chat1, 'in', 'm2', 'text', 'bom dia grupo', now()),
    (v_chat1, 'out', 'm3', 'text', 'https://shopee.com.br/x', now()),
    (v_dest_chat, 'in', 'm4', 'text', 'https://shopee.com.br/y', now());
  j := public.claim_radar_messages(30);
  assert jsonb_array_length(j) = 1, 'só 1 mensagem elegível: ' || j::text;
  assert j -> 0 ->> 'chat_title' = 'Fonte A' and j -> 0 -> 'source' ->> 'mode' = 'review' and (j -> 0 -> 'source' ->> 'max_per_hour')::int = 5;
  assert jsonb_array_length(public.claim_radar_messages(30)) = 0, 'mensagem não é entregue duas vezes';

  -- cache de links e registro de capturas
  perform public.link_cache_put('h1', 'https://shopee.com.br/produto-i.7.77', 'shopee', '7.77');
  assert public.link_cache_get('h1') ->> 'external_id' = '7.77';
  assert public.link_cache_get('inexistente') is null;
  assert public.record_captured_link(jsonb_build_object('source_id', v_src1, 'original_url', 'https://s.shopee.com.br/abc', 'status', 'ineligible', 'reason', 'teste')) > 0;

  -- oferta com sinais e score v2
  j := public.ingest_offer('{"platform":"shopee","external_id":"7.77","original_url":"https://shopee.com.br/produto-i.7.77","affiliate_url":"https://s.shopee.com.br/xyz","title":"Produto Radar","price":95,"previous_price":100,"source_kind":"api","category":"eletronicos"}'::jsonb);
  assert j ->> 'status' = 'created', 'oferta criada: ' || j::text;
  v_off := (j ->> 'offer_id')::uuid; v_score := (j ->> 'score')::int;
  perform public.set_offer_signals(v_off, 9, 800, 4.9, true);
  v_score2 := (select score from public.offers where id = v_off);
  assert v_score2 = v_score + 13, format('sinais somam 13 pontos (%s -> %s)', v_score, v_score2);
  assert (select auto_ok from public.offers where id = v_off), 'oferta marcada como auto_ok';
  assert public.register_offer_source(v_off, v_src1) = 1;
  assert public.register_offer_source(v_off, v_src1) = 1, 'mesma fonte não conta duas vezes';
  assert public.register_offer_source(v_off, v_src2) = 2;
  assert (select score from public.offers where id = v_off) = v_score2 + 5, 'duas fontes: +5';
  assert (select source_count from public.offers where id = v_off) = 2;

  -- "de/por" inflado: histórico próprio mostra que o preço anterior é bem maior que o já visto
  declare v_prod uuid := (select product_id from public.offers where id = v_off); v_o2 uuid;
  begin
    insert into public.price_observations (product_id, price, source_kind, observed_at) values
      (v_prod, 90, 'api', now() - interval '3 days'), (v_prod, 92, 'api', now() - interval '2 days');
    update public.offers set status = 'rejected', rejected_reason = 'teste' where id = v_off;
    j := public.ingest_offer('{"platform":"shopee","external_id":"7.77","original_url":"https://shopee.com.br/produto-i.7.77","affiliate_url":"https://s.shopee.com.br/xyz","title":"Produto Radar","price":60,"previous_price":200,"source_kind":"api"}'::jsonb);
    assert j ->> 'status' = 'created', 'nova oferta após rejeição: ' || j::text;
    v_o2 := (j ->> 'offer_id')::uuid;
    assert exists (select 1 from jsonb_array_elements((select score_reasons from public.offers where id = v_o2)) e where e ->> 'code' = 'inflated'), 'detecta "de/por" inflado';
    update public.offers set status = 'rejected', rejected_reason = 'teste' where id = v_o2;
  end;

  -- roteamento e aprovação automática
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.save_routing_rule(null, '{"name":"x","platforms":["ebay"]}')$f$, 'Plataforma inválida');
  v_rule := public.save_routing_rule(null, jsonb_build_object('name', 'Shopee eletrônicos', 'platforms', jsonb_build_array('shopee'), 'categories', jsonb_build_array('eletronicos'),
              'min_score', 50, 'destinations', jsonb_build_array(v_dest), 'auto_approve', true));
  assert (select count(*) from public.routing_rules) = 1;
  perform test.as_role('service_role');
  update public.offers set status = 'needs_review', rejected_reason = null, score = 80, is_simulated = false where id = v_off;
  assert (public.auto_route_offer(v_off) ->> 'auto')::boolean, 'regra manda aprovar sozinha';
  assert public.auto_route_offer(v_off) -> 'destinations' = jsonb_build_array(v_dest), 'destino vem da regra';
  perform public.set_setting('mode', '"simulation"'::jsonb);
  assert (public.run_auto_approve(5) ->> 'approved') = '0', 'em simulação não aprova';
  perform public.set_setting('mode', '"review"'::jsonb);
  j := public.run_auto_approve(5);
  assert (j ->> 'approved')::int = 1, 'aprovou sozinha: ' || j::text;
  assert (select status from public.offers where id = v_off) = 'scheduled';
  assert (select approved_by from public.offers where id = v_off) is null, 'aprovação automática não tem usuário';
  select id into v_pub from public.publications where offer_id = v_off and destination_id = v_dest;
  assert v_pub is not null, 'publicação criada para o destino da regra';

  -- revalidação antes do envio
  j := public.get_publication_context(v_pub);
  assert j ->> 'platform' = 'shopee' and j ->> 'external_id' = '7.77' and (j ->> 'current_price')::numeric = 95 and j ->> 'sub_id' like 'g%';
  perform public.reprice_offer(v_off, 80, true, 'Preço mudou de 95 para 80');
  assert (select status from public.offers where id = v_off) = 'needs_review', 'volta para revisão';
  assert (select current_price from public.offers where id = v_off) = 80 and (select discount_pct from public.offers where id = v_off) = 20.00;
  assert (select status from public.publications where id = v_pub) = 'cancelled', 'envio pendente cancelado';
  perform public.reprice_offer(v_off, null, false, 'Sem estoque');
  assert (select status from public.offers where id = v_off) = 'expired', 'sem estoque expira';
  perform public.mark_offer_revalidated(v_off);

  -- acompanhamento de produtos
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.save_watch_item('https://exemplo.com/produto', 10, 10)$f$, 'fora dos domínios');
  v_w := public.save_watch_item('https://shopee.com.br/produto-bom-i.7.88', 40, 10);
  v_w2 := public.save_watch_item('https://shopee.com.br/produto-bom-i.7.88', 35, 15);
  assert v_w = v_w2, 'mesmo produto não duplica';
  assert (select target_price from public.watchlist where id = v_w) = 35;
  perform test.as_role('service_role');
  assert jsonb_array_length(public.watchlist_due(10)) = 1;
  perform public.watchlist_update(v_w, 45.5, 'Produto Bom', true);
  assert jsonb_array_length(public.watchlist_due(10)) = 0, 'recém verificado não volta já';
  assert (select last_price from public.watchlist where id = v_w) = 45.5;

  -- comissões
  v_n := public.upsert_commissions(jsonb_build_array(
    jsonb_build_object('platform', 'shopee', 'external_ref', 'c1', 'purchased_at', now() - interval '2 days', 'amount', 12.5, 'sub_id', (select sub_id from public.destinations where id = v_dest)),
    jsonb_build_object('platform', 'shopee', 'external_ref', 'c2', 'purchased_at', now() - interval '1 day', 'amount', 7.5)));
  assert v_n = 2;
  perform public.upsert_commissions(jsonb_build_array(jsonb_build_object('platform', 'shopee', 'external_ref', 'c1', 'purchased_at', now() - interval '2 days', 'amount', 13.0)));
  assert (select count(*) from public.commissions) = 2, 'upsert não duplica';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  j := public.commission_summary(30);
  assert (j ->> 'total')::numeric = 20.5 and (j ->> 'orders')::int = 2, 'resumo de comissões: ' || j::text;
  assert j -> 'by_sub' @> jsonb_build_array(jsonb_build_object('destination', 'Destino Radar', 'amount', 13.0, 'orders', 1)), 'comissão por destino';

  -- alertas e operação
  perform test.as_role('service_role');
  assert public.alert_should_send('teste:a', 'x'), 'primeiro alerta passa';
  assert not public.alert_should_send('teste:a', 'x'), 'repetido dentro do intervalo é segurado';
  perform public.alert_clear('teste:a');
  assert public.alert_should_send('teste:a', 'x'), 'depois de limpar volta a passar';
  assert public.ops_snapshot() ? 'pending_old' and public.ops_snapshot() ? 'collect_errors';
  assert public.housekeeping() ? 'ofertas_expiradas';
  assert public.get_integration_runtime() ? 'search_terms' and public.get_integration_runtime() -> 'tuning' ? 'max_price_drift_pct';

  -- apagar regra e fonte
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.delete_routing_rule(v_rule);
  perform public.delete_promo_source(v_chat2);
  assert jsonb_array_length(public.list_promo_sources()) = 1;
  assert jsonb_array_length(public.list_captured_links(10)) >= 1;
end $$;

do $$
declare j1 uuid; j2 uuid;
begin
  perform test.as_role('service_role');
  assert public.job_should_run('t1', 60), 'primeira vez roda';
  assert not public.job_should_run('t1', 60), 'dentro do intervalo não roda';
  assert public.category_guess('Fone bluetooth sem fio com microfone') = 'eletronicos', 'categoria pelo título';
  assert public.resolve_short_link('codigo-inexistente') is null;
  update public.channel_jobs set requested_at = now() - interval '1 hour';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_integration_action('worker', 'radar_test', '{"url":"ftp://x"}')$f$, 'Informe um endereço');
  j1 := public.request_integration_action('worker', 'radar_test', '{"url":"https://s.shopee.com.br/abc"}');
  j2 := public.request_integration_action('worker', 'radar_test', '{"url":"https://amzn.to/xyz"}');
  assert j1 <> j2, 'cada teste de link é uma tarefa própria';
  assert (select payload ->> 'url' from public.channel_jobs where id = j2) = 'https://amzn.to/xyz';
end $$;
