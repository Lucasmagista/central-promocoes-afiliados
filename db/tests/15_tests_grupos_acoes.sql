\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- 15. Gerenciamento de grupos: validação, pausa, limites, resultado sincroniza o chat
-- ============================================================================
do $$
declare v1 uuid; v2 uuid; v3 uuid; j jsonb; n integer; g text := '120363000000000001@g.us';
begin
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  -- padrões de grupo
  perform public.save_group_defaults('{"whatsapp":{"only_admins_send":false,"add_batch_size":10,"add_delay_s":8,"ephemeral_seconds":604800},"telegram":{"restrict_members_send":true}}');
  assert (select value #>> '{whatsapp,only_admins_send}' from settings where key = 'int_groups') = 'false';
  assert (select value #>> '{whatsapp,lock_info}' from settings where key = 'int_groups') = 'true', 'campos não enviados permanecem';
  perform test.fails($f$select public.save_group_defaults('{"whatsapp":{"add_batch_size":99}}')$f$, 'Participantes por lote');
  perform test.fails($f$select public.save_group_defaults('{"whatsapp":{"ephemeral_seconds":5}}')$f$, 'Mensagens temporárias');
  perform test.fails($f$select public.save_group_defaults('{"whatsapp":{"magia":true}}')$f$, 'Campo desconhecido');
  perform test.fails($f$select public.save_group_defaults('{"signal":{}}')$f$, 'Canal desconhecido');

  -- validação dos pedidos
  perform test.fails($f$select public.request_group_action('whatsapp', 'abc', 'info')$f$, 'Identificador de grupo');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'set_title', '{"subject":"x"}')$f$, 'não existe para o WhatsApp');
  perform test.fails($f$select public.request_group_action('telegram', '-1001234567890', 'add_participants', '{"numbers":["5511999990001"]}')$f$, 'não existe para o Telegram');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'set_subject', '{"subject":""}')$f$, '1 a 100');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'set_subject', '{"subject":"Oferta garantido"}')$f$, 'termos proibidos');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'add_participants', '{"numbers":["123"]}')$f$, 'ao menos 1 número');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'leave', '{}')$f$, 'Confirme');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'set_ephemeral', '{"seconds":10}')$f$, 'Mensagens temporárias');
  perform test.fails($f$select public.request_group_action('telegram', '-1001234567890', 'set_description', jsonb_build_object('description', repeat('a', 300)))$f$, 'Descrição longa');
  perform test.fails($f$select public.request_group_action('telegram', '-1001234567890', 'revoke_invite', '{"link":"https://evil.com/x"}')$f$, 'Link de convite');

  -- normalização e deduplicação
  v1 := public.request_group_action('whatsapp', g, 'add_participants', '{"numbers":["+55 (11) 99999-0001","5511999990001","11 98888-0002"]}');
  assert (select jsonb_array_length(payload #> '{params,numbers}') from channel_jobs where id = v1) = 2, 'números normalizados e únicos';
  v2 := public.request_group_action('whatsapp', g, 'add_participants', '{"numbers":["+55 (11) 99999-0001","5511999990001","11 98888-0002"]}');
  assert v1 = v2, 'pedido idêntico reaproveita a tarefa';
  v1 := public.request_group_action('telegram', '-1001234567890', 'info');
  assert v1 = public.request_group_action('telegram', '-1001234567890', 'info');

  -- viewer/operador não alteram grupos
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'info')$f$, 'administrador');
  perform test.fails($f$select public.save_group_defaults('{}')$f$, 'administrador');
  perform test.as_role('anon');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000001@g.us', 'info')$f$, 'permission denied');

  -- limite diário de participantes adicionados
  perform test.as_role('service_role');
  insert into settings (key, value) values ('max_participant_adds_per_day', '3') on conflict (key) do update set value = '3';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000002@g.us', 'add_participants', '{"numbers":["5511999990003","5511999990004"]}')$f$, 'Limite de 3');
  perform public.request_group_action('whatsapp', '120363000000000002@g.us', 'add_participants', '{"numbers":["5511999990003"]}');

  -- pausa global: leitura passa, alteração não
  perform test.as_role('service_role');
  update settings set value = 'true' where key = 'paused';
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform test.fails($f$select public.request_group_action('whatsapp', '120363000000000009@g.us', 'set_subject', '{"subject":"Novo nome"}')$f$, 'pausados');
  v3 := public.request_group_action('whatsapp', '120363000000000009@g.us', 'info');

  perform test.as_role('service_role');
  n := 0;
  loop
    j := public.claim_channel_job('w1'); exit when j is null;
    assert j ->> 'kind' <> 'group_action' or public.group_action_is_read(j #>> '{payload,action}'), 'só leituras saem durante a pausa';
    if j ->> 'kind' = 'group_action' then
      perform public.complete_channel_job((j ->> 'id')::uuid, jsonb_build_object(
        'chat', jsonb_build_object('external_id', j #>> '{payload,external_id}', 'kind', 'group', 'title', 'Grupo Teste', 'description', 'desc', 'participant_count', 2, 'we_are_admin', true),
        'participants', jsonb_build_array(jsonb_build_object('external_id', '5511999990001', 'role', 'admin'), jsonb_build_object('external_id', '5511988880002', 'role', 'member')),
        'invite_url', 'https://chat.whatsapp.com/ABC'));
      n := n + 1;
    else perform public.complete_channel_job((j ->> 'id')::uuid, '{"x":1}'); end if;
  end loop;
  assert n >= 1, 'leituras rodaram durante a pausa';
  assert (select title from chats where channel = 'whatsapp' and external_id = '120363000000000009@g.us') = 'Grupo Teste', 'resultado atualiza o chat';
  assert (select count(*) from chat_participants cp join chats c on c.id = cp.chat_id where c.external_id = '120363000000000009@g.us') = 2, 'participantes sincronizados';
  assert (select result ->> 'invite_url' from channel_jobs where id = v3) = 'https://chat.whatsapp.com/ABC';
  update settings set value = 'false' where key = 'paused';

  -- sair do grupo arquiva o chat
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  v1 := public.request_group_action('whatsapp', '120363000000000009@g.us', 'leave', '{"confirm":true}');
  perform test.as_role('service_role');
  loop j := public.claim_channel_job('w1'); exit when j is null or (j ->> 'id')::uuid = v1; perform public.complete_channel_job((j ->> 'id')::uuid, '{}'); end loop;
  perform public.complete_channel_job(v1, '{"left":true}');
  assert (select archived from chats where external_id = '120363000000000009@g.us'), 'chat arquivado depois de sair';

  -- alteração com reserva vencida nunca é repetida
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  v1 := public.request_group_action('whatsapp', '120363000000000003@g.us', 'set_subject', '{"subject":"Ofertas Tech"}');
  v2 := public.request_group_action('whatsapp', '120363000000000003@g.us', 'info');
  perform test.as_role('service_role');
  update channel_jobs set status = 'claimed', locked_until = now() - interval '1 minute' where id in (v1, v2);
  j := public.claim_channel_job('w2');
  assert (select status from channel_jobs where id = v1) = 'failed', 'alteração interrompida falha e não repete';
  assert (select status from channel_jobs where id = v2) in ('pending', 'claimed', 'done'), 'leitura interrompida pode repetir';
  assert (select last_error from channel_jobs where id = v1) like '%confira%';

  -- runtime entrega padrões e aviso de afiliado ao worker
  assert public.get_integration_runtime() #>> '{groups,whatsapp,add_batch_size}' = '10';
  assert coalesce(public.get_integration_runtime() ->> 'disclosure', '') <> '';
  raise notice 'ok 25: gerenciamento de grupos (validação, pausa, limites, sincronização)';
end $$;
