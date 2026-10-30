import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, SessionState } from './api';
import type {
  Analytics, AuditEvent, Connector, DashboardSummary, Destination, IngestInput, IngestResult, Offer, OfferDetail,
  PriceObservation, Profile, Publication, Role, Run, SettingsMap, Template,
  SecretInfo, Channel, ChannelOverview, Chat, ChatDetail, ChatFilter, ChatMessage, OutboxItem, Participant,
  ProductCategory, DiscoveredGroup, Contact, ChannelJob, TemplateVersion,
  PromoSource, CapturedLink, RoutingRule, WatchItem, CommissionSummary,
} from './types';

type Row = Record<string, any>;

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

function mapOffer(r: Row): Offer {
  const p = r.products ?? {};
  return {
    ...r, platform: p.platform, title: p.title, category: p.category ?? null, image_url: p.image_url ?? null,
    seller_name: p.seller_name ?? null,
    current_price: Number(r.current_price), previous_price: r.previous_price == null ? null : Number(r.previous_price),
    discount_pct: r.discount_pct == null ? null : Number(r.discount_pct),
    score_reasons: r.score_reasons ?? [], validation_notes: r.validation_notes ?? [],
  } as Offer;
}

function mapPublication(r: Row): Publication {
  const clicks = (r.short_links ?? []).reduce((a: number, s: Row) => a + (s.click_events?.[0]?.count ?? 0), 0);
  return {
    ...r, offer_title: r.offers?.products?.title ?? '—', is_simulated: !!r.offers?.is_simulated, offer_image: r.offers?.products?.image_url ?? null,
    destination_name: r.destinations?.name ?? '—', channel: r.destinations?.channel, clicks,
  } as Publication;
}

