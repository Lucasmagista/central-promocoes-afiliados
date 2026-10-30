// Central de Promoções — worker (processo próprio, sem dependências).
// Também serve o redirecionador de links curtos (/r/<código>) e o endpoint interno /metrics.
//
// Roda exatamente a mesma lógica de central-worker.mjs como um processo Node comum:
//   * a cada 5 s   → tarefas pedidas pelo painel (QR code, testes, grupos, conectar conta, coletar agora…)
//   * a cada 1 min → publica ofertas aprovadas (revalidando o preço), responde conversas, vigia WhatsApp/Telegram, aprova automaticamente
//                    o que as regras mandam, coleta ofertas das lojas, acompanha produtos e sincroniza comissões
//   * a cada 15 s  → Radar de grupos (captura promoções dos grupos monitorados, troca o link para o seu e cria a oferta)
//   * a cada 5 min → alertas (fila parada, coleta com erro, token a renovar…)  ·  a cada 6 h → limpeza de dados antigos
//   * HTTP         → recebe os webhooks da Evolution e do Telegram e responde /healthz
//
// Variáveis de ambiente:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (obrigatórias; a service_role fica SÓ aqui)
//   PORT (8787)  ·  CENTRAL_WEBHOOK_MAX_POR_MIN (120)  ·  CENTRAL_WEBHOOK_MAX_KB (256)
//   CENTRAL_ORCAMENTO_ENVIO_MS (50000)  ·  CENTRAL_MAX_ENVIOS (20)  ·  CENTRAL_MAX_TAREFAS (5)
//   CENTRAL_WEBHOOK_SALT (opcional: muda os caminhos secretos dos webhooks)
// Sem dependências: só Node 18+.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as W from './central-worker.mjs';

