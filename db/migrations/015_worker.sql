-- ============================================================================
-- 015 — O serviço que executa as tarefas passa a se chamar "worker"
--
-- Troca o provedor "n8n" por "worker" (ações do painel, status e heartbeat) e remove
-- a configuração de endereço do n8n, que não é mais usada.
-- As funções são ajustadas por substituição de texto sobre a versão em vigor; se o
-- trecho esperado não existir, a migração falha em vez de passar em silêncio.
-- ============================================================================
do $$
declare d text;
  swap constant text[][] := array[
    array['public.request_integration_action(text,text,jsonb)', $a$when 'n8n' then p_action in$a$, $b$when 'worker' then p_action in$b$],
    array['public.report_integration_status(text,jsonb)', $a$'telegram','n8n',$a$, $b$'telegram','worker',$b$],
    array['public.save_integration(text,jsonb)', $a$('evolution', 'telegram', 'n8n')$a$, $b$('evolution', 'telegram')$b$]
  ];
begin
  for i in 1 .. array_length(swap, 1) loop
    d := pg_get_functiondef(swap[i][1]::regprocedure);
    if position(swap[i][2] in d) = 0 then raise exception 'Migração 015: trecho esperado não encontrado em %', swap[i][1]; end if;
    execute replace(d, swap[i][2], swap[i][3]);
  end loop;
end $$;

create or replace function public.get_integration_runtime() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'evolution', coalesce((select value from public.settings where key = 'int_evolution'), '{}'::jsonb),
    'telegram',  coalesce((select value from public.settings where key = 'int_telegram'),  '{}'::jsonb),
    'database',  coalesce((select value from public.settings where key = 'int_database'),  '{}'::jsonb),
    'paused',    public.setting_bool('paused', false),
    'status',    coalesce((select jsonb_object_agg(substr(key, 12), value) from public.settings where left(key, 11) = 'int_status_'), '{}'::jsonb),
    'secrets',   coalesce((select jsonb_object_agg(key, value) from public.integration_secrets), '{}'::jsonb),
    'connectors', coalesce((select jsonb_object_agg(c.platform, jsonb_build_object(
        'mode', c.mode, 'config', c.config,
        'last_run_at', (select max(r.started_at) from public.runs r where r.connector_id = c.id)))
      from public.connectors c), '{}'::jsonb))
$$;
revoke all on function public.get_integration_runtime() from public, anon;
grant execute on function public.get_integration_runtime() to service_role;

-- o sinal de vida antigo vira o do worker; o resto do n8n é descartado
update public.heartbeats set service = 'worker' where service = 'n8n' and not exists (select 1 from public.heartbeats where service = 'worker');
delete from public.heartbeats where service = 'n8n';
delete from public.settings where key in ('int_n8n', 'int_status_n8n');