const PUB_SELECT =
  '*, offers!inner(is_simulated, products!inner(title, image_url)), destinations!inner(name, channel), short_links(click_events(count))';

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const rpc = async <T = unknown>(fn: string, args?: Row): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    fail(error);
    return data as T;
  };

  return {
    mode: 'supabase',
    auth: {
      async current(): Promise<SessionState> {
        const { data } = await sb.auth.getSession();
        const user = data.session?.user;
        if (!user) return { status: 'anonymous' };
        const { data: p, error } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
        fail(error);
        if (!p || !p.active) return { status: 'pending', email: user.email ?? '' };
        return { status: 'ready', profile: p as Profile };
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        fail(error);
      },
      async signUp(email, password, name) {
        const { error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
        fail(error);
      },
      async signOut() { await sb.auth.signOut(); },
    },

    dashboard: () => rpc<DashboardSummary>('dashboard_summary'),
    analytics: (days) => rpc<Analytics>('analytics_overview', { p_days: days }),

    async listOffers(f) {
      let q = sb.from('offers')
        .select('*, products!inner(platform, title, category, image_url, seller_name)')
        .order('created_at', { ascending: false }).limit(f.limit ?? 200);
      if (f.status && f.status !== 'all') q = q.eq('status', f.status);
      if (f.platform && f.platform !== 'all') q = q.eq('products.platform', f.platform);
      if (f.q) q = q.ilike('products.title', `%${f.q.replace(/[%_]/g, '')}%`);
      const { data, error } = await q;
      fail(error);
      return (data ?? []).map(mapOffer);
    },
    async getOffer(id): Promise<OfferDetail> {
      const { data, error } = await sb.from('offers')
        .select('*, products!inner(platform, title, category, image_url, seller_name)').eq('id', id).single();
      fail(error);
      const offer = mapOffer(data);
      const [obs, pubs] = await Promise.all([
        sb.from('price_observations').select('id, price, source_kind, availability, observed_at')
          .eq('product_id', offer.product_id).order('observed_at', { ascending: false }).limit(60),
        sb.from('publications').select(PUB_SELECT).eq('offer_id', id).order('created_at', { ascending: false }),
      ]);
      fail(obs.error); fail(pubs.error);
      return {
        offer,
        observations: (obs.data ?? []).map((o: Row) => ({ ...o, price: Number(o.price) })) as PriceObservation[],
        publications: (pubs.data ?? []).map(mapPublication),
      };
    },
    async ingestOffer(i: IngestInput) {
      return rpc<IngestResult>('ingest_offer', { p: { ...i, observed_at: new Date().toISOString(), source_layer: 'A' } });
    },
    async setAffiliateUrl(offerId, url) { await rpc('set_offer_affiliate_url', { p_offer: offerId, p_url: url }); },
    async approveOffer(offerId, destinationIds, scheduledFor) {
      return rpc<number>('approve_offer', { p_offer: offerId, p_destinations: destinationIds, p_scheduled_for: scheduledFor ?? null });
    },
    async listCategories() {
      const { data, error } = await sb.from('product_categories').select('*').order('sort');
      fail(error);
      return (data ?? []) as ProductCategory[];
    },
    async setOfferCategory(offerId, slug) { await rpc('set_offer_category', { p_offer: offerId, p_slug: slug }); },
    async reopenOffer(offerId) { await rpc('reopen_offer', { p_offer: offerId }); },
    async rejectOffer(offerId, reason) { await rpc('reject_offer', { p_offer: offerId, p_reason: reason }); },
    previewText: (offerId, destinationId) => rpc<string>('render_offer_text', { p_offer: offerId, p_destination: destinationId }),

    async listPublications(f) {
      let q = sb.from('publications').select(PUB_SELECT).order('created_at', { ascending: false }).limit(300);
      if (f.status && f.status !== 'all') q = q.eq('status', f.status);
      if (f.channel && f.channel !== 'all') q = q.eq('destinations.channel', f.channel);
      const { data, error } = await q;
      fail(error);
      return (data ?? []).map(mapPublication);
    },
    async cancelPublication(id) { await rpc('cancel_publication', { p_id: id }); },
    async retryPublication(id) { await rpc('retry_publication', { p_id: id }); },
    async resolveUnknown(id, resolution, externalId) {
      await rpc('resolve_unknown', { p_id: id, p_resolution: resolution, p_external_message_id: externalId ?? null });
    },
    async reschedulePublication(id, whenIso) { await rpc('reschedule_publication', { p_id: id, p_when: whenIso }); },
    async editPublicationText(id, text) { await rpc('edit_publication_text', { p_id: id, p_text: text }); },

    async listDestinations() {
      const { data, error } = await sb.from('destinations').select('*').order('created_at');
      fail(error);
      return (data ?? []) as Destination[];
    },
    async saveDestination(d) {
      const { id, created_at: _c, ...rest } = d as Row;
      const { error } = id
        ? await sb.from('destinations').update(rest).eq('id', id)
        : await sb.from('destinations').insert(rest);
      fail(error);
    },
    async deleteDestination(id) {
      const { error } = await sb.from('destinations').delete().eq('id', id);
      fail(error);
    },
    async requestDestinationTest(id) { await rpc('request_destination_test', { p_destination: id }); },
    async listDiscoveredGroups(channel) { return (await rpc<DiscoveredGroup[]>('list_discovered_groups', { p_channel: channel })) ?? []; },
    async listContacts(channel, q) { return (await rpc<Contact[]>('list_contacts', { p_channel: channel, p_q: q ?? null })) ?? []; },
    async requestGroupRefresh(channel) { return rpc<string>('request_group_refresh', { p_channel: channel }); },
    async requestGroupCreation(i) {
      return rpc<string>('request_group_creation', { p_channel: i.channel, p_name: i.name, p_description: i.description, p_participants: i.participants, p_key: i.key });
    },
    async requestGroupAction(channel, externalId, action, params) { return rpc<string>('request_group_action', { p_channel: channel, p_external_id: externalId, p_action: action, p_params: params ?? {} }); },
    async saveGroupDefaults(config) { await rpc('save_group_defaults', { p_config: config }); },
    async requestChatVerify(channel, ref) { return rpc<string>('request_chat_verify', { p_channel: channel, p_ref: ref }); },
    async getJob(id) {
      const { data, error } = await sb.from('channel_jobs').select('*').eq('id', id).single();
      fail(error);
      return data as ChannelJob;
    },
    async cancelJob(id) { await rpc('cancel_channel_job', { p_id: id }); },

    async listIntegrationSecrets() { return (await rpc<SecretInfo[]>('list_integration_secrets')) ?? []; },
    async setIntegrationSecret(key, value) { await rpc('set_integration_secret', { p_key: key, p_value: value }); },
    async clearIntegrationSecret(key) { await rpc('clear_integration_secret', { p_key: key }); },
    async rotateTelegramWebhookSecret() { await rpc('rotate_telegram_webhook_secret'); },
    async saveIntegration(provider, config) { await rpc('save_integration', { p_provider: provider, p_config: config }); },
    async requestIntegrationAction(provider, action, payload) { return rpc<string>('request_integration_action', { p_provider: provider, p_action: action, p_payload: payload ?? {} }); },
    getDatabaseOverview: () => rpc('get_database_overview'),
    async saveDatabaseConfig(config) { await rpc('save_database_config', { p_config: config }); },
    async setSupabaseManagementToken(value) { await rpc('set_supabase_management_token', { p_value: value }); },
    requestDatabaseMigration: () => rpc<string>('request_database_migration'),

    async listConnectors() {
      const { data, error } = await sb.from('connectors').select('*').order('display_name');
      fail(error);
      return (data ?? []) as Connector[];
    },
    async saveConnector(id, patch) {
      const { error } = await sb.from('connectors').update(patch).eq('id', id);
      fail(error);
    },
    async listRuns() {
      const { data, error } = await sb.from('runs').select('*, connectors(platform)').order('started_at', { ascending: false }).limit(50);
      fail(error);
      return (data ?? []).map((r: Row) => ({ ...r, platform: r.connectors?.platform ?? '—' })) as Run[];
    },

    async listPromoSources() { return (await rpc<PromoSource[]>('list_promo_sources')) ?? []; },
    async savePromoSource(chatId, cfg) { return rpc<string>('save_promo_source', { p_chat: chatId, p_config: cfg }); },
    async deletePromoSource(chatId) { await rpc('delete_promo_source', { p_chat: chatId }); },
    async listCapturedLinks(limit = 100) { return (await rpc<CapturedLink[]>('list_captured_links', { p_limit: limit })) ?? []; },
    async listRoutingRules() {
      const { data, error } = await sb.from('routing_rules').select('*').order('priority').order('created_at');
      fail(error); return (data ?? []) as RoutingRule[];
    },
    async saveRoutingRule(id, cfg) { return rpc<string>('save_routing_rule', { p_id: id, p_config: cfg }); },
    async deleteRoutingRule(id) { await rpc('delete_routing_rule', { p_id: id }); },
    async listWatchItems() {
      const { data, error } = await sb.from('watchlist').select('*').order('created_at', { ascending: false });
      fail(error); return (data ?? []).map((r: Row) => ({ ...r, target_price: r.target_price == null ? null : Number(r.target_price), last_price: r.last_price == null ? null : Number(r.last_price), min_drop_pct: Number(r.min_drop_pct) })) as WatchItem[];
    },
    async saveWatchItem(url, target, drop) { return rpc<string>('save_watch_item', { p_url: url, p_target: target, p_drop: drop }); },
    async deleteWatchItem(id) { await rpc('delete_watch_item', { p_id: id }); },
    commissionSummary: (days = 30) => rpc<CommissionSummary>('commission_summary', { p_days: days }),

    async listTemplates() {
      const { data, error } = await sb.from('templates').select('*').order('channel');
      fail(error);
      return (data ?? []) as Template[];
    },
    async listTemplateVersions(templateId) {
      const { data, error } = await sb.from('template_versions').select('*').eq('template_id', templateId).order('version', { ascending: false }).limit(30);
      fail(error);
      return (data ?? []) as TemplateVersion[];
    },
    async saveTemplate(id, patch) {
      const { error } = await sb.from('templates').update(patch).eq('id', id);
      fail(error);
    },

    async getSettings() {
      const { data, error } = await sb.from('settings').select('key, value');
      fail(error);
      return Object.fromEntries((data ?? []).map((r: Row) => [r.key, r.value])) as SettingsMap;
    },
    async setSetting(key, value) { await rpc('set_setting', { p_key: key, p_value: value }); },
    async setPaused(paused, reason) { await rpc('set_paused', { p_paused: paused, p_reason: reason ?? null }); },

    async listAudit(f) {
      let q = sb.from('audit_events').select('*').order('id', { ascending: false }).limit(f.limit ?? 200);
      if (f.entity && f.entity !== 'all') q = q.eq('entity_type', f.entity);
      if (f.q) q = q.ilike('action', `%${f.q.replace(/[%_]/g, '')}%`);
      const { data, error } = await q;
      fail(error);
      let emails = new Map<string, string>();
      const prof = await sb.from('profiles').select('user_id, email');
      if (!prof.error) emails = new Map((prof.data ?? []).map((p: Row) => [p.user_id, p.email]));
      return (data ?? []).map((r: Row) => ({ ...r, actor_email: r.actor_id ? emails.get(r.actor_id) ?? null : null })) as AuditEvent[];
    },
    async listUsers() {
      const { data, error } = await sb.from('profiles').select('*').order('created_at');
      fail(error);
      return (data ?? []) as Profile[];
    },
    async channelOverview(channel: Channel) { return rpc<ChannelOverview>('channel_overview', { p_channel: channel }); },
    async listChats(f: ChatFilter) {
      let q = sb.from('chats').select('*, destinations(name)').eq('channel', f.channel).eq('archived', !!f.archived)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(300);
      if (f.kind && f.kind !== 'all') q = q.eq('kind', f.kind);
      if (f.unreadOnly) q = q.gt('unread_count', 0);
      if (f.q) q = q.ilike('title', `%${f.q.replace(/[%_]/g, '')}%`);
      const { data, error } = await q; fail(error);
      return (data ?? []).map((r: Row) => ({ ...r, destination_name: r.destinations?.name ?? null }) as Chat);
    },
    async getChat(id: string): Promise<ChatDetail> {
      const [c, p, o] = await Promise.all([
        sb.from('chats').select('*, destinations(name)').eq('id', id).single(),
        sb.from('chat_participants').select('external_id, display_name, role, joined_at').eq('chat_id', id).order('role').limit(500),
        sb.from('chat_outbox').select('id, chat_id, body, status, last_error, created_at, sent_at').eq('chat_id', id).in('status', ['pending', 'claimed', 'failed']).order('created_at').limit(20),
      ]);
      fail(c.error); fail(p.error); fail(o.error);
      return { chat: { ...c.data, destination_name: c.data.destinations?.name ?? null } as Chat, participants: (p.data ?? []) as Participant[], outbox: (o.data ?? []) as OutboxItem[] };
    },
    async listMessages(chatId: string, limit = 150) {
      const { data, error } = await sb.from('chat_messages').select('*').eq('chat_id', chatId).order('sent_at', { ascending: false }).limit(limit);
      fail(error);
      return ((data ?? []) as ChatMessage[]).reverse();
    },
    async markChatRead(id: string) { await rpc('mark_chat_read', { p_chat: id }); },
    async setChatFlags(id: string, f: { archived?: boolean; muted?: boolean }) { await rpc('set_chat_flags', { p_chat: id, p_archived: f.archived ?? null, p_muted: f.muted ?? null }); },
    async linkChatDestination(id: string, destinationId: string | null) { await rpc('link_chat_destination', { p_chat: id, p_destination: destinationId }); },
    async queueChatMessage(chatId: string, text: string) { await rpc('queue_chat_message', { p_chat: chatId, p_text: text, p_key: crypto.randomUUID() }); },
    async cancelOutbox(id: string) { await rpc('cancel_chat_outbox', { p_id: id }); },
    async setProfile(userId, role: Role, active) { await rpc('set_profile', { p_user: userId, p_role: role, p_active: active }); },
  };
}
