-- ============================================================================
-- 005_security_and_seed.sql — RLS, permissões, gatilhos de auditoria e padrões.
-- ============================================================================

-- ---------- Gatilhos ----------------------------------------------------------
create trigger trg_auth_new_user after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger trg_audit_destinations after insert or update or delete on public.destinations
  for each row execute function public.audit_row_change();
create trigger trg_audit_templates after insert or update or delete on public.templates
  for each row execute function public.audit_row_change();
create trigger trg_audit_connectors after insert or update or delete on public.connectors
  for each row execute function public.audit_row_change();
create trigger trg_audit_profiles after update on public.profiles
  for each row execute function public.audit_row_change();

-- Versão do template sobe a cada alteração do corpo.
create or replace function public.bump_template_version() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body then
    new.version := old.version + 1;
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;
create trigger trg_templates_version before update on public.templates
  for each row execute function public.bump_template_version();

-- ---------- RLS ---------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.connectors         enable row level security;
alter table public.products           enable row level security;
alter table public.price_observations enable row level security;
alter table public.offers             enable row level security;
alter table public.destinations       enable row level security;
alter table public.destination_tests  enable row level security;
alter table public.templates          enable row level security;
alter table public.publications       enable row level security;
alter table public.short_links        enable row level security;
alter table public.click_events       enable row level security;
alter table public.audit_events       enable row level security;
alter table public.runs               enable row level security;
alter table public.settings           enable row level security;
alter table public.heartbeats         enable row level security;

-- Leitura: qualquer membro ativo.
create policy read_member on public.connectors         for select to authenticated using (public.is_member());
create policy read_member on public.products           for select to authenticated using (public.is_member());
create policy read_member on public.price_observations for select to authenticated using (public.is_member());
create policy read_member on public.offers             for select to authenticated using (public.is_member());
create policy read_member on public.destinations       for select to authenticated using (public.is_member());
create policy read_member on public.destination_tests  for select to authenticated using (public.is_member());
create policy read_member on public.templates          for select to authenticated using (public.is_member());
create policy read_member on public.publications       for select to authenticated using (public.is_member());
create policy read_member on public.short_links        for select to authenticated using (public.is_member());
create policy read_member on public.click_events       for select to authenticated using (public.is_member());
create policy read_member on public.audit_events       for select to authenticated using (public.is_member());
create policy read_member on public.runs               for select to authenticated using (public.is_member());
create policy read_member on public.settings           for select to authenticated using (public.is_member());
create policy read_member on public.heartbeats         for select to authenticated using (public.is_member());

-- Perfis: cada um vê o próprio; administrador vê todos (precisa para aprovar contas).
create policy read_self_or_admin on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Escrita direta só do administrador, e só nas tabelas de configuração.
create policy admin_write on public.destinations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy admin_write on public.templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy admin_write on public.connectors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Permissões ---------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.destinations, public.templates to authenticated;
grant update on public.connectors to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Auxiliares de RLS e leitura
grant execute on function public.app_role(), public.is_admin(), public.can_operate(), public.is_member()
  to authenticated;
-- Painel (RBAC verificado dentro de cada função)
grant execute on function
  public.set_paused(boolean, text), public.set_setting(text, jsonb), public.ingest_offer(jsonb),
  public.render_offer_text(uuid, uuid, text), public.approve_offer(uuid, uuid[], timestamptz),
  public.reject_offer(uuid, text), public.set_offer_affiliate_url(uuid, text), public.resolve_unknown(uuid, text, text),
  public.cancel_publication(uuid), public.retry_publication(uuid), public.edit_publication_text(uuid, text),
  public.request_destination_test(uuid), public.set_profile(uuid, text, boolean),
  public.dashboard_summary(), public.analytics_overview(integer), public.text_violations(text)
  to authenticated;
-- Somente o dono do banco executa:
revoke all on function public.bootstrap_admin(text) from service_role;

-- ---------- Padrões -------------------------------------------------------------
insert into public.settings (key, value) values
  ('paused', 'false'),
  ('mode', '"simulation"'),
  ('timezone', '"America/Sao_Paulo"'),
  ('auto_approve_enabled', 'false'),
  ('auto_approve_threshold', '90'),
  ('max_price_age_minutes', '720'),
  ('dedupe_window_hours', '72'),
  ('republish_drop_pct', '10'),
  ('min_history_observations', '5'),
  ('min_history_days', '3'),
  ('max_attempts', '5'),
  ('claim_lock_seconds', '120'),
  ('review_interval_days', '30'),
  ('retention_days_clicks', '180'),
  ('retention_days_audit', '365'),
  ('shortlink_base', '""'),
  ('affiliate_disclosure',
   '"Esta publicação contém link de afiliado; posso receber comissão por compras qualificadas, sem custo adicional para você. Preço e estoque podem mudar."'),
  ('banned_terms',
   '["garantido","últimas unidades","ultimas unidades","corre","corra","menor preço da história","menor preço da historia","só hoje","acaba hoje","última chance","ultima chance","vai acabar"]'),
  ('allowed_domains',
   '{"mercadolivre":["mercadolivre.com.br"],"shopee":["shopee.com.br"],"amazon":["amazon.com.br"]}')
on conflict (key) do nothing;

insert into public.connectors (platform, display_name, mode) values
  ('mercadolivre', 'Mercado Livre', 'disabled'),
  ('shopee', 'Shopee', 'disabled'),
  ('amazon', 'Amazon Brasil', 'disabled'),
  ('network', 'Redes de afiliados', 'disabled')
on conflict (platform) do nothing;

insert into public.templates (channel, kind, name, body) values
  ('telegram', 'offer', 'Oferta — Telegram (HTML)',
E'<b>{{title}}</b>\n\n💰 {{price}}\n{{previous_line}}\n{{coupon_line}}\n🕒 Preço visto em {{observed_at}}\n\n🛒 <a href="{{url}}">Ver oferta</a>\n\n<i>{{disclosure}}</i>'),
  ('whatsapp', 'offer', 'Oferta — WhatsApp',
E'*{{title}}*\n\n💰 {{price}}\n{{previous_line}}\n{{coupon_line}}\n🕒 Preço visto em {{observed_at}}\n\n🛒 {{url}}\n\n_{{disclosure}}_')
on conflict do nothing;
