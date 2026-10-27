import type { Api, SessionState } from './api';
import type {
  Alert, Analytics, AuditEvent, Connector, DashboardSummary, Destination, IngestInput, IngestResult, Offer,
  OfferDetail, PriceObservation, Profile, Publication, Role, Run, ScoreReason, SettingsMap, Template,
  ChannelJob, DiscoveredGroup, TemplateVersion, SecretInfo, SecretKey, IntProvider,
} from './types';
import { DEFAULT_CATEGORIES, categorySlug } from './categories';
import { renderTemplate } from './template';
import { DemoChats } from './demoChats';
import type { Channel, ChatFilter, GroupActionResult, GroupDefaults } from './types';

// ---------------------------------------------------------------------------
// Back-end de DEMONSTRAÇÃO: replica as regras do banco em memória. Nenhum envio é real.
// ---------------------------------------------------------------------------
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const uid = () => crypto.randomUUID();
const wait = <T,>(v: T, ms = 140) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ME: Profile = { user_id: 'u-admin', email: 'lucas.magista1@gmail.com', name: 'Lucas Magista', role: 'admin', active: true, created_at: iso(-60 * DAY) };

interface DemoState {
  users: Profile[]; connectors: Connector[]; destinations: Destination[]; templates: Template[];
  offers: Offer[]; publications: Publication[]; observations: Record<string, PriceObservation[]>;
  settings: SettingsMap; audit: AuditEvent[]; runs: Run[]; series: { day: string; sent: number; clicks: number }[];
  heartbeatAt: number; auditId: number; obsId: number;
}

const TEMPLATE_TG = '<b>{{title}}</b>\n\n💰 {{price}}\n{{previous_line}}\n{{coupon_line}}\n🕒 Preço visto em {{observed_at}}\n\n🛒 <a href="{{url}}">Ver oferta</a>\n\n<i>{{disclosure}}</i>';
const TEMPLATE_WA = '*{{title}}*\n\n💰 {{price}}\n{{previous_line}}\n{{coupon_line}}\n🕒 Preço visto em {{observed_at}}\n\n🛒 {{url}}\n\n_{{disclosure}}_';

const CATALOG: [string, 'mercadolivre' | 'shopee' | 'amazon', string, number, number | null, 'api' | 'feed' | 'own_history' | null][] = [
  ['Fone de Ouvido Bluetooth TWS com ANC', 'mercadolivre', 'Eletrônicos', 189.9, 299.9, 'api'],
  ['Smartwatch Fit 2 Pro 1.8" AMOLED', 'shopee', 'Eletrônicos', 229, 349, 'feed'],
  ['Air Fryer Digital 4L Inox', 'amazon', 'Casa', 279.9, 399.9, 'api'],
  ['Teclado Mecânico 60% RGB Hot-Swap', 'mercadolivre', 'Informática', 219.9, null, null],
  ['Mouse Gamer 7200 DPI Sem Fio', 'shopee', 'Informática', 64.9, 99.9, 'feed'],
  ['Cadeira Gamer Ergonômica Reclinável', 'amazon', 'Casa', 799, 1099, 'own_history'],
  ['Carregador Turbo 65W GaN 2 Portas', 'shopee', 'Eletrônicos', 89.9, 129.9, 'feed'],
  ['SSD NVMe 1TB PCIe 4.0', 'amazon', 'Informática', 389, 549, 'api'],
  ['Monitor 24" Full HD 144Hz IPS', 'mercadolivre', 'Informática', 749, 949, 'feed'],
  ['Aspirador Robô Slim com Mapeamento', 'amazon', 'Casa', 899, 1299, 'api'],
  ['Caixa de Som Portátil 20W à Prova d’Água', 'shopee', 'Eletrônicos', 119.9, 169.9, 'feed'],
  ['Webcam Full HD 1080p com Microfone', 'mercadolivre', 'Informática', 119, null, null],
  ['Hub USB-C 7 em 1 HDMI 4K', 'amazon', 'Informática', 139.9, 199.9, 'own_history'],
  ['Panela Elétrica de Pressão 6L Digital', 'mercadolivre', 'Casa', 349, 499, 'api'],
];

