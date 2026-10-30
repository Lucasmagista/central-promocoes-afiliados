// Central de Promoções — lógica do worker.
//
// Este arquivo é a ÚNICA fonte da lógica de integração. O servidor (deploy/worker/server.mjs) o executa e o teste
// `npm run worker:test` o executa contra servidores falsos (nada sai da sua máquina).
//
// Contrato (ctx):
//   urls (opcional) -> { telegram, ml } para testes
//   rpc(nome, args)  -> chama uma função do Supabase com a chave service_role; devolve o JSON
//   http({method,url,headers,json,form,body,timeoutMs}) -> { status, data }  (lança { code:'timeout'|'network' })
//   sleep(ms), now() -> Date, rand() -> 0..1, log(msg), sha256hex(texto) -> string (opcional), env -> { supabase_host, has_url, has_key }
//
// Regras de segurança que este código segue:
//   * resultado ambíguo (timeout/5xx depois de enviar) => publicação "unknown"; NUNCA reenvia sozinho;
//   * segredos só são lidos de get_integration_runtime() e nunca vão para logs, status ou resultados;
//   * criar grupo e teste de envio não são repetidos (o banco falha a tarefa se a reserva vencer).

const DEFAULT_TG = 'https://api.telegram.org';
const clean = (s) => String(s ?? '').replace(/[A-Za-z0-9+/=_-]{40,}/g, '[oculto]').replace(/\d{9,}:[A-Za-z0-9_-]{30,}/g, '[token]').slice(0, 300);
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const jidPhone = (jid) => { const m = /^(\d{8,20})(?::\d+)?@/.exec(String(jid || '')); return m ? m[1] : ''; };
const isGroupJid = (j) => /@g\.us$/.test(String(j || ''));

