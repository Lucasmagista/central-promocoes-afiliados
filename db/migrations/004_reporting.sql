-- ============================================================================
-- 004_reporting.sql — leitura agregada para o painel (sempre exige membro ativo)
-- ============================================================================

create or replace function public.dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_res jsonb; v_alerts jsonb := '[]'::jsonb;
  v_unknown integer; v_failed integer; v_paused boolean; v_oldest numeric; v_enabled integer;
  c record; h record;
begin
  if not public.is_member() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_paused := public.setting_bool('paused', false);

  select count(*) into v_unknown from public.publications where status = 'unknown';
  select count(*) into v_failed from public.publications where status = 'failed_permanent';
  select count(*) into v_enabled from public.destinations where enabled;
  select extract(epoch from (now() - min(created_at))) / 60 into v_oldest
    from public.offers where status = 'needs_review';

  if v_paused then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'warning', 'code', 'paused',
      'message', 'Publicação pausada globalmente: nada é enviado até você retomar.'));
  end if;
  if v_unknown > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'critical', 'code', 'unknown',
      'message', v_unknown || ' envio(s) em estado unknown aguardando reconciliação manual.'));
  end if;
  if v_failed > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'warning', 'code', 'failed',
      'message', v_failed || ' publicação(ões) com falha permanente.'));
  end if;
  if v_oldest is not null and v_oldest > 24 * 60 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'warning', 'code', 'stale_review',
      'message', 'Há ofertas aguardando revisão há mais de 24 h.'));
  end if;
  if v_enabled = 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'info', 'code', 'no_destination',
      'message', 'Nenhum destino habilitado. Cadastre e teste um destino para publicar.'));
  end if;
  for c in select * from public.connectors loop
    if c.mode = 'paused_policy' then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'critical', 'code', 'connector_paused',
        'message', c.display_name || ' pausado por política: revise os termos antes de retomar.'));
    elsif c.mode = 'error' then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'critical', 'code', 'connector_error',
        'message', c.display_name || ' em erro: ' || coalesce(c.last_error, 'sem detalhe')));
    end if;
    if c.mode <> 'disabled' and c.review_due_at is not null and c.review_due_at < now() then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'warning', 'code', 'review_due',
        'message', 'Revisão de termos de ' || c.display_name || ' vencida.'));
    end if;
  end loop;
  for h in select * from public.heartbeats where last_seen < now() - interval '5 minutes' loop
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object('level', 'critical', 'code', 'heartbeat',
      'message', 'Serviço ' || h.service || ' sem sinal há mais de 5 minutos.'));
  end loop;

  select jsonb_build_object(
    'paused', v_paused,
    'mode', public.setting_text('mode', 'simulation'),
    'offers', (select jsonb_build_object(
        'needs_review', count(*) filter (where status = 'needs_review'),
        'scheduled', count(*) filter (where status = 'scheduled'),
        'created_24h', count(*) filter (where created_at > now() - interval '24 hours'),
        'published_24h', count(*) filter (where status = 'published' and updated_at > now() - interval '24 hours'),
        'rejected_24h', count(*) filter (where status = 'rejected' and updated_at > now() - interval '24 hours'))
      from public.offers),
    'publications', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('pending', 'retry_scheduled')),
        'unknown', count(*) filter (where status = 'unknown'),
        'failed', count(*) filter (where status = 'failed_permanent'),
        'sent_24h', count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours'),
        'sent_prev_24h', count(*) filter (where status = 'sent' and sent_at > now() - interval '48 hours'
                                          and sent_at <= now() - interval '24 hours'))
      from public.publications),
    'clicks', (select jsonb_build_object(
        'last_24h', count(*) filter (where clicked_at > now() - interval '24 hours'),
        'prev_24h', count(*) filter (where clicked_at > now() - interval '48 hours'
                                     and clicked_at <= now() - interval '24 hours'))
      from public.click_events),
    'approval_rate_7d', (select case when count(*) filter (where status in ('scheduled', 'published', 'rejected')) = 0
        then null else round(100.0 * count(*) filter (where status in ('scheduled', 'published'))
             / count(*) filter (where status in ('scheduled', 'published', 'rejected')), 1) end
      from public.offers where created_at > now() - interval '7 days'),
    'oldest_review_minutes', v_oldest,
    'connectors', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', platform, 'display_name', display_name, 'mode', mode,
        'review_due_at', review_due_at, 'last_success_at', last_success_at, 'last_error_at', last_error_at)
        order by platform) from public.connectors), '[]'::jsonb),
    'destinations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'channel', d.channel, 'enabled', d.enabled, 'max_per_day', d.max_per_day,
        'sent_24h', (select count(*) from public.publications p
                      where p.destination_id = d.id and p.status = 'sent' and p.sent_at > now() - interval '24 hours'))
        order by d.name) from public.destinations d), '[]'::jsonb),
    'heartbeats', coalesce((select jsonb_agg(jsonb_build_object(
        'service', service, 'status', status, 'last_seen', last_seen,
        'age_seconds', extract(epoch from (now() - last_seen))::integer) order by service)
      from public.heartbeats), '[]'::jsonb),
    'alerts', v_alerts
  ) into v_res;
  return v_res;
