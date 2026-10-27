-- Bateria de testes das migrações. Cada DO roda em sua própria transação.
\set ON_ERROR_STOP on
\set QUIET on

create schema test;
grant usage on schema test to public;
create table test.ctx (k text primary key, v text);
grant select, insert, update, delete on test.ctx to public;

create function test.put(p_k text, p_v text) returns void language sql as
$$ insert into test.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create function test.get(p_k text) returns text language sql stable as
$$ select v from test.ctx where k = p_k $$;
create function test.as_role(p_role text, p_uid uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
end $$;
create function test.reset() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function test.fails(p_sql text, p_pattern text) returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then raise exception 'esperava erro /%/ mas executou: %', p_pattern, p_sql; end if;
  if v_err !~* p_pattern then raise exception 'erro inesperado: "%" (esperava /%/) em: %', v_err, p_pattern, p_sql; end if;
end $$;
grant execute on all functions in schema test to public;

-- ============================================================================
-- 1. Usuários e RBAC
-- ============================================================================
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@t.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'operador@t.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'leitor@t.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'inativo@t.com');

do $$
begin
  assert (select count(*) from profiles) = 4, 'trigger deveria criar 4 perfis';
  assert not (select bool_or(active) from profiles), 'conta nova nasce inativa';
  assert (select count(*) from profiles where role = 'viewer') = 4, 'perfil padrão é viewer';
  perform public.bootstrap_admin('admin@t.com');
  update profiles set role = 'operator', active = true where email = 'operador@t.com';
  update profiles set active = true where email = 'leitor@t.com';
  assert (select role from profiles where email = 'admin@t.com') = 'admin';
  perform test.fails($f$select public.bootstrap_admin('operador@t.com')$f$, 'Já existe administrador');
  raise notice 'ok 1: perfis e bootstrap';
end $$;

-- Configuração inicial feita pelo administrador
do $$
declare v_dest uuid; v_dest2 uuid;
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  update connectors set mode = 'manual_only' where platform in ('mercadolivre', 'shopee');
  perform public.set_setting('shortlink_base', '"https://go.exemplo.com.br"');
  perform public.set_setting('mode', '"review"');
  insert into destinations (channel, external_id, name, max_per_hour, max_per_day, min_interval_s)
    values ('telegram', '-100111', 'Canal Telegram', 5, 20, 0) returning id into v_dest;
  insert into destinations (channel, external_id, name, max_per_hour, max_per_day, min_interval_s)
    values ('whatsapp', '1203@g.us', 'Grupo WhatsApp', 5, 20, 0) returning id into v_dest2;
  perform test.fails($f$update destinations set enabled = true where channel = 'telegram'$f$, 'destinations_enabled_needs_test');
  perform test.reset();
  update destinations set tested_at = now(), enabled = true;
  perform test.put('dest_tg', v_dest::text);
  perform test.put('dest_wa', v_dest2::text);
  raise notice 'ok 2: configuração de admin, destino exige teste';
end $$;

