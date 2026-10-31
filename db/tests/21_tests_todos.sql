\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 21. Enviar para todos os grupos e modo automático (021)
-- ============================================================================
do $$
declare
  v_t1 uuid; v_t2 uuid; v_w1 uuid; v_wx uuid; j jsonb; v_off uuid; v_n integer;
begin
  perform test.as_role('service_role');
  delete from public.routing_rules;
  update public.destinations set enabled = false;
  update public.connectors set mode = 'manual_only' where platform = 'shopee';
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('telegram', '-100777001', 'Todos T1', true, now()) returning id into v_t1;
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('telegram', '-100777002', 'Todos T2', true, now()) returning id into v_t2;
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('whatsapp', '120363777777777001@g.us', 'Todos W1', true, now()) returning id into v_w1;
  -- um destino que só aceita outra categoria: deve ser ignorado, sem derrubar os demais
  insert into public.destinations (channel, external_id, name, enabled, tested_at, categories) values ('telegram', '-100777003', 'Só casa', true, now(), array['casa']) returning id into v_wx;

  j := public.ingest_offer('{"platform":"shopee","external_id":"21.1","original_url":"https://shopee.com.br/produto-i.21.1","affiliate_url":"https://s.shopee.com.br/t21","title":"Produto Todos","price":50,"previous_price":100,"source_kind":"api","category":"eletronicos"}'::jsonb);
  v_off := (j ->> 'offer_id')::uuid;
  update public.offers set status = 'needs_review', score = 80, is_simulated = false where id = v_off;

  -- aprovar para todos: 3 destinos aceitos, 1 ignorado por categoria
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  j := public.approve_offer_all(v_off);
  assert (j ->> 'destinos_ok')::int = 3, 'aprovou nos 3 destinos que aceitam: ' || j::text;
  assert jsonb_array_length(j -> 'ignorados') = 1, 'um destino ignorado';
  assert (select count(*) from public.publications where offer_id = v_off) = 3;
  assert (select count(distinct d.channel) from public.publications p join public.destinations d on d.id = p.destination_id where p.offer_id = v_off) = 2, 'telegram e whatsapp';
  assert (select status from public.offers where id = v_off) = 'scheduled';
  -- repetir não duplica
  j := public.approve_offer_all(v_off);
  assert (select count(*) from public.publications where offer_id = v_off) = 3, 'não duplica';

  -- sem destinos ativos: erro claro
  perform test.as_role('service_role');
  update public.destinations set enabled = false;
  update public.offers set status = 'needs_review' where id = v_off;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.approve_offer_all(gen_random_uuid())$f$, 'Nenhum destino ativo');

  -- modo automático aprova sozinho (sem precisar ligar a outra chave) e vai para todos os grupos
  perform test.as_role('service_role');
  update public.destinations set enabled = true where id in (v_t1, v_t2, v_w1, v_wx);
  delete from public.publications where offer_id = v_off;
  update public.offers set status = 'needs_review', score = 95, approved_at = null, approved_by = null where id = v_off;
  perform public.set_setting('auto_approve_enabled', 'false'::jsonb);
  perform public.set_setting('auto_approve_threshold', '90'::jsonb);
  perform public.set_setting('mode', '"review"'::jsonb);
  assert not (public.auto_route_offer(v_off) ->> 'auto')::boolean, 'revisão humana não aprova sozinha';
  perform public.set_setting('mode', '"auto"'::jsonb);
  assert (public.auto_route_offer(v_off) ->> 'auto')::boolean, 'modo automático aprova sozinho';
  assert jsonb_array_length(public.auto_route_offer(v_off) -> 'destinations') = 3, 'todos os destinos que aceitam a categoria';
  update public.offers set score = 40 where id = v_off;
  assert not (public.auto_route_offer(v_off) ->> 'auto')::boolean, 'abaixo da nota de corte espera revisão';
  update public.offers set score = 95 where id = v_off;
  j := public.run_auto_approve(5);
  assert (j ->> 'approved')::int >= 1, 'aprovou: ' || j::text;
  assert (select status from public.offers where id = v_off) = 'scheduled', 'oferta agendada';
  select count(*) into v_n from public.publications where offer_id = v_off;
  assert v_n = 3, 'publicações em todos os grupos: ' || v_n;

  -- mesmo com uma regra que cita só um destino, "todos" vale
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.save_routing_rule(null, jsonb_build_object('name', 'Só um', 'destinations', jsonb_build_array(v_t1), 'auto_approve', true));
  perform test.as_role('service_role');
  assert jsonb_array_length(public.auto_route_offer(v_off) -> 'destinations') = 3, 'regra não restringe quando route_all_destinations ligado';
  perform public.set_setting('route_all_destinations', 'false'::jsonb);
  assert public.auto_route_offer(v_off) -> 'destinations' = jsonb_build_array(v_t1), 'desligado: respeita a regra';
  perform public.set_setting('route_all_destinations', 'true'::jsonb);
  delete from public.routing_rules;
  perform public.set_setting('mode', '"review"'::jsonb);
  raise notice 'OK 21 enviar para todos';
end $$;
