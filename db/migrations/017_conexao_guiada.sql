-- ============================================================================
-- 017 — Conexão guiada do WhatsApp/Telegram e imagens dos produtos
--
--  * novas ações: evolution/connect_poll (QR code ao vivo) e telegram/connect (liga o bot sozinho);
--  * mais folga no limite de ações por minuto (o QR é consultado a cada poucos segundos);
--  * imagem do produto nos links capturados do Radar e nos produtos acompanhados.
-- request_integration_action é redefinida por inteiro (idempotente).
-- ============================================================================
-- Função completa (e não por substituição de texto): vale para qualquer versão anterior que esteja no banco.
CREATE OR REPLACE FUNCTION public.request_integration_action(p_provider text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_ok boolean; v_text text; v_payload jsonb := '{}'::jsonb; v_to text; v_ch text; v_mode text;
begin
  perform public.require_admin();
  v_ok := case p_provider
    when 'evolution' then p_action in ('status', 'connect', 'restart', 'logout', 'set_webhook', 'create_instance', 'list_instances', 'send_test', 'connect_poll')
    when 'telegram' then p_action in ('check', 'connect', 'set_webhook', 'delete_webhook', 'send_test')
    when 'mercadolivre' then p_action in ('check', 'exchange_code', 'disconnect', 'preview', 'collect')
    when 'shopee' then p_action in ('check', 'preview', 'collect')
    when 'amazon' then p_action in ('check', 'preview', 'collect') when 'aliexpress' then p_action in ('check', 'preview', 'collect') when 'magalu' then p_action = 'check'
    when 'worker' then p_action in ('selftest', 'webhook_check', 'run_monitor', 'run_sender', 'radar_test')
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Ação não existe para esta integração'; end if;
  v_ch := case p_provider when 'evolution' then 'whatsapp' when 'telegram' then 'telegram' else null end;

  if p_action = 'run_sender' and public.setting_bool('paused', false) then raise exception 'Envios pausados: retome antes de rodar o ciclo de envio'; end if;

  if p_action = 'collect' then
    select mode into v_mode from public.connectors where platform = p_provider;
    if v_mode is null or v_mode in ('disabled', 'paused_policy', 'error') then
      raise exception 'Ative a coleta deste conector antes de coletar (modo atual: %). Para só ver uma amostra, use "Ver amostra".', coalesce(v_mode, 'inexistente');
    end if;
  end if;

  if p_action = 'exchange_code' then
    v_to := btrim(coalesce(p_payload ->> 'code', ''));
    if v_to !~ '^[A-Za-z0-9_.-]{10,200}$' then raise exception 'Código de autorização inválido. Clique em "Conectar conta" de novo.'; end if;
    v_payload := jsonb_build_object('code', v_to);
    v_text := btrim(coalesce(p_payload ->> 'redirect_uri', ''));
    if v_text <> '' then
      if not public.valid_https_url(v_text) then raise exception 'Endereço de redirecionamento inválido (precisa ser https)'; end if;
      v_payload := v_payload || jsonb_build_object('redirect_uri', v_text);
    end if;
  elsif p_action = 'radar_test' then
    v_to := btrim(coalesce(p_payload ->> 'url', ''));
    if v_to !~ '^https?://[^[:space:]]+$' or length(v_to) > 500 then raise exception 'Informe um endereço (http ou https) de até 500 caracteres'; end if;
    v_payload := jsonb_build_object('url', v_to);
  elsif p_action = 'send_test' then
    if public.setting_bool('paused', false) then raise exception 'Envios pausados: retome antes de enviar o teste'; end if;
    v_to := btrim(coalesce(p_payload ->> 'to', ''));
    if p_provider = 'evolution' then
      v_to := regexp_replace(v_to, '\D', '', 'g');
      if v_to !~ '^\d{10,15}$' then raise exception 'Número inválido. Use DDI + DDD + número, só dígitos (ex.: 5511999990001)'; end if;
    elsif v_to !~ '^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$' then raise exception 'Destino inválido: ID numérico do chat ou @canal';
    end if;
    v_text := left(btrim(coalesce(p_payload ->> 'text', 'Teste da Central de Promoções: a integração está funcionando.')), 500);
    if array_length(public.text_violations(v_text), 1) > 0 then raise exception 'O texto contém termos proibidos'; end if;
    v_payload := jsonb_build_object('to', v_to, 'text', v_text);
  elsif p_provider = 'evolution' and p_action in ('connect', 'connect_poll') then
    v_to := regexp_replace(coalesce(p_payload ->> 'pairing_number', ''), '\D', '', 'g');
    if v_to <> '' and v_to !~ '^\d{10,15}$' then raise exception 'Número para código de pareamento inválido'; end if;
    if v_to <> '' then v_payload := jsonb_build_object('pairing_number', v_to); end if;
  end if;

  -- repetição de clique: reaproveita a tarefa idêntica em andamento (o código do OAuth nunca é reaproveitado)
  if p_action not in ('exchange_code', 'radar_test') then
    select id into v_id from public.channel_jobs
     where kind = 'integration' and status in ('pending', 'claimed') and payload ->> 'provider' = p_provider and payload ->> 'action' = p_action
       and requested_at > now() - interval '60 seconds' limit 1;
    if found then return v_id; end if;
  end if;
  if (select count(*) from public.channel_jobs where kind = 'integration' and requested_by = auth.uid() and requested_at > now() - interval '1 minute') >= 30 then
    raise exception 'Muitas ações seguidas. Aguarde um minuto';
  end if;
  -- QR codes antigos não ficam guardados
  update public.channel_jobs set result = null where kind = 'integration' and result ? 'qr' and finished_at < now() - interval '10 minutes';
  insert into public.channel_jobs (kind, channel, payload, requested_by)
  values ('integration', v_ch, jsonb_build_object('provider', p_provider, 'action', p_action) || v_payload, auth.uid()) returning id into v_id;
  perform public.log_audit('integration_action', 'integration', p_provider || ':' || p_action, '{}'::jsonb);
  return v_id;
end $function$;

-- imagem do produto nos links capturados
create or replace function public.list_captured_links(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select cl.id, cl.created_at, cl.status, cl.reason, cl.platform, cl.original_url, c.title as source_title, c.channel,
           pr.title as product_title, pr.image_url, o.id as offer_id, o.status as offer_status, o.score
      from public.captured_links cl left join public.promo_sources ps on ps.id = cl.source_id left join public.chats c on c.id = ps.chat_id
      left join public.offers o on o.id = cl.offer_id left join public.products pr on pr.id = o.product_id
     order by cl.created_at desc limit least(greatest(p_limit, 1), 300)) x), '[]'::jsonb);
end $$;

-- imagem nos produtos acompanhados
alter table public.watchlist add column if not exists image_url text;
drop function if exists public.watchlist_update(uuid, numeric, text, boolean);
create or replace function public.watchlist_update(p_id uuid, p_price numeric, p_title text, p_offer boolean, p_image text default null) returns void
language sql security definer set search_path = public as $$
  update public.watchlist set last_price = coalesce(p_price, last_price), title = coalesce(left(p_title, 300), title),
         image_url = coalesce(case when p_image ~ '^https://' then left(p_image, 600) end, image_url), last_checked_at = now(),
         last_offer_at = case when p_offer then now() else last_offer_at end where id = p_id
$$;
revoke all on function public.watchlist_update(uuid, numeric, text, boolean, text) from public, anon;
grant execute on function public.watchlist_update(uuid, numeric, text, boolean, text) to service_role;