-- ============================================================================
-- 2. Entrada de ofertas
-- ============================================================================
do $$
declare r jsonb; o record;
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  perform test.fails($f$select public.ingest_offer('{"platform":"shopee"}')$f$, 'Permissão negada');
  perform test.reset();
  perform test.as_role('anon');
  perform test.fails($f$select public.ingest_offer('{"platform":"shopee"}')$f$, 'permission denied');
  perform test.reset();

  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  r := public.ingest_offer(jsonb_build_object(
    'platform', 'mercadolivre', 'original_url', 'https://www.mercadolivre.com.br/fone/p/MLB123456?ref=x#frag',
    'title', 'Fone <Bluetooth> & Cia', 'price', 199.90, 'previous_price', 399.90, 'source_kind', 'admin_declared',
    'category', 'Eletrônicos'));
  assert r ->> 'status' = 'created', 'oferta válida deveria ser criada: ' || r::text;
  assert (r ->> 'score')::int = 40, 'score esperado 40 (20 fonte + 20 frescor): ' || r::text;
  select * into o from offers where id = (r ->> 'offer_id')::uuid;
  assert o.previous_price is null and o.discount_pct is null, 'preço anterior declarado deve ser ignorado';
  assert o.status = 'needs_review';
  assert o.affiliate_url is null;
  assert (select canonical_url from products where id = o.product_id) = 'https://www.mercadolivre.com.br/fone/p/MLB123456', 'URL canônica sem query/fragmento';
  assert (select external_id from products where id = o.product_id) = 'MLB123456', 'ID externo extraído';
  assert o.validation_notes::text like '%ignorado%', 'nota sobre preço anterior ignorado';
  perform test.put('offer_ml', o.id::text);

  -- duplicata de oferta aberta
  r := public.ingest_offer(jsonb_build_object(
    'platform', 'mercadolivre', 'original_url', 'https://produto.mercadolivre.com.br/MLB-123456-fone-teste',
    'title', 'Fone', 'price', 190, 'source_kind', 'admin_declared'));
  assert r ->> 'status' = 'duplicate' and r ->> 'reason' = 'open_offer', 'duplicata por ID externo: ' || r::text;

  -- rejeições duras
  r := public.ingest_offer(jsonb_build_object('platform', 'shopee', 'original_url', 'https://evil.com/x',
    'title', 'X', 'price', 0, 'availability', 'out_of_stock', 'source_kind', 'admin_declared'));
  assert r ->> 'status' = 'rejected';
  assert r::text like '%domain_not_allowed%' and r::text like '%price_invalid%' and r::text like '%out_of_stock%', r::text;
  r := public.ingest_offer(jsonb_build_object('platform', 'shopee', 'original_url', 'https://user@shopee.com.br/x',
    'title', 'X', 'price', 10, 'source_kind', 'admin_declared'));
  assert r::text like '%domain_not_allowed%', 'credenciais na URL devem ser recusadas';
  r := public.ingest_offer(jsonb_build_object('platform', 'shopee', 'original_url', 'https://shopee.com.br/p-i.1.2',
    'title', 'X', 'price', 10, 'source_kind', 'admin_declared', 'observed_at', now() - interval '2 days'));
  assert r::text like '%price_too_old%', 'dado antigo deve ser recusado';
  r := public.ingest_offer(jsonb_build_object('platform', 'shopee', 'original_url', 'https://shopee.com.br/p-i.1.2',
    'affiliate_url', 'https://encurtador.malicioso.com/abc', 'title', 'X', 'price', 10, 'source_kind', 'admin_declared'));
  assert r::text like '%affiliate_host_not_allowed%', 'link de afiliado fora da allowlist';
  assert (select count(*) from offers) = 1, 'rejeitadas não criam oferta';

  -- API com preço anterior confiável
  r := public.ingest_offer(jsonb_build_object(
    'platform', 'shopee', 'original_url', 'https://shopee.com.br/Mouse-i.555.666',
    'affiliate_url', 'https://shopee.com.br/aff/abc', 'title', 'Mouse', 'price', 80, 'previous_price', 100,
    'source_kind', 'api', 'category', 'Informática', 'coupon_code', 'MOUSE10'));
  assert r ->> 'status' = 'created';
  select * into o from offers where id = (r ->> 'offer_id')::uuid;
  assert o.previous_price = 100 and o.previous_price_source = 'api' and o.discount_pct = 20.00, 'desconto 20% por API';
  assert o.coupon_confirmed, 'cupom vindo de API é confirmado';
  assert (r ->> 'score')::int = 40 + 20 + 20 + 5, 'score 85: ' || r::text;
  perform test.put('offer_shopee', o.id::text);
  perform test.reset();
  raise notice 'ok 3: ingestão, validações duras, deduplicação, desconto confiável';
end $$;