const num = (k, d, min, max) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : d; };
const SB = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const PORT = num('PORT', 8787, 1, 65535);
const SEG = { webhookPorMin: num('CENTRAL_WEBHOOK_MAX_POR_MIN', 120, 10, 5000), corpoMaxKb: num('CENTRAL_WEBHOOK_MAX_KB', 256, 8, 4096), tarefasPorExecucao: num('CENTRAL_MAX_TAREFAS', 5, 1, 20), enviosPorExecucao: num('CENTRAL_MAX_ENVIOS', 20, 1, 100), orcamentoEnvioMs: num('CENTRAL_ORCAMENTO_ENVIO_MS', 50000, 10000, 100000) };
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (!/^https:\/\/[^/\s]+/.test(SB) || KEY.length < 20) { console.error('Defina SUPABASE_URL (https://…) e SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const keyRole = () => { try { return String(JSON.parse(Buffer.from(KEY.split('.')[1], 'base64').toString('utf8')).role || 'desconhecido'); } catch { return 'desconhecido'; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

// Caminhos secretos e estáveis dos webhooks (derivados da chave: não mudam entre reinícios, não precisam ser configurados).
const salt = process.env.CENTRAL_WEBHOOK_SALT || '';
const pathFor = (kind) => `/hook/${kind}-${crypto.createHmac('sha256', KEY).update(`webhook:${kind}:${salt}`).digest('hex').slice(0, 32)}`;
// Conexões gerenciadas: tudo que é segredo ou endereço fixo vem daqui (worker.env), nunca do painel.
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const INTERNAL_URL = String(process.env.WORKER_INTERNAL_URL || `http://promo-worker:${PORT}`).trim().replace(/\/+$/, '');
const envv = (k) => String(process.env[k] || '').trim();
const MANAGED = {
  evolution: { base_url: envv('EVOLUTION_BASE_URL').replace(/\/+$/, ''), instance: envv('EVOLUTION_INSTANCE'), api_key: envv('EVOLUTION_API_KEY'), webhook_url: envv('EVOLUTION_API_KEY') ? INTERNAL_URL + pathFor('whatsapp') : '' },
  telegram: { bot_token: envv('TELEGRAM_BOT_TOKEN'), webhook_url: PUBLIC_URL.startsWith('https://') ? PUBLIC_URL + pathFor('telegram') : '', webhook_secret: crypto.createHmac('sha256', KEY).update('telegram-webhook-secret:' + salt).digest('hex').slice(0, 48) },
};
const MIG_DIR = process.env.MIGRATIONS_DIR || '/app/migrations';
const ROUTES = { [pathFor('whatsapp')]: 'whatsapp', [pathFor('telegram')]: 'telegram' };

// Saída segura: só http/https, sem redirecionamento e nunca para metadados de nuvem (anti-SSRF).
const assertOut = (u) => { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw new Error('Protocolo não permitido'); if (/^(169\.254\.|0\.0\.0\.0|metadata\.|\[?fe80:)/i.test(x.hostname) || x.hostname === 'metadata.google.internal') throw new Error('Endereço bloqueado por segurança'); };
async function httpCall(o) {
  assertOut(o.url);
  const headers = { ...(o.headers || {}) }; let body = o.body;
  if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(Object.fromEntries(Object.entries(o.form).map(([k, v]) => [k, String(v)]))).toString(); }
  else if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
  try {
    const r = await fetch(o.url, { method: o.method, headers, body, redirect: o.redirect || 'error', signal: AbortSignal.timeout(o.timeoutMs || 20000) });
    const t = await r.text(); let data = t; try { data = JSON.parse(t); } catch { /* texto puro */ }
    return { status: r.status, data, location: r.headers.get('location') || undefined };
  } catch (e) { throw { code: /timeout|abort/i.test(String(e && (e.name + e.message))) ? 'timeout' : 'network' }; }
}

// Limite de taxa em memória (por tipo de webhook).
const buckets = new Map();
const limit = (key, max, windowMs) => {
  const now = Date.now(); for (const [k, b] of buckets) if (now - b.t0 > 600000) buckets.delete(k);
  const e = buckets.get(key) && now - buckets.get(key).t0 < windowMs ? buckets.get(key) : { t0: now, n: 0 }; e.n++; buckets.set(key, e);
  return { ok: e.n <= max, n: e.n, retryAfter: Math.max(1, Math.ceil((e.t0 + windowMs - now) / 1000)) };
};

const FEED_DIR = process.env.FEED_DIR || '/feeds';
const ctx = {
  http: httpCall, now: () => new Date(), rand: Math.random, log: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  sha256hex: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
  env: { has_url: true, has_key: true, supabase_host: hostOf(SB), key_role: keyRole() },
  managed: MANAGED, limits: SEG, limit, hasStore: true,
  // Feed da Shopee: arquivo na pasta do servidor (FEED_DIR) ou endereço https (segue no máximo 3 redirecionamentos, sempre checando o destino)
  openFeed: async (src) => {
    if (src.kind === 'file') return fs.createReadStream(path.join(FEED_DIR, path.basename(String(src.value))));
    let u = String(src.value);
    for (let hop = 0; hop < 4; hop++) {
      assertOut(u); if (!/^https:/i.test(u)) throw new Error('O endereço do feed precisa ser https');
      const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(300000) });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u).toString(); continue; }
      if (!r.ok || !r.body) throw new Error('O feed respondeu HTTP ' + r.status);
      return r.body;
    }
    throw new Error('Redirecionamentos demais ao abrir o feed');
  },
  rpc: async (name, args) => {
    const r = await httpCall({ method: 'POST', url: `${SB}/rest/v1/rpc/${name}`, headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, json: args || {}, timeoutMs: 30000 });
    if (r.status >= 300) throw new Error(`Supabase ${name} respondeu ${r.status}: ${String((r.data && (r.data.message || JSON.stringify(r.data))) || '').slice(0, 200)}`);
    return r.data;
  },
};

// Migrações do projeto (pasta montada só para leitura): o botão "Aplicar migrações pendentes" do painel usa isto.
Object.defineProperty(ctx, 'migrations', { get() {
  try { return fs.readdirSync(MIG_DIR).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/i.test(f)).sort().map((version) => ({ version, sql: fs.readFileSync(path.join(MIG_DIR, version), 'utf8') })); } catch { return []; }
} });

