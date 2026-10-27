\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 5. Fila: modos, pausa, limites, janela de silêncio
-- ============================================================================
do $$
declare c jsonb; v_off uuid := test.get('offer_ml')::uuid; v_tg uuid := test.get('dest_tg')::uuid;
begin
  -- modo simulation: oferta real NÃO sai
  perform public.set_setting('mode', '"simulation"');
  assert public.claim_next_publication('w1') is null, 'simulation não libera oferta real';
  perform public.set_setting('mode', '"review"');

  -- pausa global
  perform public.set_paused(true, 'teste');
  assert public.claim_next_publication('w1') is null, 'pausa global bloqueia a fila';
  perform public.set_paused(false);
  raise notice 'ok 7: modo simulation e pausa global';
end $$;

do $$
declare c jsonb; v_tg uuid := test.get('dest_tg')::uuid; v_wa uuid := test.get('dest_wa')::uuid;
begin
  -- janela de silêncio cobrindo o horário atual bloqueia o destino (Telegram); WhatsApp segue livre
  update destinations set quiet_start = ((now() at time zone 'America/Sao_Paulo')::time - interval '1 hour')::time,
                          quiet_end   = ((now() at time zone 'America/Sao_Paulo')::time + interval '1 hour')::time
   where id = v_tg;
  c := public.claim_next_publication('w1');
  assert c is not null and c ->> 'channel' = 'whatsapp', 'silêncio pula o Telegram: ' || coalesce(c::text, 'null');
  perform test.put('claimed_wa', c ->> 'publication_id');
  assert (select status from publications where id = (c ->> 'publication_id')::uuid) = 'claimed';
  assert (c ->> 'attempt')::int = 1;
  assert c ->> 'rendered_text' like '*Fone%';
  -- janela de silêncio que atravessa a meia-noite
  update destinations set quiet_start = ((now() at time zone 'America/Sao_Paulo')::time - interval '1 hour')::time,
                          quiet_end   = ((now() at time zone 'America/Sao_Paulo')::time - interval '2 hours')::time
   where id = v_tg;
  assert public.claim_next_publication('w1') is null, 'silêncio atravessando a meia-noite também bloqueia';
  update destinations set quiet_start = null, quiet_end = null where id = v_tg;
  raise notice 'ok 8: janela de silêncio';
end $$;

do $$
declare c jsonb; v_wa uuid := test.get('dest_wa')::uuid; v_tg uuid := test.get('dest_tg')::uuid;
begin
  -- limite por hora: WhatsApp com limite 1 já tem 1 reservada
  update destinations set max_per_hour = 1 where id = v_wa;
  update publications set status = 'cancelled' where destination_id = v_tg and status = 'pending';
  assert public.claim_next_publication('w1') is null, 'nada elegível (Telegram cancelado)';
  update publications set status = 'cancelled' where destination_id = v_tg;
  -- novo envio no WhatsApp para a oferta Shopee
  update destinations set max_per_hour = 5, min_interval_s = 3600 where id = v_wa;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform public.approve_offer(test.get('offer_shopee')::uuid, array[v_wa]);
  perform test.reset();
  assert public.claim_next_publication('w1') is null, 'intervalo mínimo bloqueia o segundo envio';
  update publications set claimed_at = now() - interval '2 hours' where id = test.get('claimed_wa')::uuid;
  c := public.claim_next_publication('w1');
  assert c is not null, 'após o intervalo, libera';
  perform test.put('claimed_shopee', c ->> 'publication_id');
  raise notice 'ok 9: limites por destino e intervalo mínimo';
end $$;

