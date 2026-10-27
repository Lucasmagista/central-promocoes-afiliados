-- ============================================================================
-- 001_schema.sql — Central de Promoções e Afiliados
-- Banco: PostgreSQL (Supabase). Use um projeto Supabase DEDICADO a este sistema.
-- Princípios: o banco decide; RLS em tudo; escrita sensível só por funções.
-- ============================================================================

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Perfis do painel (RBAC): admin, operator, viewer. Conta nova nasce INATIVA.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text,
  role       text not null default 'viewer' check (role in ('admin', 'operator', 'viewer')),
  active     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Conectores (plataformas de afiliados e redes). Nenhum segredo aqui.
-- ---------------------------------------------------------------------------
create table public.connectors (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null unique
                   check (platform in ('mercadolivre', 'shopee', 'amazon', 'network')),
  display_name     text not null,
  mode             text not null default 'disabled'
                   check (mode in ('disabled', 'manual_only', 'api_pending', 'api_ready', 'paused_policy', 'error')),
  use_short_link   boolean not null default true,
  docs_reviewed_at timestamptz,
  review_due_at    timestamptz,
  last_success_at  timestamptz,
  last_error_at    timestamptz,
  last_error       text,
  notes            text,
  config           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint connectors_api_ready_needs_review
    check (mode <> 'api_ready' or docs_reviewed_at is not null)
);
create trigger trg_connectors_updated before update on public.connectors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catálogo canônico de produtos e histórico PRÓPRIO de preço.
-- ---------------------------------------------------------------------------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null check (platform in ('mercadolivre', 'shopee', 'amazon')),
  external_id   text,
  canonical_url text not null,
  title         text not null,
  category      text,
  image_url     text,
  seller_name   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index products_platform_external_uq
  on public.products (platform, external_id) where external_id is not null;
create unique index products_platform_url_uq
  on public.products (platform, canonical_url);
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

create table public.price_observations (
  id                       bigint generated always as identity primary key,
  product_id               uuid not null references public.products (id) on delete cascade,
  price                    numeric(12, 2) not null check (price > 0),
  claimed_previous_price   numeric(12, 2) check (claimed_previous_price is null or claimed_previous_price > 0),
  currency                 text not null default 'BRL',
  availability             text not null default 'unknown'
                           check (availability in ('in_stock', 'out_of_stock', 'unknown')),
  source_kind              text not null check (source_kind in ('api', 'feed', 'admin_declared')),
  source_name              text,
  observed_at              timestamptz not null default now(),
  evidence                 jsonb not null default '{}'::jsonb
);
create index price_obs_product_time_idx on public.price_observations (product_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Ofertas
-- ---------------------------------------------------------------------------
create table public.offers (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete cascade,
  observation_id        bigint references public.price_observations (id),
  status                text not null default 'discovered'
                        check (status in ('discovered', 'needs_review', 'approved', 'scheduled',
                                          'published', 'rejected', 'expired')),
  source_layer          text not null default 'A' check (source_layer in ('A', 'B', 'C')),
  source_name           text,
  original_url          text not null,
  affiliate_url         text,
  current_price         numeric(12, 2) not null check (current_price > 0),
  previous_price        numeric(12, 2) check (previous_price is null or previous_price > 0),
  previous_price_source text check (previous_price_source in ('api', 'feed', 'own_history')),
  discount_pct          numeric(5, 2),
  coupon_code           text,
  coupon_confirmed      boolean not null default false,
  availability          text not null default 'unknown'
                        check (availability in ('in_stock', 'out_of_stock', 'unknown')),
  price_observed_at     timestamptz not null,
  expires_at            timestamptz,
  score                 integer check (score between 0 and 100),
  score_reasons         jsonb not null default '[]'::jsonb,
  validation_notes      jsonb not null default '[]'::jsonb,
  is_simulated          boolean not null default false,
  rejected_reason       text,
  created_by            uuid,
  approved_by           uuid,
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Nunca existe desconto sem preço anterior com fonte confiável.
  constraint offers_discount_needs_trusted_previous
    check (discount_pct is null or (previous_price is not null and previous_price_source is not null))
);
create index offers_status_idx on public.offers (status, created_at desc);
create index offers_product_idx on public.offers (product_id);
create trigger trg_offers_updated before update on public.offers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Destinos (canais e grupos). Nasce desabilitado; só habilita após teste.
-- ---------------------------------------------------------------------------
create table public.destinations (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null check (channel in ('telegram', 'whatsapp')),
  external_id     text not null,
  name            text not null,
  description     text,
  enabled         boolean not null default false,
  categories      text[] not null default '{}',
  quiet_start     time,
  quiet_end       time,
  max_per_hour    integer not null default 2 check (max_per_hour > 0),
  max_per_day     integer not null default 10 check (max_per_day > 0),
  min_interval_s  integer not null default 600 check (min_interval_s >= 0),
  risk_tier       text not null default 'medium' check (risk_tier in ('low', 'medium', 'high')),
  tested_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (channel, external_id),
  constraint destinations_enabled_needs_test check (not enabled or tested_at is not null)
);
create trigger trg_destinations_updated before update on public.destinations
  for each row execute function public.set_updated_at();

create table public.destination_tests (
  id             uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations (id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'claimed', 'ok', 'failed')),
  requested_by   uuid,
  requested_at   timestamptz not null default now(),
  completed_at   timestamptz,
  error          text
);
create index destination_tests_status_idx on public.destination_tests (status, requested_at);

