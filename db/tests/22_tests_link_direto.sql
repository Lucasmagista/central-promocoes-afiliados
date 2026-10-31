\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 22. Link direto de afiliado quando já é curto (022)
-- ============================================================================
do $$
declare
  v_d1 uuid; v_d2 uuid; j jsonb; v_ml uuid; v_long uuid; v_txt text; v_pub uuid;
begin
  perform test.as_role('service_role');
  update public.destinations set enabled = false;
  update public.connectors set mode = 'manual_only' where platform in ('shopee', 'mercadolivre', 'amazon');
  perform public.set_setting('shortlink_base', '"https://worker.exemplo.com/r"'::jsonb);
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('telegram', '-100888001', 'Link T', true, now()) returning id into v_d1;
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('whatsapp', '120363888888888001@g.us', 'Link W', true, now()) returning id into v_d2;

  assert public.is_short_affiliate('https://meli.la/2ZiAGb8'), 'meli.la é curto';
  assert public.is_short_affiliate('https://s.shopee.com.br/AbC123'), 'shopee é curto';
  assert not public.is_short_affiliate('https://www.amazon.com.br/dp/B0X?tag=a-20'), 'amazon longo usa o link curto do worker';
  assert not public.is_short_affiliate(null);

  j := public.ingest_offer('{"platform":"shopee","external_id":"22.1","original_url":"https://shopee.com.br/produto-i.22.1","affiliate_url":"https://s.shopee.com.br/Direto1","title":"Produto Direto","price":50,"previous_price":100,"source_kind":"api","category":"eletronicos"}'::jsonb);
  v_ml := (j ->> 'offer_id')::uuid;
  update public.offers set status = 'needs_review', score = 80, is_simulated = false where id = v_ml;

  -- link curto de afiliado: vai direto, sem redirecionador
  v_txt := public.render_offer_text(v_ml, v_d2, 'abcd1234');
  assert v_txt like '%https://s.shopee.com.br/Direto1%', 'link direto no texto: ' || v_txt;
  assert v_txt not like '%worker.exemplo.com%', 'sem redirecionador';
  v_txt := public.render_offer_text(v_ml, v_d1, 'abcd1234');
  assert v_txt not like '%worker.exemplo.com%', 'telegram também sem redirecionador';

  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.approve_offer_all(v_ml);
  perform test.as_role('service_role');
  assert (select count(*) from public.short_links s join public.publications p on p.id = s.publication_id where p.offer_id = v_ml) = 0, 'não cria link curto';
  assert (select count(*) from public.publications where offer_id = v_ml and rendered_text like '%https://s.shopee.com.br/Direto1%') >= 1, 'whatsapp com link direto';

  -- forçar o redirecionador volta a usá-lo
  perform public.set_setting('shortlink_force', 'true'::jsonb);
  assert public.render_offer_text(v_ml, v_d2, 'abcd1234') like '%worker.exemplo.com/r/abcd1234%', 'forçado usa worker';
  perform public.set_setting('shortlink_force', 'false'::jsonb);

  -- publicação pendente que ficou com o link do worker volta para o link direto
  select id into v_pub from public.publications where offer_id = v_ml and destination_id = v_d2;
  update public.publications set rendered_text = replace(rendered_text, 'https://s.shopee.com.br/Direto1', 'https://worker.exemplo.com/r/zzzz9999') where id = v_pub;
  insert into public.short_links (code, publication_id, target_url) values ('zzzz9999', v_pub, 'https://s.shopee.com.br/Direto1');
  assert public.reshorten_pending() >= 1;
  assert (select rendered_text from public.publications where id = v_pub) like '%https://s.shopee.com.br/Direto1%', 'voltou para o link direto';
  assert not exists (select 1 from public.short_links where publication_id = v_pub);

  -- link longo continua usando o redirecionador
  j := public.ingest_offer('{"platform":"amazon","external_id":"B0LONGO22","original_url":"https://www.amazon.com.br/dp/B0LONGO22","affiliate_url":"https://www.amazon.com.br/dp/B0LONGO22?tag=loja-20","title":"Produto Longo","price":50,"previous_price":100,"source_kind":"api","category":"eletronicos"}'::jsonb);
  v_long := (j ->> 'offer_id')::uuid;
  assert public.render_offer_text(v_long, v_d2, 'abcd1234') like '%worker.exemplo.com/r/abcd1234%', 'link longo usa o redirecionador';
  raise notice 'OK 22 link direto';
end $$;