/* ---------- agendador ---------- */
const running = new Set();
const every = (name, ms, fn) => {
  const tick = async () => {
    if (running.has(name)) return; running.add(name);
    try { await fn(); } catch (e) { log(`[${name}] erro:`, String((e && (e.message || (e.code && `sem conexão (${e.code})`))) || e).slice(0, 300)); } finally { running.delete(name); }
  };
  setTimeout(tick, 1500); return setInterval(tick, ms);
};
const stats = { started: new Date().toISOString(), envio: 0, coleta: 0, radar: 0, automacao: 0, sent: 0, failed: 0, repriced: 0, radar_messages: 0, radar_offers: 0, auto_approved: 0, last: {} };
const timers = [
  every('tarefas', 2000, async () => { const r = await W.runJobs(ctx, { max: SEG.tarefasPorExecucao }); if (r.done) log(`[tarefas] ${r.done} executada(s)`); }),
  every('envio', 60000, async () => {
    const a = await W.runSender(ctx, { budgetMs: SEG.orcamentoEnvioMs, maxPerRun: SEG.enviosPorExecucao });
    const b = await W.runMonitor(ctx);
    stats.envio++; stats.sent += a.sent; stats.failed += a.failed; stats.repriced += a.repriced || 0; stats.last.envio = new Date().toISOString();
    if (a.sent || a.failed || a.unknown || a.repriced) log('[envio]', JSON.stringify({ ...a, monitor: b }));
  }),
  every('automacao', 60000, async () => {
    const r = await W.runAutomation(ctx); stats.automacao++; stats.last.automacao = new Date().toISOString();
    const n = r.auto && r.auto.approved || 0; stats.auto_approved += n; if (n || (r.auto && r.auto.errors)) log('[automacao]', JSON.stringify(r));
  }),
  every('coleta', 60000, async () => {
    const c = await W.runCollectors(ctx).catch((e) => ({ erro: String((e && e.message) || e).slice(0, 100) }));
    const w = await W.runWatchlist(ctx).catch(() => ({}));
    const m = await W.runCommissionSync(ctx).catch(() => ({}));
    const h = await W.runHousekeeping(ctx).catch(() => null);
    stats.coleta++; stats.last.coleta = new Date().toISOString();
    if (Object.keys(c).length || w.offers || m.synced || h) log('[coleta]', JSON.stringify({ coleta: c, acompanhados: w, comissoes: m, limpeza: h }));
  }),
  every('feed', 600000, async () => { const r = await W.runFeedImport(ctx); if (r && r.feed) log('[feed]', r.feed); }),
  every('radar', 15000, async () => {
    const r = await W.runRadar(ctx, { max: 10 }); stats.radar++; stats.last.radar = new Date().toISOString();
    if (r.messages) { stats.radar_messages += r.messages; stats.radar_offers += r.created || 0; log('[radar]', JSON.stringify(r)); }
  }),
  every('alertas', 300000, async () => { const r = await W.runAlerts(ctx); if (r.fired && r.fired.length) log('[alertas]', r.fired.join(', ')); }),
];

