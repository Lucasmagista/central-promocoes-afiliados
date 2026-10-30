// Central de Promoções — worker (processo próprio, sem dependências).
//
// Roda exatamente a mesma lógica de central-worker.mjs como um processo Node comum:
//   * a cada 5 s   → tarefas pedidas pelo painel (QR code, testes, grupos, conectar conta, coletar agora…)
//   * a cada 1 min → publica ofertas aprovadas, responde conversas, vigia WhatsApp/Telegram e coleta ofertas das lojas
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
const ROUTES = { [pathFor('whatsapp')]: 'whatsapp', [pathFor('telegram')]: 'telegram' };

// Saída segura: só http/https, sem redirecionamento e nunca para metadados de nuvem (anti-SSRF).
const assertOut = (u) => { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw new Error('Protocolo não permitido'); if (/^(169\.254\.|0\.0\.0\.0|metadata\.|\[?fe80:)/i.test(x.hostname) || x.hostname === 'metadata.google.internal') throw new Error('Endereço bloqueado por segurança'); };
async function httpCall(o) {
  assertOut(o.url);
  const headers = { ...(o.headers || {}) }; let body = o.body;
  if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(Object.fromEntries(Object.entries(o.form).map(([k, v]) => [k, String(v)]))).toString(); }
  else if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
  try {
    const r = await fetch(o.url, { method: o.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs || 20000) });
    const t = await r.text(); let data = t; try { data = JSON.parse(t); } catch { /* texto puro */ }
    return { status: r.status, data };
  } catch (e) { throw { code: /timeout|abort/i.test(String(e && (e.name + e.message))) ? 'timeout' : 'network' }; }
}

// Limite de taxa em memória (por tipo de webhook).
const buckets = new Map();
const limit = (key, max, windowMs) => {
  const now = Date.now(); for (const [k, b] of buckets) if (now - b.t0 > 600000) buckets.delete(k);
  const e = buckets.get(key) && now - buckets.get(key).t0 < windowMs ? buckets.get(key) : { t0: now, n: 0 }; e.n++; buckets.set(key, e);
  return { ok: e.n <= max, n: e.n, retryAfter: Math.max(1, Math.ceil((e.t0 + windowMs - now) / 1000)) };
};

const ctx = {
  http: httpCall, now: () => new Date(), rand: Math.random, log: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  sha256hex: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
  env: { has_url: true, has_key: true, supabase_host: hostOf(SB), key_role: keyRole() },
  migrations: [], limits: SEG, limit, hasStore: true,
  rpc: async (name, args) => {
    const r = await httpCall({ method: 'POST', url: `${SB}/rest/v1/rpc/${name}`, headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, json: args || {}, timeoutMs: 30000 });
    if (r.status >= 300) throw new Error(`Supabase ${name} respondeu ${r.status}: ${String((r.data && (r.data.message || JSON.stringify(r.data))) || '').slice(0, 200)}`);
    return r.data;
  },
};

/* ---------- agendador ---------- */
const running = new Set();
const every = (name, ms, fn) => {
  const tick = async () => {
    if (running.has(name)) return; running.add(name);
    try { await fn(); } catch (e) { log(`[${name}] erro:`, String((e && (e.message || (e.code && `sem conexão (${e.code})`))) || e).slice(0, 300)); } finally { running.delete(name); }
  };
  setTimeout(tick, 1500); return setInterval(tick, ms);
};
const timers = [
  every('tarefas', 5000, async () => { const r = await W.runJobs(ctx, { max: SEG.tarefasPorExecucao }); if (r.done) log(`[tarefas] ${r.done} executada(s)`); }),
  every('ciclo', 60000, async () => {
    const a = await W.runSender(ctx, { budgetMs: SEG.orcamentoEnvioMs, maxPerRun: SEG.enviosPorExecucao });
    const b = await W.runMonitor(ctx);
    const c = await W.runCollectors(ctx).catch(() => ({}));
    if (a.sent || a.failed || a.unknown || Object.keys(c).length) log('[ciclo]', JSON.stringify({ ...a, monitor: b, coleta: c }));
  }),
];

/* ---------- HTTP: webhooks de entrada ---------- */
const readBody = (req, maxBytes) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > maxBytes) { reject(Object.assign(new Error('grande demais'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
});
const reply = (res, status, data, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(data)); };

const server = http.createServer(async (req, res) => {
  const path = String(req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/healthz') return reply(res, 200, { ok: true });
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
  log(`Webhook do WhatsApp (Evolution, rede interna): http://promo-worker:${PORT}${pathFor('whatsapp')}`);
  log(`   (ou público, via Nginx Proxy Manager: https://<seu-dominio>${pathFor('whatsapp')})`);
  log(`Webhook do Telegram (precisa ser público): https://<seu-dominio>${pathFor('telegram')}`);
});

const stop = () => { log('encerrando…'); timers.forEach(clearInterval); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
