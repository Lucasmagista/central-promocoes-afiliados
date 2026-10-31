\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 19. Conexão guiada (017): QR ao vivo, ligar o Telegram, imagens
-- ============================================================================
do $$
declare j1 uuid; j2 uuid; v jsonb; v_w uuid;
begin
  perform test.as_role('service_role');
  update public.channel_jobs set requested_at = now() - interval '1 hour';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  j1 := public.request_integration_action('evolution', 'connect_poll', '{"pairing_number":"+55 (11) 99999-0001"}');
  assert (select payload ->> 'pairing_number' from public.channel_jobs where id = j1) = '5511999990001', 'código de pareamento aceito no connect_poll';
  perform test.fails($f$select public.request_integration_action('evolution', 'connect_poll', '{"pairing_number":"12"}')$f$, 'pareamento inválido');
  j2 := public.request_integration_action('telegram', 'connect');
  assert j2 is not null, 'telegram/connect aceito';
  perform test.fails($f$select public.request_integration_action('telegram', 'conectar_tudo')$f$, 'Ação não existe');
  perform test.fails($f$select public.request_integration_action('amazon', 'connect_poll')$f$, 'Ação não existe');

  -- imagens
  perform test.as_role('service_role');
  v := public.ingest_offer('{"platform":"shopee","external_id":"8.81","original_url":"https://shopee.com.br/produto-i.8.81","affiliate_url":"https://s.shopee.com.br/img","title":"Com Imagem","price":50,"source_kind":"api","image_url":"https://down-br.img.susercontent.com/file/x"}'::jsonb);
  assert v ->> 'status' = 'created', 'oferta com imagem: ' || v::text;
  assert (select image_url from public.products where external_id = '8.81') = 'https://down-br.img.susercontent.com/file/x';
  insert into public.watchlist (platform, external_id, url) values ('shopee', '8.82', 'https://shopee.com.br/x-i.8.82') returning id into v_w;
  perform public.watchlist_update(v_w, 10, 'Título', false, 'https://img.exemplo.com/a.jpg');
  assert (select image_url from public.watchlist where id = v_w) = 'https://img.exemplo.com/a.jpg', 'imagem do acompanhado';
  perform public.watchlist_update(v_w, 11, null, false, 'http://inseguro.com/a.jpg');
  assert (select image_url from public.watchlist where id = v_w) = 'https://img.exemplo.com/a.jpg', 'imagem http é ignorada';
  perform public.watchlist_update(v_w, 12, null, false);
  assert (select last_price from public.watchlist where id = v_w) = 12, 'chamada antiga (sem imagem) continua valendo';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  assert not exists (select 1 from jsonb_array_elements(public.list_captured_links(10)) e where not (e ? 'image_url')), 'links capturados trazem a chave image_url';
end $$;