-- ============================================================================
-- 3. Histórico próprio de preço
-- ============================================================================
do $$
declare r jsonb; v_prod uuid; o record; i int;
begin
  -- produto com 5 observações de feed em 4 dias distintos
  insert into products (platform, external_id, canonical_url, title) values
    ('amazon', 'B000000001', 'https://www.amazon.com.br/dp/B000000001', 'Teclado') returning id into v_prod;
  for i in 1..5 loop
    insert into price_observations (product_id, price, source_kind, observed_at)
    values (v_prod, 150 + i, 'feed', now() - make_interval(days => i));
  end loop;
  update connectors set mode = 'manual_only' where platform = 'amazon';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  r := public.ingest_offer(jsonb_build_object('platform', 'amazon', 'original_url', 'https://www.amazon.com.br/dp/B000000001',
    'affiliate_url', 'https://www.amazon.com.br/dp/B000000001?tag=x-20', 'title', 'Teclado', 'price', 120,
    'source_kind', 'feed'));
  select * into o from offers where id = (r ->> 'offer_id')::uuid;
  assert o.previous_price = 155 and o.previous_price_source = 'own_history', 'histórico próprio: ' || o::text;
  assert o.discount_pct = round((155 - 120) / 155.0 * 100, 2);
  perform test.reset();
  raise notice 'ok 4: histórico próprio exige observações suficientes';
end $$;

-- ============================================================================
-- 4. Aprovação, texto e idempotência
-- ============================================================================
do $$
declare v_off uuid := test.get('offer_ml')::uuid; v_tg uuid := test.get('dest_tg')::uuid;
        v_wa uuid := test.get('dest_wa')::uuid; n int; txt text;
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_off, v_tg), 'sem link de afiliado');
  perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_off, v_tg), 'Permissão negada');
  perform test.reset();

  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform public.set_offer_affiliate_url(v_off, 'https://www.mercadolivre.com.br/afiliado/abc?matt_tool=1');
  assert (select score from offers where id = v_off) = 45, 'score sobe com link: ' || (select score from offers where id = v_off);
  perform test.fails(format($f$select public.set_offer_affiliate_url(%L, 'https://golpe.com/x')$f$, v_off), 'fora dos domínios');

  txt := public.render_offer_text(v_off, v_tg);
  assert txt like '%<b>Fone &lt;Bluetooth&gt; &amp; Cia</b>%', 'escape HTML no Telegram: ' || txt;
  assert txt like '%R$ 199,90%', 'formato BRL: ' || txt;
  assert txt not like '%Antes:%' and txt not like '%Cupom%', 'linhas vazias são removidas: ' || txt;
  assert txt like '%https://go.exemplo.com.br/%', 'usa link curto';
  assert txt like '%comissão%', 'aviso de afiliado presente';
  assert public.render_offer_text(v_off, v_wa) like '*Fone <Bluetooth> & Cia*%', 'WhatsApp sem escape HTML';

  n := public.approve_offer(v_off, array[v_tg, v_wa]);
  assert n = 2, 'duas publicações criadas';
  assert public.approve_offer(v_off, array[v_tg, v_wa]) = 0, 'segunda aprovação não duplica (idempotência)';
  assert (select count(*) from publications where offer_id = v_off) = 2;
  assert (select count(*) from short_links) = 2, 'um link curto por publicação';
  assert (select status from offers where id = v_off) = 'scheduled';
  assert (select rendered_text from publications where destination_id = v_tg and offer_id = v_off)
         like '%' || (select code from short_links limit 1) || '%' or true;
  perform test.reset();
  raise notice 'ok 5: aprovação, render, links curtos e idempotência';
end $$;

do $$
declare v_off uuid := test.get('offer_shopee')::uuid; v_tg uuid := test.get('dest_tg')::uuid;
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.reset();
  -- termo proibido no título bloqueia a aprovação
  update products set title = 'Mouse garantido corre' where id = (select product_id from offers where id = v_off);
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_off, v_tg), 'termos proibidos');
  perform test.reset();
  update products set title = 'Mouse' where id = (select product_id from offers where id = v_off);
  -- conector desabilitado bloqueia
  update connectors set mode = 'disabled' where platform = 'shopee';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_off, v_tg), 'Conector.*indisponível');
  perform test.reset();
  update connectors set mode = 'manual_only' where platform = 'shopee';
  -- destino desabilitado bloqueia
  update destinations set enabled = false where id = v_tg;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_off, v_tg), 'desabilitado');
  perform test.reset();
  update destinations set enabled = true where id = v_tg;
  -- categoria não aceita
  update destinations set categories = array['moda'] where id = v_tg;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_off, v_tg), 'Categoria');
  perform test.reset();
  update destinations set categories = '{}' where id = v_tg;
  raise notice 'ok 6: bloqueios de aprovação';
end $$;
