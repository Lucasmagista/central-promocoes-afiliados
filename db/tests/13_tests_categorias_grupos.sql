\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 9. Categorias por destino, grupos descobertos/criados, conectores e templates
-- ============================================================================
do $$
declare v_pr uuid; v_of uuid; v_dest_car uuid; v_dest_home uuid; v_job uuid; v_job2 uuid; j jsonb; v_chat uuid; n integer;
begin
  -- mapeamento texto livre -> slug
  assert public.category_slug('Eletrônicos') = 'eletronicos';
  assert public.category_slug('Informática') = 'informatica';
  assert public.category_slug('Casa') = 'casa';
  assert public.category_slug('pneu aro 15') = 'automotivo', 'palavra-chave de carro';
  assert public.category_slug('Fone Bluetooth') = 'eletronicos';
  assert public.category_slug('xyz qualquer') = 'outros', 'sem correspondência vira outros';
  assert public.category_slug('  ') is null and public.category_slug(null) is null;
  -- não confunde pedaços de palavra (tv dentro de outra palavra)
  assert public.category_slug('ativo fixo') = 'outros';

  -- destinos só aceitam slugs existentes
  perform test.fails($f$update destinations set categories = '{inexistente}' where false or id = (select id from destinations limit 1)$f$, 'Categoria desconhecida');

  -- destino "carro" não aceita oferta de eletrônicos; destino "casa" aceita oferta de casa
  insert into destinations (channel, external_id, name, enabled, tested_at, categories)
    values ('telegram', '-100carro', 'Carro BR', true, now(), '{automotivo}') returning id into v_dest_car;
  insert into destinations (channel, external_id, name, enabled, tested_at, categories)
    values ('telegram', '-100casa', 'Casa BR', true, now(), '{casa}') returning id into v_dest_home;
  select o.id into v_of from offers o join products p on p.id = o.product_id
   where o.status = 'needs_review' and o.affiliate_url is not null limit 1;
  if v_of is null then
    v_of := (public.ingest_offer(jsonb_build_object('platform','mercadolivre','external_id','MLB900001','url','https://www.mercadolivre.com.br/p/MLB900001',
       'title','Cadeira de escritório','category','Casa','price',199.9,'previous_price',299.9,'previous_price_source','api',
       'affiliate_url','https://mercadolivre.com/sec/abc','observed_at', now(), 'availability','in_stock','is_simulated', true)) ->> 'offer_id')::uuid;
  end if;
  update products set category = 'Eletrônicos' where id = (select product_id from offers where id = v_of);
  update offers set status = 'needs_review', affiliate_url = coalesce(affiliate_url, 'https://mercadolivre.com/sec/abc') where id = v_of;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.approve_offer(%L, array[%L]::uuid[])$f$, v_of, v_dest_car), 'não é aceita pelo destino');
  perform public.set_offer_category(v_of, 'automotivo');
  assert (select category from products where id = (select product_id from offers where id = v_of)) = 'Carro e moto';
  perform test.fails(format($f$select public.set_offer_category(%L, 'nao-existe')$f$, v_of), 'desconhecida');
  assert public.approve_offer(v_of, array[v_dest_car]) = 1, 'oferta de carro entra no destino de carro';
  perform test.reset();

  -- reabrir oferta rejeitada
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.reopen_offer(%L)$f$, v_of), 'rejeitadas');
  perform test.reset();

  -- descoberta de grupos: o que o n8n sincroniza aparece, com marca de "já é destino"
  v_job := public.request_group_refresh('whatsapp');
  assert v_job is not null;
  assert public.request_group_refresh('whatsapp') = v_job, 'não duplica busca em andamento';
  perform test.as_role('anon'); perform test.fails($f$select public.request_group_refresh('whatsapp')$f$, 'permission denied'); perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  perform test.fails($f$select public.request_group_refresh('whatsapp')$f$, 'Permissão negada');
  perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  v_job2 := public.request_group_refresh('whatsapp');
  perform test.reset();
  j := public.claim_channel_job('w1');
  assert j ->> 'kind' = 'refresh_groups' and j ->> 'channel' = 'whatsapp', j::text;
  perform public.complete_channel_job((j ->> 'id')::uuid, '{"groups":[{"external_id":"1203999@g.us","title":"Grupo do Celular","kind":"group","participant_count":12,"we_are_admin":true},{"external_id":"1203888@g.us","title":"Grupo Sem Admin","kind":"group","we_are_admin":false}]}');
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  j := public.list_discovered_groups('whatsapp');
  assert jsonb_array_length(j) >= 3, j::text;
  assert exists (select 1 from jsonb_array_elements(j) x where x ->> 'title' = 'Grupo do Celular' and (x ->> 'we_are_admin')::boolean and x -> 'destination_id' = 'null'::jsonb), 'grupo novo ainda não é destino';
  assert exists (select 1 from jsonb_array_elements(j) x where x ->> 'external_id' = '1203@g.us' and x ->> 'destination_id' is not null), 'grupo que já é destino vem marcado';
  perform test.reset();

  -- contatos para escolher participantes
  perform public.sync_chat_participants((select id from chats where external_id = '1203999@g.us'), '[{"external_id":"5511999990001@s.whatsapp.net","display_name":"Ana Souza"},{"external_id":"5511999990002@s.whatsapp.net","display_name":"Bruno"}]');
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  assert jsonb_array_length(public.list_contacts('whatsapp', 'souza')) = 1, public.list_contacts('whatsapp', 'souza')::text;
  perform test.reset();

  -- criação de grupo: só admin, só WhatsApp, validações e limite diário
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$select public.request_group_creation('whatsapp','Ofertas Carro','x','[{"external_id":"5511999990001"}]','k')$f$, 'Permissão negada');
  perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_group_creation('telegram','Canal','x','[{"external_id":"5511999990001"}]','k')$f$, 'Telegram não permite');
  perform test.fails($f$select public.request_group_creation('whatsapp','ab','x','[{"external_id":"5511999990001"}]','k')$f$, '3 a 100');
  perform test.fails($f$select public.request_group_creation('whatsapp','Ofertas Carro','x','[{"external_id":"abc"}]','k')$f$, 'ao menos 1 participante');
  perform test.fails($f$select public.request_group_creation('whatsapp','Ganhe dinheiro fácil, garantido','x','[{"external_id":"5511999990001"}]','k')$f$, 'proibidos');
  v_job := public.request_group_creation('whatsapp', 'Ofertas Carro BR', 'Só itens para carro', '[{"external_id":"+55 (11) 99999-0001"},{"external_id":"5511999990001@s.whatsapp.net"},{"external_id":"5511999990002"}]', 'g1');
  assert public.request_group_creation('whatsapp', 'Ofertas Carro BR', 'x', '[{"external_id":"5511999990002"}]', 'g1') = v_job, 'idempotente';
  assert (select jsonb_array_length(payload -> 'participants') from channel_jobs where id = v_job) = 2, 'números normalizados e sem repetição';
  perform public.request_group_creation('whatsapp', 'Ofertas Casa BR', 'x', '[{"external_id":"5511999990002"}]', 'g2');
  perform public.request_group_creation('whatsapp', 'Ofertas Tech BR', 'x', '[{"external_id":"5511999990002"}]', 'g3');
  perform test.fails($f$select public.request_group_creation('whatsapp','Ofertas Games BR','x','[{"external_id":"5511999990002"}]','g4')$f$, 'Limite de 3');
  perform test.reset();

  -- worker: pausa segura a criação, mas a busca (somente leitura) continua
  perform public.set_paused(true, 't');
  assert public.claim_channel_job('w1') is null, 'pausa bloqueia criação de grupo';
  perform public.request_group_refresh('telegram');
  assert public.claim_channel_job('w1') ->> 'kind' = 'refresh_groups', 'busca de grupos continua com pausa';
  perform public.set_paused(false);
  j := public.claim_channel_job('w1');
  assert j ->> 'kind' = 'refresh_groups' or j ->> 'kind' = 'create_group';
  -- conclui todas as pendentes de criação
  update channel_jobs set status = 'done' where kind = 'refresh_groups';
  update channel_jobs set status = 'pending', locked_until = null where id = (j ->> 'id')::uuid and kind = 'create_group';
  j := public.claim_channel_job('w1');
  assert j ->> 'kind' = 'create_group' and (j -> 'payload' ->> 'name') is not null, j::text;
  perform public.complete_channel_job((j ->> 'id')::uuid, '{"external_id":"1203777@g.us","title":"Ofertas Carro BR","participants":[{"external_id":"5511999990002@s.whatsapp.net","display_name":"Bruno","role":"member"},{"external_id":"5511000@s.whatsapp.net","role":"owner"}]}');
  select id into v_chat from chats where external_id = '1203777@g.us';
  assert v_chat is not null and (select we_are_admin from chats where id = v_chat), 'grupo criado aparece como conversa onde somos admin';
  assert (select participant_count from chats where id = v_chat) = 2;
  perform test.fails(format($f$select public.complete_channel_job(%L, '{}')$f$, (j ->> 'id')), 'não está reservada');
  -- reserva vencida de criação NUNCA volta para a fila
  j := public.claim_channel_job('w1');
  update channel_jobs set locked_until = now() - interval '1 minute' where id = (j ->> 'id')::uuid;
  perform public.claim_channel_job('w1');
  assert (select status from channel_jobs where id = (j ->> 'id')::uuid) = 'failed', (select string_agg(kind||':'||status||':'||(payload->>'name'), ' | ') from channel_jobs) || ' J=' || j::text;

  -- verificação de chat do Telegram
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$select public.request_chat_verify('telegram', 'canal sem arroba')$f$, 'Informe @usuario');
  perform test.fails($f$select public.request_chat_verify('whatsapp', '@canal_x')$f$, 'só existe para o Telegram');
  v_job := public.request_chat_verify('telegram', '@ofertas_tech');
  perform public.cancel_channel_job(v_job);
  perform test.fails(format($f$select public.cancel_channel_job(%L)$f$, v_job), 'ainda não começaram');
  v_job := public.request_chat_verify('telegram', '-1001234567890');
  perform test.reset();
  j := public.claim_channel_job('w1');
  perform public.complete_channel_job((j ->> 'id')::uuid, '{"chat":{"external_id":"-1001234567890","kind":"channel","title":"Ofertas Tech","we_are_admin":true,"username":"ofertas_tech"}}');
  assert exists (select 1 from chats where channel = 'telegram' and external_id = '-1001234567890' and we_are_admin);

  raise notice 'ok 22: categorias por destino, grupos descobertos/criados, verificação';
