-- ============================================================================
-- 011 — Provedores de banco e atualização controlada de migrações
--
-- Este arquivo é o bootstrap da atualização automática. Aplique-o uma vez no
-- SQL Editor. Depois disso o worker pode aplicar somente arquivos posteriores,
-- usando token da Management API guardado apenas no cofre de segredos.
-- ============================================================================

create table if not exists public.app_schema_migrations (
  version text primary key check (version ~ '^\\d{3}_[a-z0-9_]+\\.sql$'),
  applied_at timestamptz not null default now(),
  applied_by text not null default 'bootstrap',
  checksum text
);
alter table public.app_schema_migrations enable row level security;
revoke all on public.app_schema_migrations from public, anon;
grant select on public.app_schema_migrations to authenticated;
grant all on public.app_schema_migrations to service_role;
create policy read_member on public.app_schema_migrations for select to authenticated using (public.is_member());

insert into public.app_schema_migrations(version, applied_by) values
  ('001_schema.sql', 'bootstrap'), ('002_core_functions.sql', 'bootstrap'),
  ('003_publication_functions.sql', 'bootstrap'), ('004_reporting.sql', 'bootstrap'),
  ('005_security_and_seed.sql', 'bootstrap'), ('006_chats.sql', 'bootstrap'),
  ('007_categorias_grupos_conectores.sql', 'bootstrap'), ('008_integracoes.sql', 'bootstrap'),
  ('009_grupos_acoes.sql', 'bootstrap'), ('010_n8n_testes.sql', 'bootstrap'),
  ('011_database_providers.sql', 'bootstrap')
on conflict (version) do nothing;

insert into public.settings(key, value) values
  ('int_database', '{"provider":"supabase","project_ref":"","api_url":"","migration_mode":"manual"}'::jsonb)
on conflict (key) do nothing;

-- Só nomes e estado são retornados ao painel. O token da Management API nunca sai
-- de integration_secrets e não é enviado pelo get_database_overview.
create or replace function public.get_database_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb;
begin
  if not public.is_member() then raise exception 'Sem permissão' using errcode = '42501'; end if;
  select value into cfg from public.settings where key = 'int_database';
  return jsonb_build_object(
    'config', coalesce(cfg, '{}'::jsonb),
    'migration_count', (select count(*) from public.app_schema_migrations),
    'latest', (select max(version) from public.app_schema_migrations),
    'management_token_configured', exists (select 1 from public.integration_secrets where key = 'supabase_management_token')
  );
end $$;

