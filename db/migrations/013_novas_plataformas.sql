-- ============================================================================
-- 013 — Novas plataformas: AliExpress e Magalu; Amazon passa a coletar pela Creators API
--
--   * connectors/products aceitam 'aliexpress' e 'magalu';
--   * domínios permitidos e extração do ID do produto das novas lojas;
--   * novo segredo aliexpress_app_secret; o segredo da Amazon aceita qualquer caractere sem espaço;
--   * novas ações (check/preview/collect) e status aceitos para as novas lojas;
--   * config: credential_version (Amazon) e tracking_id (AliExpress) validados.
-- As funções grandes são ajustadas por substituição de texto sobre a versão em vigor,
-- para não duplicar regras: se o texto esperado não existir, a migração falha em vez de passar em silêncio.
-- ============================================================================

-- 1. Plataformas aceitas
alter table public.connectors drop constraint if exists connectors_platform_check;
alter table public.connectors add constraint connectors_platform_check
  check (platform in ('mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu', 'network'));
alter table public.products drop constraint if exists products_platform_check;
alter table public.products add constraint products_platform_check
  check (platform in ('mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu'));

insert into public.connectors (platform, display_name, mode) values
  ('aliexpress', 'AliExpress', 'disabled'),
  ('magalu', 'Magalu', 'disabled')
on conflict (platform) do nothing;

-- 2. Domínios permitidos (só acrescenta; não mexe no que você já cadastrou)
update public.settings set value =
  case when value ? 'aliexpress' then value else value || '{"aliexpress":["aliexpress.com","aliexpress.us"]}'::jsonb end
  || case when value ? 'magalu' then '{}'::jsonb else '{"magalu":["magazineluiza.com.br","magalu.com","magazinevoce.com.br"]}'::jsonb end
 where key = 'allowed_domains';
update public.settings set value = jsonb_set(value, '{amazon}', (value -> 'amazon') || '["amzn.to"]'::jsonb)
 where key = 'allowed_domains' and value ? 'amazon' and not (value -> 'amazon') ? 'amzn.to';

-- 3. ID externo do produto (deduplicação)
create or replace function public.extract_external_id(p_platform text, p_url text) returns text
language sql immutable as $$
  select case p_platform
    when 'amazon' then upper(substring(p_url from '/(?:dp|gp/product)/([A-Za-z0-9]{10})'))
    when 'mercadolivre' then replace(upper(substring(p_url from '(?i)(MLB-?[0-9]+)')), '-', '')
    when 'shopee' then substring(p_url from 'i\.([0-9]+\.[0-9]+)')
    when 'aliexpress' then substring(p_url from '/item/([0-9]{6,})')
    when 'magalu' then lower(substring(p_url from '/p/([A-Za-z0-9]{6,})'))
  end
$$;

-- 4. Funções existentes ajustadas por substituição
do $$
declare d text; r text;
  swap constant text[][] := array[
    -- [função, texto antigo, texto novo]
    array['public.ingest_offer(jsonb)', $a$v_platform not in ('mercadolivre', 'shopee', 'amazon')$a$, $b$v_platform not in ('mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu')$b$],
    array['public.report_integration_status(text,jsonb)', $a$'mercadolivre','shopee','amazon','database'$a$, $b$'mercadolivre','shopee','amazon','aliexpress','magalu','database'$b$],
    array['public.request_integration_action(text,text,jsonb)', $a$when 'amazon' then p_action = 'check'$a$,
      $b$when 'amazon' then p_action in ('check', 'preview', 'collect') when 'aliexpress' then p_action in ('check', 'preview', 'collect') when 'magalu' then p_action = 'check'$b$],
    array['public.set_integration_secret(text,text)', $a$elsif p_key in ('ml_client_secret', 'shopee_secret', 'amazon_client_secret') and v !~ '^[A-Za-z0-9_.+=/-]{16,200}$' then$a$,
      $b$elsif p_key = 'amazon_client_secret' and v !~ '^[^[:space:]]{16,200}$' then
    raise exception 'Chave secreta inválida (16 a 200 caracteres, sem espaços)';
  elsif p_key in ('ml_client_secret', 'shopee_secret', 'aliexpress_app_secret') and v !~ '^[A-Za-z0-9_.+=/-]{16,200}$' then$b$],
    array['public.integration_secret_keys()', $a$'shopee_secret', 'amazon_client_secret']$a$, $b$'shopee_secret', 'amazon_client_secret', 'aliexpress_app_secret']$b$]
  ];
begin
  for i in 1 .. array_length(swap, 1) loop
    d := pg_get_functiondef(swap[i][1]::regprocedure);
    if position(swap[i][2] in d) = 0 then raise exception 'Migração 013: trecho esperado não encontrado em %', swap[i][1]; end if;
    execute replace(d, swap[i][2], swap[i][3]);
  end loop;
end $$;

-- 5. Config: campos novos validados num gatilho separado (soma-se ao validate_connector_config)
create or replace function public.validate_connector_config_ext() returns trigger
language plpgsql as $$
begin
  if new.config ? 'credential_version' and (new.config ->> 'credential_version') not in ('3.1', '3.2', '3.3') then
    raise exception '"credential_version" deve ser 3.1 (Américas, inclui o Brasil), 3.2 (Europa) ou 3.3 (Ásia-Pacífico). Credenciais antigas (2.x) precisam ser recriadas no Associates.';
  end if;
  if new.config ? 'tracking_id' and jsonb_typeof(new.config -> 'tracking_id') = 'string' and (new.config ->> 'tracking_id') !~ '^[A-Za-z0-9._:-]{2,60}$' then
    raise exception '"tracking_id" deve ter de 2 a 60 caracteres (letras, números, ponto, - _ :), sem espaços';
  end if;
  return new;
end $$;
drop trigger if exists trg_connectors_config_ext on public.connectors;
create trigger trg_connectors_config_ext before insert or update of config on public.connectors
  for each row execute function public.validate_connector_config_ext();
