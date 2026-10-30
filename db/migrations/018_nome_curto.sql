-- =============================================================================
-- 018 — Nome curto do produto na mensagem
-- Títulos de marketplace têm 100-200 caracteres ("Clipes de cabo organizador gota suporte de fio
-- gerenciamento de cabo auto-adesivo ..."). A mensagem passa a levar um nome curto, no estilo dos canais
-- de ofertas: "Monitor Gamer ARZOPA M1RC, 27" 2K QHD 180Hz IPS, 1ms".
--   {{title}}      = nome curto (limite em settings.title_max_chars, padrão 70)
--   {{full_title}} = título completo, para quem preferir
-- Também corrige o limite de legenda do Telegram: o limite de 1024 vale para o texto VISÍVEL (sem as
-- marcas <a href="..."> e sem o endereço do link, que fica fora da contagem). Antes o banco contava o HTML
-- inteiro e recusava ofertas que o Telegram aceitaria.
-- Funções redefinidas por inteiro (idempotente), sem remendo de texto.
-- =============================================================================

insert into public.settings (key, value) values ('title_max_chars', '70') on conflict (key) do nothing;

-- Nome curto: corta no último separador ou palavra inteira, sem terminar em "de", "para", "com"...
create or replace function public.short_title(p_title text, p_max integer default 70) returns text
language plpgsql immutable set search_path = public as $$
declare t text; m integer; cut text; sep text; i integer;
begin
  t := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  m := greatest(coalesce(p_max, 70), 20);
  if length(t) <= m then return t; end if;
  if substr(t, m + 1, 1) = ' ' then cut := left(t, m); else cut := regexp_replace(left(t, m), '\s+\S*$', ''); end if;
  sep := regexp_replace(cut, '\s*[,;|]\s*[^,;|]*$', '');
  if sep <> cut and length(sep) >= m * 0.55 then cut := sep; end if;
  for i in 1..4 loop
    cut := regexp_replace(cut, '[\s,;:|/+&-]+$', '');
    cut := regexp_replace(cut, '\s+(de|da|do|das|dos|para|pra|com|e|em|p/|c/|a|o|ou|no|na|por)$', '', 'i');
  end loop;
  if length(regexp_replace(cut, '[^(]', '', 'g')) > length(regexp_replace(cut, '[^)]', '', 'g')) then cut := btrim(regexp_replace(cut, '\([^)]*$', '')); end if;
  if length(cut) < 3 then cut := left(t, m); end if;
  return cut;
end $$;

-- Tamanho do texto como o Telegram conta: sem marcas HTML e com as entidades já desfeitas.
create or replace function public.visible_length(p_text text) returns integer
language sql immutable set search_path = public as $$
  select length(replace(replace(replace(replace(replace(
    regexp_replace(coalesce(p_text, ''), '<[^>]*>', '', 'g'),
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'))
$$;

CREATE OR REPLACE FUNCTION public.render_offer_text(p_offer uuid, p_destination uuid, p_short_code text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record; pr record; d record; c record;
  t text; v_vars jsonb; v_line text; v_out text[] := '{}'; v_drop boolean; v_res text; m record;
  v_val text; v_base text; v_url text; v_prevline text; v_disc text; v_esc boolean; v_tz text := 'America/Sao_Paulo';
begin
  select * into o from public.offers where id = p_offer;
  select * into d from public.destinations where id = p_destination;
  if o.id is null or d.id is null then raise exception 'oferta ou destino inexistente'; end if;
  select * into pr from public.products where id = o.product_id;
  select * into c from public.connectors where platform = pr.platform;
  select body into t from public.templates where channel = d.channel and kind = 'offer' and active;
  if t is null then raise exception 'Sem template ativo de oferta para %', d.channel; end if;
  t := public.spin_text(t);

  v_base := public.setting_text('shortlink_base', '');
  if coalesce(c.use_short_link, true) and v_base <> '' then
    v_url := rtrim(v_base, '/') || '/' || coalesce(p_short_code, 'abc123xy');
  else
    v_url := o.affiliate_url;
  end if;

  v_prevline := '';
  if o.previous_price is not null and o.discount_pct is not null then
    v_prevline := case o.previous_price_source
      when 'own_history' then 'Já registramos por ' || public.fmt_brl(o.previous_price)
      else 'Antes: ' || public.fmt_brl(o.previous_price) end
      || ' (-' || trim(trailing '.' from trim(trailing '0' from o.discount_pct::text)) || '%)';
  end if;

  v_vars := jsonb_build_object(
    'title', public.short_title(pr.title, public.setting_int('title_max_chars', 70)),
    'full_title', pr.title,
    'price', public.fmt_brl(o.current_price),
    'previous_line', v_prevline,
    'coupon_line', case when o.coupon_code is not null and o.coupon_confirmed then 'Cupom: ' || o.coupon_code else '' end,
    'observed_at', to_char(o.price_observed_at at time zone v_tz, 'DD/MM "às" HH24:MI'),
    'url', coalesce(v_url, ''),
    'disclosure', public.setting_text('affiliate_disclosure', ''),
    'category', coalesce(pr.category, ''),
    'seller', coalesce(pr.seller_name, ''));

  v_esc := d.channel = 'telegram';
  foreach v_line in array string_to_array(t, E'\n') loop
    v_drop := false; v_res := v_line;
    for m in select distinct (regexp_matches(v_line, '\{\{([a-z_]+)\}\}', 'g'))[1] as name loop
      v_val := coalesce(v_vars ->> m.name, '');
      if v_val = '' then v_drop := true; exit; end if;
      if v_esc then
        v_val := replace(replace(replace(replace(v_val, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
      end if;
      v_res := replace(v_res, '{{' || m.name || '}}', v_val);
    end loop;
    if not v_drop then v_out := v_out || v_res; end if;
  end loop;

  v_res := array_to_string(v_out, E'\n');
  if position('{{disclosure}}' in t) = 0 and (v_vars ->> 'disclosure') <> '' then
    v_res := v_res || E'\n\n' || case when v_esc then '<i>' || (v_vars ->> 'disclosure') || '</i>' else (v_vars ->> 'disclosure') end;
  end if;
  v_res := btrim(regexp_replace(v_res, E'\n{3,}', E'\n\n', 'g'));
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION public.approve_offer(p_offer uuid, p_destinations uuid[], p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record; pr record; d record; c record;
  v_count integer := 0; v_id uuid; v_code text; v_text text; v_viol text[]; v_key text;
  v_base text := public.setting_text('shortlink_base', ''); v_dest uuid; v_ins integer; v_limit integer;
begin
  perform public.require_operator();
  select * into o from public.offers where id = p_offer for update;
  if not found then raise exception 'Oferta inexistente'; end if;
  if o.status not in ('needs_review', 'approved', 'scheduled') then
    raise exception 'Oferta em estado % não pode ser aprovada', o.status;
  end if;
  if o.affiliate_url is null then raise exception 'Oferta sem link de afiliado'; end if;
  select * into pr from public.products where id = o.product_id;
  if not public.host_allowed(pr.platform, o.affiliate_url) then
    raise exception 'Link de afiliado fora dos domínios permitidos';
  end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'Oferta vencida'; end if;
  if o.availability = 'out_of_stock' then raise exception 'Oferta sem estoque'; end if;
  if p_destinations is null or cardinality(p_destinations) = 0 then
    raise exception 'Selecione ao menos um destino';
  end if;
  select * into c from public.connectors where platform = pr.platform;
  if not o.is_simulated and (c.id is null or c.mode in ('disabled', 'paused_policy', 'error')) then
    raise exception 'Conector de % indisponível (estado: %)', pr.platform, coalesce(c.mode, 'inexistente');
  end if;

  foreach v_dest in array p_destinations loop
    select * into d from public.destinations where id = v_dest;
    if not found then raise exception 'Destino inexistente'; end if;
    if not d.enabled then raise exception 'Destino "%" está desabilitado', d.name; end if;
    if cardinality(d.categories) > 0 and (public.category_slug(pr.category) is null or not (public.category_slug(pr.category) = any (d.categories))) then
      raise exception 'Categoria da oferta não é aceita pelo destino "%"', d.name;
    end if;

    v_key := p_offer::text || ':' || v_dest::text || ':1';
    if exists (select 1 from public.publications where idempotency_key = v_key) then continue; end if;

    v_id := gen_random_uuid();
    v_code := substr(md5(random()::text || clock_timestamp()::text || v_id::text), 1, 8);
    v_text := public.render_offer_text(p_offer, v_dest, v_code);
    v_viol := public.text_violations(v_text);
    if cardinality(v_viol) > 0 then
      raise exception 'Texto contém termos proibidos: %', array_to_string(v_viol, ', ');
    end if;
    v_limit := case when pr.image_url is not null then 1024 else 4096 end;
    if d.channel = 'telegram' and public.visible_length(v_text) > v_limit then
      raise exception 'Texto excede o limite do Telegram (% de % caracteres)', public.visible_length(v_text), v_limit;
    end if;

    insert into public.publications
      (id, offer_id, destination_id, content_version, rendered_text, status, idempotency_key,
       scheduled_for, next_attempt_at)
    values (v_id, p_offer, v_dest, 1, v_text, 'pending', v_key,
            coalesce(p_scheduled_for, now()), coalesce(p_scheduled_for, now()))
    on conflict (idempotency_key) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 1 then
      if coalesce(c.use_short_link, true) and v_base <> '' then
        insert into public.short_links (code, publication_id, target_url) values (v_code, v_id, o.affiliate_url);
      end if;
      v_count := v_count + 1;
    end if;
  end loop;

  update public.offers
     set status = 'scheduled', approved_by = coalesce(auth.uid(), approved_by), approved_at = now()
   where id = p_offer;
  perform public.log_audit('offer_approved', 'offer', p_offer::text,
    jsonb_build_object('destinos', to_jsonb(p_destinations), 'publicacoes_criadas', v_count,
                       'agendada_para', p_scheduled_for));
  return v_count;
end $function$;
