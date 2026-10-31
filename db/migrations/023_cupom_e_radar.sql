-- 023 — Cupom com link de resgate e ofertas do Radar sem API.
--
-- 1) Muitos grupos mandam "use o cupom X" e um link para RESGATAR o cupom antes de comprar. A oferta agora guarda o código e o
--    link de resgate (coupon_url) e o texto sai com as duas linhas. Só entra link de cupom da própria loja (nunca de afiliado de terceiros).
-- 2) set_offer_coupon: usado pelo Radar quando a mensagem do grupo traz cupom.
-- Rode no SQL Editor do Supabase, depois da 022.

alter table public.offers add column if not exists coupon_url text;

create or replace function public.set_offer_coupon(p_offer uuid, p_code text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text := nullif(upper(btrim(coalesce(p_code, ''))), ''); v_url text := nullif(btrim(coalesce(p_url, '')), ''); v_platform text;
begin
  select pr.platform into v_platform from public.offers o join public.products pr on pr.id = o.product_id where o.id = p_offer;
  if not found then return; end if;
  if v_url is not null and (v_url !~* '^https://' or length(v_url) > 600 or not public.host_allowed(v_platform, v_url)) then v_url := null; end if;
  if v_code is not null and v_code !~ '^[A-Z0-9]{4,20}$' then v_code := null; end if;
  if v_code is null and v_url is null then return; end if;
  update public.offers set
    coupon_code = coalesce(v_code, coupon_code),
    coupon_confirmed = coalesce(v_code, coupon_code) is not null,
    coupon_url = coalesce(v_url, coupon_url)
  where id = p_offer and status in ('needs_review', 'approved', 'scheduled');
end $$;
revoke all on function public.set_offer_coupon(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_offer_coupon(uuid, text, text) to service_role;

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
    'coupon_line', case
      when o.coupon_code is not null and o.coupon_confirmed then '🎟️ Cupom: ' || o.coupon_code || case when o.coupon_url is not null then E'\n👉 Resgate o cupom aqui: ' || o.coupon_url else '' end
      when o.coupon_url is not null then '🎟️ Resgate o cupom aqui: ' || o.coupon_url
      else '' end,
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

-- 3) Telegram: mensagens encaminhadas ao bot viram "grupos" de origem (external_id fwd:...) que servem só como fonte do Radar,
--    nunca como destino de envio.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'destinations_not_forwarded') then
    alter table public.destinations add constraint destinations_not_forwarded check (external_id not like 'fwd:%');
  end if;
end $$;
