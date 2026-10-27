/**
 * Conexão direta do navegador com a Evolution API (sem passar pelo n8n), para gerar o QR code na hora.
 *
 * - A chave (apikey) fica só na memória/sessão desta aba; nunca é enviada ao banco por aqui.
 * - Depende de CORS: o servidor da Evolution precisa aceitar o endereço do painel (variável CORS_ORIGIN).
 * - No modo demonstração (?demo) nada sai do navegador: um servidor falso responde.
 */
export interface DirectInfo { state: string; phone: string | null; profile: string | null }
export interface DirectQr { qr: string | null; pairingCode: string | null }

export class DirectError extends Error {
  constructor(message: string, public kind: 'cors' | 'auth' | 'missing' | 'timeout' | 'server' | 'other' = 'other') { super(message); }
}

const toDataUrl = (b64: unknown): string | null => {
  if (typeof b64 !== 'string' || !b64) return null;
  if (b64.startsWith('data:image/')) return b64.length < 600000 ? b64 : null;
  return /^[A-Za-z0-9+/=]+$/.test(b64) && b64.length < 600000 ? 'data:image/png;base64,' + b64 : null;
};
const phoneOf = (jid: unknown) => { const m = /^(\d{8,20})(?::\d+)?@/.exec(String(jid ?? '')); return m ? m[1] : null; };

export interface DirectClient {
  ping(): Promise<{ version: string | null; ms: number }>;
  info(): Promise<DirectInfo>;
  create(): Promise<DirectQr>;
  connect(pairingNumber?: string): Promise<DirectQr>;
  restart(): Promise<void>;
  logout(): Promise<void>;
  setWebhook(url: string): Promise<void>;
  listInstances(): Promise<{ name: string; state: string; phone: string | null }[]>;
}

