// Central de Promoções — worker do n8n.
//
// Este arquivo é a ÚNICA fonte da lógica de integração. O script `npm run n8n:build` o embute nos
// workflows importáveis (deploy/n8n/*.json) e o teste `npm run n8n:test` o executa contra servidores falsos.
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

/* SHA-256 em JavaScript puro (UTF-8): dispensa NODE_FUNCTION_ALLOW_BUILTIN=crypto no n8n. */
export function sha256Hex(str) {
  const bytes = []; for (const ch of unescape(encodeURIComponent(String(str)))) bytes.push(ch.charCodeAt(0));
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
  return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
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
const httpErr = (who, r) => { const e = new Error(`${who} respondeu HTTP ${r.status}${msgOf(r.data) ? ': ' + msgOf(r.data) : ''}`); e.status = r.status; return e; };
const msgOf = (d) => { if (!d) return ''; if (typeof d === 'string') return clean(d); const m = d.message ?? d.error ?? d.description ?? (d.response && d.response.message); return clean(Array.isArray(m) ? m.join('; ') : typeof m === 'object' ? JSON.stringify(m) : m); };

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
        const r = imageUrl && text.length <= 1024 ? await call('sendPhoto', { chat_id: chatId, photo: imageUrl, caption: text, parse_mode: 'HTML' }, 40000) : await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
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

/* ------------------------------------------------------------------ Lojas */
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
const mlBase = (ctx) => (ctx.urls && ctx.urls.ml) || 'https://api.mercadolibre.com';
async function checkStore(ctx, provider, rt) {
  const cfg = (rt.connectors[provider] && rt.connectors[provider].config) || {};
  if (provider === 'shopee') {
    const secret = rt.secrets.shopee_secret;
    if (!cfg.app_id || !secret) return { ok: false, error: 'Informe o App ID e a chave secreta da Shopee.' };
    const d = await shopeeCall(ctx, cfg, secret, 'query($k:String){ productOfferV2(keyword:$k, page:1, limit:1){ nodes{ itemId productName offerLink } } }', { k: 'fone' });
    const n = d && d.productOfferV2 && d.productOfferV2.nodes;
    return { ok: true, detail: `Credenciais aceitas. Consulta de produtos respondeu com ${Array.isArray(n) ? n.length : 0} item(ns).` };
  }
  if (provider === 'mercadolivre') {
    const secret = rt.secrets.ml_client_secret;
    if (!cfg.app_id || !secret) return { ok: false, error: 'Informe o App ID e a chave secreta do aplicativo do Mercado Livre.' };
    const t = await ctx.http({ method: 'POST', url: mlBase(ctx) + '/oauth/token', form: { grant_type: 'client_credentials', client_id: cfg.app_id, client_secret: secret }, timeoutMs: 20000 });
    if (t.status >= 400 || !t.data || !t.data.access_token) return { ok: false, error: `O Mercado Livre recusou as credenciais (${t.status}): ${msgOf(t.data) || 'verifique App ID e chave secreta'}` };
    const s = await ctx.http({ method: 'GET', url: mlBase(ctx) + '/sites/MLB/search?q=fone&limit=1', headers: { Authorization: `Bearer ${t.data.access_token}` }, timeoutMs: 20000 });
    if (s.status >= 400) return { ok: false, error: `Token aceito, mas a busca de produtos respondeu ${s.status}: ${msgOf(s.data) || 'permissões insuficientes no aplicativo'}` };
    return { ok: true, detail: `Credenciais aceitas; busca de produtos respondeu normalmente. Token válido por ${Math.round((t.data.expires_in || 0) / 3600)} h.` };
  }
  // Amazon: a Creators API (OAuth) ainda não tem verificação automática aqui; só conferimos o preenchimento.
  const miss = [!cfg.client_id && 'Client ID', !cfg.partner_tag && 'tag de associado', !rt.secrets.amazon_client_secret && 'chave secreta'].filter(Boolean);
  return miss.length ? { ok: false, error: `Falta informar: ${miss.join(', ')}.` } : { ok: true, partial: true, detail: 'Campos preenchidos. A verificação automática da Amazon ainda não está disponível; teste gerando um link no painel do Associates.' };
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
  }
  return st;
}

