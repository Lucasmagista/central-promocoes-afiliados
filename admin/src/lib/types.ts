export type Role = 'admin' | 'operator' | 'viewer';
export type Platform = 'mercadolivre' | 'shopee' | 'amazon' | 'aliexpress' | 'magalu';
export type Channel = 'telegram' | 'whatsapp';
export type OfferStatus =
  | 'discovered' | 'needs_review' | 'approved' | 'scheduled' | 'published' | 'rejected' | 'expired';
export type PublicationStatus =
  | 'pending' | 'claimed' | 'sent' | 'retry_scheduled' | 'failed_permanent' | 'unknown' | 'cancelled';
export type ConnectorMode =
  | 'disabled' | 'manual_only' | 'api_pending' | 'api_ready' | 'paused_policy' | 'error';
export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';
export type SourceKind = 'api' | 'feed' | 'admin_declared';

export interface Profile {
  user_id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface ScoreReason { code: string; points: number; label: string }

export interface Offer {
  id: string;
  product_id: string;
  status: OfferStatus;
  platform: Platform;
  title: string;
  category: string | null;
  image_url: string | null;
  seller_name: string | null;
  source_layer: 'A' | 'B' | 'C';
  source_name: string | null;
  original_url: string;
  affiliate_url: string | null;
  current_price: number;
  previous_price: number | null;
  previous_price_source: 'api' | 'feed' | 'own_history' | null;
  discount_pct: number | null;
  coupon_code: string | null;
  coupon_confirmed: boolean;
  availability: Availability;
  price_observed_at: string;
  expires_at: string | null;
  score: number | null;
  score_reasons: ScoreReason[];
  validation_notes: string[];
  is_simulated: boolean;
  rejected_reason: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface PriceObservation {
  id: number;
  price: number;
  source_kind: SourceKind;
  availability: Availability;
  observed_at: string;
}

export interface OfferDetail {
  offer: Offer;
  observations: PriceObservation[];
  publications: Publication[];
}

export interface Publication {
  id: string;
  offer_id: string;
  destination_id: string;
  offer_title: string;
  destination_name: string;
  channel: Channel;
  status: PublicationStatus;
  rendered_text: string;
  attempt_count: number;
  scheduled_for: string;
  next_attempt_at: string;
  last_error_code: string | null;
  note: string | null;
  external_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  clicks: number;
  is_simulated: boolean;
}

export interface Destination {
  id: string;
  channel: Channel;
  external_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  categories: string[];
  quiet_start: string | null;
  quiet_end: string | null;
  max_per_hour: number;
  max_per_day: number;
  min_interval_s: number;
  risk_tier: 'low' | 'medium' | 'high';
  tested_at: string | null;
  created_at: string;
}

export interface Connector {
  id: string;
  platform: Platform | 'network';
  display_name: string;
  mode: ConnectorMode;
  use_short_link: boolean;
  docs_reviewed_at: string | null;
  review_due_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  notes: string | null;
  config: ConnectorConfig;
}

export interface Template {
  id: string;
  channel: Channel;
  kind: 'offer' | 'price_drop' | 'daily_summary';
  name: string;
  body: string;
  active: boolean;
  version: number;
  updated_at: string;
}

export interface AuditEvent {
  id: number;
  actor_type: 'system' | 'admin';
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Alert { level: 'info' | 'warning' | 'critical'; code: string; message: string }

export interface DashboardSummary {
  paused: boolean;
  mode: 'simulation' | 'review' | 'auto';
  offers: { needs_review: number; scheduled: number; created_24h: number; published_24h: number; rejected_24h: number };
  publications: { pending: number; unknown: number; failed: number; sent_24h: number; sent_prev_24h: number };
  clicks: { last_24h: number; prev_24h: number };
  approval_rate_7d: number | null;
  oldest_review_minutes: number | null;
  connectors: { platform: string; display_name: string; mode: ConnectorMode; review_due_at: string | null; last_success_at: string | null; last_error_at: string | null }[];
  destinations: { id: string; name: string; channel: Channel; enabled: boolean; max_per_day: number; sent_24h: number }[];
  heartbeats: { service: string; status: 'ok' | 'degraded' | 'down'; last_seen: string; age_seconds: number }[];
  alerts: Alert[];
}

export interface Analytics {
  days: number;
  series: { day: string; sent: number; clicks: number }[];
  by_channel: { channel: Channel; sent: number; clicks: number }[];
  by_platform: { platform: Platform; clicks: number; sent: number }[];
  by_category: { category: string; clicks: number }[];
  top_offers: { offer_id: string; title: string; platform: Platform; current_price: number; clicks: number }[];
  funnel: { ingested: number; approved: number; published: number; clicked: number };
}

export interface IngestInput {
  platform: Platform;
  title: string;
  original_url: string;
  affiliate_url?: string;
  price: number;
  previous_price?: number;
  availability: Availability;
  category?: string;
  image_url?: string;
  seller_name?: string;
  coupon_code?: string;
  coupon_confirmed?: boolean;
  expires_at?: string;
  source_kind: SourceKind;
  source_name?: string;
  is_simulated?: boolean;
}

export interface IngestResult {
  status: 'created' | 'rejected' | 'duplicate';
  offer_id?: string;
  score?: number;
  reason?: string;
  notes?: string[];
  failures?: { code: string; message: string }[];
}

export interface Run {
  id: string;
  platform: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial' | 'error';
  items_seen: number;
  items_accepted: number;
  items_rejected: number;
  error_summary: string | null;
}

export type SettingsMap = Record<string, unknown>;

export interface OfferFilter { status?: OfferStatus | 'all'; platform?: Platform | 'all'; q?: string; limit?: number }
export interface PublicationFilter { status?: PublicationStatus | 'all'; channel?: Channel | 'all' }
export interface AuditFilter { q?: string; entity?: string; limit?: number }

/* ---------- Conversas (WhatsApp / Telegram) ---------- */
export type ChatKind = 'group' | 'channel' | 'private';
export interface Chat {
  id: string;
  channel: Channel;
  external_id: string;
  kind: ChatKind;
  title: string;
  username: string | null;
  description: string | null;
  participant_count: number | null;
  we_are_admin: boolean;
  destination_id: string | null;
  destination_name: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  archived: boolean;
  muted: boolean;
}
export interface ChatMessage {
  id: string;
  chat_id: string;
  direction: 'in' | 'out';
  external_id: string | null;
  sender_name: string | null;
  sender_external_id: string | null;
  kind: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'system' | 'offer';
  body: string;
  reply_to: string | null;
  publication_id: string | null;
  outbox_id: string | null;
  sent_at: string;
}
export interface Participant { external_id: string; display_name: string | null; role: 'owner' | 'admin' | 'member'; joined_at: string | null }
export interface OutboxItem {
  id: string; chat_id: string; body: string; status: 'pending' | 'claimed' | 'sent' | 'failed' | 'cancelled';
  last_error: string | null; created_at: string; sent_at: string | null;
}
export interface ChatDetail { chat: Chat; participants: Participant[]; outbox: OutboxItem[] }
export interface ChannelOverview {
  chats: number; groups: number; participants: number; unread: number;
  messages_in_24h: number; messages_out_24h: number; outbox_pending: number; linked_destinations: number;
}
export interface ChatFilter { channel: Channel; kind?: ChatKind | 'all'; q?: string; archived?: boolean; unreadOnly?: boolean }

/* ---------- Categorias, grupos e tarefas de canal ---------- */
export interface ProductCategory { slug: string; label: string; icon: string; sort: number; keywords: string[] }
export interface DiscoveredGroup {
  chat_id: string; external_id: string; title: string; kind: ChatKind; username: string | null;
  participant_count: number | null; we_are_admin: boolean; destination_id: string | null; destination_name: string | null;
}
export interface Contact { external_id: string; display_name: string }
export type JobKind = 'refresh_groups' | 'create_group' | 'verify_chat' | 'integration' | 'group_action';
export interface ChannelJob {
  id: string; kind: JobKind; channel: Channel | null; payload: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'done' | 'failed' | 'cancelled'; result: Record<string, unknown> | null;
  last_error: string | null; requested_at: string; finished_at: string | null;
}
export interface TemplateVersion { id: string; template_id: string; version: number; body: string; changed_at: string }
export interface ConnectorConfig {
  affiliate_tag?: string; affiliate_id?: string; credential_ref?: string; poll_minutes?: number; max_items_per_run?: number;
  min_discount_pct?: number; min_score?: number; min_price?: number; max_price?: number; categories?: string[];
  sources?: { name: string; url: string }[]; keywords?: string[]; link_template?: string; [k: string]: unknown;
}

/* ---------- Contas de afiliado (012) ---------- */
export interface StoreProduct { title: string; price: number; previous: number | null; discount_pct: number | null; url: string; image: string | null; seller: string | null; commission_pct: number | null; free_shipping?: boolean }
export interface StoreAccount {
  id: string; nickname?: string | null; site?: string | null; permalink?: string | null; level?: string | null; power_seller?: string | null; registered?: string | null;
  kind?: 'affiliate_app' | 'associate'; tracking_id?: string; marketplace?: string; report?: { conversions: number; more: boolean; commission: number }; report_error?: string;
}
/** Estado da integração da loja (gravado pelo worker em int_status_<plataforma>). */
export interface StoreStatus { ok?: boolean; partial?: boolean; connected?: boolean | null; account?: StoreAccount | null; detail?: string | null; error?: string | null; checked_at?: string }
export interface StoreCheckResult extends StoreStatus { sample?: StoreProduct[]; search_error?: string }
export interface CollectResult {
  ok: boolean; dry?: boolean; seen: number; eligible: number; skipped: Record<string, number>; errors: string[]; items?: StoreProduct[];
  selected?: number; created?: number; duplicates?: number; rejected?: number; low_score?: number; reasons?: Record<string, number>; run_id?: string;
}

/* ---------- Integrações (008) ---------- */
export type IntProvider = 'evolution' | 'telegram' | 'worker' | 'mercadolivre' | 'shopee' | 'amazon' | 'aliexpress' | 'magalu';
export type SecretKey = 'evolution_api_key' | 'telegram_bot_token' | 'telegram_webhook_secret' | 'ml_client_secret' | 'shopee_secret' | 'amazon_client_secret' | 'aliexpress_app_secret' | 'supabase_management_token';
/** O painel nunca recebe o valor de um segredo: só se existe e os 4 últimos caracteres. */
export interface SecretInfo { key: SecretKey; is_set: boolean; hint: string | null; updated_at: string | null }
export interface EvolutionConfig { base_url: string; instance: string; webhook_url: string; send_delay_min_s: number; send_delay_max_s: number; alert_numbers: string[]; alerts: boolean }
export interface TelegramConfig { enabled: boolean; mode: 'polling' | 'webhook'; webhook_url: string; admin_chat_id: string; alerts: boolean }
export type DatabaseProvider = 'supabase' | 'postgresql' | 'future';
export interface DatabaseConfig { provider: DatabaseProvider; project_ref: string; api_url: string; migration_mode: 'manual' | 'worker' }
export interface DatabaseOverview { config: DatabaseConfig; migration_count: number; latest: string | null; management_token_configured: boolean }

/* ---------- Gerenciamento de grupos (009) ---------- */
export type WaGroupAction = 'info' | 'participants' | 'invite_code' | 'revoke_invite' | 'set_subject' | 'set_description' | 'set_only_admins_send' | 'set_lock_info'
  | 'set_ephemeral' | 'add_participants' | 'remove_participants' | 'promote' | 'demote' | 'send_invite' | 'leave' | 'apply_defaults';
export type TgGroupAction = 'info' | 'admins' | 'create_invite' | 'revoke_invite' | 'set_title' | 'set_description' | 'set_permissions' | 'leave';
export type GroupAction = WaGroupAction | TgGroupAction;
export interface GroupFlags { only_admins_send?: boolean; lock_info?: boolean; ephemeral_seconds?: number }
/** Resultado de uma ação de grupo (o chat atualizado fica em chats/chat_participants; aqui vêm o id e o que não é guardado lá). */
export interface GroupActionResult { chat_id?: string; flags?: GroupFlags; invite_url?: string; added?: string[]; pending_numbers?: string[]; applied?: Record<string, boolean>; left?: boolean; sent_to?: number; revoked?: boolean }
export interface GroupDefaults {
  whatsapp: { only_admins_send: boolean; lock_info: boolean; ephemeral_seconds: number; add_disclosure: boolean; add_batch_size: number; add_delay_s: number; invite_after_create: boolean };
  telegram: { restrict_members_send: boolean; add_disclosure: boolean };
}

/* ---------- Testes do worker (010) ---------- */
export interface SelfCheck { id: string; label: string; ok: boolean; detail: string; required: boolean }
export interface SelfTestResult { ok: boolean; checks: SelfCheck[]; ms: number; supabase_ms: number; at: string }
export interface WebhookCheck { name: string; configured: boolean; ok: boolean; status?: number; ms?: number; target?: string; detail: string }
