import type {
  PromoSource, PromoSourceInput, CapturedLink, RoutingRule, RoutingRuleInput, WatchItem, CommissionSummary,
  Alert, Analytics, AuditEvent, AuditFilter, Connector, DashboardSummary, Destination, IngestInput, IngestResult,
  Offer, OfferDetail, OfferFilter, Profile, Publication, PublicationFilter, Role, Run, SettingsMap, Template,
  Channel, ChannelOverview, SecretInfo, SecretKey, IntProvider, Chat, ChatDetail, ChatFilter, ChatMessage, ProductCategory, DiscoveredGroup, Contact, ChannelJob, TemplateVersion, GroupAction, GroupDefaults, DatabaseConfig, DatabaseOverview } from './types';

export type SessionState =
  | { status: 'anonymous' }
  | { status: 'pending'; email: string }
  | { status: 'ready'; profile: Profile };

/** Contrato único entre o painel e o back-end. Duas implementações: Supabase (real) e demonstração. */
export interface Api {
  readonly mode: 'demo' | 'supabase';
  auth: {
    current(): Promise<SessionState>;
    signIn(email: string, password: string): Promise<void>;
    signUp(email: string, password: string, name: string): Promise<void>;
    signOut(): Promise<void>;
  };
  dashboard(): Promise<DashboardSummary>;
  analytics(days: number): Promise<Analytics>;

  listOffers(f: OfferFilter): Promise<Offer[]>;
  getOffer(id: string): Promise<OfferDetail>;
  ingestOffer(input: IngestInput): Promise<IngestResult>;
  setAffiliateUrl(offerId: string, url: string): Promise<void>;
  approveOffer(offerId: string, destinationIds: string[], scheduledFor?: string): Promise<number>;
  rejectOffer(offerId: string, reason: string): Promise<void>;
  previewText(offerId: string, destinationId: string): Promise<string>;
  listCategories(): Promise<ProductCategory[]>;
  setOfferCategory(offerId: string, slug: string): Promise<void>;
  reopenOffer(offerId: string): Promise<void>;

  listPublications(f: PublicationFilter): Promise<Publication[]>;
  cancelPublication(id: string): Promise<void>;
  retryPublication(id: string): Promise<void>;
  resolveUnknown(id: string, resolution: 'sent' | 'cancelled', externalId?: string): Promise<void>;
  editPublicationText(id: string, text: string): Promise<void>;
  reschedulePublication(id: string, whenIso: string): Promise<void>;

  listDestinations(): Promise<Destination[]>;
  saveDestination(d: Partial<Destination> & Pick<Destination, 'channel' | 'external_id' | 'name'>): Promise<void>;
  deleteDestination(id: string): Promise<void>;
  requestDestinationTest(id: string): Promise<void>;
  /** Grupos/canais que o número ou o bot já conhecem (sincronizados pelo worker), com marca de "já é destino". */
  listDiscoveredGroups(channel: Channel): Promise<DiscoveredGroup[]>;
  listContacts(channel: Channel, q?: string): Promise<Contact[]>;
  requestGroupRefresh(channel: Channel): Promise<string>;
  requestGroupCreation(i: { channel: Channel; name: string; description: string; participants: Contact[]; key: string }): Promise<string>;
  requestChatVerify(channel: Channel, ref: string): Promise<string>;
  /** Ação em um grupo/canal existente (executada pelo worker). Leituras funcionam com a pausa global; alterações não. */
  requestGroupAction(channel: Channel, externalId: string, action: GroupAction, params?: Record<string, unknown>): Promise<string>;
  saveGroupDefaults(config: { [K in keyof GroupDefaults]?: Partial<GroupDefaults[K]> }): Promise<void>;
  getJob(id: string): Promise<ChannelJob>;
  cancelJob(id: string): Promise<void>;

  /** Integrações: configuração sem segredo (settings int_*), segredos só de escrita e ações executadas pelo worker. */
  listIntegrationSecrets(): Promise<SecretInfo[]>;
  setIntegrationSecret(key: SecretKey, value: string): Promise<void>;
  clearIntegrationSecret(key: SecretKey): Promise<void>;
  rotateTelegramWebhookSecret(): Promise<void>;
  saveIntegration(provider: 'evolution' | 'telegram', config: Record<string, unknown>): Promise<void>;
  requestIntegrationAction(provider: IntProvider, action: string, payload?: Record<string, unknown>): Promise<string>;
  getDatabaseOverview(): Promise<DatabaseOverview>;
  saveDatabaseConfig(config: DatabaseConfig): Promise<void>;
  setSupabaseManagementToken(value: string): Promise<void>;
  requestDatabaseMigration(): Promise<string>;

  listConnectors(): Promise<Connector[]>;
  saveConnector(id: string, patch: Partial<Connector>): Promise<void>;
  listRuns(): Promise<Run[]>;

  listPromoSources(): Promise<PromoSource[]>;
  savePromoSource(chatId: string, cfg: PromoSourceInput): Promise<string>;
  deletePromoSource(chatId: string): Promise<void>;
  listCapturedLinks(limit?: number): Promise<CapturedLink[]>;
  listRoutingRules(): Promise<RoutingRule[]>;
  saveRoutingRule(id: string | null, cfg: RoutingRuleInput): Promise<string>;
  deleteRoutingRule(id: string): Promise<void>;
  listWatchItems(): Promise<WatchItem[]>;
  saveWatchItem(url: string, target: number | null, drop: number | null): Promise<string>;
  deleteWatchItem(id: string): Promise<void>;
  commissionSummary(days?: number): Promise<CommissionSummary>;

  listTemplates(): Promise<Template[]>;
  saveTemplate(id: string, patch: { body?: string; active?: boolean; name?: string }): Promise<void>;
  listTemplateVersions(templateId: string): Promise<TemplateVersion[]>;

  getSettings(): Promise<SettingsMap>;
  setSetting(key: string, value: unknown): Promise<void>;
  setPaused(paused: boolean, reason?: string): Promise<void>;

  channelOverview(channel: Channel): Promise<ChannelOverview>;
  listChats(f: ChatFilter): Promise<Chat[]>;
  getChat(id: string): Promise<ChatDetail>;
  listMessages(chatId: string, limit?: number): Promise<ChatMessage[]>;
  markChatRead(id: string): Promise<void>;
  setChatFlags(id: string, flags: { archived?: boolean; muted?: boolean }): Promise<void>;
  linkChatDestination(id: string, destinationId: string | null): Promise<void>;
  queueChatMessage(chatId: string, text: string): Promise<void>;
  cancelOutbox(id: string): Promise<void>;

  listAudit(f: AuditFilter): Promise<AuditEvent[]>;
  listUsers(): Promise<Profile[]>;
  setProfile(userId: string, role: Role, active: boolean): Promise<void>;
}

export const can = {
  operate: (r?: Role) => r === 'admin' || r === 'operator',
  admin: (r?: Role) => r === 'admin',
};

export type { Alert };

let instance: Api | null = null;
export function setApi(a: Api) { instance = a; }
export function api(): Api {
  if (!instance) throw new Error('API não inicializada');
  return instance;
}