end $$;

do $$
declare v_conn uuid; v_tpl uuid; n integer; v_pub uuid;
begin
  -- config de conectores: sem segredos e com limites
  select id into v_conn from connectors where platform = 'amazon';
  update connectors set config = '{"affiliate_tag":"loja-20","poll_minutes":30,"min_discount_pct":20,"categories":["eletronicos","casa"],"credential_ref":"amazon-paapi"}' where id = v_conn;
  perform test.fails(format($f$update connectors set config = '{"api_key":"abc"}' where id = %L$f$, v_conn), 'segredos');
  perform test.fails(format($f$update connectors set config = '{"nota":"sk-1234567890"}' where id = %L$f$, v_conn), 'parece um segredo');
  perform test.fails(format($f$update connectors set config = '{"poll_minutes":1}' where id = %L$f$, v_conn), 'entre 5 e 1440');
  perform test.fails(format($f$update connectors set config = '{"min_discount_pct":99}' where id = %L$f$, v_conn), 'entre 0 e 95');
  perform test.fails(format($f$update connectors set config = '{"categories":["xyz"]}' where id = %L$f$, v_conn), 'desconhecida');
  perform test.fails(format($f$update connectors set config = '{"poll_minutes":"10"}' where id = %L$f$, v_conn), 'precisa ser número');

  -- histórico de templates
  select id into v_tpl from templates where channel = 'telegram' and kind = 'offer';
  select count(*) into n from template_versions where template_id = v_tpl;
  assert n >= 1, 'versão inicial registrada';
  update templates set body = body || E'\nlinha nova' where id = v_tpl;
  assert (select count(*) from template_versions where template_id = v_tpl) = n + 1, 'nova versão no histórico';
  update templates set active = active where id = v_tpl;
  assert (select count(*) from template_versions where template_id = v_tpl) = n + 1, 'sem mudança de corpo não cria versão';

  -- reagendar publicação
  select id into v_pub from publications where status in ('pending', 'retry_scheduled') limit 1;
  if v_pub is not null then
    perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
    perform public.reschedule_publication(v_pub, now() + interval '2 hours');
    assert (select scheduled_for from publications where id = v_pub) > now() + interval '1 hour';
    perform test.fails(format($f$select public.reschedule_publication(%L, now() + interval '40 days')$f$, v_pub), 'entre agora e 30 dias');
    perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
    perform test.fails(format($f$select public.reschedule_publication(%L, now())$f$, v_pub), 'Permissão negada');
    perform test.reset();
  end if;
  raise notice 'ok 23: config de conectores, histórico de templates, reagendamento';
end $$;
