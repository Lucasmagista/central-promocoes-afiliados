\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- Envio por canal em paralelo e link curto nas ofertas já aprovadas (migração 019)
-- ============================================================================
do $$
declare
  v_off uuid := test.get('offer_shopee')::uuid; v_tg uuid := test.get('dest_tg')::uuid; v_wa uuid := test.get('dest_wa')::uuid;
  c jsonb; v_aff text; v_pub uuid; v_txt text;
begin
  perform public.set_setting('mode', '"review"'); perform public.set_paused(false);
  update destinations set enabled = true, quiet_start = null, quiet_end = null, max_per_hour = 100, max_per_day = 1000, min_interval_s = 0, categories = '{}' where id in (v_tg, v_wa);
  update offers set status = 'approved', expires_at = null where id = v_off;
  update publications set status = 'cancelled' where status in ('pending', 'retry_scheduled');
  insert into publications (offer_id, destination_id, content_version, rendered_text, status, idempotency_key, scheduled_for, next_attempt_at)
  values (v_off, v_tg, 91, 'texto telegram', 'pending', 'pista:' || v_off || ':tg', now(), now() - interval '1 minute'),
         (v_off, v_wa, 91, 'texto whatsapp', 'pending', 'pista:' || v_off || ':wa', now(), now() - interval '2 minutes');

  -- cada pista só reserva publicações do seu canal (a do WhatsApp é a mais antiga e NÃO atrasa o Telegram)
  c := public.claim_next_publication('w-tg', 'telegram');
  assert c is not null and c ->> 'channel' = 'telegram', 'pista do Telegram pega só Telegram: ' || coalesce(c::text, 'null');
  c := public.claim_next_publication('w-wa', 'whatsapp');
  assert c is not null and c ->> 'channel' = 'whatsapp', 'pista do WhatsApp pega só WhatsApp: ' || coalesce(c::text, 'null');
  assert public.claim_next_publication('w-tg', 'telegram') is null, 'nada mais do Telegram';
  assert public.claim_next_publication('w-wa', 'whatsapp') is null, 'nada mais do WhatsApp';

  -- sem o parâmetro continua funcionando como antes (qualquer canal)
  update publications set status = 'pending' where idempotency_key = 'pista:' || v_off || ':wa';
  c := public.claim_next_publication('w-any');
  assert c is not null and c ->> 'channel' = 'whatsapp', 'sem canal: pega o que houver';
  update publications set status = 'cancelled' where idempotency_key like 'pista:%';

  -- ofertas aprovadas antes do link curto ficam com o link comprido; reshorten_pending troca pelo curto
  select affiliate_url into v_aff from offers where id = v_off;
  if coalesce(v_aff, '') = '' then update offers set affiliate_url = 'https://s.click.exemplo.com/e/ABC?x=1&y=2' where id = v_off; v_aff := 'https://s.click.exemplo.com/e/ABC?x=1&y=2'; end if;
  perform public.set_setting('shortlink_base', '""');
  assert public.reshorten_pending() = 0, 'sem URL base configurada não mexe em nada';
  insert into publications (offer_id, destination_id, content_version, rendered_text, status, idempotency_key, scheduled_for, next_attempt_at)
  values (v_off, v_wa, 92, 'Oferta ' || v_aff || ' fim', 'pending', 'pista:' || v_off || ':curto', now(), now()) returning id into v_pub;
  perform public.set_setting('shortlink_base', '"https://worker.exemplo.com/r"');
  assert public.reshorten_pending() >= 1, 'troca o link comprido nas pendentes';
  select rendered_text into v_txt from publications where id = v_pub;
  assert v_txt like 'Oferta https://worker.exemplo.com/r/% fim', 'texto com link curto: ' || v_txt;
  assert position(v_aff in v_txt) = 0, 'o link comprido saiu do texto';
  assert exists (select 1 from short_links where publication_id = v_pub and target_url = v_aff), 'código registrado no redirecionador';
  assert public.reshorten_pending() = 0, 'repetir não faz nada (idempotente)';
  perform public.set_setting('shortlink_base', '""');
  update publications set status = 'cancelled' where idempotency_key like 'pista:%';
  raise notice 'ok: pistas por canal e link curto nas pendentes';
end $$;