/* ---------- HTTP: webhooks de entrada ---------- */
const readBody = (req, maxBytes) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > maxBytes) { reject(Object.assign(new Error('grande demais'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
});
const reply = (res, status, data, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(data)); };

// Link curto: registra o clique (sem IP nem telefone: só um hash do dia) e redireciona. Robôs de pré-visualização não contam.
const BOT_UA = /(whatsapp|telegrambot|facebookexternalhit|twitterbot|slackbot|discordbot|googlebot|bingbot|\bbot\b|crawler|spider|preview|curl|wget|python-requests|headless)/i;
const uaFamily = (ua) => /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : ua ? 'Outro' : 'Desconhecido';
async function redirectShort(req, res, code, xff) {
  const ip = xff.split(',')[0].trim() || req.socket.remoteAddress || '';
  if (!limit('r:' + ip, 120, 60000).ok) return reply(res, 429, { ok: false });
  const ua = String(req.headers['user-agent'] || ''); let ref = ''; try { ref = req.headers.referer ? new URL(String(req.headers.referer)).hostname : ''; } catch { /* sem referrer */ }
  try {
    let target;
    if (BOT_UA.test(ua) || req.method === 'HEAD') target = await ctx.rpc('resolve_short_link', { p_code: code });
    else {
      const day = new Date().toISOString().slice(0, 10);
      const visitor = crypto.createHash('sha256').update(`${ip}|${ua}|${day}|${KEY.slice(-12)}`).digest('hex').slice(0, 32);
      target = await ctx.rpc('record_click', { p_code: code, p_visitor_hash: visitor, p_ua_family: uaFamily(ua), p_referrer_host: ref });
    }
    if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) return reply(res, 404, { ok: false });
    res.writeHead(302, { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); return res.end();
  } catch (e) { log('[redirect] erro:', String((e && e.message) || e).slice(0, 150)); return reply(res, 502, { ok: false }); }
}

const server = http.createServer(async (req, res) => {
  const path = String(req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/healthz') return reply(res, 200, { ok: true });
  const xff = String(req.headers['x-forwarded-for'] || '');
  if (req.method === 'GET' && (path === '/metrics' || path === '/status')) {
    if (xff) return reply(res, 404, { ok: false }); // só pela rede interna (o proxy sempre acrescenta x-forwarded-for)
    if (path === '/status') return reply(res, 200, { ok: true, ...stats });
    const lines = Object.entries(stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => `promo_worker_${k} ${v}`).join('\n') + '\n';
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }); return res.end(lines);
  }
  const mShort = (req.method === 'GET' || req.method === 'HEAD') && (/^\/r\/([A-Za-z0-9_-]{4,32})$/.exec(path) || /^\/([a-f0-9]{8})$/.exec(path));
  if (mShort) return redirectShort(req, res, mShort[1], xff);
  if (path === '/ingest/browser') {
    // Coletor do navegador (extensão): produtos lidos nas páginas do programa de afiliados. Exige o token gerado no painel.
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-ingest-token', 'access-control-allow-methods': 'POST, OPTIONS' }); return res.end(); }
    if (req.method !== 'POST') return reply(res, 404, { ok: false });
    const ip = xff.split(',')[0].trim() || req.socket.remoteAddress || '';
    if (!limit('ingest:' + ip, 20, 60000).ok) return reply(res, 429, { ok: false });
    try {
      const raw = await readBody(req, 1024 * 1024); let body; try { body = JSON.parse(raw); } catch { return reply(res, 400, { ok: false }); }
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const r = await W.handleBrowserIngest(ctx, headers, body); const { status, ...rest } = r;
      res.setHeader && res.setHeader('access-control-allow-origin', '*'); return reply(res, status || 200, rest, { 'access-control-allow-origin': '*' });
    } catch (e) { if (e && e.status === 413) return reply(res, 413, { ok: false }); log('[ingest] erro:', String((e && e.message) || e).slice(0, 200)); return reply(res, 500, { ok: false }); }
  }
  const kind = ROUTES[path];
  if (req.method !== 'POST' || !kind) return reply(res, 404, { ok: false });
  try {
    const raw = await readBody(req, SEG.corpoMaxKb * 1024);
    let body; try { body = JSON.parse(raw); } catch { return reply(res, 400, { ok: false }); }
    const item = { body, headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])) };
    const g = W.guardWebhook(ctx, kind, item);
    if (g.blocked) return reply(res, g.status, { ok: false }, g.retryAfter ? { 'retry-after': String(g.retryAfter) } : {});
    const r = kind === 'telegram' ? await W.handleTelegramWebhook(ctx, item.headers, body) : await W.handleEvolutionWebhook(ctx, body);
    return reply(res, r.status || 200, { ok: r.ok === true });
  } catch (e) {
    if (e && e.status === 413) return reply(res, 413, { ok: false });
    log(`[webhook ${kind}] erro:`, String((e && e.message) || e).slice(0, 200)); return reply(res, 500, { ok: false });
  }
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(PORT, () => {
  log(`Central worker no ar na porta ${PORT} · banco ${hostOf(SB)} · chave ${keyRole()}`);
  if (keyRole() === 'anon') log('ATENÇÃO: esta é a chave ANON. Use a service_role.');
  log(`Conexões pelo servidor → WhatsApp: ${MANAGED.evolution.api_key ? 'sim (' + (MANAGED.evolution.base_url || 'endereço do painel') + ', instância ' + (MANAGED.evolution.instance || 'do painel') + ')' : 'não (usa o cadastro do painel)'} · Telegram: ${MANAGED.telegram.bot_token ? 'sim' + (MANAGED.telegram.webhook_url ? ' (webhook público)' : ' (consulta; defina PUBLIC_URL para webhook)') : 'não (usa o cadastro do painel)'}`);
  log(`Webhook do WhatsApp (Evolution, rede interna): http://promo-worker:${PORT}${pathFor('whatsapp')}`);
  log(`   (ou público, via Nginx Proxy Manager: https://<seu-dominio>${pathFor('whatsapp')})`);
  log(`Webhook do Telegram (precisa ser público): https://<seu-dominio>${pathFor('telegram')}`);
});

const stop = () => { log('encerrando…'); timers.forEach(clearInterval); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