-- ============================================================================
-- 6. Resultado do envio: sucesso, retry, falha permanente, unknown
-- ============================================================================
do $$
declare v_p uuid := test.get('claimed_wa')::uuid; v_s text;
begin
  perform public.complete_publication(v_p, 'msg-42');
  assert (select status from publications where id = v_p) = 'sent';
  assert (select status from offers where id = test.get('offer_ml')::uuid) = 'published', 'oferta vira published';
  perform test.fails(format($f$select public.complete_publication(%L)$f$, v_p), 'não está em estado de conclusão');

  v_p := test.get('claimed_shopee')::uuid;
  v_s := public.fail_publication(v_p, 'HTTP_429', false, 60);
  assert v_s = 'retry_scheduled';
  assert (select next_attempt_at from publications where id = v_p) > now() + interval '50 seconds', 'backoff aplicado';
  update destinations set min_interval_s = 0 where id = test.get('dest_wa')::uuid;
  assert public.claim_next_publication('w1') is null, 'retry ainda não venceu';
  update publications set next_attempt_at = now() - interval '1 second', claimed_at = now() - interval '3 hours' where id = v_p;
  assert public.claim_next_publication('w1') ->> 'attempt' = '2', 'segunda tentativa';
  v_s := public.fail_publication(v_p, 'CHAT_NOT_FOUND', true);
  assert v_s = 'failed_permanent', 'falha permanente não repete';
  update publications set attempt_count = 5, status = 'claimed' where id = v_p;
  v_s := public.fail_publication(v_p, 'HTTP_500');
  assert v_s = 'failed_permanent', 'estourou o máximo de tentativas';
  raise notice 'ok 10: conclusão, retry com backoff e falha permanente';
end $$;

do $$
declare v_p uuid := test.get('claimed_shopee')::uuid; v_n int;
begin
  -- reenfileirar falha permanente (operador)
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  perform test.fails(format($f$select public.retry_publication(%L)$f$, v_p), 'Permissão negada');
  perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform public.retry_publication(v_p);
  assert (select status from publications where id = v_p) = 'pending';
  perform test.reset();

  -- reserva que expira vira unknown (nunca pending)
  update publications set status = 'claimed', locked_until = now() - interval '1 minute', claimed_at = now() - interval '3 hours' where id = v_p;
  v_n := public.release_stale_claims();
  assert v_n = 1 and (select status from publications where id = v_p) = 'unknown', 'reserva vencida vira unknown';
  assert public.claim_next_publication('w1') is null, 'unknown nunca é reenviado sozinho';

  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  perform test.fails(format($f$select public.resolve_unknown(%L, 'sent')$f$, v_p), 'Permissão negada');
  perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform public.resolve_unknown(v_p, 'sent', 'msg-77');
  assert (select status from publications where id = v_p) = 'sent';
  perform test.fails(format($f$select public.resolve_unknown(%L, 'sent')$f$, v_p), 'não está em estado unknown');
  perform test.reset();
  raise notice 'ok 11: unknown, reconciliação e reenfileiramento';
end $$;

-- ============================================================================
-- 7. Rejeição, cancelamento, edição, expiração
-- ============================================================================
do $$
declare r jsonb; v_off uuid; v_wa uuid := test.get('dest_wa')::uuid; v_pub uuid; n int;
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  r := public.ingest_offer(jsonb_build_object('platform', 'shopee', 'original_url', 'https://shopee.com.br/Cabo-i.9.10',
    'affiliate_url', 'https://shopee.com.br/aff/zzz', 'title', 'Cabo USB', 'price', 15, 'source_kind', 'api',
    'expires_at', now() + interval '1 day'));
  v_off := (r ->> 'offer_id')::uuid;
  perform public.approve_offer(v_off, array[v_wa], now() + interval '2 hours');
  select id into v_pub from publications where offer_id = v_off;
  assert (select next_attempt_at from publications where id = v_pub) > now() + interval '1 hour', 'agendamento respeitado';

  perform public.edit_publication_text(v_pub, 'Texto editado com *carinho*');
  perform test.fails(format($f$select public.edit_publication_text(%L, 'imperdível, vai acabar')$f$, v_pub), 'termos proibidos');
  perform public.cancel_publication(v_pub);
  assert (select status from publications where id = v_pub) = 'cancelled';
  perform test.fails(format($f$select public.cancel_publication(%L)$f$, v_pub), 'Só é possível cancelar');

  perform public.reject_offer(v_off, 'Preço não confere');
  assert (select status from offers where id = v_off) = 'rejected';
  perform test.fails(format($f$select public.reject_offer(%L, '')$f$, v_off), 'motivo');
  perform test.reset();

  -- expiração cancela pendentes
  r := public.ingest_offer(jsonb_build_object('platform', 'shopee', 'original_url', 'https://shopee.com.br/Capa-i.11.12',
    'affiliate_url', 'https://shopee.com.br/aff/yyy', 'title', 'Capa', 'price', 25, 'source_kind', 'api'));
  v_off := (r ->> 'offer_id')::uuid;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform public.approve_offer(v_off, array[v_wa]);
  perform test.reset();
  update offers set expires_at = now() - interval '1 minute' where id = v_off;
  n := public.expire_offers();
  assert n = 1 and (select status from offers where id = v_off) = 'expired', 'oferta expirada';
  assert (select count(*) from publications where offer_id = v_off and status = 'cancelled') = 1;
  raise notice 'ok 12: agendamento, edição, cancelamento, rejeição e expiração';