/* ------------------------------------------------------------------ n8n: autoteste e diagnósticos */
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
const maskUrl = (u) => { try { const x = new URL(u); const p = x.pathname.split('/').filter(Boolean); const last = p.pop() || ''; return `${x.host}/…/${last.slice(0, 8)}…`; } catch { return ''; } };
// Confere o que o n8n precisa para trabalhar. Nunca devolve segredo: só "sim/não" e nomes de servidor.
export async function selfTest(ctx, rt) {
  const t0 = ctx.now().getTime(); const checks = []; const add = (id, label, ok, detail, required = true) => checks.push({ id, label, ok: !!ok, detail: String(detail || ''), required });
  const env = ctx.env || {};
  add('env', 'Variáveis do n8n (SUPABASE_URL e chave)', env.has_url && env.has_key, env.has_url && env.has_key ? `Banco em ${env.supabase_host || '—'}` : 'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no n8n (e N8N_BLOCK_ENV_ACCESS_IN_NODE=false).');
  let ms = 0; try { const a = ctx.now().getTime(); await ctx.rpc('get_integration_runtime', {}); ms = ctx.now().getTime() - a; add('supabase', 'Conexão com o Supabase', true, `Respondeu em ${ms} ms`); } catch (e) { add('supabase', 'Conexão com o Supabase', false, clean(e && e.message)); }
  let sha = ''; try { sha = await (ctx.sha256hex || sha256Hex)('abc'); } catch { /* falha abaixo */ }
  add('sha', 'Assinatura (SHA-256, usada pela Shopee)', sha === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sha ? 'Funcionando' : 'Indisponível');
  const ev = rt.evolution || {}, tg = rt.telegram || {}, sec = rt.secrets || {};
  add('evo_cfg', 'WhatsApp configurado (endereço, instância e chave)', ev.base_url && ev.instance && sec.evolution_api_key, [!ev.base_url && 'falta o endereço', !ev.instance && 'falta a instância', !sec.evolution_api_key && 'falta a chave'].filter(Boolean).join(', ') || `${hostOf(ev.base_url)} · instância ${ev.instance}`, false);
  add('tg_cfg', 'Telegram configurado (token e ligado)', tg.enabled && sec.telegram_bot_token, !sec.telegram_bot_token ? 'falta o token do bot' : !tg.enabled ? 'o Telegram está desligado nas configurações' : `modo ${tg.mode}`, false);
  add('hook_wa', 'Webhook de entrada do WhatsApp salvo', !!ev.webhook_url, ev.webhook_url ? maskUrl(ev.webhook_url) : 'Cole o endereço na aba WhatsApp (passo 3).', false);
  add('hook_tg', 'Webhook de entrada do Telegram', tg.mode !== 'webhook' || (tg.webhook_url && sec.telegram_webhook_secret), tg.mode !== 'webhook' ? 'Não usado (modo polling)' : tg.webhook_url ? maskUrl(tg.webhook_url) : 'Modo webhook sem endereço salvo.', false);
  const lim = ctx.limits || {};
  add('ratelimit', 'Limite de requisições nos webhooks', !!ctx.hasStore, ctx.hasStore ? `Ativo: até ${lim.webhookPorMin || 120} por minuto por webhook` : 'Indisponível neste n8n (sem memória do workflow): os webhooks ficam sem limite de taxa.', false);
  add('service_role', 'Chave do Supabase é a service_role', !env.key_role || env.key_role === 'service_role' || env.key_role === 'desconhecido', env.key_role === 'anon' ? 'Esta é a chave ANON: as tarefas vão falhar. Use a service_role.' : env.key_role ? `Papel da chave: ${env.key_role}` : '—', true);
  const https = (u) => !u || /^https:\/\//i.test(u);
  add('https', 'Endereços usam HTTPS', https(ev.base_url) && https(ev.webhook_url) && https(tg.webhook_url), https(ev.base_url) && https(ev.webhook_url) && https(tg.webhook_url) ? 'Tudo em HTTPS' : 'Há endereço sem HTTPS: a chave e as mensagens viajam sem proteção.', false);
  const lastSeg = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean).pop() || ''; } catch { return ''; } };
  const weak = [ev.webhook_url, tg.webhook_url].filter(Boolean).filter((u) => lastSeg(u).length < 20);
  add('hook_secret_path', 'Caminho dos webhooks é secreto', weak.length === 0, weak.length ? 'Algum caminho é curto/previsível. Use o caminho aleatório do arquivo importado.' : 'Caminhos longos e aleatórios', false);
  add('tg_secret', 'Segredo do webhook do Telegram é forte', tg.mode !== 'webhook' || (sec.telegram_webhook_secret || '').length >= 32, tg.mode !== 'webhook' ? 'Não usado (modo polling)' : (sec.telegram_webhook_secret || '').length >= 32 ? 'Forte' : 'Gere um novo segredo na aba Telegram.', false);
  add('paused', 'Envios liberados', !rt.paused, rt.paused ? 'A pausa geral está ligada: nada é publicado até retomar.' : 'Sem pausa', false);
  const bad = checks.filter((c) => c.required && !c.ok);
  const out = { ok: bad.length === 0, checks, ms: ctx.now().getTime() - t0, supabase_ms: ms, at: ctx.now().toISOString() };
  await ctx.rpc('report_integration_status', { p_provider: 'n8n', p_status: { ok: out.ok, at: out.at, falhas: checks.filter((c) => !c.ok).map((c) => c.id) } }).catch(() => {});
  return out;
}
// Chama os próprios webhooks de entrada (como a Evolution/Telegram fariam) para provar que a URL salva chega ao n8n.
async function webhookCheck(ctx, rt) {
  const res = [];
  const one = async (name, url, headers, json) => {
    if (!url) return res.push({ name, configured: false, ok: false, detail: 'Nenhum endereço salvo.' });
    const t = ctx.now().getTime();
    try { const r = await ctx.http({ method: 'POST', url, headers, json, timeoutMs: 12000 }); const ms = ctx.now().getTime() - t;
      const ok = r.status === 200 && !!(r.data && r.data.ok);
      res.push({ name, configured: true, ok, status: r.status, ms, target: maskUrl(url), detail: ok ? 'O webhook respondeu corretamente.' : r.status === 404 ? 'Não encontrado (404): o workflow está ativo? O caminho confere com o do n8n?' : r.status === 401 ? 'Recusado (401): o segredo do webhook do Telegram não confere.' : r.status === 403 ? 'Recusado (403): o nome da instância não confere.' : `Resposta inesperada (HTTP ${r.status}).` });
    } catch (e) { res.push({ name, configured: true, ok: false, target: maskUrl(url), detail: e && e.code === 'timeout' ? 'Sem resposta em 12 s.' : 'Não foi possível alcançar o endereço (DNS, certificado ou servidor fora do ar).' }); }
  };
  await one('WhatsApp (Evolution → n8n)', rt.evolution.webhook_url, {}, { event: 'central.ping', instance: rt.evolution.instance });
  await one('Telegram (bot → n8n)', rt.telegram.webhook_url, { 'x-telegram-bot-api-secret-token': rt.secrets.telegram_webhook_secret || '' }, { update_id: 0 });
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
    await query(`insert into public.app_schema_migrations(version, applied_by) values ('${String(migration.version).replace(/'/g, "''")}', 'n8n-worker') on conflict (version) do nothing`);
    done.push(migration.version);
  }
  const out = { ok: true, applied: done, up_to_date: done.length === 0, latest: migrations[migrations.length - 1].version };
  await ctx.rpc('report_integration_status', { p_provider: 'database', p_status: { ok: true, latest: out.latest, applied: done, at: ctx.now().toISOString() } });
  return out;
}