const HOSTS = { mercadolivre: 'www.mercadolivre.com.br', shopee: 'shopee.com.br', amazon: 'www.amazon.com.br' } as const;
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function seed(): DemoState {
  const r = rng(42);
  const connectors: Connector[] = [
    { id: 'c-ml', platform: 'mercadolivre', display_name: 'Mercado Livre', mode: 'manual_only', use_short_link: true, docs_reviewed_at: iso(-12 * DAY), review_due_at: iso(18 * DAY), last_success_at: iso(-3 * HOUR), last_error_at: null, last_error: null, notes: 'Entrada manual com link gerado no painel oficial do programa.', config: { affiliate_id: 'lucasmagista', poll_minutes: 60, min_discount_pct: 15, min_score: 60, max_items_per_run: 50, categories: ['eletronicos', 'informatica', 'casa'], credential_ref: 'ml-afiliados', sources: [{ name: 'Ofertas do dia', url: 'https://www.mercadolivre.com.br/ofertas' }] } },
    { id: 'c-sh', platform: 'shopee', display_name: 'Shopee', mode: 'api_pending', use_short_link: true, docs_reviewed_at: iso(-27 * DAY), review_due_at: iso(3 * DAY), last_success_at: null, last_error_at: null, last_error: null, notes: 'Aguardando liberação do acesso à API de afiliados.', config: { poll_minutes: 120, min_discount_pct: 20, categories: [] } },
    { id: 'c-am', platform: 'amazon', display_name: 'Amazon Brasil', mode: 'manual_only', use_short_link: false, docs_reviewed_at: iso(-5 * DAY), review_due_at: iso(25 * DAY), last_success_at: iso(-1 * DAY), last_error_at: null, last_error: null, notes: 'Link curto desligado: confirmar regra do programa antes de usar redirecionador.', config: { affiliate_tag: 'lucas-20', poll_minutes: 90, min_discount_pct: 20, min_score: 70, max_price: 3000, categories: ['eletronicos', 'cozinha', 'casa'] } },
    { id: 'c-nw', platform: 'network', display_name: 'Redes de afiliados', mode: 'disabled', use_short_link: true, docs_reviewed_at: null, review_due_at: null, last_success_at: null, last_error_at: null, last_error: null, notes: null, config: {} },
  ];
  const destinations: Destination[] = [
    { id: 'd-tg', channel: 'telegram', external_id: '-1001234567890', name: 'Ofertas Tech BR', description: 'Canal principal', enabled: true, categories: [], quiet_start: '23:00', quiet_end: '07:00', max_per_hour: 3, max_per_day: 12, min_interval_s: 900, risk_tier: 'low', tested_at: iso(-20 * DAY), created_at: iso(-30 * DAY) },
    { id: 'd-wa', channel: 'whatsapp', external_id: '120363000000000001@g.us', name: 'Grupo Ofertas 01', description: 'Grupo administrado por você', enabled: true, categories: ['eletronicos', 'informatica'], quiet_start: '22:00', quiet_end: '08:00', max_per_hour: 2, max_per_day: 6, min_interval_s: 1800, risk_tier: 'high', tested_at: iso(-14 * DAY), created_at: iso(-25 * DAY) },
    { id: 'd-wt', channel: 'whatsapp', external_id: '120363000000000002@g.us', name: 'Grupo de Teste', description: 'Somente testes internos', enabled: false, categories: [], quiet_start: null, quiet_end: null, max_per_hour: 2, max_per_day: 6, min_interval_s: 600, risk_tier: 'medium', tested_at: null, created_at: iso(-3 * DAY) },
  ];
  const templates: Template[] = [
    { id: 't-tg', channel: 'telegram', kind: 'offer', name: 'Oferta — Telegram (HTML)', body: TEMPLATE_TG, active: true, version: 3, updated_at: iso(-6 * DAY) },
    { id: 't-wa', channel: 'whatsapp', kind: 'offer', name: 'Oferta — WhatsApp', body: TEMPLATE_WA, active: true, version: 2, updated_at: iso(-9 * DAY) },
  ];
  const settings: SettingsMap = {
    paused: false, mode: 'review', timezone: 'America/Sao_Paulo', auto_approve_enabled: false, auto_approve_threshold: 90,
    max_price_age_minutes: 720, dedupe_window_hours: 72, republish_drop_pct: 10, min_history_observations: 5,
    min_history_days: 3, max_attempts: 5, claim_lock_seconds: 120, review_interval_days: 30, retention_days_clicks: 180,
    retention_days_audit: 365, shortlink_base: 'https://go.exemplo.com.br',
    affiliate_disclosure: 'Esta publicação contém link de afiliado; posso receber comissão por compras qualificadas, sem custo adicional para você. Preço e estoque podem mudar.',
    banned_terms: ['garantido', 'últimas unidades', 'corre', 'menor preço da história', 'só hoje', 'última chance', 'vai acabar'],
    int_evolution: { base_url: 'https://whatsapp.hubly.software', instance: '', webhook_url: '', send_delay_min_s: 4, send_delay_max_s: 12, alert_numbers: [], alerts: true },
    int_telegram: { enabled: false, mode: 'polling', webhook_url: '', admin_chat_id: '', alerts: true },
    int_n8n: { base_url: '' },
    int_groups: { whatsapp: { only_admins_send: true, lock_info: true, ephemeral_seconds: 0, add_disclosure: true, add_batch_size: 20, add_delay_s: 6, invite_after_create: true }, telegram: { restrict_members_send: false, add_disclosure: true } },
    allowed_domains: { mercadolivre: ['mercadolivre.com.br'], shopee: ['shopee.com.br'], amazon: ['amazon.com.br'] },
  };

  const offers: Offer[] = []; const observations: Record<string, PriceObservation[]> = {};
  const statuses: Offer['status'][] = ['needs_review', 'needs_review', 'needs_review', 'needs_review', 'needs_review', 'scheduled', 'published', 'published', 'published', 'published', 'published', 'rejected', 'published', 'expired'];
  CATALOG.forEach(([title, platform, category, price, prev, src], i) => {
    const id = `o-${i + 1}`, productId = `p-${i + 1}`;
    const seen = i < 5 ? -(10 + i * 13) * MIN : -(4 + i) * HOUR;
    const disc = prev && src ? Math.round(((prev - price) / prev) * 10000) / 100 : null;
    const reasons: ScoreReason[] = [];
    let score = 0;
    const sp = src === 'api' ? 40 : src === 'feed' ? 30 : 20;
    score += sp; reasons.push({ code: 'source', points: sp, label: src === 'api' ? 'Fonte oficial (API)' : src === 'feed' ? 'Feed de oferta' : 'Dado declarado por você' });
    const fp = seen > -HOUR ? 20 : seen > -6 * HOUR ? 10 : 0;
    score += fp; reasons.push({ code: 'freshness', points: fp, label: fp === 20 ? 'Preço observado há menos de 1 h' : fp === 10 ? 'Preço observado há menos de 6 h' : 'Dado com mais de 6 h' });
    if (disc) { const dp = Math.min(35, Math.floor(disc)); score += dp; reasons.push({ code: 'discount', points: dp, label: `Queda de ${disc}% (${src === 'own_history' ? 'histórico próprio' : 'fonte oficial'})` }); }
    else reasons.push({ code: 'discount', points: 0, label: 'Sem desconto comprovado' });
    const hasLink = i !== 3 && i !== 11;
    if (hasLink) { score += 5; reasons.push({ code: 'link', points: 5, label: 'Link de afiliado presente' }); }
    else reasons.push({ code: 'link', points: 0, label: 'Link de afiliado ausente ou não confirmado' });
    const status = statuses[i] ?? 'published';
    offers.push({
      id, product_id: productId, status, platform, title, category, image_url: null, seller_name: i % 3 === 0 ? 'Loja Oficial' : null,
      source_layer: src === 'api' ? 'B' : src === 'feed' ? 'C' : 'A', source_name: src ? (src === 'api' ? 'API oficial' : src === 'feed' ? 'Feed de ofertas' : 'Histórico') : 'Manual',
      original_url: `https://${HOSTS[platform]}/${slug(title)}-i.${100 + i}.${900 + i}`,
      affiliate_url: hasLink ? `https://${HOSTS[platform]}/aff/${slug(title).slice(0, 12)}${i}` : null,
      current_price: price, previous_price: prev && src ? prev : null, previous_price_source: prev && src ? src : null,
      discount_pct: disc, coupon_code: i === 1 ? 'TECH10' : null, coupon_confirmed: i === 1,
      availability: 'in_stock', price_observed_at: iso(seen), expires_at: i === 7 ? iso(5 * HOUR) : null,
      score: Math.min(100, score), score_reasons: reasons,
      validation_notes: !hasLink ? ['Link de afiliado ausente: obtenha no painel oficial antes de aprovar'] : [],
      is_simulated: true, rejected_reason: status === 'rejected' ? 'Preço não confere com a página do produto' : null,
      approved_at: ['scheduled', 'published'].includes(status) ? iso(-(i + 2) * HOUR) : null, created_at: iso(-(i * 1.7 + 0.5) * HOUR),
    });
    let p = price * 1.08;
    observations[productId] = Array.from({ length: 14 }, (_, k) => {
      p = Math.max(price * 0.98, p + (r() - 0.62) * price * 0.03);
      return { id: i * 100 + k, price: Math.round((k === 0 ? price : p) * 100) / 100, source_kind: src === 'api' ? 'api' : src === 'feed' ? 'feed' : 'admin_declared', availability: 'in_stock', observed_at: iso(-k * 14 * HOUR) } as PriceObservation;
    });
  });

  const publications: Publication[] = [];
  const mkPub = (offer: Offer, dest: Destination, status: Publication['status'], minsAgo: number, extra: Partial<Publication> = {}) => {
    publications.push({
      id: uid(), offer_id: offer.id, destination_id: dest.id, offer_title: offer.title, destination_name: dest.name, channel: dest.channel,
      status, rendered_text: '', attempt_count: status === 'pending' ? 0 : 1, scheduled_for: iso(-minsAgo * MIN), next_attempt_at: iso(-minsAgo * MIN),
      last_error_code: null, note: null, external_message_id: status === 'sent' ? `${Math.floor(r() * 9000 + 1000)}` : null,
      sent_at: status === 'sent' ? iso(-minsAgo * MIN) : null, created_at: iso(-(minsAgo + 5) * MIN),
      clicks: status === 'sent' ? Math.floor(r() * 60 + 4) : 0, is_simulated: true, ...extra,
    });
  };
  const tg = destinations[0], wa = destinations[1];
  const pub = offers.filter((o) => o.status === 'published' || o.status === 'scheduled');
  pub.forEach((o, i) => {
    mkPub(o, tg, o.status === 'scheduled' ? 'pending' : 'sent', 50 + i * 190);
    if (o.category !== 'Casa') mkPub(o, wa, o.status === 'scheduled' ? 'pending' : 'sent', 70 + i * 210);
  });
  mkPub(offers[12], wa, 'unknown', 300, { note: 'Resposta ambígua (timeout) ao enviar — confira no grupo antes de reconciliar', external_message_id: null, attempt_count: 1 });
  mkPub(offers[6], tg, 'failed_permanent', 600, { last_error_code: 'CHAT_NOT_FOUND', attempt_count: 5, external_message_id: null });
  mkPub(offers[9], tg, 'retry_scheduled', 8, { last_error_code: 'HTTP_429', attempt_count: 2, next_attempt_at: iso(12 * MIN), external_message_id: null });
  publications.forEach((p) => {
    const o = offers.find((x) => x.id === p.offer_id)!; const d = destinations.find((x) => x.id === p.destination_id)!;
    const tpl = templates.find((t) => t.channel === d.channel)!;
    p.rendered_text = renderTemplate(tpl.body, d.channel, { offer: o, disclosure: settings.affiliate_disclosure as string, shortlinkBase: settings.shortlink_base as string, code: p.id.slice(0, 8) });
  });

  const series = Array.from({ length: 90 }, (_, k) => {
    const d = new Date(Date.now() - (89 - k) * DAY);
    const day = new Date(d.getTime() - 3 * HOUR).toISOString().slice(0, 10);
    const sent = Math.floor(5 + r() * 7 + k / 14);
    return { day, sent, clicks: Math.floor(sent * (22 + r() * 30)) };
  });

  const audit: AuditEvent[] = [];
  const st: DemoState = {
    users: [
      ME,
      { user_id: 'u-op', email: 'marina.operadora@exemplo.com', name: 'Marina Souza', role: 'operator', active: true, created_at: iso(-20 * DAY) },
      { user_id: 'u-vw', email: 'leitor@exemplo.com', name: 'Paulo Lima', role: 'viewer', active: true, created_at: iso(-9 * DAY) },
      { user_id: 'u-new', email: 'novo.usuario@exemplo.com', name: 'Novo Usuário', role: 'viewer', active: false, created_at: iso(-2 * HOUR) },
    ],
    connectors, destinations, templates, offers, publications, observations, settings, audit, series,
    runs: [
      { id: uid(), platform: 'amazon', started_at: iso(-1 * DAY), finished_at: iso(-1 * DAY + 40_000), status: 'success', items_seen: 24, items_accepted: 9, items_rejected: 15, error_summary: null },
      { id: uid(), platform: 'mercadolivre', started_at: iso(-3 * HOUR), finished_at: iso(-3 * HOUR + 12_000), status: 'partial', items_seen: 12, items_accepted: 7, items_rejected: 5, error_summary: 'Alguns itens fora da lista de domínios permitidos' },
    ],
    heartbeatAt: Date.now(), auditId: 0, obsId: 5000,
  };
  const A = (action: string, entity: string | null, id: string | null, meta: Record<string, unknown>, minsAgo: number, actor: 'system' | 'admin' = 'admin') => {
    st.audit.push({ id: ++st.auditId, actor_type: actor, actor_id: actor === 'admin' ? ME.user_id : null, actor_email: actor === 'admin' ? ME.email : null, action, entity_type: entity, entity_id: id, metadata: meta, created_at: iso(-minsAgo * MIN) });
  };
  A('offer_ingested', 'offer', 'o-1', { plataforma: 'mercadolivre', camada: 'B', fonte: 'api', score: 85 }, 600, 'system');
  A('offer_approved', 'offer', 'o-7', { destinos: ['d-tg', 'd-wa'], publicacoes_criadas: 2 }, 540);
  A('publication_sent', 'publication', 'x', { mensagem: '1893' }, 538, 'system');
  A('setting_changed', 'settings', 'max_per_day', { de: 8, para: 12 }, 420);
  A('update_destinations', 'destinations', 'd-tg', { campos: { max_per_hour: { de: 2, para: 3 } } }, 400);
  A('publication_unknown', 'publication', 'y', { nota: 'timeout' }, 300, 'system');
  A('offer_rejected', 'offer', 'o-12', { motivo: 'Preço não confere com a página do produto' }, 200);
  A('global_pause', 'settings', 'paused', { motivo: 'manutenção do WhatsApp' }, 120);
  A('global_resume', 'settings', 'paused', {}, 100);
  A('insert_profiles', 'profiles', 'u-new', { campos: { email: 'novo.usuario@exemplo.com' } }, 120, 'system');
  return st;
}

const ERR = (m: string): never => { throw new Error(m); };

