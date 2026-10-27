\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 8. Conversas e grupos (WhatsApp/Telegram)
-- ============================================================================
do $$
declare r jsonb; v_chat uuid; v_wa uuid;
begin
  -- publicação enviada já foi espelhada como "oferta" na conversa do destino (gatilho)
  select id into v_wa from chats where channel = 'whatsapp' and external_id = '1203@g.us';
  assert v_wa is not null, 'conversa do destino deveria existir pelo espelho da publicação';
  assert exists (select 1 from chat_messages where chat_id = v_wa and kind = 'offer' and publication_id is not null and direction = 'out'),
    'publicação enviada deveria aparecer como mensagem de oferta';
  assert (select destination_id from chats where id = v_wa) = test.get('dest_wa')::uuid, 'conversa ligada ao destino';

  -- ingestão de mensagem recebida cria conversa, conta não lidas e deduplica
  r := public.ingest_chat_message(jsonb_build_object('direction', 'in', 'external_id', 'm1', 'sender_name', 'Ana', 'sender_external_id', '5511@s.whatsapp.net',
        'body', 'Esse link ainda funciona?', 'sent_at', now(),
        'chat', jsonb_build_object('channel', 'whatsapp', 'external_id', '1203@g.us', 'title', 'Grupo WhatsApp', 'participant_count', 87, 'we_are_admin', true)));
  assert r ->> 'status' = 'created', r::text;
  v_chat := (r ->> 'chat_id')::uuid;
  assert v_chat = v_wa, 'mesma conversa (unique channel+external_id)';
  assert (select unread_count from chats where id = v_chat) = 1;
  assert (select participant_count from chats where id = v_chat) = 87;
  assert (select last_message_preview from chats where id = v_chat) = 'Esse link ainda funciona?';
  r := public.ingest_chat_message(jsonb_build_object('direction', 'in', 'external_id', 'm1', 'body', 'repetida',
        'chat', jsonb_build_object('channel', 'whatsapp', 'external_id', '1203@g.us')));
  assert r ->> 'status' = 'duplicate', 'mesma mensagem não duplica';
  assert (select unread_count from chats where id = v_chat) = 1, 'duplicada não conta não lida';
  perform test.fails($f$select public.ingest_chat_message('{"direction":"x","chat":{"channel":"whatsapp","external_id":"a"}}')$f$, 'direction inválida');
  perform test.fails($f$select public.upsert_chat('{"channel":"sms","external_id":"a"}')$f$, 'inválidos');

  -- participantes
  assert public.sync_chat_participants(v_chat, '[{"external_id":"u1","display_name":"Ana","role":"admin"},{"external_id":"u2"},{"external_id":""}]') = 2;
  assert (select participant_count from chats where id = v_chat) = 2;
  perform test.put('chat_wa', v_chat::text);
  raise notice 'ok 20: espelho de publicação, ingestão, deduplicação e participantes';
end $$;