async function integrationTask(ctx, rt, payload) {
  const { provider, action } = payload;
  if (provider === 'n8n') {
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
    if (action === 'connect') {
      const cur = await ev.state(); if (cur === 'open') return { state: 'open', already: true };
      if (cur === 'missing') { const c = await ev.create(); return { created: true, state: 'connecting', ...c }; }
      const c = await ev.connect(payload.pairing_number); return { state: 'connecting', ...c };
    }
    if (action === 'restart') { await ev.restart(); return { restarted: true }; }
    if (action === 'logout') { await ev.logout(); return { logged_out: true }; }
    if (action === 'set_webhook') { need(cfg.webhook_url, 'Informe o endereço do webhook do n8n (aba WhatsApp).'); await ev.setWebhook(cfg.webhook_url); const w = await ev.getWebhook().catch(() => null); return { webhook: w }; }
    if (action === 'send_test') { const r = await ev.send('sendText', { number: payload.to, text: payload.text }); if (!r.ok) throw new Error(r.error); return { sent: true, message_id: r.messageId }; }
  }
  if (provider === 'telegram') {
    const tg = rt.secrets.telegram_bot_token; need(tg, 'Informe o token do bot (aba Telegram).');
    const bot = telegramClient(ctx, tg);
    if (action === 'check') { const st = await telegramStatus(ctx, rt); await ctx.rpc('report_integration_status', { p_provider: 'telegram', p_status: { ...(rt.status.telegram || {}), ...st } }); return st; }
    if (action === 'set_webhook') {
      need(rt.telegram.webhook_url, 'Informe o endereço do webhook (aba Telegram).'); need(rt.secrets.telegram_webhook_secret, 'Gere o segredo do webhook antes.');
      await bot.setWebhook(rt.telegram.webhook_url, rt.secrets.telegram_webhook_secret); const info = await bot.webhookInfo(); return { webhook: sanitizeWebhook(info) };
    }
    if (action === 'delete_webhook') { await bot.deleteWebhook(); return { webhook: null }; }
    if (action === 'send_test') { const r = await bot.send(payload.to, payload.text); if (!r.ok) throw new Error(r.error); return { sent: true, message_id: r.messageId }; }
  }
  if (['mercadolivre', 'shopee', 'amazon'].includes(provider) && action === 'check') {
    const res = await checkStore(ctx, provider, rt);
    await ctx.rpc('report_integration_status', { p_provider: provider, p_status: { ok: !!res.ok, partial: !!res.partial, detail: res.detail || null, error: res.error || null } });
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
    const job = await ctx.rpc('claim_channel_job', { p_worker: 'n8n' });
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
  rt.evolution = rt.evolution || {}; rt.telegram = rt.telegram || {}; rt.groups = rt.groups || {};
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
  const t0 = ctx.now().getTime(); const rt = await loadRuntime(ctx); const s = sender(ctx, rt); let sent = 0; let failed = 0; let unknown = 0;
  await ctx.rpc('heartbeat', { p_service: 'n8n', p_status: 'ok', p_details: {} }).catch(() => {});
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
    const p = await ctx.rpc('claim_next_publication', { p_worker: 'n8n' }); if (!p) break;
    if (p.is_simulated) { await ctx.rpc('complete_publication', { p_id: p.publication_id, p_external_message_id: 'simulado-' + String(p.publication_id).slice(0, 8) }); sent++; continue; }
    const r = await s.send(p.channel, p.external_chat_id, p.rendered_text, p.image_url);
    if (r.ok) { await ctx.rpc('complete_publication', { p_id: p.publication_id, p_external_message_id: r.messageId }); sent++; }
    else if (r.ambiguous) { await ctx.rpc('mark_publication_unknown', { p_id: p.publication_id, p_note: `${r.error} — confira no canal antes de reenviar` }); unknown++; }
    else { await ctx.rpc('fail_publication', { p_id: p.publication_id, p_error_code: r.code, p_permanent: !!r.permanent, p_retry_in_seconds: r.retryIn ?? null }); failed++; }
    if (p.channel === 'whatsapp') await ctx.sleep(Math.min(pickDelay(ctx, rt.evolution), Math.max(0, left() - 4000)));
  }
  // 3) respostas manuais das conversas
  for (let i = 0; i < 5 && left() > 8000; i++) {
    const m = await ctx.rpc('claim_chat_outbox', { p_worker: 'n8n' }); if (!m) break;
    const r = await s.send(m.channel, m.chat_external_id, m.text);
    if (r.ok) await ctx.rpc('complete_chat_outbox', { p_id: m.outbox_id, p_external_message_id: r.messageId });
    else await ctx.rpc('fail_chat_outbox', { p_id: m.outbox_id, p_error: r.ambiguous ? `${r.error} — resultado incerto: confira no aplicativo antes de reenviar` : r.error });
  }
  await ctx.rpc('release_stale_claims', {}).catch(() => {});
  return { sent, failed, unknown };
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
        for (const u of ups) { const m = mapTelegramUpdate(u); if (m) { await ctx.rpc('ingest_chat_message', { p: m }).catch(() => {}); got++; } offset = Math.max(offset, u.update_id + 1); }
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
    body: text || `[${kind}]`, kind, sent_at: m.date ? new Date(m.date * 1000).toISOString() : undefined };
}
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