end $$;

create or replace function public.analytics_overview(p_days integer default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public.setting_text('timezone', 'America/Sao_Paulo');
  v_from timestamptz; v_days integer := greatest(1, least(coalesce(p_days, 14), 90)); v_res jsonb;
begin
  if not public.is_member() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_from := date_trunc('day', now() at time zone v_tz) at time zone v_tz - make_interval(days => v_days - 1);

  with days as (
    select (generate_series(0, v_days - 1) * interval '1 day' + (v_from at time zone v_tz))::date as day
  ), sent as (
    select (sent_at at time zone v_tz)::date as day, count(*) n
      from public.publications where status = 'sent' and sent_at >= v_from group by 1
  ), clicks as (
    select (clicked_at at time zone v_tz)::date as day, count(*) n
      from public.click_events where clicked_at >= v_from group by 1
  ), by_channel as (
    select d.channel,
           count(distinct p.id) filter (where p.status = 'sent' and p.sent_at >= v_from) as sent,
           count(ce.id) filter (where ce.clicked_at >= v_from) as clicks
      from public.destinations d
      left join public.publications p on p.destination_id = d.id
      left join public.short_links sl on sl.publication_id = p.id
      left join public.click_events ce on ce.code = sl.code
     group by d.channel
  ), by_platform as (
    select pr.platform, count(ce.id) as clicks, count(distinct p.id) filter (where p.status = 'sent') as sent
      from public.click_events ce
      join public.short_links sl on sl.code = ce.code
      join public.publications p on p.id = sl.publication_id
      join public.offers o on o.id = p.offer_id
      join public.products pr on pr.id = o.product_id
     where ce.clicked_at >= v_from group by pr.platform
  ), by_category as (
    select coalesce(pr.category, 'Sem categoria') as category, count(ce.id) as clicks
      from public.click_events ce
      join public.short_links sl on sl.code = ce.code
      join public.publications p on p.id = sl.publication_id
      join public.offers o on o.id = p.offer_id
      join public.products pr on pr.id = o.product_id
     where ce.clicked_at >= v_from group by 1
  ), top as (
    select o.id as offer_id, pr.title, pr.platform, o.current_price, count(ce.id) as clicks
      from public.click_events ce
      join public.short_links sl on sl.code = ce.code
      join public.publications p on p.id = sl.publication_id
      join public.offers o on o.id = p.offer_id
      join public.products pr on pr.id = o.product_id
     where ce.clicked_at >= v_from group by o.id, pr.title, pr.platform, o.current_price
     order by clicks desc limit 10
  )
  select jsonb_build_object(
    'days', v_days,
    'series', (select jsonb_agg(jsonb_build_object('day', d.day, 'sent', coalesce(s.n, 0), 'clicks', coalesce(c.n, 0)) order by d.day)
               from days d left join sent s on s.day = d.day left join clicks c on c.day = d.day),
    'by_channel', coalesce((select jsonb_agg(to_jsonb(b)) from by_channel b), '[]'::jsonb),
    'by_platform', coalesce((select jsonb_agg(to_jsonb(b)) from by_platform b), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(to_jsonb(b) order by b.clicks desc) from by_category b), '[]'::jsonb),
    'top_offers', coalesce((select jsonb_agg(to_jsonb(t) order by t.clicks desc) from top t), '[]'::jsonb),
    'funnel', jsonb_build_object(
      'ingested', (select count(*) from public.offers where created_at >= v_from),
      'approved', (select count(*) from public.offers where approved_at >= v_from),
      'published', (select count(*) from public.publications where status = 'sent' and sent_at >= v_from),
      'clicked', (select count(distinct sl.publication_id) from public.click_events ce
                    join public.short_links sl on sl.code = ce.code where ce.clicked_at >= v_from))
  ) into v_res;
  return v_res;
end $$;
