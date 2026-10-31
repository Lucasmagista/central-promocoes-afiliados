-- 021 — Enviar para TODOS os grupos + modo automático que realmente aprova sozinho.
--
-- Problemas corrigidos:
--  1. "Modo: Automático" (Configurações) não ligava a aprovação automática: ela dependia de OUTRA chave
--     (auto_approve_enabled). Com isso as ofertas continuavam esperando revisão. Agora mode = 'auto' aprova sozinho
--     tudo que atinge a nota de corte.
--  2. Aprovar com vários destinos era "tudo ou nada": um grupo com problema (categoria, texto longo) derrubava o envio
--     para todos os outros. Agora cada destino é tentado separadamente.
--  3. Sem regra de roteamento, o envio automático ia para todos os destinos ativos; com regra, só para os da regra.
--     A nova chave route_all_destinations (padrão: ligada) manda para TODOS os destinos ativos, sempre.
--
-- Rode no SQL Editor do Supabase, depois da 020.

insert into public.settings (key, value) values ('route_all_destinations', 'true') on conflict (key) do nothing;

-- Aprova a oferta para todos os destinos ativos (ou para a lista dada), pulando os que não aceitam.
create or replace function public.approve_offer_all(p_offer uuid, p_scheduled_for timestamptz default null, p_destinations uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_dest uuid; v_ok integer := 0; v_pubs integer := 0; v_n integer; v_first text;
  v_skipped jsonb := '[]'::jsonb; v_name text;
begin
  perform public.require_operator();
  if p_destinations is not null and cardinality(p_destinations) > 0 then
    v_ids := p_destinations;
  else
    select coalesce(array_agg(id order by channel, created_at), '{}') into v_ids from public.destinations where enabled;
  end if;
  if cardinality(v_ids) = 0 then raise exception 'Nenhum destino ativo. Cadastre e ative um grupo ou canal.'; end if;

  foreach v_dest in array v_ids loop
    begin
      v_n := public.approve_offer(p_offer, array[v_dest], p_scheduled_for);
      v_ok := v_ok + 1; v_pubs := v_pubs + coalesce(v_n, 0);
    exception when others then
      select name into v_name from public.destinations where id = v_dest;
      v_first := coalesce(v_first, sqlerrm);
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('destino', coalesce(v_name, v_dest::text), 'motivo', left(sqlerrm, 160)));
    end;
  end loop;

  if v_ok = 0 then raise exception '%', v_first; end if;
  return jsonb_build_object('destinos_ok', v_ok, 'publicacoes_criadas', v_pubs, 'ignorados', v_skipped);
end $$;

revoke all on function public.approve_offer_all(uuid, timestamptz, uuid[]) from public, anon;
grant execute on function public.approve_offer_all(uuid, timestamptz, uuid[]) to authenticated, service_role;

-- Roteamento: no modo automático toda oferta acima da nota de corte é aprovada; destinos = todos os ativos.
create or replace function public.auto_route_offer(p_offer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o record; pr record; v_slug text; v_dests uuid[] := '{}'; v_auto boolean := false; r record;
  v_thr integer := public.setting_int('auto_approve_threshold', 90); v_rthr integer := public.setting_int('radar_auto_min_score', 70);
  v_all boolean := public.setting_bool('route_all_destinations', true);
begin
  select * into o from public.offers where id = p_offer;
  select * into pr from public.products where id = o.product_id;
  v_slug := public.category_slug(pr.category);
  for r in select * from public.routing_rules where enabled order by priority, created_at loop
    if (cardinality(r.platforms) = 0 or pr.platform = any (r.platforms))
       and (cardinality(r.categories) = 0 or v_slug = any (r.categories))
       and coalesce(o.score, 0) >= r.min_score and coalesce(o.discount_pct, 0) >= r.min_discount_pct then
      v_dests := v_dests || r.destinations;
      if r.auto_approve then v_auto := true; end if;
    end if;
  end loop;
  if not v_auto and o.auto_ok and coalesce(o.score, 0) >= v_rthr then v_auto := true; end if;
  if not v_auto and public.setting_bool('auto_approve_enabled', false) and coalesce(o.score, 0) >= v_thr then v_auto := true; end if;
  -- modo automático = aprova sozinho o que atinge a nota de corte
  if not v_auto and public.setting_text('mode', 'simulation') = 'auto' and coalesce(o.score, 0) >= v_thr then v_auto := true; end if;
  if v_all or cardinality(v_dests) = 0 then select coalesce(array_agg(id), '{}') into v_dests from public.destinations where enabled; end if;
  -- destinos que o administrador restringiu a certas categorias continuam respeitando essa restrição
  select coalesce(array_agg(distinct dd.id), '{}') into v_dests from public.destinations dd
   where dd.id = any (v_dests) and dd.enabled and (cardinality(dd.categories) = 0 or (v_slug is not null and v_slug = any (dd.categories)));
  return jsonb_build_object('auto', v_auto, 'destinations', to_jsonb(v_dests));
end $$;

-- A aprovação automática também tenta cada destino separadamente.
create or replace function public.run_auto_approve(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; v_route jsonb; v_dests uuid[]; v_d uuid; v_n integer := 0; v_err integer := 0; v_ok integer; v_last text;
  v_cap integer := public.setting_int('auto_approve_max_per_day', 20); v_today integer;
begin
  perform public.require_operator();
  if public.setting_bool('paused', false) or public.setting_text('mode', 'simulation') = 'simulation' then
    return jsonb_build_object('approved', 0, 'skipped', 'modo simulação ou pausa');
  end if;
  select count(*) into v_today from public.offers where approved_by is null
     and approved_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') and status in ('scheduled', 'approved', 'published');
  for o in select id from public.offers where status = 'needs_review' and not is_simulated and affiliate_url is not null and availability <> 'out_of_stock'
              and validation_notes::text not like '%Aprovação automática falhou%'
            order by score desc nulls last, created_at limit least(greatest(p_limit, 1), 50) loop
    exit when v_today >= v_cap;
    v_route := public.auto_route_offer(o.id);
    continue when not (v_route ->> 'auto')::boolean;
    select coalesce(array_agg(x::uuid), '{}') into v_dests from jsonb_array_elements_text(v_route -> 'destinations') x;
    continue when cardinality(v_dests) = 0;
    v_ok := 0; v_last := null;
    foreach v_d in array v_dests loop
      begin
        perform public.approve_offer(o.id, array[v_d], null);
        v_ok := v_ok + 1;
      exception when others then v_last := left(sqlerrm, 160);
      end;
    end loop;
    if v_ok > 0 then
      v_n := v_n + 1; v_today := v_today + 1;
    else
      v_err := v_err + 1;
      update public.offers set auto_ok = false, validation_notes = validation_notes || jsonb_build_array('Aprovação automática falhou: ' || coalesce(v_last, 'sem destino')) where id = o.id;
    end if;
  end loop;
  return jsonb_build_object('approved', v_n, 'errors', v_err);
end $$;