/* SHA-256 e HMAC-SHA256 em JavaScript puro (UTF-8): sem depender de módulos do Node (o mesmo código roda nos testes). */
const utf8 = (str) => { const out = []; for (const ch of unescape(encodeURIComponent(String(str)))) out.push(ch.charCodeAt(0)); return out; };
const toHex = (bytes) => bytes.map((v) => (v & 255).toString(16).padStart(2, '0')).join('');
function sha256Bytes(input) {
  const bytes = input.slice();
  const K = []; { let n = 2, c = 0; while (c < 64) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (p) { K.push((Math.cbrt(n) % 1 * 4294967296) | 0); c++; } n++; } }
  const H = []; { let n = 2, c = 0; while (c < 8) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (p) { H.push((Math.sqrt(n) % 1 * 4294967296) | 0); c++; } n++; } }
  const l = bytes.length; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(l * 8 / 4294967296), lo = (l * 8) >>> 0; for (const v of [hi, lo]) bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < bytes.length; o += 64) {
    const w = []; for (let i = 0; i < 16; i++) w[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) { const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out;
}
export function sha256Hex(str) { return toHex(sha256Bytes(utf8(str))); }
export function hmacSha256Hex(key, msg) {
  let k = utf8(key); if (k.length > 64) k = sha256Bytes(k); while (k.length < 64) k.push(0);
  const inner = sha256Bytes([...k.map((b) => b ^ 0x36), ...utf8(msg)]);
  return toHex(sha256Bytes([...k.map((b) => b ^ 0x5c), ...inner]));
}

/* ------------------------------------------------------------------ Evolution */
export function evolutionClient(ctx, cfg, key) {
  const base = String(cfg.base_url || '').replace(/\/+$/, '');
  const inst = encodeURIComponent(cfg.instance || '');
  const call = (method, path, json, timeoutMs = 20000) => ctx.http({ method, url: base + path, headers: { apikey: key }, json, timeoutMs });
  call.inst = inst;
  return {
    ready: () => !!base && !!key,
    ping: async () => { const t = ctx.now().getTime(); const r = await call('GET', '/', undefined, 8000); const d = r.data && typeof r.data === 'object' ? r.data : {}; return { ok: r.status < 500, ms: ctx.now().getTime() - t, version: d.version || null }; },
    state: async () => { const r = await call('GET', `/instance/connectionState/${inst}`); if (r.status === 404) return 'missing'; if (r.status >= 400) throw httpErr('evolution', r); const d = r.data || {}; return String((d.instance && d.instance.state) || d.state || 'unknown'); },
    fetchOne: async () => {
      const r = await call('GET', `/instance/fetchInstances?instanceName=${inst}`); if (r.status >= 400) throw httpErr('evolution', r);
      const it = Array.isArray(r.data) ? r.data[0] : r.data; if (!it) return null;
      const s = it.instance && typeof it.instance === 'object' ? { ...it, ...it.instance } : it;
      return { name: s.name || s.instanceName || cfg.instance, state: String(s.connectionStatus || s.status || s.state || ''), phone: jidPhone(s.ownerJid || s.owner || '') || digits(s.number), profile: s.profileName || null };
    },
    listAll: async () => {
      const r = await call('GET', '/instance/fetchInstances'); if (r.status >= 400) throw httpErr('evolution', r);
      return (Array.isArray(r.data) ? r.data : []).map((it) => { const s = it && it.instance && typeof it.instance === 'object' ? { ...it, ...it.instance } : it || {}; return { name: String(s.name || s.instanceName || ''), state: String(s.connectionStatus || s.status || s.state || ''), phone: jidPhone(s.ownerJid || s.owner || '') }; }).filter((x) => x.name);
    },
    create: async () => {
      const r = await call('POST', '/instance/create', { instanceName: cfg.instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' }, 30000);
      if (r.status >= 400) throw httpErr('evolution', r);
      const q = (r.data && r.data.qrcode) || {}; return { qr: toDataUrl(q.base64), pairing_code: typeof q.pairingCode === 'string' ? q.pairingCode : null };
    },
    connect: async (pairingNumber) => {
      const r = await call('GET', `/instance/connect/${inst}${pairingNumber ? `?number=${encodeURIComponent(pairingNumber)}` : ''}`, undefined, 30000);
      if (r.status >= 400) throw httpErr('evolution', r);
      const d = r.data || {}; return { qr: toDataUrl(d.base64 || (d.qrcode && d.qrcode.base64)), pairing_code: typeof d.pairingCode === 'string' ? d.pairingCode : null, count: d.count ?? null };
    },
    restart: async () => { for (const m of ['PUT', 'POST']) { const r = await call(m, `/instance/restart/${inst}`, undefined, 30000); if (r.status < 300) return true; if (![404, 405].includes(r.status)) throw httpErr('evolution', r); } throw new Error('A Evolution não aceita reiniciar por API nesta versão'); },
    logout: async () => { const r = await call('DELETE', `/instance/logout/${inst}`); return r.status < 300 || r.status === 404; },
    remove: async () => { const r = await call('DELETE', `/instance/delete/${inst}`, undefined, 30000); return r.status < 300 || r.status === 404; },
    getWebhook: async () => { const r = await call('GET', `/webhook/find/${inst}`); if (r.status >= 400) return null; const j = r.data || {}; const w = j.webhook && typeof j.webhook === 'object' ? j.webhook : j; return { enabled: !!w.enabled, url: String(w.url || ''), events: Array.isArray(w.events) ? w.events : [] }; },
    setWebhook: async (url) => {
      const events = ['MESSAGES_UPSERT'];
      const one = (body) => call('POST', `/webhook/set/${inst}`, body, 15000);
      let r = await one({ webhook: { enabled: true, url, byEvents: false, base64: false, events } });
      if (r.status === 400) r = await one({ enabled: true, url, webhook_by_events: false, webhook_base64: false, events });
      if (r.status >= 400) throw httpErr('evolution', r); return true;
    },
    async send(method, body) {
      let r;
      try { r = await call('POST', `/message/${method}/${inst}`, body, method === 'sendMedia' ? 60000 : 20000); }
      catch (e) { return { ok: false, ambiguous: true, code: e && e.code === 'timeout' ? 'timeout' : 'network', error: e && e.code === 'timeout' ? 'a Evolution não respondeu a tempo' : 'sem conexão com a Evolution' }; }
      if (r.status < 300) return { ok: true, messageId: r.data && r.data.key && typeof r.data.key.id === 'string' ? r.data.key.id.slice(0, 80) : null };
      return { ok: false, ...explainEvolution(r.status, r.data) };
    },
    groups: async () => {
      const r = await call('GET', `/group/fetchAllGroups/${inst}?getParticipants=false`, undefined, 40000); if (r.status >= 400) throw httpErr('evolution', r);
      return (Array.isArray(r.data) ? r.data : []).flatMap((g) => { const id = g && (g.id || g.jid || g.groupJid); const t = g && (g.subject || g.name); if (!isGroupJid(id) || typeof t !== 'string') return []; return [{ external_id: id, kind: 'group', title: t.trim().slice(0, 120) || 'Grupo sem nome', participant_count: Number.isFinite(g.size) ? g.size : undefined, we_are_admin: !!(g.owner || g.isAdmin) }]; });
    },
    group: groupApi(call),
    createGroup: async (name, description, participants) => {
      const r = await call('POST', `/group/create/${inst}`, { subject: name, description: description || '', participants }, 60000);
      if (r.status >= 400) throw httpErr('evolution', r);
      const d = r.data || {}; const id = d.id || d.groupJid || d.jid; if (!isGroupJid(id)) throw new Error('A Evolution não devolveu o identificador do grupo');
      return { external_id: id, title: d.subject || name, participants: (Array.isArray(d.participants) ? d.participants : []).map((p) => ({ external_id: jidPhone(p.id || p.jid || p) || digits(p.id || p), display_name: '+' + (jidPhone(p.id || p.jid || p) || digits(p.id || p)), role: p.admin ? 'admin' : 'member' })).filter((p) => p.external_id) };
    },
  };
}

/* Gerenciamento de grupos na Evolution v2. Alterações nunca repetem: erro de rede vira "resultado incerto". */
function groupApi(call) {
  const q = (jid) => `?groupJid=${encodeURIComponent(jid)}`;
  const ok = (r) => { if (r.status >= 400) throw httpErr('evolution', r); return r.data; };
  const mut = async (method, path, body, ms = 30000) => {
    let r; try { r = await call(method, path, body, ms); }
    catch { const e = new Error('Resultado incerto: a Evolution não confirmou. Confira no aplicativo antes de tentar de novo'); e.uncertain = true; throw e; }
    if (r.status >= 500) { const e = new Error('Resultado incerto: erro interno da Evolution. Confira no aplicativo antes de tentar de novo'); e.uncertain = true; throw e; }
    return ok(r);
  };
  return {
    info: async (jid) => ok(await call('GET', `/group/findGroupInfos/${call.inst}${q(jid)}`, undefined, 30000)),
    participants: async (jid) => { const d = ok(await call('GET', `/group/participants/${call.inst}${q(jid)}`, undefined, 40000)); return Array.isArray(d) ? d : (d && d.participants) || []; },
    inviteCode: async (jid) => { const d = ok(await call('GET', `/group/inviteCode/${call.inst}${q(jid)}`)) || {}; return d.inviteUrl || (d.code ? 'https://chat.whatsapp.com/' + d.code : (d.inviteCode ? 'https://chat.whatsapp.com/' + d.inviteCode : null)); },
    revokeInvite: async (jid) => { const d = (await mut('POST', `/group/revokeInviteCode/${call.inst}${q(jid)}`, {})) || {}; return d.inviteUrl || (d.code ? 'https://chat.whatsapp.com/' + d.code : null); },
    subject: (jid, subject) => mut('POST', `/group/updateGroupSubject/${call.inst}${q(jid)}`, { subject }),
    description: (jid, description) => mut('POST', `/group/updateGroupDescription/${call.inst}${q(jid)}`, { description }),
    setting: (jid, action) => mut('POST', `/group/updateSetting/${call.inst}${q(jid)}`, { action }),
    ephemeral: (jid, expiration) => mut('POST', `/group/toggleEphemeral/${call.inst}${q(jid)}`, { expiration }),
    participant: (jid, action, participants) => mut('POST', `/group/updateParticipant/${call.inst}${q(jid)}`, { action, participants }, 60000),
    sendInvite: (jid, numbers, description) => mut('POST', `/group/sendInvite/${call.inst}`, { groupJid: jid, description, numbers }, 60000),
    leave: (jid) => mut('DELETE', `/group/leaveGroup/${call.inst}${q(jid)}`, undefined),
  };
}
const waParticipant = (p) => { const id = p && (p.phoneNumber || p.id || p.jid || p); const ph = jidPhone(p && p.phoneNumber || id) || digits(id); return ph ? { external_id: ph, display_name: '+' + ph, role: p && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin) ? 'admin' : 'member' } : null; };
const toDataUrl = (b64) => { if (typeof b64 !== 'string' || !b64) return null; if (b64.startsWith('data:image/')) return b64.length < 400000 ? b64 : null; return /^[A-Za-z0-9+/=]+$/.test(b64) && b64.length < 400000 ? 'data:image/png;base64,' + b64 : null; };
// tamanho como o Telegram conta a legenda: sem as marcas HTML (o endereço do link fica no atributo href)
export const visibleLength = (t) => String(t || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').length;
const httpErr = (who, r) => {
  const txt = msgOf(r.data); const dead = who === 'evolution' && /connection closed/i.test(JSON.stringify(r.data || {}));
  const e = new Error(dead ? 'A sessão do WhatsApp travou na Evolution (Connection Closed). Em Configurações → WhatsApp clique em Desconectar e leia o QR de novo.' : `${who} respondeu HTTP ${r.status}${txt ? ': ' + txt : ''}`);
  e.status = r.status; if (dead) e.dead = true; return e;
};
const msgOf = (d) => { if (!d) return ''; if (typeof d === 'string') return clean(d); const m = (d.response && d.response.message) ?? d.message ?? d.error ?? d.description; return clean(Array.isArray(m) ? m.join('; ') : typeof m === 'object' ? JSON.stringify(m) : m); };

// Traduz a recusa da Evolution em código curto + se vale tentar de novo.
export function explainEvolution(status, data) {
  const txt = (JSON.stringify(data || {}) + ' ' + msgOf(data)).toLowerCase();
  const out = (code, error, extra = {}) => ({ code, error, ...extra });
  if (/"exists":\s*false/.test(txt)) return out('no_whatsapp', 'número sem WhatsApp', { permanent: true });
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api ?key/.test(txt)) return out('auth', 'a Evolution recusou a chave de acesso', { permanent: true });
  if (status === 404 || /instance.{0,40}(does not exist|not found)/.test(txt)) return out('instance_missing', 'instância não encontrada na Evolution', { permanent: true });
  if (/connection closed|not connected|disconnected|instance.{0,20}close/.test(txt)) return out('instance_closed', 'o WhatsApp do número de envio está desconectado', { retryIn: 180 });
  if (status === 429 || /rate.?over.?limit|too many requests/.test(txt)) return out('rate', 'limite de envios atingido', { retryIn: 300 });
  if (status === 413 || /too large|entity too large|maxfilesize/.test(txt)) return out('media_size', 'arquivo grande demais', { mediaProblem: true });
  if (/media|\burl\b|base64|mimetype|\bimage\b/.test(txt) && status < 500) return out('media', 'a imagem não foi aceita', { mediaProblem: true });
  if (/\bjid\b|invalid number|number.{0,20}invalid/.test(txt)) return out('invalid_number', 'número ou grupo inválido', { permanent: true });
  if (status >= 500) return out('server', 'erro interno da Evolution', { ambiguous: true });
  return out('rejected', `recusado pela Evolution (${status})`, { permanent: true });
}

/* ------------------------------------------------------------------ Telegram */
export function telegramClient(ctx, token, apiBase) {
  apiBase = apiBase || (ctx.urls && ctx.urls.telegram) || DEFAULT_TG;
  const call = async (method, body, timeoutMs = 25000) => {
    let r; try { r = await ctx.http({ method: 'POST', url: `${apiBase}/bot${token}/${method}`, json: body || {}, timeoutMs }); }
    catch (e) { const err = new Error(e && e.code === 'timeout' ? 'O Telegram não respondeu a tempo' : 'Sem conexão com o Telegram'); err.network = true; err.code = e && e.code; throw err; }
    const d = r.data || {};
    if (d.ok) return d.result;
    const e = new Error(clean(d.description || `Telegram respondeu HTTP ${r.status}`)); e.status = d.error_code || r.status; e.retryAfter = d.parameters && d.parameters.retry_after; throw e;
  };
  return {
    call,
    me: () => call('getMe'),
    webhookInfo: () => call('getWebhookInfo'),
    setWebhook: (url, secret) => call('setWebhook', { url, secret_token: secret || undefined, allowed_updates: ['message', 'channel_post', 'my_chat_member'], drop_pending_updates: false }),
    deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
    getChat: (ref) => call('getChat', { chat_id: ref }),
    getMember: (chat, uid) => call('getChatMember', { chat_id: chat, user_id: uid }),
    memberCount: (chat) => call('getChatMemberCount', { chat_id: chat }),
    admins: (chat) => call('getChatAdministrators', { chat_id: chat }),
    createInvite: (chat, name) => call('createChatInviteLink', { chat_id: chat, name: name || undefined }),
    revokeInvite: (chat, link) => call('revokeChatInviteLink', { chat_id: chat, invite_link: link }),
    setTitle: (chat, title) => call('setChatTitle', { chat_id: chat, title }),
    setDescription: (chat, description) => call('setChatDescription', { chat_id: chat, description }),
    setPermissions: (chat, canSend) => call('setChatPermissions', { chat_id: chat, permissions: { can_send_messages: canSend, can_send_audios: canSend, can_send_documents: canSend, can_send_photos: canSend, can_send_videos: canSend, can_send_video_notes: canSend, can_send_voice_notes: canSend, can_send_polls: canSend, can_send_other_messages: canSend, can_add_web_page_previews: canSend } }),
    leave: (chat) => call('leaveChat', { chat_id: chat }),
    updates: (offset) => call('getUpdates', { offset, timeout: 0, limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] }, 20000),
    async send(chatId, text, imageUrl) {
      try {
        const r = imageUrl && visibleLength(text) <= 1024 ? await call('sendPhoto', { chat_id: chatId, photo: imageUrl, caption: text, parse_mode: 'HTML' }, 40000) : await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
        return { ok: true, messageId: String(r.message_id) };
      } catch (e) { return { ok: false, ...explainTelegram(e) }; }
    },
  };
}
export function explainTelegram(e) {
  const m = String(e.message || '').toLowerCase();
  if (e.network) return { ambiguous: true, code: e.code === 'timeout' ? 'timeout' : 'network', error: e.message };
  if (e.status === 429) return { code: 'rate', error: 'limite do Telegram', retryIn: Math.min(3600, (e.retryAfter || 30) + 2) };
  if (e.status === 401) return { code: 'auth', error: 'token do bot recusado', permanent: true };
  if (e.status === 403) return { code: 'blocked_bot', error: 'o bot foi removido ou bloqueado no chat', permanent: true };
  if (e.status === 400 && /chat not found/.test(m)) return { code: 'no_chat', error: 'chat não encontrado (o bot precisa estar no chat)', permanent: true };
  if (e.status === 400 && /can't parse entities|unsupported start tag/.test(m)) return { code: 'bad_html', error: 'HTML inválido no texto', permanent: true };
  if (e.status === 400 && /(wrong file identifier|failed to get http url content|wrong type of the web page|photo)/.test(m)) return { code: 'media', error: 'a imagem não foi aceita', mediaProblem: true };
  if (e.status >= 500) return { ambiguous: true, code: 'server', error: 'erro interno do Telegram' };
  return { code: 'rejected', error: clean(e.message), permanent: true };
}

/* ------------------------------------------------------------------ Lojas: conta conectada, amostra e coleta */
const connectorOf = (rt, p) => { const c = (rt.connectors && rt.connectors[p]) || { mode: 'disabled', config: {} }; const g = c.config || {}; return p === 'amazon' && !g.partner_tag && g.affiliate_tag ? { ...c, config: { ...g, partner_tag: g.affiliate_tag } } : c; };
const round2 = (n) => Math.round(n * 100) / 100;
const pctOff = (price, prev) => (prev && prev > price ? round2((prev - price) / prev * 100) : 0);
const STORE_LABEL = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', aliexpress: 'AliExpress', amazon: 'Amazon' };
const SOURCE_NAME = { mercadolivre: 'API Mercado Livre', shopee: 'Shopee Open API', aliexpress: 'AliExpress Affiliate API', amazon: 'Amazon Creators API' };
const authStop = (e) => e && (e.status === 401 || e.status === 403 || /Invalid Signature|conecte a conta|Conecte a conta/i.test(String(e.message)));

// Termos de busca por tipo de produto (usados quando o conector não tem "keywords" próprias).
const SEARCH_TERMS = { eletronicos: ['fone bluetooth', 'smartwatch'], informatica: ['notebook', 'ssd'], games: ['controle gamer', 'console'], casa: ['luminária', 'organizador'], cozinha: ['air fryer', 'cafeteira'], automotivo: ['som automotivo', 'capacete'], moda: ['tênis', 'mochila'], beleza: ['perfume', 'secador de cabelo'], saude: ['suplemento', 'massageador'], esporte: ['bicicleta', 'halteres'], bebes: ['carrinho de bebê'], brinquedos: ['lego'], ferramentas: ['furadeira', 'parafusadeira'], pet: ['ração', 'comedouro'], mercado: ['café', 'azeite'], livros: ['livro', 'caderno'] };
export function termsFor(cfg) {
  const kw = Array.isArray(cfg.keywords) ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()) : [];
  if (kw.length) return kw.map((q) => ({ q: q.trim(), cat: undefined }));
  const cats = Array.isArray(cfg.categories) && cfg.categories.length ? cfg.categories : ['eletronicos', 'informatica', 'casa'];
  return cats.flatMap((c) => (SEARCH_TERMS[c] || []).map((q) => ({ q, cat: c })));
}

/* ---- Shopee: a conta é o par App ID + Secret do Programa de Afiliados (não existe login/OAuth). */
async function shopeeCall(ctx, cfg, secret, query, variables) {
  const endpoint = cfg.api_endpoint || 'https://open-api.affiliate.shopee.com.br/graphql';
  const payload = JSON.stringify({ query, variables: variables || {} });
  const ts = Math.floor(ctx.now().getTime() / 1000);
  const sig = await (ctx.sha256hex || sha256Hex)(`${cfg.app_id}${ts}${payload}${secret}`);
  const r = await ctx.http({ method: 'POST', url: endpoint, headers: { Authorization: `SHA256 Credential=${cfg.app_id}, Timestamp=${ts}, Signature=${sig}`, 'Content-Type': 'application/json' }, body: payload, timeoutMs: 20000 });
  if (r.status >= 400 || (r.data && r.data.errors && r.data.errors.length)) {
    const er = r.data && r.data.errors && r.data.errors[0]; const e = new Error(er ? `${clean(er.message)}${er.extensions && er.extensions.code ? ` (código ${er.extensions.code})` : ''}` : `HTTP ${r.status}`); e.status = r.status; throw e;
  }
  return r.data && r.data.data;
}
const SP_FULL = 'itemId shopId productName price priceMin priceMax priceDiscountRate commissionRate sales ratingStar imageUrl shopName productLink offerLink';
const SP_MIN = 'itemId productName price commissionRate imageUrl productLink offerLink';
async function shopeeProducts(ctx, cfg, secret, keyword, limit, sortType = 2, page = 1) {
  // sortType: 1 relevância · 2 mais vendidos · 3 maior preço · 4 menor preço · 5 maior comissão
  const q = (f) => `query{ productOfferV2(keyword:${JSON.stringify(String(keyword))}, sortType:${sortType}, page:${page}, limit:${limit}){ nodes{ ${f} } } }`;
  let d; try { d = await shopeeCall(ctx, cfg, secret, q(SP_FULL)); } catch (e) { if (!/field|cannot query|validation/i.test(String(e.message))) throw e; d = await shopeeCall(ctx, cfg, secret, q(SP_MIN)); }
  return (d && d.productOfferV2 && d.productOfferV2.nodes) || [];
}
export function shopeeItem(n) {
  const price = Number(n.price) || Number(n.priceMin) || 0; const rate = Number(n.priceDiscountRate) || 0;
  const prev = rate > 0 && rate < 95 ? round2(price / (1 - rate / 100)) : null; const cr = Number(n.commissionRate);
  return { external_id: n.shopId ? `${n.shopId}.${n.itemId}` : String(n.itemId || ''), title: String(n.productName || '').trim(), price, previous: prev, derived_previous: !!prev, url: n.productLink || '', affiliate_url: n.offerLink || '', image: n.imageUrl || null, seller: n.shopName || null,
    commission_pct: Number.isFinite(cr) && cr > 0 ? round2(cr <= 1 ? cr * 100 : cr) : null, sold: Number(n.sales) || null, rating: Number(n.ratingStar) || null, stock: null };
}
async function shopeeReport(ctx, cfg, secret) {
  const end = Math.floor(ctx.now().getTime() / 1000), start = end - 30 * 86400;
  const d = await shopeeCall(ctx, cfg, secret, `query{ conversionReport(purchaseTimeStart:${start}, purchaseTimeEnd:${end}, limit:100){ nodes{ totalCommission } pageInfo{ hasNextPage } } }`);
  const cr = (d && d.conversionReport) || {}; const nodes = cr.nodes || [];
  return { conversions: nodes.length, more: !!(cr.pageInfo && cr.pageInfo.hasNextPage), commission: round2(nodes.reduce((a, n) => a + (Number(n.totalCommission) || 0), 0)) };
}

/* ---- Mercado Livre: OAuth (authorization_code). Os tokens ficam no cofre; o refresh_token gira a cada uso. */
const mlBase = (ctx) => (ctx.urls && ctx.urls.ml) || 'https://api.mercadolibre.com';
async function mlSaveTokens(ctx, rt, d) {
  const exp = String(Math.floor(ctx.now().getTime() / 1000) + Number(d.expires_in || 21600));
  await ctx.rpc('store_integration_token', { p_key: 'ml_access_token', p_value: d.access_token });
  if (d.refresh_token) await ctx.rpc('store_integration_token', { p_key: 'ml_refresh_token', p_value: d.refresh_token });
  await ctx.rpc('store_integration_token', { p_key: 'ml_token_expires_at', p_value: exp });
  rt.secrets.ml_access_token = d.access_token; if (d.refresh_token) rt.secrets.ml_refresh_token = d.refresh_token; rt.secrets.ml_token_expires_at = exp;
}
const mlFresh = (ctx, sec) => !!sec.ml_access_token && Number(sec.ml_token_expires_at || 0) * 1000 - ctx.now().getTime() > 300000;
async function mlToken(ctx, rt) {
  const cfg = connectorOf(rt, 'mercadolivre').config || {}; const sec = rt.secrets;
  if (mlFresh(ctx, sec)) return sec.ml_access_token;
  if (!sec.ml_refresh_token) { const e = new Error('Conta do Mercado Livre não conectada: use “Conectar conta” no conector.'); e.status = 401; throw e; }
  if (!cfg.app_id || !sec.ml_client_secret) throw new Error('Informe o App ID e a chave secreta do aplicativo do Mercado Livre.');
  const t = await ctx.http({ method: 'POST', url: mlBase(ctx) + '/oauth/token', headers: { accept: 'application/json' }, form: { grant_type: 'refresh_token', client_id: cfg.app_id, client_secret: sec.ml_client_secret, refresh_token: sec.ml_refresh_token }, timeoutMs: 20000 });
  if (t.status < 400 && t.data && t.data.access_token) { await mlSaveTokens(ctx, rt, t.data); return t.data.access_token; }
  // o refresh_token é de uso único: outro worker pode ter renovado agora há pouco. Relê o cofre antes de desistir.
  const again = await loadRuntime(ctx).catch(() => null);
  if (again && mlFresh(ctx, again.secrets)) { Object.assign(rt.secrets, again.secrets); return again.secrets.ml_access_token; }
  const e = new Error(`O Mercado Livre recusou a renovação do acesso (${t.status}). Conecte a conta de novo.`); e.status = 401; throw e;
}
async function mlGet(ctx, rt, path) {
  const tok = await mlToken(ctx, rt);
  const r = await ctx.http({ method: 'GET', url: mlBase(ctx) + path, headers: { Authorization: `Bearer ${tok}` }, timeoutMs: 15000 });
  if (r.status >= 400) { const e = new Error(`o Mercado Livre respondeu ${r.status}${msgOf(r.data) ? ': ' + msgOf(r.data) : ''}`); e.status = r.status; throw e; }
  return r.data;
}
export function mlItem(it) {
  it = it || {}; const price = Number(it.price) || 0; const prev = it.original_price != null ? Number(it.original_price) : null;
  return { external_id: String(it.id || ''), title: String(it.title || '').trim(), price, previous: prev && prev > price ? prev : null, url: it.permalink || '', affiliate_url: '',
    image: it.thumbnail ? String(it.thumbnail).replace(/^http:/, 'https:').replace(/-I\.(jpg|webp)$/, '-O.$1') : null, seller: it.seller && it.seller.nickname || null,
    stock: it.available_quantity == null ? null : Number(it.available_quantity), used: !!it.condition && it.condition !== 'new', sold: Number(it.sold_quantity) || null, free_shipping: !!(it.shipping && it.shipping.free_shipping) };
}
/* Desde 2025 o Mercado Livre responde 403 em /sites/MLB/search para a maioria dos aplicativos (a conta conecta e /users/me funciona).
   O catálogo continua liberado: /products/search acha o produto e /products/{id}/items traz as ofertas (preço, frete, vendedor).
   Por isso a busca tenta o caminho normal uma vez e, se vier 403, passa a usar o catálogo pelo resto da execução. */
const mlMenor = (offers) => {
  const ok = (offers || []).filter((o) => o && Number(o.price) > 0 && (!o.condition || o.condition === 'new')).sort((a, b) => Number(a.price) - Number(b.price));
  return ok[0] || null;
};
function mlCatalogItem(p, o) {
  const pic = p.pictures && p.pictures[0] && (p.pictures[0].url || p.pictures[0].secure_url); const price = Number(o.price) || 0; const prev = o.original_price != null ? Number(o.original_price) : null;
  return { external_id: String(p.id), title: String(p.name || '').trim(), price, previous: prev && prev > price ? prev : null, url: 'https://www.mercadolivre.com.br/p/' + p.id, affiliate_url: '',
    image: pic ? String(pic).replace(/^http:/, 'https:') : null, seller: null, stock: null, used: false, sold: null, free_shipping: !!(o.shipping && o.shipping.free_shipping) };
}
async function mlCatalogOffer(ctx, rt, p) {
  try { const d = await mlGet(ctx, rt, `/products/${p.id}/items`); const o = mlMenor(d && d.results); return o ? mlCatalogItem(p, o) : null; }
  catch (e) { if (e && (e.status === 404 || e.status === 429)) return null; throw e; }
}
async function mlCatalogSearch(ctx, rt, q, limit, offset = 0) {
  const n = Math.max(1, Math.min(Number(limit) || 15, 15));
  const d = await mlGet(ctx, rt, `/products/search?status=active&site_id=MLB&q=${encodeURIComponent(q)}&limit=${n}${offset > 0 ? `&offset=${offset}` : ''}`);
  const out = [];
  for (const p of (d && d.results) || []) { const it = await mlCatalogOffer(ctx, rt, p); if (it) out.push(it); if (ctx.sleep) await ctx.sleep(250); }
  return out;
}
async function mlSearch(ctx, rt, q, limit, offset = 0) {
  if (!rt.ml_catalog_only) {
    try { const d = await mlGet(ctx, rt, `/sites/MLB/search?q=${encodeURIComponent(q)}&limit=${limit}${offset > 0 ? `&offset=${offset}` : ''}`); return ((d && d.results) || []).map(mlItem); }
    catch (e) { if (!(e && e.status === 403)) throw e; rt.ml_catalog_only = true; }
  }
  return mlCatalogSearch(ctx, rt, q, limit, offset);
}
async function mlAccount(ctx, rt) {
  const d = (await mlGet(ctx, rt, '/users/me')) || {}; const rep = d.seller_reputation || {};
  return { id: String(d.id || ''), nickname: d.nickname || null, site: d.site_id || null, permalink: d.permalink || null, level: rep.level_id || null, power_seller: rep.power_seller_status || null, registered: d.registration_date || null };
}
async function mlExchange(ctx, rt, payload) {
  const cfg = connectorOf(rt, 'mercadolivre').config || {}; const sec = rt.secrets;
  need(cfg.app_id && sec.ml_client_secret, 'Informe o App ID e a chave secreta do aplicativo do Mercado Livre antes de conectar.');
  const redirect = payload.redirect_uri || cfg.redirect_uri; need(redirect, 'Informe a URL de redirecionamento do aplicativo.');
  const t = await ctx.http({ method: 'POST', url: mlBase(ctx) + '/oauth/token', headers: { accept: 'application/json' }, form: { grant_type: 'authorization_code', client_id: cfg.app_id, client_secret: sec.ml_client_secret, code: payload.code, redirect_uri: redirect }, timeoutMs: 20000 });
  if (t.status >= 400 || !t.data || !t.data.access_token) throw new Error(`O Mercado Livre não aceitou a autorização (${t.status}): ${msgOf(t.data) || 'o código vale poucos minutos; clique em “Conectar conta” de novo'}`);
  await mlSaveTokens(ctx, rt, t.data);
  const account = await mlAccount(ctx, rt);
  const out = { ok: true, connected: true, account, detail: `Conta conectada: ${account.nickname || account.id}.` };
  await ctx.rpc('report_integration_status', { p_provider: 'mercadolivre', p_status: { ok: true, connected: true, account, detail: out.detail } });
  return out;
}
async function mlDisconnect(ctx, rt) {
  for (const k of ['ml_access_token', 'ml_refresh_token', 'ml_token_expires_at']) await ctx.rpc('store_integration_token', { p_key: k, p_value: '' });
  await ctx.rpc('report_integration_status', { p_provider: 'mercadolivre', p_status: { ok: false, connected: false, detail: 'Conta desconectada.' } });
  return { disconnected: true };
}

/* ---- AliExpress: Affiliate API. A "conta" é App Key + App Secret + Tracking ID do portal de afiliados. Assinatura HMAC-SHA256. ---- */
async function aliCall(ctx, cfg, secret, method, params) {
  const p = { app_key: String(cfg.app_id), timestamp: String(ctx.now().getTime()), sign_method: 'sha256', method, ...params };
  const base = Object.keys(p).sort().map((k) => k + p[k]).join('');
  p.sign = String(await (ctx.hmacSha256hex || hmacSha256Hex)(secret, base)).toUpperCase();
  const r = await ctx.http({ method: 'POST', url: cfg.api_endpoint || 'https://api-sg.aliexpress.com/sync', form: p, timeoutMs: 20000 });
  const d = r.data && typeof r.data === 'object' ? r.data : {}; const er = d.error_response;
  if (er || r.status >= 400) {
    const txt = er ? String((er.msg || er.sub_msg || 'erro') + ' ' + (er.code || '')) : '';
    const e = new Error(er ? `${clean(er.msg || er.sub_msg || 'erro')} (código ${er.code})` : `AliExpress respondeu HTTP ${r.status}`);
    e.status = r.status >= 400 ? r.status : /sign|appkey|app key|permission|forbidden|invalid/i.test(txt) ? 401 : 0; throw e;
  }
  return d;
}
async function aliProducts(ctx, cfg, secret, keyword, size, page = 1, hot = false) {
  const d = await aliCall(ctx, cfg, secret, hot ? 'aliexpress.affiliate.hotproduct.query' : 'aliexpress.affiliate.product.query', { keywords: keyword, page_no: String(page), page_size: String(size), sort: 'LAST_VOLUME_DESC', target_currency: 'BRL', target_language: 'PT', ship_to_country: 'BR', tracking_id: String(cfg.tracking_id || cfg.affiliate_id || ''), fields: 'commission_rate,sale_price' });
  const res = (d[hot ? 'aliexpress_affiliate_hotproduct_query_response' : 'aliexpress_affiliate_product_query_response'] || {}).resp_result;
  if (!res) throw new Error('Resposta inesperada da AliExpress (sem resp_result). Confira se o app tem a API de afiliados liberada.');
  if (Number(res.resp_code) !== 200) throw new Error(`AliExpress: ${clean(res.resp_msg || 'recusado')} (código ${res.resp_code})`);
  const list = res.result && res.result.products && res.result.products.product; return Array.isArray(list) ? list : [];
}
const num2 = (v) => Number(String(v ?? '').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
export function aliItem(n) {
  const price = num2(n.target_sale_price), orig = num2(n.target_original_price), cr = num2(n.commission_rate);
  return { external_id: String(n.product_id || ''), title: String(n.product_title || '').trim(), price, previous: orig > price ? orig : null, url: n.product_id ? `https://pt.aliexpress.com/item/${n.product_id}.html` : '', affiliate_url: n.promotion_link || '',
    image: n.product_main_image_url || null, seller: null, commission_pct: cr > 0 ? cr : null, sold: Number(n.lastest_volume) || null, rating: num2(n.evaluate_rate) || null, stock: null };
}

/* ---- Amazon: Creators API (OAuth 2.0 client_credentials). detailPageURL já traz a sua tag de associado. ---- */
const AMZ_TOKEN = { '3.1': 'https://api.amazon.com/auth/o2/token', '3.2': 'https://api.amazon.co.uk/auth/o2/token', '3.3': 'https://api.amazon.co.jp/auth/o2/token' };
async function amazonToken(ctx, rt, cfg) {
  if (rt._amz) return rt._amz;
  const known = AMZ_TOKEN[cfg.credential_version || '3.1']; need(known, 'Versão da credencial inválida (use 3.1, 3.2 ou 3.3).'); const url = (ctx.urls && ctx.urls.amazonToken) || known;
  const r = await ctx.http({ method: 'POST', url, json: { grant_type: 'client_credentials', client_id: cfg.client_id, client_secret: rt.secrets.amazon_client_secret, scope: 'creatorsapi::default' }, timeoutMs: 20000 });
  if (r.status >= 400 || !r.data || !r.data.access_token) { const e = new Error(`A Amazon recusou as credenciais (${r.status}): ${msgOf(r.data) || 'confira o Credential ID, o Secret e a versão da credencial'}`); e.status = 401; throw e; }
  return (rt._amz = r.data.access_token);
}
const AMZ_RES = ['itemInfo.title', 'images.primary.large', 'offersV2.listings.price', 'offersV2.listings.condition', 'offersV2.listings.availability', 'offersV2.listings.merchantInfo'];
async function amazonSearch(ctx, rt, cfg, keyword, count) {
  const token = await amazonToken(ctx, rt, cfg); const mkt = cfg.marketplace || 'www.amazon.com.br';
  if (rt._amzCalls) await ctx.sleep(1100); rt._amzCalls = (rt._amzCalls || 0) + 1; // a Amazon limita a ~1 consulta por segundo
  const body = { keywords: keyword, partnerTag: cfg.partner_tag, marketplace: mkt, itemCount: Math.min(10, count), condition: 'New', resources: AMZ_RES };
  if (Number(cfg.min_discount_pct) > 0) body.minSavingPercent = Math.min(99, Math.floor(Number(cfg.min_discount_pct)));
  const r = await ctx.http({ method: 'POST', url: ((ctx.urls && ctx.urls.amazon) || 'https://creatorsapi.amazon') + '/catalog/v1/searchItems', headers: { Authorization: `Bearer ${token}`, 'x-marketplace': mkt }, json: body, timeoutMs: 25000 });
  if (r.status >= 400) { const er = r.data && Array.isArray(r.data.errors) && r.data.errors[0]; const e = new Error(`a Amazon respondeu ${r.status}: ${er ? clean(er.message || er.code) : msgOf(r.data) || 'sem detalhe'}`); e.status = r.status; throw e; }
  return (r.data && r.data.searchResult && r.data.searchResult.items) || [];
}
export function amazonItem(it, mkt) {
  const lst = (it.offersV2 && it.offersV2.listings) || (it.offers && it.offers.listings) || []; const l = lst.find((x) => x && x.isBuyBoxWinner) || lst[0] || {};
  const pr = l.price || {}; const price = num2(pr.money && pr.money.amount); const basis = num2(pr.savingBasis && pr.savingBasis.money && pr.savingBasis.money.amount); const sav = num2(pr.savings && pr.savings.money && pr.savings.money.amount);
  const prev = basis > price ? basis : sav > 0 ? round2(price + sav) : null; const av = String(l.availability && l.availability.type || '');
  const img = it.images && it.images.primary && (it.images.primary.large || it.images.primary.medium);
  return { external_id: String(it.asin || '').toUpperCase(), title: String(it.itemInfo && it.itemInfo.title && it.itemInfo.title.displayValue || '').trim(), price, previous: prev, url: it.asin ? `https://${mkt}/dp/${it.asin}` : '', affiliate_url: it.detailPageURL || '',
    image: img && img.url || null, seller: l.merchantInfo && l.merchantInfo.name || null, stock: /out|unavail/i.test(av) ? 0 : null, commission_pct: null, sold: null };
}
const FETCH = {
  mercadolivre: async (ctx, rt, cfg, q) => { const out = []; for (let p = 0; p < pagesOf(cfg); p++) out.push(...await mlSearch(ctx, rt, q, 50, p * 50)); return out; },
  shopee: async (ctx, rt, cfg, q) => { const out = []; for (let p = 1; p <= pagesOf(cfg); p++) out.push(...(await shopeeProducts(ctx, cfg, rt.secrets.shopee_secret, q, 30, cfg.sort_by === 'commission' ? 5 : 2, p)).map(shopeeItem)); return out; },
  aliexpress: async (ctx, rt, cfg, q) => { const out = []; for (let p = 1; p <= pagesOf(cfg); p++) out.push(...(await aliProducts(ctx, cfg, rt.secrets.aliexpress_app_secret, q, 30, p, cfg.hot_products === true)).map(aliItem)); return out; },
  amazon: async (ctx, rt, cfg, q) => (await amazonSearch(ctx, rt, cfg, q, 10)).map((i) => amazonItem(i, cfg.marketplace || 'www.amazon.com.br')),
};
const pagesOf = (cfg) => Math.max(1, Math.min(3, Number(cfg.pages) || 1));
const credsOk = (p, cfg, sec) => p === 'shopee' ? cfg.app_id && sec.shopee_secret : p === 'mercadolivre' ? cfg.app_id && sec.ml_client_secret
  : p === 'aliexpress' ? cfg.app_id && sec.aliexpress_app_secret && (cfg.tracking_id || cfg.affiliate_id) : cfg.client_id && cfg.partner_tag && sec.amazon_client_secret;

/* ---- Teste de conexão: devolve a conta e uma amostra de produtos reais ---- */
const previewItem = (it) => ({ title: it.title.slice(0, 90), price: it.price, previous: it.previous, discount_pct: pctOff(it.price, it.previous) || null, url: it.url, image: it.image, seller: it.seller, commission_pct: it.commission_pct ?? null, free_shipping: it.free_shipping || undefined });
const sampleOf = (items, n = 3) => [...items].sort((a, b) => pctOff(b.price, b.previous) - pctOff(a.price, a.previous) || (b.sold || 0) - (a.sold || 0)).slice(0, n).map(previewItem);

async function checkStore(ctx, provider, rt) {
  const cfg = connectorOf(rt, provider).config || {}; const sec = rt.secrets;
  if (provider === 'shopee') {
    if (!cfg.app_id || !sec.shopee_secret) return { ok: false, error: 'Informe o App ID e a chave secreta da Shopee.' };
    const nodes = await shopeeProducts(ctx, cfg, sec.shopee_secret, termsFor(cfg)[0] ? termsFor(cfg)[0].q : 'fone', 8);
    const out = { ok: true, connected: true, detail: `Credenciais aceitas. A Shopee devolveu ${nodes.length} produto(s) de amostra.`, account: { id: String(cfg.app_id), kind: 'affiliate_app' }, sample: sampleOf(selectOffers(nodes.map(shopeeItem), {}, 30).list) };
    try { out.account.report = await shopeeReport(ctx, cfg, sec.shopee_secret); } catch (e) { out.account.report_error = clean(e && e.message); }
    return out;
  }
  if (provider === 'mercadolivre') {
    if (!cfg.app_id || !sec.ml_client_secret) return { ok: false, error: 'Informe o App ID e a chave secreta do aplicativo do Mercado Livre.' };
    if (!sec.ml_refresh_token && !sec.ml_access_token) {
      // sem conta conectada: só valida o aplicativo
      const t = await ctx.http({ method: 'POST', url: mlBase(ctx) + '/oauth/token', form: { grant_type: 'client_credentials', client_id: cfg.app_id, client_secret: sec.ml_client_secret }, timeoutMs: 20000 });
      if (t.status >= 400 || !t.data || !t.data.access_token) return { ok: false, connected: false, error: `O Mercado Livre recusou as credenciais (${t.status}): ${msgOf(t.data) || 'verifique App ID e chave secreta'}` };
      const s = await ctx.http({ method: 'GET', url: mlBase(ctx) + '/sites/MLB/search?q=fone&limit=1', headers: { Authorization: `Bearer ${t.data.access_token}` }, timeoutMs: 20000 });
      if (s.status >= 400) return { ok: false, connected: false, error: `Aplicativo aceito, mas a busca de produtos respondeu ${s.status}: ${msgOf(s.data) || 'permissões insuficientes no aplicativo'}` };
      return { ok: true, partial: true, connected: false, detail: 'O aplicativo é válido. Falta autorizar a sua conta: clique em “Conectar conta”.' };
    }
    let account; try { account = await mlAccount(ctx, rt); } catch (e) { return { ok: false, connected: false, error: clean(e && e.message) }; }
    const out = { ok: true, connected: true, account, detail: `Conectado como ${account.nickname || account.id}.` };
    try { out.sample = sampleOf(selectOffers(await mlSearch(ctx, rt, termsFor(cfg)[0] ? termsFor(cfg)[0].q : 'fone', 30), {}, 30).list); }
    catch (e) { out.partial = true; out.search_error = clean(e && e.message); out.detail += ' A busca de produtos falhou: ' + out.search_error; }
    return out;
  }
  const first = termsFor(cfg)[0] ? termsFor(cfg)[0].q : 'fone';
  if (provider === 'aliexpress') {
    if (!credsOk(provider, cfg, sec)) return { ok: false, error: 'Informe o App Key, o App Secret e o Tracking ID da AliExpress.' };
    const nodes = await aliProducts(ctx, cfg, sec.aliexpress_app_secret, first, 8);
    return { ok: true, connected: true, detail: `Credenciais aceitas. A AliExpress devolveu ${nodes.length} produto(s) de amostra.`, account: { id: String(cfg.app_id), kind: 'affiliate_app', tracking_id: String(cfg.tracking_id || cfg.affiliate_id) }, sample: sampleOf(selectOffers(nodes.map(aliItem), {}, 30).list) };
  }
  if (provider === 'amazon') {
    if (!credsOk(provider, cfg, sec)) return { ok: false, error: `Falta informar: ${[!cfg.client_id && 'Credential ID', !cfg.partner_tag && 'tag de associado', !sec.amazon_client_secret && 'Credential Secret'].filter(Boolean).join(', ')}.` };
    const items = await amazonSearch(ctx, rt, cfg, first, 5); const mkt = cfg.marketplace || 'www.amazon.com.br';
    return { ok: true, connected: true, detail: `Credenciais aceitas. A Amazon devolveu ${items.length} produto(s) de amostra.`, account: { id: String(cfg.partner_tag), kind: 'associate', marketplace: mkt }, sample: sampleOf(selectOffers(items.map((i) => amazonItem(i, mkt)), {}, 30).list) };
  }
  // Magalu: não há API pública de afiliados confirmada; a entrada é manual com link gerado no painel do Parceiro Magalu.
  const miss = [!cfg.affiliate_id && !cfg.link_template && 'ID de afiliado ou modelo do link'].filter(Boolean);
  return miss.length ? { ok: false, error: `Falta informar: ${miss.join(', ')}.` } : { ok: true, partial: true, detail: 'Dados preenchidos. A Magalu não oferece API pública de afiliados: cadastre ofertas em “Nova oferta” com o link gerado no painel do Parceiro Magalu.' };
}

/* ---- Coleta: busca produtos reais pela API, filtra pelas regras do conector e entrega ao banco (ingest_offer) ---- */
async function gather(ctx, rt, provider, cfg, maxTerms) {
  const terms = (await termsForRt(ctx, rt, provider, cfg)).slice(0, maxTerms); const items = []; const errors = [];
  for (const t of terms) {
    try {
      const got = await FETCH[provider](ctx, rt, cfg, t.q);
      for (const it of got) items.push({ ...it, category: t.cat, term: t.q });
    } catch (e) { errors.push(`${t.q}: ${clean(e && e.message)}`); if (authStop(e)) break; }
  }
  return { items, errors, terms: terms.length };
}
export function selectOffers(items, cfg, limit) {
  const minD = Number(cfg.min_discount_pct || 0); const minP = cfg.min_price != null ? Number(cfg.min_price) : 0; const maxP = cfg.max_price != null ? Number(cfg.max_price) : Infinity;
  const skip = { invalido: 0, repetido: 0, sem_estoque: 0, usado: 0, sem_desconto: 0, fora_da_faixa: 0 }; const seen = new Set(); const list = [];
  for (const it of items) {
    if (!it.external_id || !it.url || !it.title || !(it.price > 0)) { skip.invalido++; continue; }
    if (seen.has(it.external_id)) { skip.repetido++; continue; } seen.add(it.external_id);
    if (it.used) { skip.usado++; continue; }
    if (it.stock != null && it.stock <= 0) { skip.sem_estoque++; continue; }
    if (minD > 0 && pctOff(it.price, it.previous) < minD) { skip.sem_desconto++; continue; }
    if (it.price < minP || it.price > maxP) { skip.fora_da_faixa++; continue; }
    list.push(it);
  }
  const by = cfg.sort_by;
  list.sort((a, b) => by === 'commission' ? (b.commission_pct || 0) - (a.commission_pct || 0) || pctOff(b.price, b.previous) - pctOff(a.price, a.previous) : by === 'sold' ? (b.sold || 0) - (a.sold || 0) : pctOff(b.price, b.previous) - pctOff(a.price, a.previous) || (b.sold || 0) - (a.sold || 0));
  return { list: list.slice(0, limit), skip, eligible: list.length };
}
const affiliateUrl = (it, cfg) => {
  if (it.affiliate_url) return it.affiliate_url;
  const t = cfg.link_template; if (!t) return undefined;
  const base = String(it.url).split('?')[0]; return t.split('{url}').join(/^\{url\}/.test(t) ? base : encodeURIComponent(base)).split('{id}').join(cfg.affiliate_id || '');
};
export async function collectStore(ctx, rt, provider, { dry = false, limit, maxTerms = 6 } = {}) {
  const cfg = connectorOf(rt, provider).config || {}; const label = STORE_LABEL[provider]; need(label, 'Esta plataforma não tem coleta por API.');
  need(credsOk(provider, cfg, rt.secrets), `Informe as credenciais do ${label} (Conectores → ${label} → Configurar).`);
  if (provider === 'mercadolivre') need(rt.secrets.ml_refresh_token || rt.secrets.ml_access_token, 'Conecte a conta do Mercado Livre antes (botão “Conectar conta”).');
  const max = Math.max(1, Math.min(Number(limit || cfg.max_items_per_run || 30), 100));
  const runId = dry ? null : await ctx.rpc('start_run', { p_platform: provider });
  try {
    const g = await gather(ctx, rt, provider, cfg, maxTerms);
    if (!g.items.length && g.errors.length) throw new Error(g.errors[0]);
    const sel = selectOffers(g.items, cfg, max);
    if (dry) return { ok: true, dry: true, seen: g.items.length, eligible: sel.eligible, skipped: sel.skip, errors: g.errors, items: sel.list.slice(0, 12).map(previewItem) };
    let created = 0, duplicates = 0, rejected = 0, lowScore = 0; const reasons = {};
    for (const it of sel.list) {
      const res = await ingestStoreItem(ctx, rt, provider, cfg, it);
      if (res.status === 'created') {
        if (cfg.min_score != null && res.score != null && res.score < Number(cfg.min_score)) { await ctx.rpc('reject_offer', { p_offer: res.offer_id, p_reason: `Abaixo do score mínimo do conector (${res.score} < ${cfg.min_score})` }).catch(() => {}); lowScore++; } else created++;
      } else if (res.status === 'duplicate') duplicates++;
      else { rejected++; for (const f of res.failures || []) reasons[f.code] = (reasons[f.code] || 0) + 1; }
    }
    await ctx.rpc('finish_run', { p_run: runId, p_status: g.errors.length ? 'partial' : 'success', p_seen: sel.list.length, p_accepted: created, p_rejected: rejected + lowScore, p_error: g.errors[0] || null });
    return { ok: true, run_id: runId, seen: g.items.length, eligible: sel.eligible, selected: sel.list.length, created, duplicates, rejected, low_score: lowScore, reasons, skipped: sel.skip, errors: g.errors };
  } catch (e) {
    if (runId) await ctx.rpc('finish_run', { p_run: runId, p_status: 'error', p_seen: 0, p_accepted: 0, p_rejected: 0, p_error: clean(e && e.message) }).catch(() => {});
    throw e;
  }
}
// Coleta automática: no máximo uma loja por chamada (cabe no orçamento de tempo do ciclo de 1 minuto).
export async function runCollectors(ctx) {
  const rt = await loadRuntime(ctx); const out = {};
  for (const p of ['mercadolivre', 'shopee', 'aliexpress', 'amazon']) {
    const c = connectorOf(rt, p); if (c.mode !== 'api_ready') continue;
    const every = Math.max(5, Number((c.config || {}).poll_minutes || 60)); const last = c.last_run_at ? new Date(c.last_run_at).getTime() : 0;
    if (ctx.now().getTime() - last < every * 60000) continue;
    try { const r = await collectStore(ctx, rt, p, { maxTerms: 4 }); out[p] = `${r.created} nova(s) de ${r.selected}`; } catch (e) { out[p] = 'erro: ' + clean(e && e.message).slice(0, 80); }
    break;
  }
  return out;
}

/* ------------------------------------------------------------------ Tarefas do painel */
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

async function evolutionStatus(ctx, rt) {
  const cfg = rt.evolution; const ev = evolutionClient(ctx, cfg, rt.secrets.evolution_api_key);
  need(ev.ready(), 'Informe o endereço da Evolution e a chave de acesso.');
  const ping = await ev.ping();
  const st = { reachable: ping.ok, ms: ping.ms, version: ping.version, instance: cfg.instance || null };
  if (cfg.instance) {
    st.state = await ev.state();
    if (st.state !== 'missing') { const one = await ev.fetchOne().catch(() => null); if (one) { st.phone = one.phone || null; st.profile = one.profile || null; } }
    const w = st.state === 'missing' ? null : await ev.getWebhook().catch(() => null);
    st.webhook = w ? { enabled: w.enabled, url: w.url, matches: !cfg.webhook_url || w.url === cfg.webhook_url } : null;
    // conexão gerenciada pelo servidor: o endereço do webhook é do próprio worker, então corrige sozinho se estiver diferente
    if (st.state !== 'missing' && rt.managed && rt.managed.evolution.webhook && cfg.webhook_url && (!w || !w.enabled || w.url !== cfg.webhook_url)) {
      try { await ev.setWebhook(cfg.webhook_url); const w2 = await ev.getWebhook().catch(() => null); if (w2) st.webhook = { enabled: w2.enabled, url: w2.url, matches: w2.url === cfg.webhook_url }; st.webhook_fixed = true; }
      catch (e) { st.webhook_error = clean(e && e.message); }
    }
  }
  st.managed = (rt.managed && rt.managed.evolution) || {}; st.host = hostOf(cfg.base_url) || null;
  return st;
}

/* ------------------------------------------------------------------ Worker: autoteste e diagnósticos */
// Leitor de endereço simples e previsível (não depende da classe `URL`).
const parseUrl = (u) => { const m = /^(https?:)\/\/(?:[^\/?#\s@]*@)?(\[[^\]]+\]|[^\/?#\s:]+)(:\d+)?([^?#]*)/i.exec(String(u == null ? '' : u).trim()); if (!m) throw new Error('Endereço inválido'); const hostname = m[2].toLowerCase(); return { protocol: m[1].toLowerCase(), hostname, host: hostname + (m[3] || ''), pathname: m[4] || '/' }; };
const hostOf = (u) => { try { return parseUrl(u).host; } catch { return ''; } };
const maskUrl = (u) => { try { const x = parseUrl(u); const p = x.pathname.split('/').filter(Boolean); const last = p.pop() || ''; return `${x.host}/…/${last.slice(0, 8)}…`; } catch { return ''; } };
// Confere o que o worker precisa para trabalhar. Nunca devolve segredo: só "sim/não" e nomes de servidor.
export async function selfTest(ctx, rt) {
  const t0 = ctx.now().getTime(); const checks = []; const add = (id, label, ok, detail, required = true) => checks.push({ id, label, ok: !!ok, detail: String(detail || ''), required });
  const env = ctx.env || {};
  add('env', 'Variáveis do worker (SUPABASE_URL e chave)', env.has_url && env.has_key, env.has_url && env.has_key ? `Banco em ${env.supabase_host || '—'}` : 'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em deploy/worker/worker.env e reinicie o worker.');
  let ms = 0; try { const a = ctx.now().getTime(); await ctx.rpc('get_integration_runtime', {}); ms = ctx.now().getTime() - a; add('supabase', 'Conexão com o Supabase', true, `Respondeu em ${ms} ms`); } catch (e) { add('supabase', 'Conexão com o Supabase', false, clean(e && e.message)); }
  let sha = ''; try { sha = await (ctx.sha256hex || sha256Hex)('abc'); } catch { /* falha abaixo */ }
  add('sha', 'Assinatura (SHA-256, usada pela Shopee)', sha === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sha ? 'Funcionando' : 'Indisponível');
  const ev = rt.evolution || {}, tg = rt.telegram || {}, sec = rt.secrets || {};
  add('evo_cfg', 'WhatsApp configurado (endereço, instância e chave)', ev.base_url && ev.instance && sec.evolution_api_key, [!ev.base_url && 'falta o endereço', !ev.instance && 'falta a instância', !sec.evolution_api_key && 'falta a chave'].filter(Boolean).join(', ') || `${hostOf(ev.base_url)} · instância ${ev.instance}`, false);
  add('tg_cfg', 'Telegram configurado (token e ligado)', tg.enabled && sec.telegram_bot_token, !sec.telegram_bot_token ? 'falta o token do bot' : !tg.enabled ? 'o Telegram está desligado nas configurações' : `modo ${tg.mode}`, false);
  add('hook_wa', 'Webhook de entrada do WhatsApp salvo', !!ev.webhook_url, ev.webhook_url ? maskUrl(ev.webhook_url) : 'Cole o endereço na aba WhatsApp (passo 3).', false);
  add('hook_tg', 'Webhook de entrada do Telegram', tg.mode !== 'webhook' || (tg.webhook_url && sec.telegram_webhook_secret), tg.mode !== 'webhook' ? 'Não usado (modo polling)' : tg.webhook_url ? maskUrl(tg.webhook_url) : 'Modo webhook sem endereço salvo.', false);
  const lim = ctx.limits || {};
  add('ratelimit', 'Limite de requisições nos webhooks', !!ctx.hasStore, ctx.hasStore ? `Ativo: até ${lim.webhookPorMin || 120} por minuto por webhook` : 'Indisponível: os webhooks ficam sem limite de taxa.', false);
  add('service_role', 'Chave do Supabase é a service_role', !env.key_role || env.key_role === 'service_role' || env.key_role === 'desconhecido', env.key_role === 'anon' ? 'Esta é a chave ANON: as tarefas vão falhar. Use a service_role.' : env.key_role ? `Papel da chave: ${env.key_role}` : '—', true);
  const https = (u) => !u || /^https:\/\//i.test(u) || /^http:\/\/[a-z0-9-]+:\d{2,5}\//i.test(u);
  add('https', 'Endereços usam HTTPS', https(ev.base_url) && https(ev.webhook_url) && https(tg.webhook_url), https(ev.base_url) && https(ev.webhook_url) && https(tg.webhook_url) ? 'Tudo em HTTPS' : 'Há endereço sem HTTPS: a chave e as mensagens viajam sem proteção.', false);
  const lastSeg = (u) => { try { return parseUrl(u).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; } };
  const weak = [ev.webhook_url, tg.webhook_url].filter(Boolean).filter((u) => lastSeg(u).length < 20);
  add('hook_secret_path', 'Caminho dos webhooks é secreto', weak.length === 0, weak.length ? 'Algum caminho é curto/previsível. Use o caminho aleatório do arquivo importado.' : 'Caminhos longos e aleatórios', false);
  add('tg_secret', 'Segredo do webhook do Telegram é forte', tg.mode !== 'webhook' || (sec.telegram_webhook_secret || '').length >= 32, tg.mode !== 'webhook' ? 'Não usado (modo polling)' : (sec.telegram_webhook_secret || '').length >= 32 ? 'Forte' : 'Gere um novo segredo na aba Telegram.', false);
  add('paused', 'Envios liberados', !rt.paused, rt.paused ? 'A pausa geral está ligada: nada é publicado até retomar.' : 'Sem pausa', false);
  const bad = checks.filter((c) => c.required && !c.ok);
  const out = { ok: bad.length === 0, checks, ms: ctx.now().getTime() - t0, supabase_ms: ms, at: ctx.now().toISOString() };
  await ctx.rpc('report_integration_status', { p_provider: 'worker', p_status: { ok: out.ok, at: out.at, falhas: checks.filter((c) => !c.ok).map((c) => c.id) } }).catch(() => {});
  return out;
}
// Chama os próprios webhooks de entrada (como a Evolution/Telegram fariam) para provar que a URL salva chega ao worker.
async function webhookCheck(ctx, rt) {
  const res = [];
  const one = async (name, url, headers, json) => {
    if (!url) return res.push({ name, configured: false, ok: false, detail: 'Nenhum endereço salvo.' });
    const t = ctx.now().getTime();
    try { const r = await ctx.http({ method: 'POST', url, headers, json, timeoutMs: 12000 }); const ms = ctx.now().getTime() - t;
      const ok = r.status === 200 && !!(r.data && r.data.ok);
      res.push({ name, configured: true, ok, status: r.status, ms, target: maskUrl(url), detail: ok ? 'O webhook respondeu corretamente.' : r.status === 404 ? 'Não encontrado (404): o worker está no ar? O caminho confere com o que aparece em docker logs promo-worker?' : r.status === 401 ? 'Recusado (401): o segredo do webhook do Telegram não confere.' : r.status === 403 ? 'Recusado (403): o nome da instância não confere.' : `Resposta inesperada (HTTP ${r.status}).` });
    } catch (e) { res.push({ name, configured: true, ok: false, target: maskUrl(url), detail: e && e.code === 'timeout' ? 'Sem resposta em 12 s.' : 'Não foi possível alcançar o endereço (DNS, certificado ou servidor fora do ar).' }); }
  };
  await one('WhatsApp (Evolution → worker)', rt.evolution.webhook_url, {}, { event: 'central.ping', instance: rt.evolution.instance });
  await one('Telegram (bot → worker)', rt.telegram.webhook_url, { 'x-telegram-bot-api-secret-token': rt.secrets.telegram_webhook_secret || '' }, { update_id: 0 });
  return { webhooks: res, ok: res.filter((r) => r.configured).every((r) => r.ok) && res.some((r) => r.configured) };
}
// Executa apenas migrações ainda não registradas. O token de gerenciamento fica
// no cofre do banco e nunca é devolvido ao painel, log ou resultado da tarefa.
async function applyDatabaseMigrations(ctx, rt) {
  const cfg = rt.database || {}; const token = rt.secrets && rt.secrets.supabase_management_token;
  need(cfg.provider === 'supabase', 'Atualização pelo worker está disponível somente para Supabase.');
  need(cfg.migration_mode === 'worker', 'Ative o modo “Pelo worker” em Banco de dados.');
  need(/^[a-z0-9]{20}$/.test(String(cfg.project_ref || '')), 'Project ref do Supabase ausente ou inválido.');
  need(token, 'Token da Management API não configurado.');
  const migrations = Array.isArray(ctx.migrations) ? ctx.migrations : [];
  need(migrations.length > 0, 'Gere e reimporte os workflows depois de atualizar o projeto.');
  const endpoint = `https://api.supabase.com/v1/projects/${encodeURIComponent(cfg.project_ref)}/database/query`;
  const query = async (sql) => {
    const r = await ctx.http({ method: 'POST', url: endpoint, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, json: { query: sql }, timeoutMs: 60000 });
    if (r.status >= 300) throw new Error(`Management API recusou a atualização (HTTP ${r.status}): ${clean(msgOf(r.data))}`);
    return r.data;
  };
  let rows;
  try { rows = await query('select version from public.app_schema_migrations order by version'); }
  catch { throw new Error('Bootstrap pendente: aplique 011_database_providers.sql uma vez no SQL Editor e tente novamente.'); }
  const applied = new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.version || '')));
  const pending = migrations.filter((m) => !applied.has(m.version)); const done = [];
  for (const migration of pending) {
    await query(migration.sql);
    await query(`insert into public.app_schema_migrations(version, applied_by) values ('${String(migration.version).replace(/'/g, "''")}', 'worker') on conflict (version) do nothing`);
    done.push(migration.version);
  }
  const out = { ok: true, applied: done, up_to_date: done.length === 0, latest: migrations[migrations.length - 1].version };
  await ctx.rpc('report_integration_status', { p_provider: 'database', p_status: { ok: true, latest: out.latest, applied: done, at: ctx.now().toISOString() } });
  return out;
}


async function integrationTask(ctx, rt, payload) {
  const { provider, action } = payload;
  if (provider === 'worker') {
    if (action === 'radar_test') { need(/^https?:\/\//i.test(String(payload.url || '')), 'Informe o endereço do produto.'); return radarTest(ctx, rt, String(payload.url)); }
    if (action === 'selftest') return selfTest(ctx, rt);
    if (action === 'webhook_check') return webhookCheck(ctx, rt);
    if (action === 'run_monitor') return { monitor: await runMonitor(ctx) };
    if (action === 'run_sender') return { sender: await runSender(ctx, { budgetMs: 40000, maxPerRun: 10 }) };
  }
  if (provider === 'database' && action === 'apply_migrations') return applyDatabaseMigrations(ctx, rt);
  if (provider === 'evolution') {
    const cfg = rt.evolution; const ev = evolutionClient(ctx, cfg, rt.secrets.evolution_api_key);
    need(ev.ready(), 'Informe o endereço da Evolution e a chave de acesso (aba WhatsApp).');
    if (action === 'status') { const st = await evolutionStatus(ctx, rt); await ctx.rpc('report_integration_status', { p_provider: 'evolution', p_status: st }); return st; }
    if (action === 'list_instances') return { instances: await ev.listAll() };
    need(cfg.instance, 'Defina o nome da instância antes.');
    if (action === 'create_instance') {
      const cur = await ev.state().catch(() => 'missing');
      if (cur !== 'missing') return { existed: true, state: cur };
      const c = await ev.create(); return { created: true, ...c };
    }
    if (action === 'connect_poll') {
      // consulta repetida pelo painel: devolve o estado e, enquanto não conectou, o QR code atual (ou o código de pareamento)
      const cur = await ev.state().catch(() => 'missing');
      if (cur === 'open') { const st = await evolutionStatus(ctx, rt); await ctx.rpc('report_integration_status', { p_provider: 'evolution', p_status: st }); return { state: 'open', phone: st.phone || null, profile: st.profile || null, webhook: st.webhook || null }; }
      if (cur === 'missing') { const c = await ev.create(); return { created: true, state: 'connecting', ...c }; }
      const c = await ev.connect(payload.pairing_number); return { state: 'connecting', ...c };
    }
    if (action === 'connect') {
      const cur = await ev.state(); if (cur === 'open') return { state: 'open', already: true };
      if (cur === 'missing') { const c = await ev.create(); return { created: true, state: 'connecting', ...c }; }
      const c = await ev.connect(payload.pairing_number); return { state: 'connecting', ...c };
    }
    if (action === 'restart') { await ev.restart(); return { restarted: true }; }
    if (action === 'logout') {
      let removed = false;
      if (!(await ev.logout().catch(() => false))) {
        // sessão travada ("Connection Closed"): o logout normal não funciona, então a instância é recriada no próximo Conectar
        if (!(await ev.remove().catch(() => false))) throw new Error('A Evolution não aceitou desconectar o número. Remova o aparelho em WhatsApp → Aparelhos conectados.');
        removed = true;
      }
      if (removed) { const st = { ...(rt.status.evolution || {}), reachable: true, state: 'close', phone: null, profile: null, checked_at: ctx.now().toISOString(), managed: (rt.managed && rt.managed.evolution) || {} }; await ctx.rpc('report_integration_status', { p_provider: 'evolution', p_status: st }); return { logged_out: true, state: 'close', recreated: true }; }
      // confere o estado real (a Evolution leva alguns segundos para largar a sessão) e atualiza o painel
      let state = 'open';
      for (let i = 0; i < 5 && state === 'open'; i++) { await new Promise((r) => setTimeout(r, 1500)); state = await ev.state().catch(() => 'unknown'); }
      const st = await evolutionStatus(ctx, rt); st.state = state === 'open' ? 'open' : (state === 'unknown' ? 'close' : state);
      await ctx.rpc('report_integration_status', { p_provider: 'evolution', p_status: st });
      if (st.state === 'open') throw new Error('O número continua conectado: a Evolution não encerrou a sessão. Tente de novo ou remova o aparelho em WhatsApp > Aparelhos conectados.');
      return { logged_out: true, state: st.state };
    }
    if (action === 'set_webhook') { need(cfg.webhook_url, 'Informe o endereço do webhook do worker (aba WhatsApp).'); await ev.setWebhook(cfg.webhook_url); const w = await ev.getWebhook().catch(() => null); return { webhook: w }; }
    if (action === 'send_test') { const r = await ev.send('sendText', { number: payload.to, text: payload.text }); if (!r.ok) throw new Error(r.error); return { sent: true, message_id: r.messageId }; }
  }
  if (provider === 'telegram') {
    const tg = rt.secrets.telegram_bot_token; need(tg, 'O token do bot não está configurado: coloque TELEGRAM_BOT_TOKEN no arquivo do servidor (deploy/worker/worker.env) ou informe em Avançado.');
    const bot = telegramClient(ctx, tg);
    if (action === 'connect') {
      // liga tudo sozinho: confere o bot, registra o webhook público (se houver) e deixa o Telegram ativo
      const me = await bot.me(); const url = rt.managed && rt.managed.telegram.webhook ? rt.telegram.webhook_url : '';
      const out = { enabled: true, mode: url ? 'webhook' : 'polling' };
      if (url) { need(rt.secrets.telegram_webhook_secret, 'Segredo do webhook indisponível.'); await bot.setWebhook(url, rt.secrets.telegram_webhook_secret); out.webhook_url = url; }
      else await bot.deleteWebhook();
      await ctx.rpc('save_integration', { p_provider: 'telegram', p_config: out });
      rt.telegram = { ...rt.telegram, ...out };
      const st = await telegramStatus(ctx, rt); st.managed = (rt.managed && rt.managed.telegram) || {};
      await ctx.rpc('report_integration_status', { p_provider: 'telegram', p_status: { ...(rt.status.telegram || {}), ...st } });
      return { ...st, connected: true, bot_username: me.username };
    }
    if (action === 'check') { const st = await telegramStatus(ctx, rt); st.managed = (rt.managed && rt.managed.telegram) || {}; await ctx.rpc('report_integration_status', { p_provider: 'telegram', p_status: { ...(rt.status.telegram || {}), ...st } }); return st; }
    if (action === 'set_webhook') {
      need(rt.telegram.webhook_url, 'Informe o endereço do webhook (aba Telegram).'); need(rt.secrets.telegram_webhook_secret, 'Gere o segredo do webhook antes.');
      await bot.setWebhook(rt.telegram.webhook_url, rt.secrets.telegram_webhook_secret); const info = await bot.webhookInfo(); return { webhook: sanitizeWebhook(info) };
    }
    if (action === 'delete_webhook') { await bot.deleteWebhook(); return { webhook: null }; }
    if (action === 'send_test') { const r = await bot.send(payload.to, payload.text); if (!r.ok) throw new Error(r.error); return { sent: true, message_id: r.messageId }; }
  }
  if (provider === 'mercadolivre' && action === 'exchange_code') return mlExchange(ctx, rt, payload);
  if (provider === 'mercadolivre' && action === 'disconnect') return mlDisconnect(ctx, rt);
  if (['mercadolivre', 'shopee', 'aliexpress', 'amazon'].includes(provider) && (action === 'preview' || action === 'collect')) return collectStore(ctx, rt, provider, { dry: action === 'preview' });
  if (['mercadolivre', 'shopee', 'aliexpress', 'amazon', 'magalu'].includes(provider) && action === 'check') {
    const res = await checkStore(ctx, provider, rt);
    await ctx.rpc('report_integration_status', { p_provider: provider, p_status: { ok: !!res.ok, partial: !!res.partial, connected: res.connected ?? null, account: res.account || null, detail: res.detail || null, error: res.error || null } });
    return res;
  }
  throw new Error('Ação não suportada pelo worker');
}
const sanitizeWebhook = (i) => i ? { url: String(i.url || '').replace(/\?.*$/, ''), pending: i.pending_update_count || 0, last_error: i.last_error_message ? clean(i.last_error_message) : null, last_error_at: i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : null } : null;
async function telegramStatus(ctx, rt) {
  const bot = telegramClient(ctx, rt.secrets.telegram_bot_token);
  const me = await bot.me(); const info = await bot.webhookInfo();
  return { ok: true, bot_username: me.username, bot_name: me.first_name, can_join_groups: !!me.can_join_groups, mode_live: info.url ? 'webhook' : 'polling', webhook: sanitizeWebhook(info) };
}


/* ------------------------------------------------------------------ Grupos */
const sleepSafe = (ctx, ms) => ctx.sleep(ms);
const withDisclosure = (rt, text, on) => { const d = String(rt.disclosure || '').trim(); const base = String(text || '').trim(); if (!on || !d || base.includes(d)) return base; return (base ? base + '\n\n' : '') + d; };

async function waChat(ctx, rt, ev, jid) {
  const info = await ev.group.info(jid); const parts = await ev.group.participants(jid).catch(() => []);
  const list = (parts.length ? parts : (info && info.participants) || []).map(waParticipant).filter(Boolean);
  const me = await ev.fetchOne().catch(() => null); const mine = me && me.phone;
  const admin = !!(mine && list.some((p) => p.external_id === mine && p.role === 'admin'));
  const chat = { external_id: jid, kind: 'group', title: String((info && (info.subject || info.name)) || 'Grupo').slice(0, 120), description: info && typeof info.desc === 'string' ? info.desc.slice(0, 2048) : (info && typeof info.description === 'string' ? info.description.slice(0, 2048) : undefined), participant_count: list.length || (info && info.size) || undefined, we_are_admin: admin };
  const flags = { only_admins_send: info && info.announce !== undefined ? !!info.announce : undefined, lock_info: info && info.restrict !== undefined ? !!info.restrict : undefined, ephemeral_seconds: info && Number.isFinite(info.ephemeralDuration) ? info.ephemeralDuration : undefined };
  return { chat, participants: list, flags };
}

async function addInBatches(ctx, ev, jid, numbers, size, delayS) {
  const added = []; const pending = [];
  for (let i = 0; i < numbers.length; i += size) {
    const batch = numbers.slice(i, i + size);
    try { await ev.group.participant(jid, 'add', batch); added.push(...batch); }
    catch (e) { pending.push(...numbers.slice(i)); if (e.uncertain) { return { added, pending, uncertain: true }; } break; }
    if (i + size < numbers.length) await sleepSafe(ctx, delayS * 1000);
  }
  return { added, pending };
}

async function whatsappGroupAction(ctx, rt, job) {
  const ev = evolutionClient(ctx, rt.evolution, rt.secrets.evolution_api_key); need(ev.ready() && rt.evolution.instance, 'Configure a Evolution e a instância em Configurações → WhatsApp.');
  const { action, external_id: jid, params = {} } = job.payload; const g = ev.group; const defs = (rt.groups && rt.groups.whatsapp) || {};
  const done = async (extra = {}) => ({ ...(await waChat(ctx, rt, ev, jid)), ...extra });
  switch (action) {
    case 'info': case 'participants': return done();
    case 'invite_code': return { ...(await done()), invite_url: await g.inviteCode(jid) };
    case 'revoke_invite': return { invite_url: await g.revokeInvite(jid), ...(await done()) };
    case 'set_subject': await g.subject(jid, params.subject); return done();
    case 'set_description': await g.description(jid, params.description); return done();
    case 'set_only_admins_send': await g.setting(jid, params.value ? 'announcement' : 'not_announcement'); return done();
    case 'set_lock_info': await g.setting(jid, params.value ? 'locked' : 'unlocked'); return done();
    case 'set_ephemeral': await g.ephemeral(jid, params.seconds); return done();
    case 'add_participants': {
      const r = await addInBatches(ctx, ev, jid, params.numbers, Math.max(1, Number(defs.add_batch_size || 20)), Math.max(2, Number(defs.add_delay_s || 6)));
      if (r.uncertain) throw new Error('Resultado incerto: a Evolution não confirmou a adição. Confira os participantes no aplicativo');
      return done({ added: r.added, pending_numbers: r.pending });
    }
    case 'remove_participants': await g.participant(jid, 'remove', params.numbers); return done();
    case 'promote': await g.participant(jid, 'promote', params.numbers); return done();
    case 'demote': await g.participant(jid, 'demote', params.numbers); return done();
    case 'send_invite': await g.sendInvite(jid, params.numbers, params.text || 'Entre no nosso grupo de ofertas'); return { sent_to: params.numbers.length };
    case 'apply_defaults': return done({ applied: await applyWaDefaults(ctx, rt, ev, jid) });
    case 'leave': await g.leave(jid); return { left: true, chat: { external_id: jid, kind: 'group', title: 'Grupo', we_are_admin: false } };
    default: throw new Error('Ação de grupo não suportada no WhatsApp');
  }
}

async function applyWaDefaults(ctx, rt, ev, jid) {
  const d = (rt.groups && rt.groups.whatsapp) || {}; const applied = {}; const g = ev.group;
  const step = async (k, fn) => { try { await fn(); applied[k] = true; } catch (e) { applied[k] = false; } };
  if (d.only_admins_send !== undefined) await step('only_admins_send', () => g.setting(jid, d.only_admins_send ? 'announcement' : 'not_announcement'));
  if (d.lock_info !== undefined) await step('lock_info', () => g.setting(jid, d.lock_info ? 'locked' : 'unlocked'));
  if (d.ephemeral_seconds) await step('ephemeral', () => g.ephemeral(jid, d.ephemeral_seconds));
  return applied;
}

async function createWaGroup(ctx, rt, payload) {
  const ev = evolutionClient(ctx, rt.evolution, rt.secrets.evolution_api_key); need(ev.ready() && rt.evolution.instance, 'Configure a Evolution e a instância em Configurações → WhatsApp.');
  const d = (rt.groups && rt.groups.whatsapp) || {}; const size = Math.max(1, Number(d.add_batch_size || 20)); const delay = Math.max(2, Number(d.add_delay_s || 6));
  const nums = [...new Set((payload.participants || []).map((p) => digits(p.external_id)).filter(Boolean))];
  const desc = withDisclosure(rt, payload.description, d.add_disclosure !== false).slice(0, 2048);
  const first = nums.slice(0, size);
  const made = await ev.createGroup(payload.name, desc, first);
  const rest = nums.slice(size); let pending = [];
  const applied = await applyWaDefaults(ctx, rt, ev, made.external_id).catch(() => ({}));
  if (rest.length) { await sleepSafe(ctx, delay * 1000); const r = await addInBatches(ctx, ev, made.external_id, rest, size, delay); pending = r.pending; made.participants.push(...r.added.map((n) => ({ external_id: n, display_name: '+' + n, role: 'member' }))); }
  let invite_url = null; if (d.invite_after_create !== false) invite_url = await ev.group.inviteCode(made.external_id).catch(() => null);
  return { ...made, invite_url, applied, pending_numbers: pending.length ? pending : undefined };
}

async function telegramGroupAction(ctx, rt, job) {
  const tok = rt.secrets.telegram_bot_token; need(tok, 'Configure o token do bot em Configurações → Telegram.');
  const bot = telegramClient(ctx, tok); const { action, external_id: ref, params = {} } = job.payload;
  const mut = async (fn) => { try { return await fn(); } catch (e) { if (e.network || e.status >= 500) { const u = new Error('Resultado incerto: o Telegram não confirmou. Confira no aplicativo antes de tentar de novo'); u.uncertain = true; throw u; } throw e; } };
  const read = async () => {
    const c = await bot.getChat(ref); const me = await bot.me(); const m = await bot.getMember(c.id, me.id).catch(() => null);
    const count = await bot.memberCount(c.id).catch(() => undefined);
    return { external_id: String(c.id), kind: c.type === 'channel' ? 'channel' : 'group', title: c.title || ref, description: c.description || undefined, username: c.username || null, participant_count: Number.isFinite(count) ? count : undefined, we_are_admin: !!(m && ['administrator', 'creator'].includes(m.status)), can_send: c.permissions ? c.permissions.can_send_messages !== false : undefined };
  };
  const admins = async (id) => (await bot.admins(id).catch(() => [])).map((a) => ({ external_id: String(a.user.id), display_name: [a.user.first_name, a.user.last_name].filter(Boolean).join(' ') || a.user.username || String(a.user.id), role: a.status === 'creator' ? 'owner' : 'admin' }));
  const done = async (extra = {}) => { const chat = await read(); return { chat, participants: await admins(chat.external_id), ...extra }; };
  switch (action) {
    case 'info': case 'admins': return done();
    case 'create_invite': { const l = await mut(() => bot.createInvite(ref, 'Central de Promoções')); return done({ invite_url: l.invite_link }); }
    case 'revoke_invite': { const l = await mut(() => bot.revokeInvite(ref, params.link)); return done({ revoked: true, invite_url: l && l.invite_link && l.invite_link !== params.link ? l.invite_link : undefined }); }
    case 'set_title': await mut(() => bot.setTitle(ref, params.subject || params.title)); return done();
    case 'set_description': await mut(() => bot.setDescription(ref, params.description)); return done();
    case 'set_permissions': await mut(() => bot.setPermissions(ref, !!params.can_send_messages)); return done();
    case 'leave': await mut(() => bot.leave(ref)); return { left: true, chat: { external_id: String(ref), kind: 'group', title: 'Grupo', we_are_admin: false } };
    default: throw new Error('Ação de grupo não suportada no Telegram');
  }
}

async function channelTask(ctx, rt, job) {
  const { kind, channel, payload } = job;
  if (kind === 'integration') return integrationTask(ctx, rt, payload);
  if (kind === 'group_action') return channel === 'whatsapp' ? whatsappGroupAction(ctx, rt, job) : telegramGroupAction(ctx, rt, job);
  if (channel === 'whatsapp') {
    const ev = evolutionClient(ctx, rt.evolution, rt.secrets.evolution_api_key); need(ev.ready() && rt.evolution.instance, 'Configure a Evolution e a instância em Configurações → WhatsApp.');
    if (kind === 'refresh_groups') return { groups: await ev.groups() };
    if (kind === 'create_group') return createWaGroup(ctx, rt, payload);
    throw new Error('Tarefa não suportada no WhatsApp');
  }
  const tg = rt.secrets.telegram_bot_token; need(tg, 'Configure o token do bot em Configurações → Telegram.');
  const bot = telegramClient(ctx, tg);
  if (kind === 'refresh_groups') {
    // O Telegram não lista chats do bot. Reaproveitamos os que o banco já conhece, atualizando nome, permissão e membros.
    const known = await ctx.rpc('list_discovered_groups', { p_channel: 'telegram' }).catch(() => []);
    const out = [];
    for (const g of known || []) { try { const c = await bot.getChat(g.external_id); const m = await bot.getMember(g.external_id, (await bot.me()).id).catch(() => null); out.push({ external_id: String(c.id), kind: c.type === 'channel' ? 'channel' : 'group', title: c.title || g.title, username: c.username || null, we_are_admin: !!(m && ['administrator', 'creator'].includes(m.status)) }); } catch { /* bot saiu do chat */ } }
    return { groups: out };
  }
  if (kind === 'verify_chat') {
    const ref = String(payload.ref); const c = await bot.getChat(ref); const me = await bot.me(); const m = await bot.getMember(c.id, me.id).catch(() => null);
    const admin = !!(m && ['administrator', 'creator'].includes(m.status));
    return { chat: { external_id: String(c.id), kind: c.type === 'channel' ? 'channel' : c.type === 'private' ? 'private' : 'group', title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || ref, username: c.username || null, we_are_admin: admin } };
  }
  throw new Error('Tarefa não suportada no Telegram');
}

// Roda as tarefas pedidas pelo painel (workflow rápido, a cada ~5 s).
export async function runJobs(ctx, { max = 5 } = {}) {
  let rt = null; let done = 0;
  for (let i = 0; i < max; i++) {
    const job = await ctx.rpc('claim_channel_job', { p_worker: 'worker' });
    if (!job) break;
    rt = rt || await loadRuntime(ctx);
    try { const res = await channelTask(ctx, rt, job); await ctx.rpc('complete_channel_job', { p_id: job.id, p_result: res }); ctx.log(`tarefa ${job.kind} concluída`); }
    catch (e) { await ctx.rpc('fail_channel_job', { p_id: job.id, p_error: clean(e && e.message || 'erro') }); ctx.log(`tarefa ${job.kind} falhou: ${clean(e && e.message)}`); }
    done++;
  }
  return { done };
}

/* ------------------------------------------------------------------ Envios */
async function loadRuntime(ctx) {
  const rt = await ctx.rpc('get_integration_runtime', {}); rt.secrets = rt.secrets || {}; rt.status = rt.status || {}; rt.connectors = rt.connectors || {};
  rt.evolution = rt.evolution || {}; rt.telegram = rt.telegram || {}; rt.groups = rt.groups || {}; rt.tuning = rt.tuning || {}; rt.search_terms = rt.search_terms || {};
  applyManaged(ctx, rt);
  return rt;
}
const pickDelay = (ctx, ev) => { const a = Number(ev.send_delay_min_s || 4), b = Math.max(a, Number(ev.send_delay_max_s || 12)); return Math.round((a + ctx.rand() * (b - a)) * 1000); };

function sender(ctx, rt) {
  const wa = evolutionClient(ctx, rt.evolution, rt.secrets.evolution_api_key);
  const tg = rt.secrets.telegram_bot_token ? telegramClient(ctx, rt.secrets.telegram_bot_token) : null;
  return {
    async send(channel, to, text, imageUrl) {
      if (channel === 'whatsapp') {
        if (!wa.ready() || !rt.evolution.instance) return { ok: false, permanent: false, retryIn: 600, code: 'not_configured', error: 'WhatsApp não configurado' };
        if (imageUrl && text.length <= 1000) {
          const r = await wa.send('sendMedia', { number: to, mediatype: 'image', media: imageUrl, caption: text });
          if (r.ok || !r.mediaProblem) return r;
        }
        return wa.send('sendText', { number: to, text });
      }
      if (!tg) return { ok: false, permanent: false, retryIn: 600, code: 'not_configured', error: 'Telegram não configurado' };
      if (!rt.telegram.enabled) return { ok: false, permanent: false, retryIn: 600, code: 'tg_off', error: 'Telegram desligado' };
      let r = await tg.send(to, text, imageUrl); if (!r.ok && r.mediaProblem) r = await tg.send(to, text, null); return r;
    },
  };
}

export async function runSender(ctx, { budgetMs = 50000, maxPerRun = 20 } = {}) {
  const t0 = ctx.now().getTime(); const rt = await loadRuntime(ctx); const s = sender(ctx, rt); let sent = 0; let failed = 0; let unknown = 0; let repriced = 0;
  await ctx.rpc('heartbeat', { p_service: 'worker', p_status: 'ok', p_details: {} }).catch(() => {});
  const left = () => budgetMs - (ctx.now().getTime() - t0);
  // 1) testes de destino
  for (let i = 0; i < 3 && left() > 8000; i++) {
    const t = await ctx.rpc('claim_destination_test', {}); if (!t) break;
    const r = await s.send(t.channel, t.external_chat_id, `✅ Teste da Central de Promoções para "${t.name}". Se você viu esta mensagem, o destino está pronto.`);
    await ctx.rpc('complete_destination_test', { p_test: t.test_id, p_ok: !!r.ok, p_error: r.ok ? null : r.error });
    if (r.ok) sent++; else failed++;
  }
  // 2) publicações de ofertas
  for (let i = 0; i < maxPerRun && left() > 8000; i++) {
    const p = await ctx.rpc('claim_next_publication', { p_worker: 'worker' }); if (!p) break;
    if (p.is_simulated) { await ctx.rpc('complete_publication', { p_id: p.publication_id, p_external_message_id: 'simulado-' + String(p.publication_id).slice(0, 8) }); sent++; continue; }
    {
      const pc = await ctx.rpc('get_publication_context', { p_pub: p.publication_id }).catch(() => null);
      if (pc && pc.offer_id) {
        if ((rt.tuning || {}).revalidate_before_send !== false) { const v = await revalidate(ctx, rt, pc).catch(() => null); if (v && v.reprice) { repriced++; continue; } }
        if (pc.short_code && pc.sub_id) await personalizeLink(ctx, rt, pc).catch(() => {});
      }
    }
    const r = await s.send(p.channel, p.external_chat_id, p.rendered_text, p.image_url);
    if (r.ok) { await ctx.rpc('complete_publication', { p_id: p.publication_id, p_external_message_id: r.messageId }); sent++; }
    else if (r.ambiguous) { await ctx.rpc('mark_publication_unknown', { p_id: p.publication_id, p_note: `${r.error} — confira no canal antes de reenviar` }); unknown++; }
    else { await ctx.rpc('fail_publication', { p_id: p.publication_id, p_error_code: r.code, p_permanent: !!r.permanent, p_retry_in_seconds: r.retryIn ?? null }); failed++; if (r.code === 'rate') break; }
    if (p.channel === 'whatsapp') await ctx.sleep(Math.min(pickDelay(ctx, rt.evolution), Math.max(0, left() - 4000)));
  }
  // 3) respostas manuais das conversas
  for (let i = 0; i < 5 && left() > 8000; i++) {
    const m = await ctx.rpc('claim_chat_outbox', { p_worker: 'worker' }); if (!m) break;
    const r = await s.send(m.channel, m.chat_external_id, m.text);
    if (r.ok) await ctx.rpc('complete_chat_outbox', { p_id: m.outbox_id, p_external_message_id: r.messageId });
    else await ctx.rpc('fail_chat_outbox', { p_id: m.outbox_id, p_error: r.ambiguous ? `${r.error} — resultado incerto: confira no aplicativo antes de reenviar` : r.error });
  }
  await ctx.rpc('release_stale_claims', {}).catch(() => {});
  return { sent, failed, unknown, repriced };
}

/* ------------------------------------------------------------------ Monitor + Telegram por consulta */
export async function runMonitor(ctx) {
  const rt = await loadRuntime(ctx); const out = {};
  // Evolution: confere a instância; alerta quando cai ou volta
  if (rt.evolution.base_url && rt.secrets.evolution_api_key && rt.evolution.instance) {
    const prev = rt.status.evolution || {};
    try {
      const st = await evolutionStatus(ctx, rt); await ctx.rpc('report_integration_status', { p_provider: 'evolution', p_status: { ...st, since: prev.state === st.state && prev.since ? prev.since : ctx.now().toISOString() } });
      out.evolution = st.state;
      if (prev.state === 'open' && st.state !== 'open') await alertAll(ctx, rt, `⚠️ O WhatsApp da instância "${rt.evolution.instance}" desconectou (${st.state}). Reconecte pelo QR code em Configurações → WhatsApp.`);
      if (prev.state && prev.state !== 'open' && st.state === 'open') await alertAll(ctx, rt, `✅ O WhatsApp da instância "${rt.evolution.instance}" voltou a conectar.`);
    } catch (e) { await ctx.rpc('report_integration_status', { p_provider: 'evolution', p_status: { reachable: false, error: clean(e && e.message), instance: rt.evolution.instance } }); out.evolution = 'erro'; }
  }
  // Telegram: confere o bot e, no modo polling, busca as mensagens recebidas
  if (rt.secrets.telegram_bot_token && rt.telegram.enabled) {
    const prev = rt.status.telegram || {}; let offset = Number(prev.offset || 0); let got = 0;
    try {
      const st = await telegramStatus(ctx, rt); const bot = telegramClient(ctx, rt.secrets.telegram_bot_token);
      if (rt.telegram.mode === 'polling' && st.mode_live === 'webhook') await bot.deleteWebhook();
      if (rt.telegram.mode === 'polling') {
        const ups = await bot.updates(offset || undefined);
        for (const u of ups) { await registerTelegramChat(ctx, u); const m = mapTelegramUpdate(u); if (m) { await ctx.rpc('ingest_chat_message', { p: m }).catch(() => {}); got++; } offset = Math.max(offset, u.update_id + 1); }
      }
      await ctx.rpc('report_integration_status', { p_provider: 'telegram', p_status: { ...st, offset, received_last_run: got, mode: rt.telegram.mode } }); out.telegram = 'ok';
    } catch (e) { await ctx.rpc('report_integration_status', { p_provider: 'telegram', p_status: { ok: false, error: clean(e && e.message), offset } }); out.telegram = 'erro'; }
  }
  return out;
}
async function alertAll(ctx, rt, text) {
  if (rt.evolution.alerts === false && rt.telegram.alerts === false) return;
  const chat = rt.telegram.admin_chat_id;
  if (rt.telegram.alerts !== false && chat && rt.secrets.telegram_bot_token && rt.telegram.enabled) await telegramClient(ctx, rt.secrets.telegram_bot_token).send(chat, text).catch(() => {});
}

/* ------------------------------------------------------------------ Entrada (webhooks) */
const WA_TEXT = (m) => !m ? '' : m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || (m.imageMessage && m.imageMessage.caption) || (m.videoMessage && m.videoMessage.caption) || (m.documentMessage && m.documentMessage.caption) || '';
const WA_KIND = (m) => !m ? 'text' : m.imageMessage ? 'image' : m.videoMessage ? 'video' : m.audioMessage ? 'audio' : m.documentMessage ? 'document' : m.stickerMessage ? 'sticker' : 'text';
// Evolution `messages.upsert` -> ingest_chat_message
export function mapEvolutionMessage(body) {
  const items = Array.isArray(body && body.data) ? body.data : body && body.data ? [body.data] : [];
  const out = [];
  for (const d of items) {
    const key = d.key || {}; const jid = key.remoteJid; if (!jid || jid === 'status@broadcast' || /@(broadcast|newsletter)$/.test(jid)) continue;
    const kind = WA_KIND(d.message); const text = WA_TEXT(d.message);
    if (!text && kind === 'text') continue;
    const group = isGroupJid(jid); const ts = Number(d.messageTimestamp);
    out.push({ chat: { channel: 'whatsapp', external_id: jid, kind: group ? 'group' : 'private', title: group ? undefined : (d.pushName || '+' + jidPhone(jid)) },
      direction: key.fromMe ? 'out' : 'in', external_id: key.id, sender_external_id: key.fromMe ? undefined : (key.participant || jid), sender_name: key.fromMe ? 'Número conectado' : d.pushName,
      body: text || `[${kind}]`, kind, sent_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : undefined });
  }
  return out;
}
// Telegram update -> ingest_chat_message
export function mapTelegramUpdate(u) {
  const m = u && (u.message || u.channel_post); if (!m || !m.chat) return null;
  const c = m.chat; const text = m.text || m.caption || ''; const kind = m.photo ? 'image' : m.video ? 'video' : m.voice || m.audio ? 'audio' : m.document ? 'document' : m.sticker ? 'sticker' : 'text';
  if (!text && kind === 'text') return null;
  const from = m.from || m.sender_chat || {};
  return { chat: { channel: 'telegram', external_id: String(c.id), kind: c.type === 'channel' ? 'channel' : c.type === 'private' ? 'private' : 'group', title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || undefined, username: c.username || undefined },
    direction: 'in', external_id: `${c.id}:${m.message_id}`, sender_external_id: from.id != null ? String(from.id) : undefined, sender_name: from.title || [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username,
    body: tgBody(m, text) || `[${kind}]`, kind, sent_at: m.date ? new Date(m.date * 1000).toISOString() : undefined };
}
// Telegram: o bot virou (ou deixou de ser) administrador/membro de um canal ou grupo -> o chat passa a aparecer em Destinos,
// mesmo que ninguém tenha escrito nada nele ainda. Também vale para posts sem texto (foto, vídeo).
export function mapTelegramChat(u) {
  if (!u) return null;
  const mc = u.my_chat_member; const m = u.message || u.channel_post;
  const c = (mc && mc.chat) || (m && m.chat); if (!c || c.id == null || c.type === 'private') return null;
  const status = mc && mc.new_chat_member && mc.new_chat_member.status;
  if (status === 'left' || status === 'kicked') return null;
  const out = { channel: 'telegram', external_id: String(c.id), kind: c.type === 'channel' ? 'channel' : 'group', title: c.title || undefined, username: c.username || undefined };
  if (status) out.we_are_admin = status === 'administrator' || status === 'creator';
  return out;
}
async function registerTelegramChat(ctx, u) { const c = mapTelegramChat(u); if (c) await ctx.rpc('upsert_chat', { p: c }).catch(() => {}); }
// Webhook do Telegram: confere o segredo do cabeçalho X-Telegram-Bot-Api-Secret-Token antes de aceitar.
/* ------------------------------------------------------------------ Segurança dos webhooks de entrada */
// Comparação em tempo constante (evita descobrir o segredo pelo tempo de resposta).
export function safeEq(a, b) { a = String(a ?? ''); b = String(b ?? ''); if (a.length !== b.length || !a) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const headerOf = (h, name) => { if (!h) return ''; const k = Object.keys(h).find((x) => x.toLowerCase() === name); return k ? String(h[k]) : ''; };
// Porteiro: roda ANTES de qualquer consulta ao banco. Recusa lixo, excesso e requisições sem credencial,
// para que um ataque de inundação nunca chegue ao Supabase. Devolve { blocked, status, motivo }.
export function guardWebhook(ctx, kind, item) {
  const lim = ctx.limits || {}; const maxKb = lim.corpoMaxKb || 256; const perMin = lim.webhookPorMin || 120;
  const body = item && item.body; const headers = (item && item.headers) || {};
  const deny = (status, motivo) => ({ blocked: true, ok: false, status, motivo });
  let size = 0; try { size = JSON.stringify(body || {}).length; } catch { return deny(400, 'corpo ilegível'); }
  if (size > maxKb * 1024) return deny(413, 'corpo grande demais');
  if (!body || typeof body !== 'object' || Array.isArray(body)) return deny(400, 'corpo inválido');
  if (kind === 'telegram') {
    const tok = headerOf(headers, 'x-telegram-bot-api-secret-token');
    if (tok.length < 16 || tok.length > 256) return deny(401, 'sem segredo do Telegram'); // nem consulta o banco
  } else if (kind === 'whatsapp') {
    if (typeof body.instance !== 'string' || typeof body.event !== 'string' || body.instance.length > 100 || body.event.length > 60) return deny(400, 'formato inesperado');
  }
  if (ctx.limit) { const r = ctx.limit('hook:' + kind, perMin, 60000); if (!r.ok) return { ...deny(429, 'excesso de requisições'), retryAfter: r.retryAfter }; }
  return { blocked: false };
}

export async function handleTelegramWebhook(ctx, headers, body) {
  const rt = await loadRuntime(ctx); const want = rt.secrets.telegram_webhook_secret; const got = headers && (headers['x-telegram-bot-api-secret-token'] || headers['X-Telegram-Bot-Api-Secret-Token']);
  if (!want || want.length < 16 || !safeEq(got, want)) return { ok: false, status: 401 };
  await registerTelegramChat(ctx, body);
  const m = mapTelegramUpdate(body); if (m) await ctx.rpc('ingest_chat_message', { p: m });
  return { ok: true, status: 200 };
}
// Webhook da Evolution: aceita só a instância configurada e o evento de mensagens.
export async function handleEvolutionWebhook(ctx, body) {
  const rt = await loadRuntime(ctx);
  if (!rt.evolution.instance || (body && body.instance) !== rt.evolution.instance) return { ok: false, status: 403 };
  if (!/messages[._]upsert/i.test(String(body && body.event))) return { ok: true, status: 200, ignored: true };
  let n = 0; for (const m of mapEvolutionMessage(body).slice(0, 50)) { await ctx.rpc('ingest_chat_message', { p: m }); n++; }
  return { ok: true, status: 200, stored: n };
}


/* ================================================================== Dados atuais de um produto (revalidação, Radar e acompanhamento) */
const normMl = (d) => ({ external_id: String(d.id || ''), title: String(d.title || '').trim(), price: Number(d.price) || 0, previous: d.original_price != null && Number(d.original_price) > Number(d.price) ? Number(d.original_price) : null,
  url: d.permalink || '', affiliate_url: '', image: (d.pictures && d.pictures[0] && (d.pictures[0].secure_url || d.pictures[0].url)) || (d.thumbnail ? String(d.thumbnail).replace(/^http:/, 'https:') : null), seller: null,
  stock: d.status && d.status !== 'active' ? 0 : (d.available_quantity == null ? null : Number(d.available_quantity)), used: !!d.condition && d.condition !== 'new', sold: Number(d.sold_quantity) || null, commission_pct: null });

// Devolve { found, item } | { found:false } | { supported:false, reason }. Erros de rede/autenticação são lançados.
export async function fetchCurrent(ctx, rt, platform, externalId) {
  const cfg = connectorOf(rt, platform).config || {}; const sec = rt.secrets || {};
  if (platform === 'magalu') return { supported: false, reason: 'A Magalu não tem API de afiliados: cadastre a oferta manualmente' };
  if (!credsOk(platform, cfg, sec)) return { supported: false, reason: `Credenciais do ${STORE_LABEL[platform] || platform} não configuradas` };
  if (platform === 'mercadolivre') {
    if (!(sec.ml_refresh_token || sec.ml_access_token)) return { supported: false, reason: 'Conta do Mercado Livre não conectada' };
    if (!/^MLB\d+$/.test(String(externalId))) return { supported: false, reason: 'Identificador do Mercado Livre inválido' };
    try { const d = await mlGet(ctx, rt, `/items/${externalId}`); return d && d.id ? { found: true, item: normMl(d) } : { found: false }; }
    catch (e) {
      if (e && (e.status === 403 || e.status === 404)) {
        // anúncio de outro vendedor é bloqueado para o aplicativo; se o código for de produto de catálogo, as ofertas ainda saem de /products
        try { const p = await mlGet(ctx, rt, `/products/${externalId}`); const it = p && p.id ? await mlCatalogOffer(ctx, rt, p) : null; if (it) return { found: true, item: it }; }
        catch (e2) { if (!(e2 && (e2.status === 404 || e2.status === 403))) throw e2; }
        if (e.status === 403) return { supported: false, reason: 'O Mercado Livre não libera o preço de anúncios individuais para este aplicativo (só produtos de catálogo).' };
        return { found: false };
      }
      throw e;
    }
  }
  if (platform === 'shopee') {
    const itemId = String(externalId).split('.').pop(); if (!/^\d+$/.test(itemId)) return { supported: false, reason: 'Identificador da Shopee inválido' };
    const q = (f) => `query{ productOfferV2(itemId:${itemId}, limit:1){ nodes{ ${f} } } }`; let d;
    try { d = await shopeeCall(ctx, cfg, sec.shopee_secret, q(SP_FULL)); } catch (e) { if (!/field|cannot query|validation/i.test(String(e.message))) throw e; d = await shopeeCall(ctx, cfg, sec.shopee_secret, q(SP_MIN)); }
    const n = d && d.productOfferV2 && d.productOfferV2.nodes && d.productOfferV2.nodes[0];
    return n ? { found: true, item: shopeeItem(n) } : { found: false };
  }
  if (platform === 'amazon') {
    const token = await amazonToken(ctx, rt, cfg); const mkt = cfg.marketplace || 'www.amazon.com.br';
    if (rt._amzCalls) await ctx.sleep(1100); rt._amzCalls = (rt._amzCalls || 0) + 1;
    const r = await ctx.http({ method: 'POST', url: ((ctx.urls && ctx.urls.amazon) || 'https://creatorsapi.amazon') + '/catalog/v1/getItems', headers: { Authorization: `Bearer ${token}`, 'x-marketplace': mkt },
      json: { itemIds: [String(externalId)], itemIdType: 'ASIN', marketplace: mkt, partnerTag: cfg.partner_tag, resources: AMZ_RES }, timeoutMs: 25000 });
    if (r.status === 404) return { found: false };
    if (r.status >= 400) { const er = r.data && Array.isArray(r.data.errors) && r.data.errors[0]; const e = new Error(`a Amazon respondeu ${r.status}: ${er ? clean(er.message || er.code) : msgOf(r.data) || 'sem detalhe'}`); e.status = r.status; throw e; }
    const it = ((r.data && r.data.itemsResult && r.data.itemsResult.items) || (r.data && r.data.items) || [])[0]; if (!it) return { found: false };
    const item = amazonItem(it, mkt); return item.price > 0 ? { found: true, item } : { found: false };
  }
  if (platform === 'aliexpress') {
    const d = await aliCall(ctx, cfg, sec.aliexpress_app_secret, 'aliexpress.affiliate.productdetail.get', { product_ids: String(externalId), target_currency: 'BRL', target_language: 'PT', country: 'BR', tracking_id: String(cfg.tracking_id || cfg.affiliate_id || '') });
    const res = d.aliexpress_affiliate_productdetail_get_response && d.aliexpress_affiliate_productdetail_get_response.resp_result;
    const list = res && res.result && res.result.products && res.result.products.product; const n = Array.isArray(list) ? list[0] : list;
    return n && n.product_id ? { found: true, item: aliItem(n) } : { found: false };
  }
  return { supported: false, reason: 'Plataforma sem consulta por API' };
}

/* ================================================================== Ingestão compartilhada (coleta, Radar e acompanhamento) */
async function guessCategory(ctx, title) {
  const s = await ctx.rpc('category_guess', { p_text: String(title || '').slice(0, 300) }).catch(() => null);
  return typeof s === 'string' && s ? s : undefined;
}
async function ingestStoreItem(ctx, rt, provider, cfg, it, { layer = 'A', sourceName, evidence = {}, autoOk = false } = {}) {
  const category = it.category || await guessCategory(ctx, it.title);
  const res = (await ctx.rpc('ingest_offer', { p: { platform: provider, external_id: it.external_id, original_url: it.url, affiliate_url: affiliateUrl(it, cfg), title: it.title.slice(0, 300), price: it.price, previous_price: it.previous || undefined,
    image_url: it.image || undefined, seller_name: it.seller || undefined, category, source_kind: 'api', source_layer: layer, source_name: sourceName || SOURCE_NAME[provider],
    availability: it.stock != null ? (it.stock > 0 ? 'in_stock' : 'out_of_stock') : 'unknown', observed_at: ctx.now().toISOString(),
    evidence: { termo: it.term, comissao_pct: it.commission_pct ?? undefined, vendidos: it.sold ?? undefined, preco_anterior_derivado: it.derived_previous || undefined, ...evidence } } })) || {};
  if (res.status === 'created') {
    const sc = await ctx.rpc('set_offer_signals', { p_offer: res.offer_id, p_commission: it.commission_pct ?? null, p_sold: it.sold ?? null, p_rating: it.rating ?? null, p_auto_ok: !!autoOk }).catch(() => null);
    void sc;
  }
  return res;
}

/* ================================================================== Revalidação do preço antes do envio e link por destino */
async function revalidate(ctx, rt, pc) {
  if (pc.revalidated_at && ctx.now().getTime() - new Date(pc.revalidated_at).getTime() < 20 * 60000) return null;
  const cur = await fetchCurrent(ctx, rt, pc.platform, pc.external_id);
  if (!cur || !cur.found || !cur.item) return null;
  const price = cur.item.price; const old = Number(pc.current_price); const avail = cur.item.stock == null ? true : cur.item.stock > 0;
  const maxDrift = Number((rt.tuning || {}).max_price_drift_pct ?? 3);
  const drift = old > 0 ? Math.abs(price - old) / old * 100 : 0;
  if (!avail || drift > maxDrift) {
    await ctx.rpc('reprice_offer', { p_offer: pc.offer_id, p_price: price > 0 ? price : null, p_available: avail, p_note: avail ? `Preço mudou de ${old} para ${price} antes do envio` : 'Produto sem estoque na revalidação antes do envio' });
    return { reprice: true };
  }
  await ctx.rpc('mark_offer_revalidated', { p_offer: pc.offer_id }).catch(() => {});
  return null;
}
// Um rastreio por destino: só quando há link curto (o texto leva o código; aqui troca o destino final). Nunca bloqueia o envio.
async function personalizeLink(ctx, rt, pc) {
  if (!pc.affiliate_url || !pc.short_code || !pc.sub_id) return false;
  let url = null;
  if (pc.platform === 'amazon') url = pc.affiliate_url + (pc.affiliate_url.includes('?') ? '&' : '?') + 'ascsubtag=' + encodeURIComponent(pc.sub_id);
  else if (pc.platform === 'shopee') {
    const cfg = connectorOf(rt, 'shopee').config || {}; if (!credsOk('shopee', cfg, rt.secrets)) return false;
    const d = await shopeeCall(ctx, cfg, rt.secrets.shopee_secret, `mutation{ generateShortLink(input:{ originUrl:${JSON.stringify(String(pc.original_url))}, subIds:[${JSON.stringify(String(pc.sub_id))}] }){ shortLink } }`);
    url = d && d.generateShortLink && d.generateShortLink.shortLink;
  }
  if (!url) return false;
  await ctx.rpc('set_short_link_target', { p_pub: pc.publication_id, p_url: url }); return true;
}

/* ================================================================== Radar de grupos */
const FOLLOW_HOST = /(^|\.)(shopee\.com\.br|shopee\.com|shp\.ee|shope\.ee|mercadolivre\.com\.br|mercadolibre\.com|mercadolivre\.com|meli\.la|amazon\.com\.br|amazon\.com|amzn\.to|amzn\.com|a\.co|aliexpress\.com|aliexpress\.us|magazineluiza\.com\.br|magalu\.com|magazinevoce\.com\.br|bit\.ly|tinyurl\.com|cutt\.ly|t\.ly|is\.gd|ow\.ly|rebrand\.ly|encurtador\.com\.br|tiny\.cc)$/i;
export function extractUrls(text) {
  const out = []; const re = /https?:\/\/[^\s<>"'`)\]]+/gi; let m;
  while ((m = re.exec(String(text || '')))) { const u = m[0].replace(/[.,;:!?*_~]+$/, ''); if (u.length > 12 && u.length < 600 && !out.includes(u)) out.push(u); }
  return out;
}
export function identifyProduct(url) {
  let u; try { u = parseUrl(url); } catch { return null; }
  const h = u.hostname; const p = u.pathname || '';
  if (/(^|\.)(mercadolivre\.com\.br|mercadolibre\.com|mercadolivre\.com)$/.test(h)) { const m = /MLB-?(\d{6,})/i.exec(p); return m ? { platform: 'mercadolivre', external_id: 'MLB' + m[1] } : null; }
  if (/(^|\.)shopee\.com(\.br)?$/.test(h)) { const m = /\/product\/(\d+)\/(\d+)/.exec(p) || /-i\.(\d+)\.(\d+)/.exec(p) || /\/(\d{5,})\/(\d{5,})(?:\/|$)/.exec(p); return m ? { platform: 'shopee', external_id: `${m[1]}.${m[2]}` } : null; }
  if (/(^|\.)amazon\.com(\.br)?$/.test(h)) { const m = /\/(?:dp|gp\/product|d|gp\/aw\/d)\/([A-Za-z0-9]{10})(?:[/?]|$)/.exec(p); return m ? { platform: 'amazon', external_id: m[1].toUpperCase() } : null; }
  if (/(^|\.)aliexpress\.(com|us)$/.test(h)) { const m = /\/item\/(\d{6,})/.exec(p) || /\/i\/(\d{6,})/.exec(p); return m ? { platform: 'aliexpress', external_id: m[1] } : null; }
  if (/(^|\.)(magazineluiza\.com\.br|magalu\.com|magazinevoce\.com\.br)$/.test(h)) { const m = /\/p\/([a-z0-9]{6,})/i.exec(p); return m ? { platform: 'magalu', external_id: m[1].toLowerCase() } : null; }
  return null;
}
export function parsePrices(text) {
  const vals = []; const re = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)/g; let m;
  while ((m = re.exec(String(text || '')))) { const v = Number(m[1].replace(/\./g, '').replace(',', '.')); if (v > 0 && v < 1e7) vals.push(v); }
  return vals.length ? { price: Math.min(...vals), previous: vals.length > 1 ? Math.max(...vals) : null } : {};
}
const absUrl = (loc, base) => { try { if (/^https?:\/\//i.test(loc)) return loc; const b = parseUrl(base); return b.protocol + '//' + b.host + (loc.startsWith('/') ? loc : '/' + loc); } catch { return ''; } };

// Segue encurtadores um salto por vez, só por domínios conhecidos (anti-SSRF), e identifica loja e produto.
export async function resolveLink(ctx, url) {
  const key = await (ctx.sha256hex || sha256Hex)(url);
  const cached = await ctx.rpc('link_cache_get', { p_hash: key }).catch(() => null);
  if (cached && (cached.platform || cached.final_url)) return cached;
  let cur = url; let found = identifyProduct(cur);
  for (let hop = 0; hop < 5 && !found; hop++) {
    let host = ''; try { host = parseUrl(cur).hostname; } catch { break; }
    if (!(ctx.followHost || FOLLOW_HOST).test(host)) break;
    let r; try { r = await ctx.http({ method: 'GET', url: cur, redirect: 'manual', timeoutMs: 8000, headers: { 'user-agent': 'Mozilla/5.0 (compatible; CentralPromocoes/1.0)', accept: 'text/html' } }); } catch { break; }
    const loc = r.location || (r.headers && r.headers.location);
    if (r.status >= 300 && r.status < 400 && loc) { cur = absUrl(String(loc), cur); found = identifyProduct(cur); continue; }
    if (typeof r.data === 'string') { // alguns encurtadores devolvem uma página com o destino no HTML
      for (const cand of extractUrls(r.data.slice(0, 60000)).slice(0, 40)) { const f = identifyProduct(cand); if (f) { cur = cand; found = f; break; } }
    }
    break;
  }
  const out = { final_url: cur, platform: found ? found.platform : null, external_id: found ? found.external_id : null };
  await ctx.rpc('link_cache_put', { p_hash: key, p_final: cur, p_platform: out.platform, p_external: out.external_id }).catch(() => {});
  return out;
}

export async function processRadarMessage(ctx, rt, msg, state) {
  const src = msg.source || {}; const platforms = Array.isArray(src.platforms) ? src.platforms : []; const blocked = Array.isArray(src.blocked_words) ? src.blocked_words : [];
  const tp = parsePrices(msg.body); const results = [];
  for (const url of extractUrls(msg.body).slice(0, 3)) {
    const rec = (status, reason, extra = {}) => ctx.rpc('record_captured_link', { p: { source_id: src.id, chat_message_id: msg.id, original_url: url, status, reason, ...extra } }).catch(() => {});
    try {
      const rl = await resolveLink(ctx, url);
      const base = { final_url: rl.final_url, platform: rl.platform, external_id: rl.external_id };
      if (!rl.platform) { await rec('ignored', 'Link que não é de uma loja suportada', base); results.push('ignored'); continue; }
      if (platforms.length && !platforms.includes(rl.platform)) { await rec('filtered', 'Loja fora das aceitas por esta fonte', base); results.push('filtered'); continue; }
      const conn = connectorOf(rt, rl.platform); const cfg = conn.config || {};
      if (['disabled', 'paused_policy', 'error'].includes(conn.mode)) { await rec('ineligible', `Conector ${STORE_LABEL[rl.platform] || rl.platform} desligado`, base); results.push('ineligible'); continue; }
      const cur = await fetchCurrent(ctx, rt, rl.platform, rl.external_id);
      if (cur.supported === false) { await rec('ineligible', cur.reason, base); results.push('ineligible'); continue; }
      if (!cur.found) { await rec('ineligible', 'Produto não encontrado no seu programa de afiliados (não dá para gerar o seu link)', base); results.push('ineligible'); continue; }
      const it = cur.item;
      if (!affiliateUrl(it, cfg)) { await rec('ineligible', 'Sem link de afiliado: configure o modelo do link no conector', base); results.push('ineligible'); continue; }
      const low = it.title.toLowerCase();
      const hit = blocked.find((w) => w && low.includes(String(w).toLowerCase()));
      if (hit) { await rec('filtered', `Palavra bloqueada: ${hit}`, base); results.push('filtered'); continue; }
      if (it.used) { await rec('filtered', 'Produto usado', base); results.push('filtered'); continue; }
      if (it.stock != null && it.stock <= 0) { await rec('filtered', 'Sem estoque', base); results.push('filtered'); continue; }
      const minD = src.min_discount_pct != null ? Number(src.min_discount_pct) : Number(cfg.min_discount_pct || 0);
      if (minD > 0 && pctOff(it.price, it.previous) < minD) { await rec('filtered', `Desconto comprovado abaixo de ${minD}%`, base); results.push('filtered'); continue; }
      if ((cfg.min_price != null && it.price < Number(cfg.min_price)) || (cfg.max_price != null && it.price > Number(cfg.max_price))) { await rec('filtered', 'Fora da faixa de preço do conector', base); results.push('filtered'); continue; }
      if (tp.price && it.price > tp.price * 1.2) { await rec('filtered', `Preço atual (R$ ${it.price}) acima do anunciado (R$ ${tp.price}): promoção encerrada?`, base); results.push('filtered'); continue; }
      const done = (state.created[src.id] || 0) + Number(src.created_last_hour || 0);
      if (done >= Number(src.max_per_hour || 20)) { await rec('filtered', 'Limite por hora da fonte atingido', base); results.push('filtered'); continue; }
      const res = await ingestStoreItem(ctx, rt, rl.platform, cfg, it, { layer: 'C', sourceName: `Radar: ${msg.chat_title || 'grupo'}`.slice(0, 80), autoOk: src.mode === 'auto',
        evidence: { fonte: msg.chat_title, canal: msg.channel, preco_no_texto: tp.price ?? undefined } });
      if (res.status === 'created') {
        state.created[src.id] = (state.created[src.id] || 0) + 1;
        await ctx.rpc('register_offer_source', { p_offer: res.offer_id, p_source: src.id }).catch(() => {});
        await rec('offer_created', `Score ${res.score ?? '—'}`, { ...base, offer_id: res.offer_id }); results.push('created');
      } else if (res.status === 'duplicate') {
        if (res.offer_id) await ctx.rpc('register_offer_source', { p_offer: res.offer_id, p_source: src.id }).catch(() => {});
        await rec('duplicate', res.reason === 'recently_published' ? 'Já publicado recentemente' : 'Já está na fila', { ...base, offer_id: res.offer_id }); results.push('duplicate');
      } else { await rec('filtered', 'Recusada pelas regras: ' + ((res.failures || []).map((f) => f.code).join(', ') || 'motivo não informado'), base); results.push('filtered'); }
    } catch (e) { await rec('error', clean(e && e.message), {}); results.push('error'); }
  }
  return results;
}

export async function runRadar(ctx, { max = 10 } = {}) {
  const msgs = await ctx.rpc('claim_radar_messages', { p_limit: max });
  if (!Array.isArray(msgs) || !msgs.length) return { messages: 0 };
  const rt = await loadRuntime(ctx); const state = { created: {} }; const tally = {};
  for (const m of msgs) { try { for (const r of await processRadarMessage(ctx, rt, m, state)) tally[r] = (tally[r] || 0) + 1; } catch { tally.error = (tally.error || 0) + 1; } }
  return { messages: msgs.length, ...tally };
}

// Teste manual de um link (botão do painel): mostra cada etapa, sem criar nada.
async function radarTest(ctx, rt, url) {
  const steps = []; const add = (label, ok, detail) => steps.push({ label, ok: !!ok, detail: String(detail || '') });
  const rl = await resolveLink(ctx, url);
  add('Seguir o link até a loja', !!rl.platform, rl.platform ? `${STORE_LABEL[rl.platform] || rl.platform} · produto ${rl.external_id}` : 'Não é um link de produto de uma loja suportada');
  const out = { ok: false, steps, final_url: rl.final_url, platform: rl.platform, external_id: rl.external_id };
  if (!rl.platform) return out;
  const cfg = connectorOf(rt, rl.platform).config || {};
  const cur = await fetchCurrent(ctx, rt, rl.platform, rl.external_id).catch((e) => ({ error: clean(e && e.message) }));
  if (cur.error) { add('Consultar o produto na API da loja', false, cur.error); return out; }
  if (cur.supported === false) { add('Consultar o produto na API da loja', false, cur.reason); return out; }
  add('Consultar o produto na API da loja', cur.found, cur.found ? `${cur.item.title.slice(0, 70)} · R$ ${cur.item.price}${cur.item.previous ? ` (antes R$ ${cur.item.previous})` : ''}` : 'Não encontrado no seu programa de afiliados');
  if (!cur.found) return out;
  const aff = affiliateUrl(cur.item, cfg);
  add('Gerar o seu link de afiliado', !!aff, aff ? maskUrl(aff) : 'Sem link: configure o modelo do link no conector');
  out.item = previewItem(cur.item); out.affiliate_ok = !!aff; out.ok = !!aff;
  return out;
}

/* ================================================================== Automação, acompanhamento, comissões, alertas e limpeza */
export async function runAutomation(ctx) {
  const out = {};
  try { out.auto = await ctx.rpc('run_auto_approve', { p_limit: 10 }); } catch (e) { out.auto = { error: clean(e && e.message) }; }
  try { out.expired = await ctx.rpc('expire_offers', {}); } catch { /* segue */ }
  return out;
}

export async function runWatchlist(ctx) {
  const due = await ctx.rpc('watchlist_due', { p_limit: 8 });
  if (!Array.isArray(due) || !due.length) return { checked: 0 };
  const rt = await loadRuntime(ctx); let offers = 0;
  for (const w of due) {
    let cur = null; try { cur = await fetchCurrent(ctx, rt, w.platform, w.external_id); } catch { cur = null; }
    if (!cur || !cur.found || !cur.item) { await ctx.rpc('watchlist_update', { p_id: w.id, p_price: null, p_title: null, p_offer: false }).catch(() => {}); continue; }
    const it = cur.item; const last = w.last_price != null ? Number(w.last_price) : null;
    const drop = last && it.price < last ? (last - it.price) / last * 100 : 0;
    const hit = (w.target_price != null && it.price <= Number(w.target_price)) || drop >= Number(w.min_drop_pct || 10);
    let offered = false;
    if (hit && (it.stock == null || it.stock > 0)) {
      const cfg = connectorOf(rt, w.platform).config || {};
      const res = await ingestStoreItem(ctx, rt, w.platform, cfg, { ...it, previous: last && last > it.price ? last : it.previous }, { sourceName: 'Produto acompanhado', evidence: { acompanhado: true, ultimo_preco: last ?? undefined } }).catch(() => ({}));
      offered = res.status === 'created'; if (offered) offers++;
    }
    await ctx.rpc('watchlist_update', { p_id: w.id, p_price: it.price, p_title: it.title, p_offer: offered, p_image: it.image || null }).catch(() => {});
  }
  return { checked: due.length, offers };
}

export async function runCommissionSync(ctx) {
  const rt = await loadRuntime(ctx); const cfg = connectorOf(rt, 'shopee').config || {};
  if (!credsOk('shopee', cfg, rt.secrets)) return { skipped: 'Shopee não configurada' };
  if (!(await ctx.rpc('job_should_run', { p_key: 'commissions', p_every_min: 120 }).catch(() => false))) return { skipped: 'intervalo' };
  const end = Math.floor(ctx.now().getTime() / 1000), start = end - 30 * 86400;
  const q = (f) => `query{ conversionReport(purchaseTimeStart:${start}, purchaseTimeEnd:${end}, limit:100){ nodes{ ${f} } } }`; let d;
  try { d = await shopeeCall(ctx, cfg, rt.secrets.shopee_secret, q('conversionId purchaseTime totalCommission utmContent')); }
  catch (e) { if (!/field|cannot query|validation/i.test(String(e.message))) throw e; d = await shopeeCall(ctx, cfg, rt.secrets.shopee_secret, q('purchaseTime totalCommission')); }
  const nodes = (d && d.conversionReport && d.conversionReport.nodes) || [];
  const rows = nodes.map((n, i) => ({ platform: 'shopee', external_ref: String(n.conversionId || `${n.purchaseTime}-${i}`), purchased_at: new Date(Number(n.purchaseTime) * 1000).toISOString(), amount: round2(Number(n.totalCommission) || 0), sub_id: n.utmContent || undefined })).filter((r) => r.purchased_at !== 'Invalid Date');
  const n = rows.length ? await ctx.rpc('upsert_commissions', { p: rows }) : 0;
  return { synced: Number(n) || 0 };
}

export async function runAlerts(ctx) {
  const snap = await ctx.rpc('ops_snapshot', {}).catch(() => null); if (!snap) return {};
  const rt = await loadRuntime(ctx); const fired = [];
  const check = async (key, bad, text) => {
    if (!bad) { await ctx.rpc('alert_clear', { p_key: key }).catch(() => {}); return; }
    if (await ctx.rpc('alert_should_send', { p_key: key, p_detail: text.slice(0, 200) }).catch(() => false)) { await alertAll(ctx, rt, text); fired.push(key); }
  };
  await check('pending_old', snap.pending_old > 0, `⚠️ ${snap.pending_old} publicação(ões) aguardando há mais de 45 min. Confira Publicações e o estado do WhatsApp/Telegram.`);
  await check('unknown', snap.unknown > 0, `❓ ${snap.unknown} publicação(ões) com resultado incerto. Confira no canal antes de reenviar (Publicações).`);
  await check('failed', snap.failed_24h >= 3, `❌ ${snap.failed_24h} publicações falharam de vez nas últimas 24 h. Veja Publicações.`);
  await check('collect', Array.isArray(snap.collect_errors) && snap.collect_errors.length > 0, `⚠️ Coleta com erro: ${(snap.collect_errors || []).map((c) => `${c.platform} (${c.error})`).join('; ')}`);
  await check('review', snap.review_waiting >= 20, `📥 ${snap.review_waiting} ofertas aguardando a sua aprovação.`);
  const ml = rt.status.mercadolivre || {};
  await check('ml_reconnect', !!rt.secrets.ml_refresh_token && ml.ok === false && /conecte a conta|renova/i.test(String(ml.error || '')), '🔑 O acesso à conta do Mercado Livre expirou. Reconecte em Conectores → Mercado Livre → Conectar conta.');
  return { fired };
}

export async function runHousekeeping(ctx) {
  const go = await ctx.rpc('job_should_run', { p_key: 'housekeeping', p_every_min: 360 }).catch(() => false);
  return go ? ctx.rpc('housekeeping', {}) : null;
}

export async function termsForRt(ctx, rt, provider, cfg) {
  const kw = Array.isArray(cfg.keywords) ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()) : [];
  if (kw.length) return kw.map((q) => ({ q: q.trim(), cat: undefined }));
  const cats = Array.isArray(cfg.categories) && cfg.categories.length ? cfg.categories : ['eletronicos', 'informatica', 'casa']; const custom = rt.search_terms || {};
  const list = cats.flatMap((c) => (Array.isArray(custom[c]) && custom[c].length ? custom[c] : SEARCH_TERMS[c] || []).map((q) => ({ q, cat: c })));
  if (provider === 'mercadolivre' && cfg.use_trends !== false) {
    try { const tr = await mlGet(ctx, rt, '/trends/MLB'); for (const t of (Array.isArray(tr) ? tr : []).slice(0, 3)) if (t && t.keyword) list.push({ q: String(t.keyword).slice(0, 60), cat: undefined }); } catch { /* sem tendências */ }
  }
  return list;
}
function tgBody(m, text) {
  const ents = [...(m.entities || []), ...(m.caption_entities || [])].filter((e) => e && e.type === 'text_link' && e.url).map((e) => e.url);
  const btns = ((m.reply_markup && m.reply_markup.inline_keyboard) || []).flat().map((b) => b && b.url).filter(Boolean);
  const extra = [...new Set([...ents, ...btns])].filter((u) => !String(text || '').includes(u));
  return [text, ...extra].filter(Boolean).join('\n');
}

/* ================================================================== Conexões gerenciadas pelo servidor (arquivo worker.env) */
// Endereço, instância e chave da Evolution, token do Telegram e endereços de webhook vêm do ambiente do worker (ctx.managed).
// Quando existem, valem mais que o cadastro do banco e o painel não pede nada disso.
function applyManaged(ctx, rt) {
  const m = ctx.managed || {}; rt.managed = { evolution: {}, telegram: {} };
  const e = m.evolution || {};
  if (e.base_url) { rt.evolution.base_url = e.base_url; rt.managed.evolution.base_url = true; }
  if (e.instance) { rt.evolution.instance = e.instance; rt.managed.evolution.instance = true; }
  if (e.api_key) { rt.secrets.evolution_api_key = e.api_key; rt.managed.evolution.api_key = true; }
  if (e.webhook_url) { rt.evolution.webhook_url = e.webhook_url; rt.managed.evolution.webhook = true; }
  const t = m.telegram || {};
  if (t.bot_token) { rt.secrets.telegram_bot_token = t.bot_token; rt.managed.telegram.token = true; }
  if (t.webhook_url) { rt.telegram.webhook_url = t.webhook_url; rt.telegram.mode = 'webhook'; rt.managed.telegram.webhook = true; }
  if (t.webhook_secret) rt.secrets.telegram_webhook_secret = t.webhook_secret;
}
