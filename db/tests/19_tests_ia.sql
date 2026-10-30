\set ON_ERROR_STOP on
\set QUIET on

-- ============================================================================
-- IA (OpenRouter), token do coletor e domínios de afiliado (migração 020)
-- ============================================================================
do $$
declare
  v_off uuid := test.get('offer_shopee')::uuid; v_tg uuid := test.get('dest_tg')::uuid;
  j jsonb; v_txt text; v_tok text;
begin
  update offers set status = 'needs_review', ai_headline = null, ai_body = null, created_at = now() where id = v_off;
  update templates set body = '<b>{{title}}</b>' || E'\n' || '{{ai_text}}' || E'\n' || E'\n' || '{{price}}' where kind = 'offer' and channel = 'telegram';
  update destinations set enabled = true where id = v_tg;

  -- a IA só pega ofertas em revisão, e a lista respeita o limite
  j := public.list_offers_for_ai(5);
  assert jsonb_array_length(j) >= 1 and exists (select 1 from jsonb_array_elements(j) x where x ->> 'id' = v_off::text), 'oferta em revisão entra na lista da IA';

  -- legenda válida é gravada e aparece no texto da mensagem
  j := public.set_offer_ai_text(v_off, '🔥 Fone Bluetooth TWS com cancelamento de ruído', 'Estojo de carga e bateria para o dia todo', 'openai/gpt-4o-mini');
  assert (j ->> 'ok')::boolean, 'legenda válida: ' || j::text;
  v_txt := public.render_offer_text(v_off, v_tg);
  assert v_txt like '<b>🔥 Fone Bluetooth TWS com cancelamento de ruído</b>%', 'manchete da IA no lugar do título: ' || v_txt;
  assert position('Estojo de carga e bateria para o dia todo' in v_txt) > 0, 'linha de benefício aparece: ' || v_txt;
  assert not exists (select 1 from jsonb_array_elements(public.list_offers_for_ai(20)) x where x ->> 'id' = v_off::text), 'já tem legenda: sai da lista';

  -- termos proibidos, endereços e tamanhos inválidos são recusados e nada é gravado
  update offers set ai_headline = null, ai_body = null where id = v_off;
  j := public.set_offer_ai_text(v_off, 'Oferta garantido só hoje', null, 'x');
  assert not (j ->> 'ok')::boolean and j ? 'violations', 'termo proibido é barrado: ' || j::text;
  j := public.set_offer_ai_text(v_off, 'Veja em https://exemplo.com', null, 'x');
  assert not (j ->> 'ok')::boolean, 'endereço é barrado';
  j := public.set_offer_ai_text(v_off, 'ok', null, 'x');
  assert not (j ->> 'ok')::boolean, 'manchete curta demais';
  assert (select ai_headline from offers where id = v_off) is null, 'nada gravado nas recusas';

  -- sem legenda da IA: cai no nome curto, e a linha do benefício some
  v_txt := public.render_offer_text(v_off, v_tg);
  assert position('{{' in v_txt) = 0 and v_txt not like E'%\n\n\n%', 'sem IA o texto continua limpo: ' || v_txt;

  -- IA não conseguiu: marca para não insistir e usa o nome curto
  perform public.skip_offer_ai(v_off);
  assert (select ai_headline from offers where id = v_off) = '', 'marcada como pulada';
  v_txt := public.render_offer_text(v_off, v_tg);
  assert v_txt not like '<b></b>%', 'manchete vazia não é usada';

  -- token do coletor: guarda só o hash e mostra o valor uma única vez
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  v_tok := public.rotate_ingest_token();
  assert v_tok like 'ing\_%' and length(v_tok) > 40, 'token gerado';
  assert (public.ingest_token_status() ->> 'is_set')::boolean, 'status do token';
  perform test.reset();
  assert (select value from integration_secrets where key = 'ingest_token_hash') = encode(sha256(convert_to(v_tok, 'utf8')), 'hex'), 'guarda o hash, não o token';
  assert (select value from integration_secrets where key = 'ingest_token_hash') <> v_tok;

  -- só administrador mexe nas chaves
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a2');
  begin perform public.set_ai_key('sk-or-v1-0123456789abcdef0123456789abcdef'); assert false, 'operador não grava a chave'; exception when others then assert sqlerrm not like 'operador não%', sqlerrm; end;
  begin perform public.rotate_ingest_token(); assert false, 'operador não gera token'; exception when others then assert sqlerrm not like 'operador não%', sqlerrm; end;
  perform test.as_role('authenticated', '00000000-0000-0000-0000-0000000000a1');
  perform public.set_ai_key('sk-or-v1-0123456789abcdef0123456789abcdef');
  assert (public.ai_key_status() ->> 'is_set')::boolean and (public.ai_key_status() ->> 'hint') = 'cdef', 'chave guardada, só a dica aparece';
  assert (public.ai_key_status())::text not like '%0123456789%', 'o valor nunca volta';
  begin perform public.set_ai_key('curta'); assert false, 'chave curta'; exception when others then assert sqlerrm not like 'chave curta', sqlerrm; end;
  perform public.clear_ai_key();
  assert not (public.ai_key_status() ->> 'is_set')::boolean, 'chave removida';
  perform test.reset();

  -- links curtos de afiliado dos dois canais passam na lista de domínios
  assert (public.setting_text('allowed_domains', '') like '%meli.la%') and (public.setting_text('allowed_domains', '') like '%shope.ee%'), 'domínios liberados';
  raise notice 'ok: IA, token do coletor e domínios';
end $$;