do $$
declare v_chat uuid := test.get('chat_wa')::uuid; v_out uuid; c jsonb; v_tg uuid;
begin
  -- RBAC e RLS
  perform test.as_role('anon');
  perform test.fails($f$select * from chats$f$, 'permission denied');
  perform test.reset();
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a3');
  assert (select count(*) from chats) >= 1, 'leitor ativo lê conversas';
  perform public.mark_chat_read(v_chat);
  assert (select unread_count from chats where id = v_chat) = 0, 'marcar como lida';
  perform test.fails(format($f$select public.queue_chat_message(%L, 'oi')$f$, v_chat), 'Permissão negada');
  perform test.fails(format($f$select public.set_chat_flags(%L, true, null)$f$, v_chat), 'Permissão negada');
  perform test.fails($f$select public.ingest_chat_message('{}')$f$, 'permission denied');
  perform test.reset();
  update profiles set active = false where email = 'inativo@t.com';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a4');
  assert (select count(*) from chats) = 0, 'conta inativa não lê nada';
  perform test.reset();

  -- operador enfileira resposta; validações
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.queue_chat_message(%L, '   ')$f$, v_chat), 'vazia');
  perform test.fails(format($f$select public.queue_chat_message(%L, 'Compre agora, é garantido!')$f$, v_chat), 'termos proibidos');
  perform test.fails(format($f$select public.queue_chat_message(%L, %L)$f$, v_chat, repeat('x', 4001)), 'maior que');
  v_out := public.queue_chat_message(v_chat, 'Sim, o link está funcionando.', 'k1');
  assert public.queue_chat_message(v_chat, 'Sim, o link está funcionando.', 'k1') = v_out, 'idempotência pela chave';
  perform public.set_chat_flags(v_chat, false, true);
  assert (select muted from chats where id = v_chat);
  perform test.fails(format($f$select public.link_chat_destination(%L, null)$f$, v_chat), 'Permissão negada');
  perform test.reset();
  perform test.put('outbox', v_out::text);

  -- worker: pausa bloqueia, depois envia e reflete na conversa
  perform public.set_paused(true, 't');
  assert public.claim_chat_outbox('w1') is null, 'pausa global bloqueia respostas manuais';
  perform public.set_paused(false);
  c := public.claim_chat_outbox('w1');
  assert c is not null and c ->> 'chat_external_id' = '1203@g.us' and c ->> 'text' like 'Sim%', c::text;
  assert public.claim_chat_outbox('w1') is null, 'só uma por vez e sem reentrega';
  perform public.complete_chat_outbox(v_out, 'wamid-9');
  assert (select status from chat_outbox where id = v_out) = 'sent';
  assert exists (select 1 from chat_messages where chat_id = v_chat and outbox_id = v_out and direction = 'out' and external_id = 'wamid-9');
  perform test.fails(format($f$select public.complete_chat_outbox(%L)$f$, v_out), 'não está reservada');

  -- reserva vencida vira failed (nunca reenvia sozinha)
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  v_out := public.queue_chat_message(v_chat, 'segunda', 'k2');
  perform test.reset();
  perform public.claim_chat_outbox('w1');
  update chat_outbox set locked_until = now() - interval '1 minute' where id = v_out;
  assert public.claim_chat_outbox('w1') is null;
  assert (select status from chat_outbox where id = v_out) = 'failed', 'reserva vencida => failed';
  -- cancelar
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  v_out := public.queue_chat_message(v_chat, 'terceira', 'k3');
  perform public.cancel_chat_outbox(v_out);
  perform test.fails(format($f$select public.cancel_chat_outbox(%L)$f$, v_out), 'ainda na fila');
  perform test.reset();

  -- canal Telegram sem ser admin do canal
  v_tg := public.upsert_chat('{"channel":"telegram","external_id":"-100999","kind":"channel","title":"Canal alheio","we_are_admin":false}');
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails(format($f$select public.queue_chat_message(%L, 'oi')$f$, v_tg), 'administradores');
  perform test.reset();

  -- vínculo com destino (admin) só do mesmo canal
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.link_chat_destination(v_tg, test.get('dest_tg')::uuid);
  perform test.fails(format($f$select public.link_chat_destination(%L, %L)$f$, v_tg, test.get('dest_wa')), 'outro canal');
  assert (public.channel_overview('telegram') ->> 'linked_destinations')::int >= 1;
  assert (public.channel_overview('whatsapp') ->> 'messages_in_24h')::int >= 1;
  perform test.reset();

  -- retenção não apaga mensagens de oferta
  update chat_messages set sent_at = now() - interval '200 days';
  perform public.purge_old_messages();
  assert exists (select 1 from chat_messages where kind = 'offer'), 'ofertas publicadas ficam';
  assert not exists (select 1 from chat_messages where publication_id is null), 'mensagens antigas apagadas';
  raise notice 'ok 21: RBAC/RLS, outbox, pausa, reserva vencida, vínculo e retenção';
end $$;