create or replace function public.save_database_config(p_config jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare p text; r text; u text; m text;
begin
  perform public.require_admin();
  if jsonb_typeof(p_config) <> 'object' then raise exception 'Configuração inválida'; end if;
  if exists (select 1 from jsonb_object_keys(p_config) k where k not in ('provider','project_ref','api_url','migration_mode')) then
    raise exception 'Campo de banco desconhecido';
  end if;
  p := coalesce(btrim(p_config ->> 'provider'), 'supabase');
  if p not in ('supabase','postgresql','future') then raise exception 'Provedor inválido'; end if;
  r := btrim(coalesce(p_config ->> 'project_ref', ''));
  u := regexp_replace(btrim(coalesce(p_config ->> 'api_url', '')), '/+$', '');
  m := coalesce(btrim(p_config ->> 'migration_mode'), 'manual');
  if p = 'supabase' and r <> '' and r !~ '^[a-z0-9]{20}$' then raise exception 'Project ref do Supabase inválido'; end if;
  if u <> '' and not public.valid_https_url(u) then raise exception 'API URL inválida; use https'; end if;
  if m not in ('manual','worker') then raise exception 'Modo de migração inválido'; end if;
  if p <> 'supabase' and m = 'worker' then raise exception 'Atualização pelo worker está disponível somente para Supabase'; end if;
  insert into public.settings(key, value, updated_by) values ('int_database', jsonb_build_object('provider',p,'project_ref',r,'api_url',u,'migration_mode',m), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_audit('database_config_saved', 'integration', p, jsonb_build_object('provider',p,'migration_mode',m,'has_project_ref',r <> '', 'has_api_url',u <> ''));
end $$;

create or replace function public.set_supabase_management_token(p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  perform public.require_admin();
  if length(v) not between 20 and 500 or v ~ '\\s' then raise exception 'Token de gerenciamento inválido'; end if;
  insert into public.integration_secrets(key,value,hint,updated_by) values ('supabase_management_token',v,right(v,4),auth.uid())
  on conflict (key) do update set value=excluded.value,hint=excluded.hint,updated_by=excluded.updated_by,updated_at=now();
  perform public.log_audit('database_management_token_set','integration','supabase','{}'::jsonb);
end $$;

create or replace function public.request_database_migration() returns uuid
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; v_id uuid;
begin
  perform public.require_admin();
  select value into cfg from public.settings where key = 'int_database';
  if coalesce(cfg ->> 'provider','') <> 'supabase' then raise exception 'Atualização automática ainda não está disponível para este provedor'; end if;
  if coalesce(cfg ->> 'migration_mode','manual') <> 'worker' then raise exception 'Escolha atualização pelo worker antes de solicitar'; end if;
  if coalesce(cfg ->> 'project_ref','') = '' then raise exception 'Informe o project ref do Supabase'; end if;
  if not exists (select 1 from public.integration_secrets where key='supabase_management_token') then raise exception 'Configure o token de gerenciamento; ele fica oculto após salvar'; end if;
  select id into v_id from public.channel_jobs where kind='integration' and status in ('pending','claimed') and payload ->> 'provider'='database' and payload ->> 'action'='apply_migrations' order by requested_at desc limit 1;
  if found then return v_id; end if;
  insert into public.channel_jobs(kind,channel,payload,requested_by) values ('integration',null,jsonb_build_object('provider','database','action','apply_migrations'),auth.uid()) returning id into v_id;
  perform public.log_audit('database_migration_requested','integration','supabase',jsonb_build_object('job',v_id));
  return v_id;
end $$;

create or replace function public.get_integration_runtime() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evolution', coalesce((select value from public.settings where key='int_evolution'),'{}'::jsonb),
    'telegram', coalesce((select value from public.settings where key='int_telegram'),'{}'::jsonb),
    'n8n', coalesce((select value from public.settings where key='int_n8n'),'{}'::jsonb),
    'database', coalesce((select value from public.settings where key='int_database'),'{}'::jsonb),
    'paused', public.setting_bool('paused',false),
    'status', coalesce((select jsonb_object_agg(substr(key,12),value) from public.settings where key like 'int\\_status\\_%'),'{}'::jsonb),
    'secrets', coalesce((select jsonb_object_agg(key,value) from public.integration_secrets),'{}'::jsonb),
    'connectors', coalesce((select jsonb_object_agg(platform,jsonb_build_object('mode',mode,'config',config)) from public.connectors),'{}'::jsonb)
  )
$$;

create or replace function public.report_integration_status(p_provider text, p_status jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_provider not in ('evolution','telegram','n8n','mercadolivre','shopee','amazon','database') then raise exception 'Integração desconhecida'; end if;
  if jsonb_typeof(p_status) <> 'object' or length(p_status::text) > 8000 then raise exception 'Estado inválido ou grande demais'; end if;
  insert into public.settings(key,value) values ('int_status_' || p_provider,p_status || jsonb_build_object('checked_at',now()))
  on conflict (key) do update set value=excluded.value,updated_at=now();
end $$;

revoke all on function public.get_database_overview(),public.save_database_config(jsonb),public.set_supabase_management_token(text),public.request_database_migration() from public,anon;
grant execute on function public.get_database_overview(),public.save_database_config(jsonb),public.set_supabase_management_token(text),public.request_database_migration() to authenticated;
grant execute on function public.get_integration_runtime(),public.report_integration_status(text,jsonb) to service_role;