export function createDirectClient(baseUrl: string, apikey: string, instance: string): DirectClient {
  const base = baseUrl.trim().replace(/\/+$/, '').replace(/\/manager$/, '');
  const inst = encodeURIComponent(instance.trim());
  if (!/^https?:\/\//.test(base)) throw new DirectError('Informe o endereço da Evolution começando com https://');
  const call = async (method: string, path: string, body?: unknown, ms = 20000) => {
    let r: Response;
    try { r = await fetch(base + path, { method, headers: { apikey, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) }); }
    catch (e) {
      if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new DirectError('A Evolution não respondeu a tempo.', 'timeout');
      throw new DirectError(`O navegador não conseguiu falar com ${base}. Ou o servidor está fora do ar, ou ele não libera o endereço deste painel (CORS). Na Evolution, defina CORS_ORIGIN com o endereço do painel (ou use o modo “Via n8n”).`, 'cors');
    }
    const text = await r.text(); let data: any = text; try { data = JSON.parse(text); } catch { /* texto */ }
    if (r.status === 401 || r.status === 403) throw new DirectError('A Evolution recusou a chave de acesso (apikey).', 'auth');
    return { status: r.status, data };
  };
  const fail = (r: { status: number; data: any }) => new DirectError(`A Evolution respondeu HTTP ${r.status}${r.data && (r.data.message || r.data.error) ? ': ' + String(Array.isArray(r.data.message) ? r.data.message.join('; ') : r.data.message ?? r.data.error).slice(0, 200) : ''}`, r.status >= 500 ? 'server' : 'other');
  const qrOf = (d: any): DirectQr => { const q = d?.qrcode ?? d ?? {}; return { qr: toDataUrl(q.base64 ?? d?.base64), pairingCode: typeof (q.pairingCode ?? d?.pairingCode) === 'string' ? (q.pairingCode ?? d?.pairingCode) : null }; };
  return {
    async ping() { const t = Date.now(); const r = await call('GET', '/', undefined, 8000); return { version: r.data && typeof r.data === 'object' && r.data.version ? String(r.data.version) : null, ms: Date.now() - t }; },
    async info() {
      const s = await call('GET', `/instance/connectionState/${inst}`);
      if (s.status === 404) return { state: 'missing', phone: null, profile: null };
      if (s.status >= 400) throw fail(s);
      const state = String(s.data?.instance?.state ?? s.data?.state ?? 'unknown');
      const o = await call('GET', `/instance/fetchInstances?instanceName=${inst}`).catch(() => null);
      const it = o && o.status < 400 ? (Array.isArray(o.data) ? o.data[0] : o.data) : null; const x = it?.instance && typeof it.instance === 'object' ? { ...it, ...it.instance } : it ?? {};
      return { state, phone: phoneOf(x.ownerJid ?? x.owner) ?? (x.number ? String(x.number).replace(/\D/g, '') : null), profile: x.profileName ?? null };
    },
    async create() { const r = await call('POST', '/instance/create', { instanceName: instance.trim(), qrcode: true, integration: 'WHATSAPP-BAILEYS' }, 30000); if (r.status >= 400) throw fail(r); return qrOf(r.data); },
    async connect(n) { const r = await call('GET', `/instance/connect/${inst}${n ? `?number=${encodeURIComponent(n)}` : ''}`, undefined, 30000); if (r.status === 404) throw new DirectError('A instância não existe. Crie a instância primeiro.', 'missing'); if (r.status >= 400) throw fail(r); return qrOf(r.data); },
    async restart() { for (const m of ['PUT', 'POST']) { const r = await call(m, `/instance/restart/${inst}`, undefined, 30000); if (r.status < 300) return; if (![404, 405].includes(r.status)) throw fail(r); } throw new DirectError('Esta versão da Evolution não reinicia por API.'); },
    async logout() { const r = await call('DELETE', `/instance/logout/${inst}`); if (r.status >= 400 && r.status !== 404) throw fail(r); },
    async setWebhook(url) {
      const events = ['MESSAGES_UPSERT'];
      let r = await call('POST', `/webhook/set/${inst}`, { webhook: { enabled: true, url, byEvents: false, base64: false, events } });
      if (r.status === 400) r = await call('POST', `/webhook/set/${inst}`, { enabled: true, url, webhook_by_events: false, webhook_base64: false, events });
      if (r.status >= 400) throw fail(r);
    },
    async listInstances() {
      const r = await call('GET', '/instance/fetchInstances'); if (r.status >= 400) throw fail(r);
      return (Array.isArray(r.data) ? r.data : []).map((it: any) => { const s = it?.instance && typeof it.instance === 'object' ? { ...it, ...it.instance } : it ?? {}; return { name: String(s.name ?? s.instanceName ?? ''), state: String(s.connectionStatus ?? s.status ?? s.state ?? ''), phone: phoneOf(s.ownerJid ?? s.owner) }; }).filter((x: { name: string }) => x.name);
    },
  };
}

/** Servidor falso do modo demonstração: não faz nenhuma requisição de rede. */
export function createDemoDirectClient(instance: string): DirectClient {
  let state: 'missing' | 'close' | 'connecting' | 'open' = 'missing'; let scanAt = 0;
  const wait = <T,>(v: T, ms = 450) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const cell = (seed: number) => { let t = seed; return () => { t = (Math.imul(t ^ (t >>> 15), 2246822507) + 374761393) | 0; return ((t >>> 0) % 100) / 100; }; };
  const fakeQr = (): string => {
    const n = 29, c = 8, r = cell(Date.now() % 100000); let d = '';
    const finder = (x: number, y: number) => x < 7 && y < 7 || x >= n - 7 && y < 7 || x < 7 && y >= n - 7;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let on: boolean;
      if (finder(x, y)) { const lx = x < 7 ? x : x - (n - 7), ly = y < 7 ? y : y - (n - 7); on = lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4); }
      else on = r() > 0.52;
      if (on) d += `<rect x="${x * c + 8}" y="${y * c + 8}" width="${c}" height="${c}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="248" height="248" viewBox="0 0 248 248"><rect width="248" height="248" fill="#fff"/><g fill="#111">${d}</g></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  };
  return {
    ping: () => wait({ version: '2.3.7 (demonstração)', ms: 38 }, 200),
    async info() { if (state === 'connecting' && scanAt && Date.now() > scanAt) state = 'open'; return wait({ state, phone: state === 'open' ? '5511999990001' : null, profile: state === 'open' ? 'Hubly (demonstração)' : null }, 200); },
    async create() { state = 'connecting'; scanAt = Date.now() + 9000; return wait({ qr: fakeQr(), pairingCode: null }); },
    async connect(n) { if (state === 'missing') throw new DirectError('A instância não existe. Crie a instância primeiro.', 'missing'); if (state !== 'open') { state = 'connecting'; scanAt = scanAt || Date.now() + 9000; } return wait({ qr: fakeQr(), pairingCode: n ? 'DEMO-1234' : null }); },
    async restart() { await wait(null); },
    async logout() { state = 'close'; scanAt = 0; await wait(null); },
    async setWebhook() { await wait(null); },
    async listInstances() { return wait(state === 'missing' ? [] : [{ name: instance, state, phone: state === 'open' ? '5511999990001' : null }], 250); },
  };
}

/** Chave (apikey) lembrada neste navegador, para o QR direto funcionar sem pedir de novo. Só vai ao servidor da Evolution, nunca ao banco por aqui. */
const KEY_STORE = 'central.evo.key';
export const evoKey = {
  get(): string { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } },
  set(v: string) { try { if (v) localStorage.setItem(KEY_STORE, v); else localStorage.removeItem(KEY_STORE); } catch { /* sem armazenamento: some ao recarregar */ } },
};
