-- 022 — Link direto de afiliado quando ele já é curto.
--
-- Os links de afiliado do Mercado Livre (meli.la) e da Shopee (s.shopee.com.br) já são curtos e confiáveis. Passar por
-- um redirecionador próprio (worker.../r/código) escondia o link de afiliado, parecia suspeito (o Telegram mostra
-- "Abrir Link" com o endereço do worker) e fazia o pessoal não clicar. Agora esses links vão DIRETOS na mensagem.
-- Links longos (Amazon, etc.) continuam usando o link curto do worker, se configurado.
-- Para forçar o link do worker em tudo, ligue a chave shortlink_force.
-- Rode no SQL Editor do Supabase, depois da 021.

insert into public.settings (key, value) values ('shortlink_force', 'false') on conflict (key) do nothing;

create or replace function public.is_short_affiliate(p_url text) returns boolean
language sql stable set search_path = public as $$
  select not public.setting_bool('shortlink_force', false)
     and coalesce(p_url, '') ~* '^https?://(meli\.la|s\.shopee\.com\.br|shope\.ee|amzn\.to|a\.aliexpress\.com|s\.click\.aliexpress\.com)/'
$$;
grant execute on function public.is_short_affiliate(text) to authenticated, service_role;

create or replace function public.render_offer_text(p_offer uuid, p_destination uuid, p_short_code text DEFAULT NULL::text)
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
  if coalesce(c.use_short_link, true) and v_base <> '' and not public.is_short_affiliate(o.affiliate_url) then
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
    'title', coalesce(nullif(btrim(o.ai_headline), ''), public.short_title(pr.title, public.setting_int('title_max_chars', 70))),
    'ai_text', coalesce(btrim(o.ai_body), ''),
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
      if coalesce(c.use_short_link, true) and v_base <> '' and not public.is_short_affiliate(o.affiliate_url) then
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

-- Reescreve as publicações que ainda não saíram: troca o link do worker pelo link de afiliado direto.
create or replace function public.reshorten_pending() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.setting_text('shortlink_base', ''); r record;
  v_code text; v_url text; v_esc text; v_new text; n integer := 0; v_old text;
begin
  -- 1) links que já são curtos: volta para o link direto
  for r in
    select p.id as pid, p.rendered_text as txt, o.affiliate_url as aff, s.code as code
      from public.publications p
      join public.offers o on o.id = p.offer_id
      join public.short_links s on s.publication_id = p.id
     where p.status in ('pending', 'retry_scheduled') and public.is_short_affiliate(o.affiliate_url)
       for update of p skip locked
  loop
    v_old := rtrim(v_base, '/') || '/' || r.code;
    v_new := replace(r.txt, v_old, r.aff);
    update public.publications set rendered_text = v_new, updated_at = now() where id = r.pid;
    delete from public.short_links where publication_id = r.pid;
    n := n + 1;
  end loop;

  if v_base = '' then return n; end if;
  -- 2) links longos: usa o link curto do worker
  for r in
    select p.id as pid, p.rendered_text as txt, o.affiliate_url as aff
      from public.publications p
      join public.offers o on o.id = p.offer_id
      join public.products pr on pr.id = o.product_id
      left join public.connectors c on c.platform = pr.platform
     where p.status in ('pending', 'retry_scheduled')
       and coalesce(c.use_short_link, true)
       and coalesce(o.affiliate_url, '') <> ''
       and not public.is_short_affiliate(o.affiliate_url)
       and not exists (select 1 from public.short_links s where s.publication_id = p.id)
       for update of p skip locked
  loop
    v_esc := replace(replace(replace(replace(r.aff, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
    v_code := substr(md5(random()::text || clock_timestamp()::text || r.pid::text), 1, 8);
    v_url := rtrim(v_base, '/') || '/' || v_code;
    v_new := replace(replace(r.txt, v_esc, v_url), r.aff, v_url);
    if v_new = r.txt then continue; end if;
    insert into public.short_links (code, publication_id, target_url) values (v_code, r.pid, r.aff);
    update public.publications set rendered_text = v_new, updated_at = now() where id = r.pid;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.reshorten_pending() from public, anon, authenticated;
grant execute on function public.reshorten_pending() to service_role;

select public.reshorten_pending();