-- ---------------------------------------------------------------------------
-- Templates de mensagem por canal
-- ---------------------------------------------------------------------------
create table public.templates (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null check (channel in ('telegram', 'whatsapp')),
  kind       text not null check (kind in ('offer', 'price_drop', 'daily_summary')),
  name       text not null,
  body       text not null,
  active     boolean not null default true,
  version    integer not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index templates_one_active_uq on public.templates (channel, kind) where active;
create trigger trg_templates_updated before update on public.templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Publicações: UMA por oferta e destino. Idempotência garantida pelo banco.
-- ---------------------------------------------------------------------------
create table public.publications (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references public.offers (id) on delete cascade,
  destination_id      uuid not null references public.destinations (id) on delete restrict,
  content_version     integer not null default 1,
  rendered_text       text not null,
  status              text not null default 'pending'
                      check (status in ('pending', 'claimed', 'sent', 'retry_scheduled',
                                        'failed_permanent', 'unknown', 'cancelled')),
  idempotency_key     text not null unique,
  attempt_count       integer not null default 0,
  scheduled_for       timestamptz not null default now(),
  next_attempt_at     timestamptz not null default now(),
  claimed_at          timestamptz,
  locked_by           text,
  locked_until        timestamptz,
  external_message_id text,
  last_error_code     text,
  note                text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (offer_id, destination_id, content_version)
);
create index publications_queue_idx on public.publications (status, next_attempt_at);
create index publications_dest_idx on public.publications (destination_id, status);
create trigger trg_publications_updated before update on public.publications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Redirecionador e cliques (visitante só como hash; sem IP nem telefone)
-- ---------------------------------------------------------------------------
create table public.short_links (
  code           text primary key,
  publication_id uuid not null references public.publications (id) on delete cascade,
  target_url     text not null,
  disabled       boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.click_events (
  id            bigint generated always as identity primary key,
  code          text not null references public.short_links (code) on delete cascade,
  clicked_at    timestamptz not null default now(),
  visitor_hash  text,
  ua_family     text,
  referrer_host text
);
create index click_events_time_idx on public.click_events (clicked_at desc);
create index click_events_code_idx on public.click_events (code);

-- ---------------------------------------------------------------------------
-- Auditoria, execuções de coleta, configurações e batimentos de serviço
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id          bigint generated always as identity primary key,
  actor_type  text not null check (actor_type in ('system', 'admin')),
  actor_id    uuid,
  action      text not null,
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_time_idx on public.audit_events (created_at desc);
create index audit_entity_idx on public.audit_events (entity_type, entity_id);

create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  connector_id   uuid not null references public.connectors (id) on delete cascade,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running', 'success', 'partial', 'error')),
  items_seen     integer not null default 0,
  items_accepted integer not null default 0,
  items_rejected integer not null default 0,
  error_summary  text
);
create index runs_time_idx on public.runs (started_at desc);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.heartbeats (
  service   text primary key,
  last_seen timestamptz not null default now(),
  status    text not null default 'ok' check (status in ('ok', 'degraded', 'down')),
  details   jsonb not null default '{}'::jsonb
);
