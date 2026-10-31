\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 23. Cupom com link de resgate (023)
-- ============================================================================
do $$
declare
  v_t uuid; v_w uuid; j jsonb; v_off uuid; v_txt text;
begin
  perform test.as_role('service_role');
  update public.destinations set enabled = false;
  update public.connectors set mode = 'manual_only' where platform in ('amazon', 'shopee');
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('telegram', '-100999001', 'Cupom T', true, now()) returning id into v_t;
  insert into public.destinations (channel, external_id, name, enabled, tested_at) values ('whatsapp', '120363999999999001@g.us', 'Cupom W', true, now()) returning id into v_w;

  j := public.ingest_offer('{"platform":"shopee","external_id":"23.1","original_url":"https://shopee.com.br/produto-i.23.1","affiliate_url":"https://s.shopee.com.br/Cup23","title":"Produto Promo","price":50,"previous_price":100,"source_kind":"admin_declared","category":"eletronicos"}'::jsonb);
  v_off := (j ->> 'offer_id')::uuid;
  update public.offers set status = 'needs_review', is_simulated = false where id = v_off;

  -- sem cupom: a linha não existe
  v_txt := public.render_offer_text(v_off, v_w, 'abcd1234');
  assert v_txt not like '%upom%', 'sem cupom: ' || v_txt;

  -- código + link de resgate
  perform public.set_offer_coupon(v_off, 'xpto15', 'https://shopee.com.br/m/cupom-do-dia');
  v_txt := public.render_offer_text(v_off, v_w, 'abcd1234');
  assert v_txt like '%Cupom: XPTO15%', 'código em maiúsculas: ' || v_txt;
  assert v_txt like '%Resgate o cupom aqui: https://shopee.com.br/m/cupom-do-dia%', 'link de resgate: ' || v_txt;

  -- link fora dos domínios da loja é descartado; o anterior permanece
  perform public.set_offer_coupon(v_off, null, 'https://promo.exemplo-qualquer.com/x');
  assert (select coupon_url from public.offers where id = v_off) = 'https://shopee.com.br/m/cupom-do-dia', 'domínio estranho não substitui';

  -- só o link (sem código)
  update public.offers set coupon_code = null, coupon_confirmed = false, coupon_url = null where id = v_off;
  perform public.set_offer_coupon(v_off, null, 'https://shopee.com.br/m/so-link');
  v_txt := public.render_offer_text(v_off, v_w, 'abcd1234');
  assert v_txt like '%Resgate o cupom aqui: https://shopee.com.br/m/so-link%' and v_txt not like '%Cupom: %', 'só link: ' || v_txt;

  -- código inválido é ignorado
  update public.offers set coupon_code = null, coupon_confirmed = false, coupon_url = null where id = v_off;
  perform public.set_offer_coupon(v_off, 'a b', null);
  assert (select coupon_code from public.offers where id = v_off) is null, 'código inválido ignorado';
  raise notice 'OK 23 cupom';
end $$;