export function createDemoApi(): Api {
  const s = seed();
  const chats = new DemoChats(() => s.destinations, s.publications);
  const stored = (() => { try { return localStorage.getItem('demo_me'); } catch { return null; } })();
  let me: Profile | null = stored ? (s.users.find((u) => u.email === stored) ?? ME) : null;
  const jobs: ChannelJob[] = [];
  const tver = new Map<string, TemplateVersion[]>(s.templates.map((t) => [t.id, Array.from({ length: t.version }, (_, i) => ({
    id: uid(), template_id: t.id, version: t.version - i, body: i === 0 ? t.body : t.body.replace('🕒 Preço visto em {{observed_at}}\n', i === 1 ? '' : '🕒 {{observed_at}}\n'), changed_at: iso(-(i * 4 + 6) * DAY),
  }))]));

  const secrets = new Map<SecretKey, { hint: string; at: string }>();
  let evoOpenAt = 0; // a "conexão" demonstrativa fecha depois de alguns segundos
  const qrSvg = () => {
    let sv = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/>';
    let seed = Date.now() % 9973;
    const eye = (x: number, y: number) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#000"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#000"/>`;
    for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) {
      if ((x < 8 && y < 8) || (x > 20 && y < 8) || (x < 8 && y > 20)) continue;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff; if (seed % 3 === 0) sv += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`;
    }
    return 'data:image/svg+xml;base64,' + btoa(sv + eye(0, 0) + eye(22, 0) + eye(0, 22) + '</svg>');
  };
  const secret = (k: SecretKey) => secrets.get(k);
  const demoIntegration = (provider: IntProvider, action: string, p: Record<string, unknown>): Record<string, unknown> => {
    const evo = s.settings.int_evolution as Record<string, unknown>, tg = s.settings.int_telegram as Record<string, unknown>;
    const report = (k: IntProvider, v: Record<string, unknown>) => { s.settings[`int_status_${k}`] = { ...v, checked_at: iso(0) }; };
    if (provider === 'evolution') {
      if (!evo.base_url || !secret('evolution_api_key')) ERR('Informe o endereço da Evolution e a chave de acesso (aba WhatsApp).');
      const open = () => evoOpenAt > 0 && Date.now() > evoOpenAt;
      const status = () => { const st: Record<string, unknown> = { reachable: true, ms: 84, version: '2.3.7', instance: evo.instance || null }; if (evo.instance) { st.state = evoOpenAt === 0 ? 'close' : open() ? 'open' : 'connecting'; if (open()) { st.phone = '5511999990001'; st.profile = 'Hubly Ofertas'; } st.webhook = { enabled: !!evo.webhook_url, url: evo.webhook_url || '', matches: true }; } return st; };
      if (action === 'status') { const st = status(); report('evolution', st); return st; }
      if (action === 'list_instances') return { instances: evo.instance ? [{ name: evo.instance, state: status().state }] : [] };
      if (!evo.instance) ERR('Defina o nome da instância antes.');
      if (action === 'create_instance') return { created: true };
      if (action === 'connect') { if (open()) return { state: 'open', already: true }; evoOpenAt = Date.now() + 9000; return { state: 'connecting', qr: qrSvg(), pairing_code: p.pairing_number ? 'HUB1-2026' : null }; }
      if (action === 'restart') return { restarted: true };
      if (action === 'logout') { evoOpenAt = 0; return { logged_out: true }; }
      if (action === 'set_webhook') { if (!evo.webhook_url) ERR('Informe o endereço do webhook do n8n (aba WhatsApp).'); return { webhook: { enabled: true, url: evo.webhook_url } }; }
      if (action === 'send_test') { return { sent: true, message_id: 'DEMO' + Date.now() }; }
    }
    if (provider === 'n8n') {
      if (action === 'selftest') {
        const evoOk = !!(evo.base_url && evo.instance && secret('evolution_api_key')), tgOk = !!(tg.enabled && secret('telegram_bot_token'));
        const checks = [
          { id: 'env', label: 'Variáveis do n8n (SUPABASE_URL e chave)', ok: true, required: true, detail: 'Banco em demo.supabase.co' },
          { id: 'supabase', label: 'Conexão com o Supabase', ok: true, required: true, detail: 'Respondeu em 112 ms' },
          { id: 'sha', label: 'Assinatura (SHA-256, usada pela Shopee)', ok: true, required: true, detail: 'Funcionando' },
          { id: 'evo_cfg', label: 'WhatsApp configurado (endereço, instância e chave)', ok: evoOk, required: false, detail: evoOk ? `whatsapp.hubly.software · instância ${evo.instance}` : 'falta a instância ou a chave' },
          { id: 'tg_cfg', label: 'Telegram configurado (token e ligado)', ok: tgOk, required: false, detail: tgOk ? `modo ${tg.mode}` : 'falta o token do bot ou o Telegram está desligado' },
          { id: 'hook_wa', label: 'Webhook de entrada do WhatsApp salvo', ok: !!evo.webhook_url, required: false, detail: evo.webhook_url ? 'n8n.exemplo.com/…/central-w…' : 'Cole o endereço na aba WhatsApp (passo 3).' },
          { id: 'hook_tg', label: 'Webhook de entrada do Telegram', ok: tg.mode !== 'webhook' || !!tg.webhook_url, required: false, detail: tg.mode !== 'webhook' ? 'Não usado (modo polling)' : tg.webhook_url ? 'salvo' : 'Modo webhook sem endereço salvo.' },
          { id: 'paused', label: 'Envios liberados', ok: !s.settings.paused, required: false, detail: s.settings.paused ? 'A pausa geral está ligada: nada é publicado até retomar.' : 'Sem pausa' },
        ];
        const res = { ok: true, checks, ms: 240, supabase_ms: 112, at: iso(0) }; report('n8n', { ok: true, at: res.at }); return res;
      }
      if (action === 'webhook_check') {
        const w = (name: string, url: unknown) => url ? { name, configured: true, ok: true, status: 200, ms: 96, target: 'n8n.exemplo.com/…/central-w…', detail: 'O webhook respondeu corretamente.' } : { name, configured: false, ok: false, detail: 'Nenhum endereço salvo.' };
        const webhooks = [w('WhatsApp (Evolution → n8n)', evo.webhook_url), w('Telegram (bot → n8n)', tg.webhook_url)];
        return { webhooks, ok: webhooks.some((x) => x.configured) };
      }
      if (action === 'run_monitor') return { monitor: { evolution: evoOpenAt > 0 ? 'open' : 'close', telegram: tg.enabled ? 'ok' : undefined } };
      if (action === 'run_sender') { if (s.settings.paused) ERR('Envios pausados: retome antes de rodar o ciclo de envio'); return { sender: { sent: 0, failed: 0, unknown: 0 } }; }
    }
    if (provider === 'telegram') {
      if (!secret('telegram_bot_token')) ERR('Informe o token do bot (aba Telegram).');
      const live = tg.mode === 'webhook' && tg.webhook_url ? 'webhook' : 'polling';
      if (action === 'check') { const st = { ok: true, bot_username: 'central_ofertas_bot', bot_name: 'Central de Ofertas', can_join_groups: true, mode_live: live, webhook: live === 'webhook' ? { url: tg.webhook_url, pending: 0, last_error: null, last_error_at: null } : null }; report('telegram', st); return st; }
      if (action === 'set_webhook') { if (!tg.webhook_url) ERR('Informe o endereço do webhook (aba Telegram).'); if (!secret('telegram_webhook_secret')) ERR('Gere o segredo do webhook antes.'); return { webhook: { url: tg.webhook_url, pending: 0, last_error: null } }; }
      if (action === 'delete_webhook') return { webhook: null };
      if (action === 'send_test') return { sent: true, message_id: 4242 };
    }
    if (action === 'check') {
      const c = s.connectors.find((x) => x.platform === provider); const cfg = (c?.config ?? {}) as Record<string, unknown>;
      const need = provider === 'amazon' ? [['client_id', cfg.client_id], ['partner_tag', cfg.partner_tag], ['chave secreta', secret('amazon_client_secret')]] : [['App ID', cfg.app_id], ['chave secreta', secret(provider === 'shopee' ? 'shopee_secret' : 'ml_client_secret')]];
      const miss = need.filter(([, v]) => !v).map(([n]) => n);
      const res = miss.length ? { ok: false, error: `Falta informar: ${miss.join(', ')}.` } : provider === 'amazon' ? { ok: true, partial: true, detail: 'Campos preenchidos. A verificação automática da Amazon ainda não está disponível; teste gerando um link no painel do Associates.' } : { ok: true, detail: 'Credenciais aceitas (demonstração: nenhum servidor real foi consultado).' };
      report(provider, { ok: res.ok, partial: !!(res as { partial?: boolean }).partial, detail: (res as { detail?: string }).detail ?? null, error: (res as { error?: string }).error ?? null }); return res;
    }
    ERR('Ação não suportada');
    return {};
  };
  const createdGroups: number[] = [];
  const gflags: Record<string, { only_admins_send: boolean; lock_info: boolean; ephemeral_seconds: number; invite: string }> = {};
  const now = () => Date.now();

  const audit = (action: string, entity: string | null, id: string | null, meta: Record<string, unknown> = {}, actor: 'system' | 'admin' = 'admin') => {
    s.audit.push({ id: ++s.auditId, actor_type: actor, actor_id: actor === 'admin' ? me?.user_id ?? null : null, actor_email: actor === 'admin' ? me?.email ?? null : null, action, entity_type: entity, entity_id: id, metadata: meta, created_at: iso(0) });
    if (s.audit.length > 800) s.audit.shift();
  };
  const role = () => me?.role ?? 'viewer';
  const needOp = () => { if (role() === 'viewer') ERR('Permissão negada: requer perfil operador ou administrador'); };
  const needAdmin = () => { if (role() !== 'admin') ERR('Permissão negada: requer perfil administrador'); };
  const setting = <T,>(k: string, d: T) => (s.settings[k] as T) ?? d;
  const host = (u: string) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !x.username ? x.hostname.toLowerCase() : null; } catch { return null; } };
  const hostAllowed = (platform: string, u: string) => {
    const h = host(u); const list = ((setting<Record<string, string[]>>('allowed_domains', {}))[platform] ?? []);
    return !!h && list.some((d) => h === d || h.endsWith('.' + d));
  };
  const violations = (text: string) => (setting<string[]>('banned_terms', [])).filter((t) => new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(text));

  const render = (o: Offer, d: Destination, code?: string) => {
    const tpl = s.templates.find((t) => t.channel === d.channel && t.kind === 'offer' && t.active);
    if (!tpl) ERR(`Sem template ativo de oferta para ${d.channel}`);
    const c = s.connectors.find((x) => x.platform === o.platform);
    return renderTemplate(tpl!.body, d.channel, { offer: o, disclosure: setting('affiliate_disclosure', ''), shortlinkBase: c?.use_short_link ? setting('shortlink_base', '') : '', code });
  };

  // Simula o worker do n8n: reserva, "envia" e acumula cliques. Respeita a pausa global.
  setInterval(() => {
    s.heartbeatAt = now();
    chats.tick(!!setting('paused', false));
    if (setting('paused', false)) return;
    const p = s.publications.find((x) => (x.status === 'pending' || x.status === 'retry_scheduled') && new Date(x.next_attempt_at).getTime() <= now()
      && s.destinations.find((d) => d.id === x.destination_id)?.enabled);
    if (p) {
      p.status = 'sent'; p.sent_at = iso(0); p.attempt_count += 1; p.external_message_id = String(Math.floor(Math.random() * 9000 + 1000));
      const o = s.offers.find((x) => x.id === p.offer_id); if (o && ['scheduled', 'approved'].includes(o.status)) o.status = 'published';
      s.series[s.series.length - 1].sent += 1;
      audit('publication_sent', 'publication', p.id, { mensagem: p.external_message_id, simulado: true }, 'system');
    }
    const recent = s.publications.filter((x) => x.status === 'sent');
    if (recent.length && Math.random() < 0.7) { const t = recent[Math.floor(Math.random() * Math.min(6, recent.length))]; t.clicks += 1; s.series[s.series.length - 1].clicks += 1; }
  }, 6000);

  const score = (o: Offer) => {
    const reasons: ScoreReason[] = []; let v = 0;
    const kind = s.observations[o.product_id]?.[0]?.source_kind ?? 'admin_declared';
    const sp = kind === 'api' ? 40 : kind === 'feed' ? 30 : 20; v += sp;
    reasons.push({ code: 'source', points: sp, label: kind === 'api' ? 'Fonte oficial (API)' : kind === 'feed' ? 'Feed de oferta' : 'Dado declarado por você' });
    const age = (now() - new Date(o.price_observed_at).getTime()) / MIN; const fp = age <= 60 ? 20 : age <= 360 ? 10 : 0; v += fp;
    reasons.push({ code: 'freshness', points: fp, label: fp === 20 ? 'Preço observado há menos de 1 h' : fp === 10 ? 'Preço observado há menos de 6 h' : 'Dado com mais de 6 h' });
    if (o.discount_pct) { const dp = Math.min(35, Math.floor(o.discount_pct)); v += dp; reasons.push({ code: 'discount', points: dp, label: `Queda de ${o.discount_pct}% (${o.previous_price_source === 'own_history' ? 'histórico próprio' : 'fonte oficial'})` }); }
    else reasons.push({ code: 'discount', points: 0, label: 'Sem desconto comprovado' });
    if (o.affiliate_url && hostAllowed(o.platform, o.affiliate_url)) { v += 5; reasons.push({ code: 'link', points: 5, label: 'Link de afiliado presente' }); }
    else reasons.push({ code: 'link', points: 0, label: 'Link de afiliado ausente ou não confirmado' });
    o.score = Math.min(100, v); o.score_reasons = reasons;
  };

  const api: Api = {
    mode: 'demo',
    auth: {
      async current(): Promise<SessionState> { return me ? { status: 'ready', profile: me } : { status: 'anonymous' }; },
      async signIn(email) {
        await wait(null, 300);
        me = s.users.find((u) => u.email === email) ?? { ...ME, email: email || ME.email };
        if (!me.active) { me = null; ERR('Conta aguardando aprovação do administrador'); }
        try { localStorage.setItem('demo_me', (me as Profile).email); } catch { /* sem storage */ }
      },
      async signUp() { await wait(null, 300); },
      async signOut() { me = null; try { localStorage.removeItem('demo_me'); } catch { /* sem storage */ } },
    },

    async dashboard() {
      const o = s.offers, p = s.publications;
      const in24 = (iso: string | null) => !!iso && now() - new Date(iso).getTime() < DAY;
      const between = (iso: string | null) => !!iso && now() - new Date(iso).getTime() >= DAY && now() - new Date(iso).getTime() < 2 * DAY;
      const unknown = p.filter((x) => x.status === 'unknown').length, failed = p.filter((x) => x.status === 'failed_permanent').length;
      const reviews = o.filter((x) => x.status === 'needs_review');
      const oldest = reviews.length ? Math.max(...reviews.map((x) => (now() - new Date(x.created_at).getTime()) / MIN)) : null;
      const paused = setting('paused', false);
      const alerts: Alert[] = [];
      if (paused) alerts.push({ level: 'warning', code: 'paused', message: 'Publicação pausada globalmente: nada é enviado até você retomar.' });
      if (unknown) alerts.push({ level: 'critical', code: 'unknown', message: `${unknown} envio(s) em estado unknown aguardando reconciliação manual.` });
      if (failed) alerts.push({ level: 'warning', code: 'failed', message: `${failed} publicação(ões) com falha permanente.` });
      if (oldest && oldest > 1440) alerts.push({ level: 'warning', code: 'stale_review', message: 'Há ofertas aguardando revisão há mais de 24 h.' });
      s.connectors.forEach((c) => {
        if (c.mode === 'paused_policy') alerts.push({ level: 'critical', code: 'connector_paused', message: `${c.display_name} pausado por política: revise os termos antes de retomar.` });
        if (c.mode === 'error') alerts.push({ level: 'critical', code: 'connector_error', message: `${c.display_name} em erro: ${c.last_error ?? 'sem detalhe'}` });
        if (c.mode !== 'disabled' && c.review_due_at && new Date(c.review_due_at).getTime() < now()) alerts.push({ level: 'warning', code: 'review_due', message: `Revisão de termos de ${c.display_name} vencida.` });
      });
      if (!s.destinations.some((d) => d.enabled)) alerts.push({ level: 'info', code: 'no_destination', message: 'Nenhum destino habilitado. Cadastre e teste um destino para publicar.' });
      const decided = o.filter((x) => ['scheduled', 'published', 'rejected'].includes(x.status));
      const ser = s.series;
      const dash: DashboardSummary = {
        paused, mode: setting('mode', 'review'),
        offers: { needs_review: reviews.length, scheduled: o.filter((x) => x.status === 'scheduled').length, created_24h: o.filter((x) => in24(x.created_at)).length, published_24h: o.filter((x) => x.status === 'published' && in24(x.created_at)).length + 2, rejected_24h: o.filter((x) => x.status === 'rejected').length },
        publications: { pending: p.filter((x) => x.status === 'pending' || x.status === 'retry_scheduled').length, unknown, failed, sent_24h: p.filter((x) => x.status === 'sent' && in24(x.sent_at)).length + ser[ser.length - 1].sent, sent_prev_24h: p.filter((x) => x.status === 'sent' && between(x.sent_at)).length + ser[ser.length - 2].sent },
        clicks: { last_24h: ser[ser.length - 1].clicks + Math.round(ser[ser.length - 2].clicks * 0.5), prev_24h: ser[ser.length - 2].clicks },
        approval_rate_7d: decided.length ? Math.round((1000 * decided.filter((x) => x.status !== 'rejected').length) / decided.length) / 10 : null,
        oldest_review_minutes: oldest,
        connectors: s.connectors.map((c) => ({ platform: c.platform, display_name: c.display_name, mode: c.mode, review_due_at: c.review_due_at, last_success_at: c.last_success_at, last_error_at: c.last_error_at })),
        destinations: s.destinations.map((d) => ({ id: d.id, name: d.name, channel: d.channel, enabled: d.enabled, max_per_day: d.max_per_day, sent_24h: p.filter((x) => x.destination_id === d.id && x.status === 'sent' && in24(x.sent_at)).length })),
        heartbeats: [
          { service: 'n8n', status: 'ok', last_seen: new Date(s.heartbeatAt).toISOString(), age_seconds: Math.round((now() - s.heartbeatAt) / 1000) },
          { service: 'evolution-api', status: 'ok', last_seen: iso(-40_000), age_seconds: 40 },
          { service: 'redirecionador', status: 'ok', last_seen: iso(-25_000), age_seconds: 25 },
        ],
        alerts,
      };
      return wait(dash);
    },

    async analytics(days) {
      const ser = s.series.slice(-days);
      const sent = s.publications.filter((p) => p.status === 'sent');
      const grp = <K extends string>(key: (p: Publication) => K) => {
        const m = new Map<K, { sent: number; clicks: number }>();
        sent.forEach((p) => { const k = key(p); const v = m.get(k) ?? { sent: 0, clicks: 0 }; v.sent += 1; v.clicks += p.clicks; m.set(k, v); });
        return m;
      };
      const offerOf = (p: Publication) => s.offers.find((o) => o.id === p.offer_id)!;
      const a: Analytics = {
        days, series: ser,
        by_channel: [...grp((p) => p.channel)].map(([channel, v]) => ({ channel, ...v })),
        by_platform: [...grp((p) => offerOf(p).platform)].map(([platform, v]) => ({ platform, ...v })),
        by_category: [...grp((p) => offerOf(p).category ?? 'Sem categoria')].map(([category, v]) => ({ category, clicks: v.clicks })).sort((x, y) => y.clicks - x.clicks),
        top_offers: Object.values(sent.reduce<Record<string, Analytics['top_offers'][number]>>((acc, p) => { const o = offerOf(p); (acc[o.id] ??= { offer_id: o.id, title: o.title, platform: o.platform, current_price: o.current_price, clicks: 0 }).clicks += p.clicks; return acc; }, {})).sort((x, y) => y.clicks - x.clicks).slice(0, 8),
        funnel: { ingested: s.offers.length * Math.max(1, Math.round(days / 7)), approved: s.offers.filter((o) => o.approved_at).length * Math.max(1, Math.round(days / 7)), published: ser.reduce((x, y) => x + y.sent, 0), clicked: Math.round(ser.reduce((x, y) => x + y.sent, 0) * 0.82) },
      };
      return wait(a);
    },

    async listOffers(f) {
      let r = s.offers.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (f.status && f.status !== 'all') r = r.filter((o) => o.status === f.status);
      if (f.platform && f.platform !== 'all') r = r.filter((o) => o.platform === f.platform);
      if (f.q) r = r.filter((o) => o.title.toLowerCase().includes(f.q!.toLowerCase()));
      return wait(r.slice(0, f.limit ?? 200));
    },
    async getOffer(id): Promise<OfferDetail> {
      const offer = s.offers.find((o) => o.id === id) ?? ERR('Oferta inexistente');
      return wait({ offer, observations: s.observations[offer.product_id] ?? [], publications: s.publications.filter((p) => p.offer_id === id) });
    },
    async ingestOffer(i: IngestInput): Promise<IngestResult> {
      needOp();
      const f: { code: string; message: string }[] = [];
      if (!i.title?.trim() || i.title.length > 300) f.push({ code: 'title_invalid', message: 'Título ausente ou maior que 300 caracteres' });
      if (!hostAllowed(i.platform, i.original_url)) f.push({ code: 'domain_not_allowed', message: 'URL do produto fora dos domínios permitidos da plataforma' });
      if (i.affiliate_url && !hostAllowed(i.platform, i.affiliate_url)) f.push({ code: 'affiliate_host_not_allowed', message: 'Link de afiliado fora dos domínios permitidos (confirme o domínio oficial e cadastre em Configurações)' });
      if (!(i.price > 0)) f.push({ code: 'price_invalid', message: 'Preço ausente ou não positivo' });
      if (i.availability === 'out_of_stock') f.push({ code: 'out_of_stock', message: 'Produto sem estoque' });
      if (i.expires_at && new Date(i.expires_at).getTime() <= now()) f.push({ code: 'expired', message: 'Oferta já vencida' });
      if (f.length) { audit('offer_ingest_rejected', 'offer', null, { falhas: f.map((x) => x.code) }); return wait({ status: 'rejected' as const, failures: f }); }
      const canon = i.original_url.split('#')[0].split('?')[0].replace(/\/+$/, '');
      const existing = s.offers.find((o) => o.original_url.split('?')[0].replace(/\/+$/, '') === canon && ['needs_review', 'approved', 'scheduled'].includes(o.status));
      if (existing) return wait({ status: 'duplicate' as const, reason: 'open_offer', offer_id: existing.id });
      const notes: string[] = [];
      if (i.previous_price && i.source_kind === 'admin_declared') notes.push('Preço anterior declarado manualmente foi ignorado (fonte não confiável)');
      if (!i.affiliate_url) notes.push('Link de afiliado ausente: obtenha no painel oficial antes de aprovar');
      const trusted = i.source_kind !== 'admin_declared' && i.previous_price && i.previous_price > i.price;
      const id = uid(), pid = uid();
      const o: Offer = {
        id, product_id: pid, status: 'needs_review', platform: i.platform, title: i.title.trim(), category: i.category || null, image_url: i.image_url || null,
        seller_name: i.seller_name || null, source_layer: 'A', source_name: i.source_name ?? null, original_url: i.original_url, affiliate_url: i.affiliate_url || null,
        current_price: i.price, previous_price: trusted ? i.previous_price! : null, previous_price_source: trusted ? (i.source_kind as 'api' | 'feed') : null,
        discount_pct: trusted ? Math.round(((i.previous_price! - i.price) / i.previous_price!) * 10000) / 100 : null,
        coupon_code: i.coupon_code || null, coupon_confirmed: !!i.coupon_code && (i.source_kind !== 'admin_declared' || !!i.coupon_confirmed),
        availability: i.availability, price_observed_at: iso(0), expires_at: i.expires_at ?? null, score: 0, score_reasons: [], validation_notes: notes,
        is_simulated: true, rejected_reason: null, approved_at: null, created_at: iso(0),
      };
      s.observations[pid] = [{ id: ++s.obsId, price: i.price, source_kind: i.source_kind, availability: i.availability, observed_at: iso(0) }];
      s.offers.unshift(o); score(o);
      audit('offer_ingested', 'offer', id, { plataforma: i.platform, camada: 'A', fonte: i.source_kind, score: o.score });
      return wait({ status: 'created' as const, offer_id: id, score: o.score ?? 0, notes });
    },
    async setAffiliateUrl(id, url) {
      needOp();
      const o = s.offers.find((x) => x.id === id) ?? ERR('Oferta inexistente');
      if (!['needs_review', 'approved'].includes(o.status)) ERR(`Oferta em estado ${o.status} não permite alterar o link`);
      if (!hostAllowed(o.platform, url.trim())) ERR(`Link fora dos domínios permitidos para ${o.platform} (confirme o domínio oficial e cadastre em Configurações)`);
      o.affiliate_url = url.trim(); o.validation_notes = o.validation_notes.filter((n) => !n.startsWith('Link de afiliado ausente')); score(o);
      audit('offer_link_set', 'offer', id, { host: host(url) }); await wait(null);
    },
    async approveOffer(id, dests, when) {
      needOp();
      const o = s.offers.find((x) => x.id === id) ?? ERR('Oferta inexistente');
      if (!['needs_review', 'approved', 'scheduled'].includes(o.status)) ERR(`Oferta em estado ${o.status} não pode ser aprovada`);
      if (!o.affiliate_url) ERR('Oferta sem link de afiliado');
      if (o.expires_at && new Date(o.expires_at).getTime() <= now()) ERR('Oferta vencida');
      if (!dests.length) ERR('Selecione ao menos um destino');
      const c = s.connectors.find((x) => x.platform === o.platform);
      if (!o.is_simulated && (!c || ['disabled', 'paused_policy', 'error'].includes(c.mode))) ERR(`Conector de ${o.platform} indisponível`);
      let n = 0;
      for (const did of dests) {
        const d = s.destinations.find((x) => x.id === did) ?? ERR('Destino inexistente');
        if (!d.enabled) ERR(`Destino "${d.name}" está desabilitado`);
        if (d.categories.length) { const sl = categorySlug(o.category); if (!sl || !d.categories.includes(sl)) ERR(`Categoria da oferta não é aceita pelo destino "${d.name}"`); }
        if (s.publications.some((p) => p.offer_id === id && p.destination_id === did)) continue;
        const text = render(o, d, uid().slice(0, 8));
        const v = violations(text); if (v.length) ERR(`Texto contém termos proibidos: ${v.join(', ')}`);
        s.publications.unshift({ id: uid(), offer_id: id, destination_id: did, offer_title: o.title, destination_name: d.name, channel: d.channel, status: 'pending', rendered_text: text, attempt_count: 0, scheduled_for: when ?? iso(0), next_attempt_at: when ?? iso(0), last_error_code: null, note: null, external_message_id: null, sent_at: null, created_at: iso(0), clicks: 0, is_simulated: o.is_simulated });
        n++;
      }
      o.status = 'scheduled'; o.approved_at = iso(0);
      audit('offer_approved', 'offer', id, { destinos: dests, publicacoes_criadas: n });
      return wait(n);
    },
    async rejectOffer(id, reason) {
      needOp(); if (!reason.trim()) ERR('Informe o motivo da rejeição');
      const o = s.offers.find((x) => x.id === id) ?? ERR('Oferta inexistente');
      if (['published', 'rejected', 'expired'].includes(o.status)) ERR(`Oferta em estado ${o.status} não pode ser rejeitada`);
      o.status = 'rejected'; o.rejected_reason = reason.trim();
      s.publications.filter((p) => p.offer_id === id && ['pending', 'retry_scheduled'].includes(p.status)).forEach((p) => { p.status = 'cancelled'; p.note = 'Oferta rejeitada'; });
      audit('offer_rejected', 'offer', id, { motivo: reason.trim() }); await wait(null);
    },
    async previewText(offerId, destId) {
      const o = s.offers.find((x) => x.id === offerId) ?? ERR('Oferta inexistente');
      const d = s.destinations.find((x) => x.id === destId) ?? ERR('Destino inexistente');
      return wait(render(o, d));
    },

    async listPublications(f) {
      let r = s.publications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (f.status && f.status !== 'all') r = r.filter((p) => p.status === f.status);
      if (f.channel && f.channel !== 'all') r = r.filter((p) => p.channel === f.channel);
      return wait(r);
    },
    async cancelPublication(id) {
      needOp(); const p = s.publications.find((x) => x.id === id); if (!p || !['pending', 'retry_scheduled'].includes(p.status)) ERR('Só é possível cancelar publicações pendentes ou em nova tentativa');
      p!.status = 'cancelled'; p!.note = 'Cancelada manualmente'; audit('publication_cancelled', 'publication', id); await wait(null);
    },
    async retryPublication(id) {
      needOp(); const p = s.publications.find((x) => x.id === id); if (!p || p.status !== 'failed_permanent') ERR('Só é possível reenfileirar publicações com falha permanente');
      Object.assign(p!, { status: 'pending', next_attempt_at: iso(0), attempt_count: 0, last_error_code: null, note: 'Reenfileirada manualmente' }); audit('publication_requeued', 'publication', id); await wait(null);
    },
    async resolveUnknown(id, resolution, ext) {
      needOp(); const p = s.publications.find((x) => x.id === id); if (!p || p.status !== 'unknown') ERR('Publicação não está em estado unknown');
      p!.status = resolution; p!.note = 'Reconciliado manualmente'; if (resolution === 'sent') { p!.sent_at = iso(0); p!.external_message_id = ext ?? p!.external_message_id; }
      audit('unknown_resolved', 'publication', id, { resolucao: resolution }); await wait(null);
    },
    async editPublicationText(id, text) {
      needOp(); const p = s.publications.find((x) => x.id === id);
      if (!p || !['pending', 'retry_scheduled'].includes(p.status)) ERR('Só é possível editar o texto de publicações ainda não enviadas');
      if (!text.trim()) ERR('Texto vazio'); const v = violations(text); if (v.length) ERR(`Texto contém termos proibidos: ${v.join(', ')}`);
      p!.rendered_text = text; p!.note = 'Texto editado manualmente'; audit('publication_text_edited', 'publication', id); await wait(null);
    },

    async listCategories() { return wait(DEFAULT_CATEGORIES); },
    async setOfferCategory(id, slugValue) {
      needOp(); const c = DEFAULT_CATEGORIES.find((x) => x.slug === slugValue) ?? ERR('Categoria desconhecida');
      const o = s.offers.find((x) => x.id === id) ?? ERR('Oferta inexistente');
      if (['published', 'rejected', 'expired'].includes(o.status)) ERR(`Oferta em estado ${o.status} não pode mudar de categoria`);
      o.category = c.label; audit('offer_category_set', 'offer', id, { categoria: slugValue }); await wait(null, 60);
    },
    async reopenOffer(id) {
      needOp(); const o = s.offers.find((x) => x.id === id);
      if (!o || o.status !== 'rejected') ERR('Só é possível reabrir ofertas rejeitadas');
      o!.status = 'needs_review'; o!.rejected_reason = null; audit('offer_reopened', 'offer', id); await wait(null, 60);
    },
    async reschedulePublication(id, whenIso) {
      needOp(); const p = s.publications.find((x) => x.id === id); const t = new Date(whenIso).getTime();
      if (!p || !['pending', 'retry_scheduled'].includes(p.status)) ERR('Só é possível reagendar publicações pendentes ou em nova tentativa');
      if (!(t > now() - MIN) || t > now() + 30 * DAY) ERR('Escolha um horário entre agora e 30 dias');
      p!.scheduled_for = new Date(Math.max(t, now())).toISOString(); p!.next_attempt_at = p!.scheduled_for; p!.note = 'Reagendada manualmente';
      audit('publication_rescheduled', 'publication', id, { para: p!.scheduled_for }); await wait(null, 60);
    },
    async listDiscoveredGroups(channel) {
      chats.sync();
      const out: DiscoveredGroup[] = chats.chats.filter((c) => c.channel === channel && c.kind !== 'private' && !c.archived).map((c) => {
        const d = s.destinations.find((x) => x.channel === channel && x.external_id === c.external_id);
        return { chat_id: c.id, external_id: c.external_id, title: c.title, kind: c.kind, username: c.username, participant_count: c.participant_count, we_are_admin: c.we_are_admin, destination_id: d?.id ?? null, destination_name: d?.name ?? null };
      });
      return wait(out.sort((a, b) => a.title.localeCompare(b.title)), 120);
    },
    async listContacts(channel, q) { return wait(chats.contacts(channel, q), 100); },
    async requestGroupRefresh(channel) {
      needOp(); const ex = jobs.find((j) => j.kind === 'refresh_groups' && j.channel === channel && ['pending', 'claimed'].includes(j.status)); if (ex) return ex.id;
      const j: ChannelJob = { id: uid(), kind: 'refresh_groups', channel, payload: {}, status: 'pending', result: null, last_error: null, requested_at: iso(0), finished_at: null }; jobs.push(j);
      setTimeout(() => { j.status = 'claimed'; }, 500);
      setTimeout(() => { const n = chats.reveal(channel); j.status = 'done'; j.result = { groups: chats.chats.filter((c) => c.channel === channel && c.kind !== 'private').length, novos: n }; j.finished_at = iso(0); }, 2200);
      return wait(j.id, 60);
    },
    async requestGroupCreation(i) {
      needAdmin();
      if (i.channel !== 'whatsapp') ERR('O Telegram não permite que bots criem grupos ou canais. Crie no aplicativo, adicione o bot como administrador e use "Buscar grupos".');
      const name = i.name.trim(); if (name.length < 3 || name.length > 100) ERR('O nome do grupo precisa ter de 3 a 100 caracteres');
      const v = violations(`${name} ${i.description}`); if (v.length) ERR(`Nome/descrição contém termos proibidos: ${v.join(', ')}`);
      const people = [...new Map(i.participants.map((p) => [p.external_id.replace(/\D/g, ''), p])).entries()].filter(([d]) => /^\d{10,15}$/.test(d)).map(([d, p]) => ({ external_id: `${d}@s.whatsapp.net`, display_name: p.display_name }));
      if (!people.length) ERR('Selecione ao menos 1 participante com número válido (DDI+DDD+número)');
      if (people.length > 256) ERR('Máximo de 256 participantes na criação');
      const prev = jobs.find((j) => j.payload.key === i.key); if (prev) return prev.id;
      const recent = createdGroups.filter((t) => now() - t < DAY).length; if (recent >= 3) ERR('Limite de 3 criações de grupo por dia atingido (proteção contra bloqueio do número)');
      createdGroups.push(now());
      const j: ChannelJob = { id: uid(), kind: 'create_group', channel: i.channel, payload: { key: i.key, name, description: i.description, participants: people.map((p) => p.external_id) }, status: 'pending', result: null, last_error: null, requested_at: iso(0), finished_at: null }; jobs.push(j);
      audit('group_creation_requested', 'channel_job', j.id, { nome: name, participantes: people.length });
      setTimeout(() => { j.status = 'claimed'; }, 700);
      setTimeout(() => { if (j.status === 'cancelled') return; const c = chats.createGroup(i.channel, name, i.description, people); j.status = 'done'; j.result = { chat_id: c.id, external_id: c.external_id }; j.finished_at = iso(0); }, 3800);
      return wait(j.id, 60);
    },

    async saveGroupDefaults(config) {
      needAdmin(); const cur = structuredClone(s.settings.int_groups as GroupDefaults);
      const wa = (config.whatsapp ?? {}) as Record<string, unknown>, tg = (config.telegram ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(wa)) {
        if (['only_admins_send', 'lock_info', 'add_disclosure', 'invite_after_create'].includes(k)) { if (typeof v !== 'boolean') ERR(`"${k}" precisa ser verdadeiro ou falso`); }
        else if (k === 'ephemeral_seconds') { if (![0, 86400, 604800, 7776000].includes(v as number)) ERR('Mensagens temporárias: desligado, 24 horas, 7 dias ou 90 dias'); }
        else if (k === 'add_batch_size') { if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 50) ERR('Participantes por lote: de 1 a 50'); }
        else if (k === 'add_delay_s') { if (typeof v !== 'number' || v < 2 || v > 60) ERR('Espera entre lotes: de 2 a 60 segundos'); }
        else ERR(`Campo desconhecido em whatsapp: ${k}`);
      }
      for (const [k, v] of Object.entries(tg)) { if (!['restrict_members_send', 'add_disclosure'].includes(k)) ERR(`Campo desconhecido em telegram: ${k}`); if (typeof v !== 'boolean') ERR(`"${k}" precisa ser verdadeiro ou falso`); }
      s.settings.int_groups = { whatsapp: { ...cur.whatsapp, ...wa }, telegram: { ...cur.telegram, ...tg } }; audit('group_defaults_saved', 'settings', 'int_groups'); await wait(null, 140);
    },
    async requestGroupAction(channel, externalId, action, params = {}) {
      needAdmin();
      const READ = ['info', 'participants', 'invite_code', 'admins'];
      const okWa = ['info', 'participants', 'invite_code', 'revoke_invite', 'set_subject', 'set_description', 'set_only_admins_send', 'set_lock_info', 'set_ephemeral', 'add_participants', 'remove_participants', 'promote', 'demote', 'send_invite', 'leave', 'apply_defaults'];
      const okTg = ['info', 'admins', 'create_invite', 'revoke_invite', 'set_title', 'set_description', 'set_permissions', 'leave'];
      if (!(channel === 'whatsapp' ? okWa : okTg).includes(action)) ERR(`Esta ação não existe para o ${channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}`);
      if (!READ.includes(action) && s.settings.paused) ERR('Envios pausados: retome antes de alterar grupos');
      const chat = chats.chats.find((c) => c.channel === channel && c.external_id === externalId) ?? ERR('Grupo desconhecido: busque os grupos no aplicativo primeiro');
      const text = String(params.subject ?? params.description ?? '').trim();
      if (['set_subject', 'set_title'].includes(action) && (text.length < 1 || text.length > 100)) ERR('O nome precisa ter de 1 a 100 caracteres');
      if (['set_subject', 'set_title', 'set_description'].includes(action)) { const v = violations(text); if (v.length) ERR(`O texto contém termos proibidos: ${v.join(', ')}`); }
      if (action === 'set_description' && text.length > (channel === 'telegram' ? 255 : 2048)) ERR(`Descrição longa demais (máx. ${channel === 'telegram' ? 255 : 2048} caracteres)`);
      if (action === 'set_ephemeral' && ![0, 86400, 604800, 7776000].includes(params.seconds as number)) ERR('Mensagens temporárias: desligado, 24 horas, 7 dias ou 90 dias');
      if (action === 'leave' && params.confirm !== true) ERR('Confirme que o sistema deve sair deste grupo');
      const nums = [...new Set(((params.numbers as string[]) ?? []).map((n) => String(n).replace(/\D/g, '')).filter((n) => /^\d{10,15}$/.test(n)))];
      if (['add_participants', 'remove_participants', 'promote', 'demote', 'send_invite'].includes(action)) { if (!nums.length) ERR('Informe ao menos 1 número válido (DDI+DDD+número)'); if (nums.length > 50) ERR('No máximo 50 números por vez'); }
      const j: ChannelJob = { id: uid(), kind: 'group_action', channel, payload: { external_id: externalId, action, params }, status: 'pending', result: null, last_error: null, requested_at: iso(0), finished_at: null };
      jobs.push(j); if (!READ.includes(action)) audit('group_action_requested', 'channel_job', j.id, { canal: channel, acao: action, grupo: externalId });
      const f = (gflags[chat.id] ??= { only_admins_send: false, lock_info: false, ephemeral_seconds: 0, invite: `https://chat.whatsapp.com/${chat.id.replace(/\W/g, '').slice(0, 10)}AbC` });
      setTimeout(() => { j.status = 'claimed'; }, 350);
      setTimeout(() => {
        if (j.status === 'cancelled') return;
        const list = chats.participants.get(chat.id) ?? []; const res: GroupActionResult = { chat_id: chat.id };
        if (action === 'set_subject' || action === 'set_title') chat.title = text;
        if (action === 'set_description') chat.description = text;
        if (action === 'set_only_admins_send') f.only_admins_send = !!params.value;
        if (action === 'set_lock_info') f.lock_info = !!params.value;
        if (action === 'set_permissions') f.only_admins_send = params.can_send_messages === false;
        if (action === 'set_ephemeral') f.ephemeral_seconds = params.seconds as number;
        if (action === 'add_participants') { for (const n of nums) if (!list.some((p) => p.external_id === n)) list.push({ external_id: n, display_name: `+${n}`, role: 'member', joined_at: iso(0) }); chat.participant_count = (chat.participant_count ?? 0) + nums.length; res.added = nums; }
        if (action === 'remove_participants') { chats.participants.set(chat.id, list.filter((p) => !nums.includes(p.external_id))); chat.participant_count = Math.max(0, (chat.participant_count ?? 0) - nums.length); }
        if (action === 'promote' || action === 'demote') for (const p of list) if (nums.includes(p.external_id)) p.role = action === 'promote' ? 'admin' : 'member';
        if (action === 'send_invite') res.sent_to = nums.length;
        if (action === 'apply_defaults') { const d = (s.settings.int_groups as GroupDefaults).whatsapp; f.only_admins_send = d.only_admins_send; f.lock_info = d.lock_info; f.ephemeral_seconds = d.ephemeral_seconds; res.applied = { only_admins_send: true, lock_info: true, ephemeral: true }; }
        if (action === 'revoke_invite' || action === 'create_invite') { f.invite = `https://${channel === 'whatsapp' ? 'chat.whatsapp.com' : 't.me/+'}${Math.random().toString(36).slice(2, 12)}`; }
        if (['invite_code', 'revoke_invite', 'create_invite'].includes(action)) res.invite_url = f.invite;
        if (action === 'leave') { chat.archived = true; chat.we_are_admin = false; res.left = true; }
        res.flags = { only_admins_send: f.only_admins_send, lock_info: f.lock_info, ephemeral_seconds: f.ephemeral_seconds };
        j.result = res as unknown as Record<string, unknown>; j.status = 'done'; j.finished_at = iso(0);
      }, 1200);
      return wait(j.id, 60);
    },
    async requestChatVerify(channel, ref) {
      needOp(); if (channel !== 'telegram') ERR('Verificação por referência só existe para o Telegram');
      if (!/^(@[A-Za-z0-9_]{5,32}|-?[0-9]{5,20})$/.test(ref.trim())) ERR('Informe @usuario do canal/grupo ou o ID numérico (ex.: -1001234567890)');
      const j: ChannelJob = { id: uid(), kind: 'verify_chat', channel, payload: { ref: ref.trim() }, status: 'pending', result: null, last_error: null, requested_at: iso(0), finished_at: null }; jobs.push(j);
      setTimeout(() => { j.status = 'claimed'; }, 400);
      setTimeout(() => {
        if (j.status === 'cancelled') return;
        if (/fail|semacesso/i.test(ref)) { j.status = 'failed'; j.last_error = 'O bot não é membro desse chat. Adicione o bot como administrador e tente de novo.'; }
        else { const c = chats.addVerified(channel, ref.trim(), true); j.status = 'done'; j.result = { chat_id: c?.id ?? null }; }
        j.finished_at = iso(0);
      }, 1800);
      return wait(j.id, 60);
    },
    async getJob(id) { return wait(jobs.find((j) => j.id === id) ?? ERR('Tarefa inexistente'), 40); },
    async cancelJob(id) { needOp(); const j = jobs.find((x) => x.id === id); if (!j || j.status !== 'pending') ERR('Só é possível cancelar tarefas que ainda não começaram'); j!.status = 'cancelled'; await wait(null, 40); },

    listDestinations: () => wait(s.destinations),
    async saveDestination(d) {
      needAdmin();
      if (d.enabled && !(d.tested_at ?? s.destinations.find((x) => x.id === d.id)?.tested_at)) ERR('Teste o destino antes de habilitar (destinations_enabled_needs_test)');
      if (d.id) { const cur = s.destinations.find((x) => x.id === d.id)!; Object.assign(cur, d); audit('update_destinations', 'destinations', d.id, { campos: d }); }
      else { const nd: Destination = { id: uid(), description: null, enabled: false, categories: [], quiet_start: null, quiet_end: null, max_per_hour: 2, max_per_day: 10, min_interval_s: 600, risk_tier: 'medium', tested_at: null, created_at: iso(0), ...d }; s.destinations.push(nd); audit('insert_destinations', 'destinations', nd.id, { campos: { name: nd.name } }); }
      await wait(null);
    },
    async deleteDestination(id) {
      needAdmin(); if (s.publications.some((p) => p.destination_id === id)) ERR('Destino possui publicações e não pode ser excluído; desabilite-o');
      s.destinations = s.destinations.filter((d) => d.id !== id); audit('delete_destinations', 'destinations', id); await wait(null);
    },
    async requestDestinationTest(id) {
      needOp(); const d = s.destinations.find((x) => x.id === id) ?? ERR('Destino inexistente');
      audit('destination_test_requested', 'destination', id);
      setTimeout(() => { if (!/fail/i.test(d.external_id)) { d.tested_at = iso(0); audit('destination_test_done', 'destination', id, { ok: true }, 'system'); } }, 2200);
      await wait(null);
    },

    /* ---- Integrações (simuladas: nenhum servidor real é contatado) ---- */
    async listIntegrationSecrets() {
      const keys: SecretKey[] = ['evolution_api_key', 'telegram_bot_token', 'telegram_webhook_secret', 'ml_client_secret', 'shopee_secret', 'amazon_client_secret', 'supabase_management_token'];
      return wait(keys.map((key): SecretInfo => { const v = secrets.get(key); return { key, is_set: !!v, hint: v?.hint ?? null, updated_at: v?.at ?? null }; }), 80);
    },
    async setIntegrationSecret(key, value) {
      needAdmin(); const v = value.trim();
      if (/\s/.test(v)) ERR('O valor não pode ter espaços ou quebras de linha');
      if (key === 'telegram_bot_token' && !/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(v)) ERR('Token do bot inválido. O formato é 123456789:AAxxxxxxxx (copie do @BotFather)');
      if (key === 'evolution_api_key' && (v.length < 12 || v.length > 200)) ERR('A chave da Evolution deve ter de 12 a 200 caracteres');
      if (['ml_client_secret', 'shopee_secret', 'amazon_client_secret'].includes(key) && !/^[A-Za-z0-9_.+=/-]{16,200}$/.test(v)) ERR('Chave secreta inválida (16 a 200 caracteres, sem espaços)');
      secrets.set(key, { hint: v.slice(-4), at: iso(0) }); audit('integration_secret_set', 'integration', key); await wait(null, 120);
    },
    async clearIntegrationSecret(key) { needAdmin(); secrets.delete(key); audit('integration_secret_cleared', 'integration', key); await wait(null, 80); },
    async rotateTelegramWebhookSecret() { needAdmin(); secrets.set('telegram_webhook_secret', { hint: uid().slice(-4), at: iso(0) }); audit('integration_secret_rotated', 'integration', 'telegram_webhook_secret'); await wait(null, 100); },
    async saveIntegration(provider, config) {
      needAdmin(); const key = `int_${provider}`; const cur = (s.settings[key] ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(config)) if (!(k in cur)) ERR(`Campo desconhecido: ${k}`);
      const https = (u: unknown, nome: string) => { if (u && !/^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/i.test(String(u))) ERR(`${nome}: use um endereço https:// completo`); };
      if (provider === 'evolution') {
        https(config.base_url, 'Endereço da Evolution'); https(config.webhook_url, 'Webhook');
        if (config.instance !== undefined && config.instance !== '' && !/^[A-Za-z0-9_-]{2,60}$/.test(String(config.instance))) ERR('Nome da instância: 2 a 60 caracteres (letras, números, - e _)');
        const lo = Number(config.send_delay_min_s ?? cur.send_delay_min_s), hi = Number(config.send_delay_max_s ?? cur.send_delay_max_s);
        if (lo < 1 || hi > 120 || lo > hi) ERR('Intervalo entre envios inválido (mínimo 1 s, máximo 120 s, e o mínimo não pode passar do máximo)');
        const nums = (config.alert_numbers as string[] | undefined) ?? [];
        if (nums.some((n) => !/^\d{10,15}$/.test(n))) ERR('Número de alerta inválido: use DDI + DDD + número, só dígitos');
      }
      if (provider === 'telegram') {
        https(config.webhook_url, 'Webhook');
        const mode = (config.mode ?? cur.mode) as string, url = (config.webhook_url ?? cur.webhook_url) as string;
        if (mode === 'webhook' && !url) ERR('No modo webhook, informe o endereço do webhook');
        if (config.admin_chat_id && !/^-?\d{5,20}$/.test(String(config.admin_chat_id))) ERR('ID do chat do administrador: só números (ex.: 123456789)');
      }
      if (provider === 'n8n') https(config.base_url, 'Endereço do n8n');
      s.settings[key] = { ...cur, ...config }; audit('integration_saved', 'integration', provider); await wait(null, 140);
    },
    async requestIntegrationAction(provider, action, payload) {
      needAdmin();
      if (action === 'send_test' && s.settings.paused) ERR('Envios pausados: retome antes de enviar o teste');
      if (provider === 'n8n' && action === 'run_sender' && s.settings.paused) ERR('Envios pausados: retome antes de rodar o ciclo de envio');
      const dup = jobs.find((j) => j.kind === 'integration' && ['pending', 'claimed'].includes(j.status) && j.payload.provider === provider && j.payload.action === action); if (dup) return dup.id;
      const j: ChannelJob = { id: uid(), kind: 'integration', channel: provider === 'evolution' ? 'whatsapp' : provider === 'telegram' ? 'telegram' : null, payload: { provider, action, ...(payload ?? {}) }, status: 'pending', result: null, last_error: null, requested_at: iso(0), finished_at: null };
      jobs.push(j); audit('integration_action', 'integration', `${provider}:${action}`);
      setTimeout(() => { j.status = 'claimed'; }, 350);
      setTimeout(() => {
        if (j.status === 'cancelled') return;
        try { j.result = demoIntegration(provider, action, payload ?? {}); j.status = 'done'; } catch (e) { j.status = 'failed'; j.last_error = e instanceof Error ? e.message : String(e); }
        j.finished_at = iso(0);
      }, 1500);
      return wait(j.id, 60);
    },
    async getDatabaseOverview() {
      const config = (s.settings.int_database ?? { provider: 'supabase', project_ref: '', api_url: '', migration_mode: 'manual' }) as any;
      return wait({ config, migration_count: 11, latest: '011_database_providers.sql', management_token_configured: secrets.has('supabase_management_token') }, 60);
    },
    async saveDatabaseConfig(config) {
      needAdmin(); if (!['supabase', 'postgresql', 'future'].includes(config.provider)) ERR('Provedor inválido');
      if (config.provider !== 'supabase' && config.migration_mode === 'worker') ERR('Atualização pelo worker está disponível somente para Supabase');
      s.settings.int_database = { ...config }; audit('database_config_saved', 'integration', config.provider); await wait(null, 100);
    },
    async setSupabaseManagementToken(value) {
      needAdmin(); const v = value.trim(); if (v.length < 20 || /\s/.test(v)) ERR('Token de gerenciamento inválido');
      secrets.set('supabase_management_token' as SecretKey, { hint: v.slice(-4), at: iso(0) }); audit('database_management_token_set', 'integration', 'supabase'); await wait(null, 100);
    },
    async requestDatabaseMigration() {
      needAdmin(); const c = s.settings.int_database as any; if (!c?.project_ref || c.migration_mode !== 'worker' || !secrets.has('supabase_management_token')) ERR('Configure Supabase, project ref, modo worker e token de gerenciamento');
      const j: ChannelJob = { id: uid(), kind: 'integration', channel: null, payload: { provider: 'database', action: 'apply_migrations' }, status: 'done', result: { applied: [], up_to_date: true }, last_error: null, requested_at: iso(0), finished_at: iso(0) }; jobs.push(j); audit('database_migration_requested', 'integration', 'supabase'); return wait(j.id, 60);
    },

    listConnectors: () => wait(s.connectors),
    async saveConnector(id, patch) {
      needAdmin(); const c = s.connectors.find((x) => x.id === id) ?? ERR('Conector inexistente');
      const next = { ...c, ...patch };
      if (next.mode === 'api_ready' && !next.docs_reviewed_at) ERR('Registre a data da revisão da documentação antes de marcar a API como pronta (connectors_api_ready_needs_review)');
      Object.assign(c, patch); audit('update_connectors', 'connectors', id, { campos: patch }); await wait(null);
    },
    listRuns: () => wait(s.runs),

    listTemplates: () => wait(s.templates),
    async listTemplateVersions(id) { return wait(tver.get(id) ?? []); },
    async saveTemplate(id, patch) {
      needAdmin(); const t = s.templates.find((x) => x.id === id) ?? ERR('Template inexistente');
      if (patch.body !== undefined && patch.body !== t.body) { t.version += 1; tver.get(id)!.unshift({ id: uid(), template_id: id, version: t.version, body: patch.body, changed_at: iso(0) }); }
      Object.assign(t, patch, { updated_at: iso(0) }); audit('update_templates', 'templates', id, { campos: { versao: t.version } }); await wait(null);
    },

    getSettings: () => wait(s.settings),
    async setSetting(k, v) {
      needAdmin(); if (k === 'mode' && !['simulation', 'review', 'auto'].includes(v as string)) ERR('Modo inválido (use simulation, review ou auto)');
      const old = s.settings[k]; s.settings[k] = v; audit('setting_changed', 'settings', k, { de: old, para: v }); await wait(null);
    },
    async setPaused(p, reason) {
      needOp(); if (!p) needAdmin();
      s.settings.paused = p; audit(p ? 'global_pause' : 'global_resume', 'settings', 'paused', { motivo: reason ?? null }); await wait(null);
    },

    async listAudit(f) {
      let r = s.audit.slice().sort((a, b) => b.id - a.id);
      if (f.entity && f.entity !== 'all') r = r.filter((a) => a.entity_type === f.entity);
      if (f.q) r = r.filter((a) => a.action.includes(f.q!.toLowerCase()));
      return wait(r.slice(0, f.limit ?? 200));
    },
    listUsers: () => wait(s.users),
    async channelOverview(channel: Channel) {
      chats.sync();
      const cs = chats.chats.filter((c) => c.channel === channel && !c.archived);
      const ms = cs.flatMap((c) => chats.messages.get(c.id) ?? []).filter((m) => now() - new Date(m.sent_at).getTime() < DAY);
      return wait({ chats: cs.length, groups: cs.filter((c) => c.kind !== 'private').length, participants: cs.reduce((a, c) => a + (c.participant_count ?? 0), 0),
        unread: cs.filter((c) => !c.muted).reduce((a, c) => a + c.unread_count, 0), messages_in_24h: ms.filter((m) => m.direction === 'in').length,
        messages_out_24h: ms.filter((m) => m.direction === 'out').length, outbox_pending: chats.outbox.filter((o) => ['pending', 'claimed'].includes(o.status) && cs.some((c) => c.id === o.chat_id)).length,
        linked_destinations: cs.filter((c) => c.destination_id).length });
    },
    async listChats(f: ChatFilter) {
      chats.sync();
      let r = chats.chats.filter((c) => c.channel === f.channel && c.archived === !!f.archived);
      if (f.kind && f.kind !== 'all') r = r.filter((c) => c.kind === f.kind);
      if (f.unreadOnly) r = r.filter((c) => c.unread_count > 0);
      if (f.q) r = r.filter((c) => c.title.toLowerCase().includes(f.q!.toLowerCase()));
      return wait(r.slice().sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')), 90);
    },
    async getChat(id: string) {
      chats.sync(); const chat = chats.chats.find((c) => c.id === id) ?? ERR('Conversa inexistente');
      return wait({ chat, participants: chats.participants.get(id) ?? [], outbox: chats.outbox.filter((o) => o.chat_id === id && ['pending', 'claimed', 'failed'].includes(o.status)) }, 80);
    },
    async listMessages(chatId: string, limit = 150) { return wait((chats.messages.get(chatId) ?? []).slice(-limit), 80); },
    async markChatRead(id: string) { const c = chats.chats.find((x) => x.id === id); if (c) c.unread_count = 0; },
    async setChatFlags(id: string, f: { archived?: boolean; muted?: boolean }) {
      needOp(); const c = chats.chats.find((x) => x.id === id) ?? ERR('Conversa inexistente');
      if (f.archived !== undefined) c.archived = f.archived; if (f.muted !== undefined) c.muted = f.muted; audit('chat_flags', 'chat', id, f as Record<string, unknown>); await wait(null, 60);
    },
    async linkChatDestination(id: string, destinationId: string | null) {
      needAdmin(); const c = chats.chats.find((x) => x.id === id) ?? ERR('Conversa inexistente');
      if (destinationId) { const d = s.destinations.find((x) => x.id === destinationId) ?? ERR('Destino inexistente'); if (d.channel !== c.channel) ERR('Destino de outro canal'); }
      c.destination_id = destinationId; chats.sync(); audit('chat_linked', 'chat', id, { destination: destinationId }); await wait(null, 60);
    },
    async queueChatMessage(chatId: string, text: string) {
      needOp(); const o = chats.queue(chatId, text, setting<string[]>('banned_terms', [])); audit('chat_message_queued', 'chat', chatId, { outbox: o.id, chars: o.body.length }); await wait(null, 60);
    },
    async cancelOutbox(id: string) {
      needOp(); const o = chats.outbox.find((x) => x.id === id); if (!o || o.status !== 'pending') ERR('Só é possível cancelar mensagens ainda na fila');
      o!.status = 'cancelled'; audit('chat_message_cancelled', 'chat', id); await wait(null, 60);
    },
    async setProfile(userId, r: Role, active) {
      needAdmin();
      const others = s.users.filter((u) => u.role === 'admin' && u.active && u.user_id !== userId).length;
      if (!others && !(r === 'admin' && active)) ERR('Operação deixaria o sistema sem nenhum administrador ativo');
      const u = s.users.find((x) => x.user_id === userId) ?? ERR('Usuário inexistente');
      u.role = r; u.active = active; audit('update_profiles', 'profiles', userId, { campos: { role: r, active } }); await wait(null);
    },
  };
  return api;
}