end $$;

-- ============================================================================
-- 8. Cliques, painel e RLS
-- ============================================================================
do $$
declare v_code text; v_url text; s jsonb; a jsonb;
begin
  select code into v_code from short_links limit 1;
  v_url := public.record_click(v_code, 'hash1', 'Chrome', 'whatsapp.com');
  assert v_url like 'https://%', 'redireciona para o link de afiliado original: ' || coalesce(v_url, 'null');
  perform public.record_click(v_code, 'hash2', 'Safari', null);
  assert public.record_click('inexistente') is null;
  assert (select count(*) from click_events) = 2;

  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  s := public.dashboard_summary();
  a := public.analytics_overview(7);
  assert (s -> 'clicks' ->> 'last_24h')::int = 2, s::text;
  assert jsonb_array_length(a -> 'series') = 7, 'série de 7 dias';
  assert (a -> 'funnel' ->> 'ingested')::int >= 3;
  perform test.reset();
  raise notice 'ok 13: cliques, dashboard e analytics';
end $$;

do $$
declare s jsonb;
begin
  -- inativo e anon não leem nada
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a4');
  assert (select count(*) from offers) = 0, 'conta inativa não enxerga dados';
  perform test.fails($f$select public.dashboard_summary()$f$, 'Acesso negado');
  perform test.reset();
  perform test.as_role('anon');
  perform test.fails($f$select count(*) from offers$f$, 'permission denied');
  perform test.reset();

  -- leitor lê, mas não escreve
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  assert (select count(*) from offers) >= 3, 'leitor enxerga ofertas';
  perform test.fails($f$update offers set status = 'rejected'$f$, 'permission denied');
  perform test.fails($f$delete from publications$f$, 'permission denied');
  perform test.fails($f$insert into destinations (channel, external_id, name) values ('telegram', '1', 'x')$f$, 'row-level security');
  assert (select count(*) from profiles) = 1, 'leitor só vê o próprio perfil';
  perform test.reset();

  -- operador não escreve em configuração direta
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$insert into destinations (channel, external_id, name) values ('telegram', '2', 'y')$f$, 'row-level security');
  perform test.fails($f$select public.set_setting('mode', '"auto"')$f$, 'Permissão negada');
  perform public.set_paused(true, 'manutenção');
  perform test.fails($f$select public.set_paused(false)$f$, 'Permissão negada');
  s := public.dashboard_summary();
  assert s ->> 'paused' = 'true';
  assert s::text like '%pausada globalmente%', 'alerta de pausa';
  perform test.reset();

  -- admin retoma, vê todos os perfis e não remove o último admin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.set_paused(false);
  assert (select count(*) from profiles) = 4, 'admin vê todos os perfis';
  perform test.fails($f$select public.set_profile('00000000-0000-0000-0000-0000000000a1', 'viewer', true)$f$, 'sem nenhum administrador');
  perform public.set_profile('00000000-0000-0000-0000-0000000000a4', 'operator', true);
  perform test.fails($f$select public.set_setting('mode', '"turbo"')$f$, 'Modo inválido');
  perform test.reset();
  assert (select active from profiles where email = 'inativo@t.com'), 'conta aprovada pelo admin';
  raise notice 'ok 14: RLS, RBAC e proteção do último admin';
end $$;

-- ============================================================================
-- 9. Auditoria
-- ============================================================================
do $$
begin
  assert exists (select 1 from audit_events where action = 'offer_approved'), 'aprovação auditada';
  assert exists (select 1 from audit_events where action = 'global_pause'), 'pausa auditada';
  assert exists (select 1 from audit_events where action = 'update_destinations'), 'alteração direta auditada por gatilho';
  assert exists (select 1 from audit_events where action = 'setting_changed'), 'configuração auditada';
  assert exists (select 1 from audit_events where action = 'unknown_resolved');
  assert not exists (select 1 from audit_events where metadata::text ~* 'token|password'), 'sem segredos na auditoria';
  assert public.scrub('{"bot_token":"abc","nome":"x"}') ->> 'bot_token' = '[redigido]', 'segredos redigidos';
  raise notice 'ok 15: auditoria completa e sem segredos';
end $$;
