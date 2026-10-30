-- =============================================================================
-- 019 — Envio por canal em paralelo + link curto nas ofertas já aprovadas
--
-- 1. claim_next_publication ganha o parâmetro opcional p_channel ('telegram' | 'whatsapp').
--    O worker passa a ter uma "pista" por canal, rodando ao mesmo tempo: a espera entre mensagens
--    do WhatsApp (que existe para proteger o número) deixa de atrasar o Telegram, e cada grupo
--    continua respeitando o seu próprio limite e intervalo. Sem o parâmetro, funciona como antes.
-- 2. reshorten_pending(): ofertas aprovadas ANTES de o link curto ser configurado ficaram com o link
--    de afiliado inteiro dentro do texto. Esta função troca o link comprido pelo curto nas
--    publicações que ainda não saíram (pendentes), criando o código no redirecionador.
--    O worker a chama sozinho; é segura para repetir (só mexe no que ainda tem o link comprido).
-- =============================================================================

drop function if exists public.claim_next_publication(text);

create or replace function public.claim_next_publication(p_worker text, p_channel text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record; d record; v_mode text; v_now_local time;
  v_hour integer; v_day integer; v_last timestamptz; v_quiet boolean;
  v_lock integer := public.setting_int('claim_lock_seconds', 120);
  v_tz text := public.setting_text('timezone', 'America/Sao_Paulo');
  v_claimed public.publications;
begin
  if public.setting_bool('paused', false) then return null; end if;
  v_mode := public.setting_text('mode', 'simulation');
  v_now_local := (now() at time zone v_tz)::time;

  for r in
    select p.id, p.destination_id
      from public.publications p
      join public.offers o on o.id = p.offer_id
      join public.destinations dd on dd.id = p.destination_id
     where p.status in ('pending', 'retry_scheduled')
       and p.next_attempt_at <= now()
       and dd.enabled
       and (p_channel is null or dd.channel = p_channel)
       and (o.expires_at is null or o.expires_at > now())
       and o.status in ('scheduled', 'approved')
       and (o.is_simulated or v_mode in ('review', 'auto'))
     order by p.next_attempt_at, p.created_at
       for update of p skip locked
  loop
    -- Serializa a avaliação de limites por destino (evita estourar o limite sob concorrência).
    if not pg_try_advisory_xact_lock(hashtextextended(r.destination_id::text, 7)) then continue; end if;

    select * into d from public.destinations where id = r.destination_id;
    if d.quiet_start is not null and d.quiet_end is not null then
      v_quiet := case when d.quiet_start < d.quiet_end
                      then v_now_local >= d.quiet_start and v_now_local < d.quiet_end
                      else v_now_local >= d.quiet_start or v_now_local < d.quiet_end end;
      if v_quiet then continue; end if;
    end if;

    select count(*) filter (where coalesce(sent_at, claimed_at) > now() - interval '1 hour'),
           count(*) filter (where coalesce(sent_at, claimed_at) > now() - interval '24 hours'),
           max(coalesce(sent_at, claimed_at))
      into v_hour, v_day, v_last
      from public.publications
     where destination_id = r.destination_id and status in ('claimed', 'sent', 'unknown');
    if v_hour >= d.max_per_hour or v_day >= d.max_per_day then continue; end if;
    if v_last is not null and v_last > now() - make_interval(secs => d.min_interval_s) then continue; end if;

    update public.publications
       set status = 'claimed', attempt_count = attempt_count + 1, claimed_at = now(),
           locked_by = p_worker, locked_until = now() + make_interval(secs => v_lock)
     where id = r.id
    returning * into v_claimed;

    return (
      select jsonb_build_object(
        'publication_id', v_claimed.id, 'offer_id', v_claimed.offer_id,
        'destination_id', v_claimed.destination_id, 'channel', d.channel,
        'external_chat_id', d.external_id, 'rendered_text', v_claimed.rendered_text,
        'idempotency_key', v_claimed.idempotency_key, 'attempt', v_claimed.attempt_count,
        'is_simulated', o.is_simulated, 'image_url', pr.image_url, 'title', pr.title)
      from public.offers o join public.products pr on pr.id = o.product_id
      where o.id = v_claimed.offer_id);
  end loop;
  return null;
end $function$;

revoke all on function public.claim_next_publication(text, text) from public, anon, authenticated;
grant execute on function public.claim_next_publication(text, text) to service_role;

create or replace function public.reshorten_pending() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.setting_text('shortlink_base', ''); r record;
  v_code text; v_url text; v_esc text; v_new text; n integer := 0;
begin
  if v_base = '' then return 0; end if;
  for r in
    select p.id as pid, p.rendered_text as txt, o.affiliate_url as aff
      from public.publications p
      join public.offers o on o.id = p.offer_id
      join public.products pr on pr.id = o.product_id
      left join public.connectors c on c.platform = pr.platform
     where p.status in ('pending', 'retry_scheduled')
       and coalesce(c.use_short_link, true)
       and coalesce(o.affiliate_url, '') <> ''
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
