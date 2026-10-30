// Testa o worker contra Evolution, Telegram, Mercado Livre e Shopee FALSOS (nada sai da sua máquina).
// Todos os valores sensíveis abaixo são aleatórios, gerados a cada execução.
// Uso: npm run worker:test
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../deploy/worker/central-worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rnd = (n = 20) => crypto.randomBytes(n).toString('hex').slice(0, n);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res({ s, url: `http://127.0.0.1:${s.address().port}` })); });
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };

const EVO_KEY = 'ev' + rnd(30);
const TG_TOKEN = '123456789:' + rnd(35);
const TG_HOOK = 'h' + rnd(24);
const ML_SECRET = 'm' + rnd(30);
const ML_ACCESS = 'acc' + rnd(16);
const SP_SECRET = 's' + rnd(30);

/* ---------- Evolution falsa ---------- */
const GJ = '120363000000000001@g.us';
const evo = { state: 'close', sent: [], mode: 'ok', webhook: null, created: null, calls: [], grp: { subject: 'Grupo A', desc: 'd', announce: false, restrict: false, members: ['5511999990001:admin', '5511988880002'] }, gmode: 'ok',
  groups: [{ id: '120363000000000001@g.us', subject: 'Grupo A', size: 5, owner: '5511@s.whatsapp.net' }, { id: 'x@s.whatsapp.net', subject: 'ignorar' }] };
const evoSrv = await listen(async (req, res) => {
  if (req.headers.apikey !== EVO_KEY) return send(res, 401, { message: 'Unauthorized' });
  const body = await readBody(req); const j = body ? JSON.parse(body) : {}; const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (p === '/') return send(res, 200, { status: 200, message: 'Welcome', version: '2.3.7' });
  if (p === '/instance/connectionState/central') return send(res, 200, { instance: { instanceName: 'central', state: evo.state } });
  if (p === '/instance/fetchInstances') return send(res, 200, [{ name: 'central', connectionStatus: evo.state, ownerJid: '5511999990001@s.whatsapp.net', profileName: 'Hubly' }]);
  if (p === '/instance/connect/central') return send(res, 200, { base64: 'iVBORw0KGgo=', pairingCode: u.searchParams.get('number') ? 'ABCD-1234' : null, count: 1 });
  if (p === '/webhook/find/central') return send(res, 200, evo.webhook || { enabled: false, url: '' });
  if (p === '/webhook/set/central') { if (j.webhook) { evo.webhook = { enabled: true, url: j.webhook.url, events: j.webhook.events }; return send(res, 201, evo.webhook); } return send(res, 400, { message: 'bad' }); }
  if (p.startsWith('/group/') && p !== '/group/fetchAllGroups/central' && p !== '/group/create/central') {
    const g = u.searchParams.get('groupJid') || j.groupJid; const act = p.split('/')[2]; evo.calls.push({ act, g, ...j });
    if (act === 'findGroupInfos') return send(res, 200, { id: g, subject: evo.grp.subject, desc: evo.grp.desc, announce: evo.grp.announce, restrict: evo.grp.restrict, size: evo.grp.members.length });
    if (act === 'participants') return send(res, 200, { participants: evo.grp.members.map((m) => ({ id: m.split(':')[0] + '@s.whatsapp.net', admin: m.endsWith(':admin') ? 'admin' : null })) });
    if (act === 'inviteCode') return send(res, 200, { code: 'ABC123', inviteUrl: 'https://chat.whatsapp.com/ABC123' });
    if (evo.gmode === 'server') return send(res, 500, { message: 'boom' });
    if (act === 'revokeInviteCode') return send(res, 201, { inviteUrl: 'https://chat.whatsapp.com/NOVO99' });
    if (act === 'updateGroupSubject') { evo.grp.subject = j.subject; return send(res, 201, { update: 'success' }); }
    if (act === 'updateGroupDescription') { evo.grp.desc = j.description; return send(res, 201, { update: 'success' }); }
    if (act === 'updateSetting') { if (j.action === 'announcement') evo.grp.announce = true; if (j.action === 'not_announcement') evo.grp.announce = false; if (j.action === 'locked') evo.grp.restrict = true; if (j.action === 'unlocked') evo.grp.restrict = false; return send(res, 201, { update: 'success' }); }
    if (act === 'toggleEphemeral') return send(res, 201, { success: true });
    if (act === 'updateParticipant') { if (j.action === 'add') evo.grp.members.push(...j.participants); if (j.action === 'remove') evo.grp.members = evo.grp.members.filter((m) => !j.participants.includes(m.split(':')[0])); return send(res, 201, { updateParticipants: j.participants.map((n) => ({ status: '200', jid: n + '@s.whatsapp.net' })) }); }
    if (act === 'sendInvite') return send(res, 201, [{ status: 'PENDING' }]);
    if (act === 'leaveGroup') return send(res, 200, { leave: 'success' });
  }
  if (p === '/group/fetchAllGroups/central') return send(res, 200, evo.groups);
  if (p === '/group/create/central') { evo.created = j; return send(res, 201, { id: '120363999999999999@g.us', subject: j.subject, participants: j.participants.map((n) => ({ id: n + '@s.whatsapp.net', admin: null })) }); }
  if (p === '/message/sendText/central' || p === '/message/sendMedia/central') {
    if (evo.mode === 'noexists') return send(res, 400, { status: 400, error: 'Bad Request', response: { message: [{ jid: j.number, exists: false, number: j.number }] } });
    if (evo.mode === 'server') return send(res, 500, { message: 'boom' });
    if (evo.mode === 'media' && p.includes('sendMedia')) return send(res, 400, { message: 'Invalid media url' });
    if (evo.mode === 'timeout') return; // nunca responde
    evo.sent.push({ p, ...j }); return send(res, 201, { key: { id: 'WA' + evo.sent.length } });
  }
  return send(res, 404, { message: 'not found' });
});

/* ---------- Telegram falso ---------- */
const tgs = { sent: [], updates: [], webhook: null, mode: 'ok', group: [], gmode: 'ok' };
const tgSrv = await listen(async (req, res) => {
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url); if (!m) return send(res, 404, {});
  if (m[1] !== TG_TOKEN) return send(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
  const j = JSON.parse((await readBody(req)) || '{}');
  switch (m[2]) {
    case 'getMe': return send(res, 200, { ok: true, result: { id: 777, username: 'central_bot', first_name: 'Central', can_join_groups: true } });
    case 'getWebhookInfo': return send(res, 200, { ok: true, result: { url: tgs.webhook ? tgs.webhook.url + '?x=1' : '', pending_update_count: 2 } });
    case 'setWebhook': tgs.webhook = j; return send(res, 200, { ok: true, result: true });
    case 'deleteWebhook': tgs.webhook = null; return send(res, 200, { ok: true, result: true });
    case 'getChat': if (String(j.chat_id) === '@sumiu') return send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }); return send(res, 200, { ok: true, result: { id: -1001234567890, type: 'channel', title: 'Ofertas Tech', username: 'ofertas_tech' } });
    case 'getChatMember': return send(res, 200, { ok: true, result: { status: 'administrator' } });
    case 'getChatMemberCount': return send(res, 200, { ok: true, result: 42 });
    case 'getChatAdministrators': return send(res, 200, { ok: true, result: [{ status: 'creator', user: { id: 1, first_name: 'Dono' } }, { status: 'administrator', user: { id: 777, first_name: 'Central', username: 'central_bot' } }] });
    case 'createChatInviteLink': tgs.group.push([m[2], j]); return send(res, 200, { ok: true, result: { invite_link: 'https://t.me/+AbCdEf123456' } });
    case 'revokeChatInviteLink': case 'setChatTitle': case 'setChatDescription': case 'setChatPermissions': case 'leaveChat':
      tgs.group.push([m[2], j]); if (tgs.gmode === 'kicked') return send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: not enough rights' });
      return send(res, 200, { ok: true, result: m[2] === 'revokeChatInviteLink' ? { invite_link: j.invite_link } : true });
    case 'getUpdates': return send(res, 200, { ok: true, result: tgs.updates.filter((x) => x.update_id >= (j.offset || 0)) });
    case 'sendMessage': case 'sendPhoto':
      if (tgs.mode === 'blocked') return send(res, 403, { ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the channel chat' });
      if (tgs.mode === 'rate') return send(res, 429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } });
      tgs.sent.push({ method: m[2], ...j }); return send(res, 200, { ok: true, result: { message_id: 100 + tgs.sent.length } });
  }
  return send(res, 404, { ok: false });
});

/* ---------- Mercado Livre e Shopee falsos ---------- */
const mlState = { itemPrice: 0, itemQty: 5, access: ML_ACCESS, refresh: 'ref' + rnd(20), refreshCalls: 0, searchStatus: 200, catalog: false, catalogCalls: 0 };
const ml = await listen(async (req, res) => {
  const body = await readBody(req);
  if (req.url === '/oauth/token') {
    const f = new URLSearchParams(body); const good = f.get('client_id') === '111' && f.get('client_secret') === ML_SECRET;
    if (!good) return send(res, 400, { message: 'invalid_client' });
    if (f.get('grant_type') === 'client_credentials') return send(res, 200, { access_token: ML_ACCESS, expires_in: 21600 });
    if (f.get('grant_type') === 'authorization_code') { if (f.get('code') !== 'CODEOK1234567' || f.get('redirect_uri') !== 'https://painel.exemplo.com/oauth/mercadolivre') return send(res, 400, { message: 'invalid_grant' }); return send(res, 200, { access_token: ML_ACCESS, refresh_token: mlState.refresh, expires_in: 21600, user_id: 99 }); }
    if (f.get('grant_type') === 'refresh_token') { if (f.get('refresh_token') !== mlState.refresh) return send(res, 400, { message: 'invalid_grant' }); mlState.refreshCalls++; mlState.refresh = 'ref' + rnd(20); mlState.access = 'acc' + rnd(16); return send(res, 200, { access_token: mlState.access, refresh_token: mlState.refresh, expires_in: 21600 }); }
    return send(res, 400, { message: 'unsupported_grant_type' });
  }
  const authed = req.headers.authorization === 'Bearer ' + ML_ACCESS || req.headers.authorization === 'Bearer ' + mlState.access;
  if (req.url.startsWith('/items/')) { if (!authed) return send(res, 403, { message: 'forbidden' }); const id = req.url.split('/items/')[1]; if (id === 'MLB1') return send(res, 200, { id: 'MLB1', title: 'Fone Bluetooth Bom', price: mlState.itemPrice || 80, original_price: 160, available_quantity: mlState.itemQty ?? 5, status: 'active', condition: 'new', permalink: 'https://produto.mercadolivre.com.br/MLB-1-fone', thumbnail: 'http://http2.mlstatic.com/D_1-I.jpg', sold_quantity: 200 }); return send(res, 404, { message: 'not found' }); }
  if (req.url === '/users/me') return authed ? send(res, 200, { id: 99, nickname: 'LUCAS_AFILIADO', site_id: 'MLB', permalink: 'https://perfil.mercadolivre.com.br/LUCAS_AFILIADO', seller_reputation: { level_id: '5_green', power_seller_status: 'gold' } }) : send(res, 401, { message: 'invalid_token' });
  // catálogo (liberado mesmo quando /sites/MLB/search responde 403)
  if (req.url.startsWith('/products/search')) { if (!authed || !mlState.catalog) return send(res, mlState.catalog ? 403 : 404, { message: 'x' }); mlState.catalogCalls++; return send(res, 200, { paging: { total: 1 }, results: [{ id: 'MLB10', name: 'Fone Catálogo Bluetooth', pictures: [{ url: 'http://http2.mlstatic.com/D_10.jpg' }] }] }); }
  if (/^\/products\/MLB10\/items/.test(req.url)) { if (!authed || !mlState.catalog) return send(res, 404, {}); return send(res, 200, { results: [{ item_id: 'MLB900', price: 120, original_price: 240, condition: 'used' }, { item_id: 'MLB901', price: 90, original_price: 180, condition: 'new', shipping: { free_shipping: true } }] }); }
  if (/^\/products\/MLB10$/.test(req.url)) { if (!authed || !mlState.catalog) return send(res, 404, {}); return send(res, 200, { id: 'MLB10', name: 'Fone Catálogo Bluetooth', pictures: [{ url: 'http://http2.mlstatic.com/D_10.jpg' }] }); }
  if (req.url.startsWith('/sites/MLB/search')) {
    if (!authed) return send(res, 403, { message: 'forbidden' });
    if (mlState.searchStatus !== 200) return send(res, mlState.searchStatus, { message: 'blocked' });
    return send(res, 200, { results: [
      { id: 'MLB1', title: 'Fone Bluetooth Bom', price: 80, original_price: 160, permalink: 'https://produto.mercadolivre.com.br/MLB-1-fone', thumbnail: 'http://http2.mlstatic.com/D_1-I.jpg', available_quantity: 5, condition: 'new', seller: { nickname: 'LOJA' }, sold_quantity: 200 },
      { id: 'MLB2', title: 'Fone Sem Desconto', price: 50, original_price: null, permalink: 'https://produto.mercadolivre.com.br/MLB-2-fone', available_quantity: 5, condition: 'new' },
      { id: 'MLB3', title: 'Fone Usado', price: 20, original_price: 100, permalink: 'https://produto.mercadolivre.com.br/MLB-3-fone', available_quantity: 1, condition: 'used' },
      { id: 'MLB4', title: 'Fone Esgotado', price: 20, original_price: 100, permalink: 'https://produto.mercadolivre.com.br/MLB-4-fone', available_quantity: 0, condition: 'new' },
      { id: 'MLB1', title: 'Fone Bluetooth Bom (repetido)', price: 80, original_price: 160, permalink: 'https://produto.mercadolivre.com.br/MLB-1-fone', available_quantity: 5, condition: 'new' },
    ] });
  }
  send(res, 404, {});
});
const spState = { queries: [] };
const shopee = await listen(async (req, res) => {
  const body = await readBody(req); const a = /Credential=([^,]+), Timestamp=(\d+), Signature=(\w+)/.exec(req.headers.authorization || '');
  const expect = a && crypto.createHash('sha256').update(a[1] + a[2] + body + SP_SECRET).digest('hex');
  if (!a || a[3] !== expect) return send(res, 200, { errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] });
  const q = String(JSON.parse(body).query); spState.queries.push(q);
  if (/generateShortLink/.test(q)) return send(res, 200, { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/sub1' } } });
  { const wi = /itemId:(\d+)/.exec(q); if (wi && wi[1] !== '55') return send(res, 200, { data: { productOfferV2: { nodes: [] } } }); }
  if (q.includes('conversionReport')) return send(res, 200, { data: { conversionReport: { nodes: [{ conversionId: 'cv1', purchaseTime: 1760000000, totalCommission: '12.50', utmContent: 'gabc' }, { conversionId: 'cv2', purchaseTime: 1760100000, totalCommission: '7.50' }], pageInfo: { hasNextPage: false } } } });
  send(res, 200, { data: { productOfferV2: { nodes: [
    { itemId: '55', shopId: '9', productName: 'Caixa de Som', price: '75.00', priceDiscountRate: 50, commissionRate: '0.12', sales: 900, imageUrl: 'https://down-br.img.susercontent.com/file/x', shopName: 'Loja Shopee', productLink: 'https://shopee.com.br/product/9/55', offerLink: 'https://s.shopee.com.br/abc' },
    { itemId: '56', shopId: '9', productName: 'Sem desconto', price: '40.00', priceDiscountRate: 0, commissionRate: '0.05', productLink: 'https://shopee.com.br/product/9/56', offerLink: 'https://s.shopee.com.br/def' },
  ] } } });
});

/* ---------- AliExpress e Amazon falsas ---------- */
const AL_SECRET = 'al' + rnd(30), AMZ_SECRET = 'amz' + rnd(30); const alState = { calls: [] };
const ali = await listen(async (req, res) => {
  const f = Object.fromEntries(new URLSearchParams(await readBody(req))); alState.calls.push(f);
  const { sign, ...rest } = f; const base = Object.keys(rest).sort().map((k) => k + rest[k]).join('');
  if (f.app_key !== 'ALIKEY1' || sign !== crypto.createHmac('sha256', AL_SECRET).update(base).digest('hex').toUpperCase()) return send(res, 200, { error_response: { code: 'IncompleteSignature', msg: 'The request signature does not conform to platform standards' } });
  if (!f.tracking_id) return send(res, 200, { aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: [] } } } } });
  send(res, 200, { aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, resp_msg: 'ok', result: { products: { product: [
    { product_id: 1005001, product_title: 'Fone TWS', target_sale_price: '39.90', target_original_price: '79.80', promotion_link: 'https://s.click.aliexpress.com/e/_abc', product_main_image_url: 'https://ae01.alicdn.com/kf/x.jpg', commission_rate: '7.5%', lastest_volume: 3000, evaluate_rate: '96.1%' },
    { product_id: 1005002, product_title: 'Sem desconto', target_sale_price: '20.00', target_original_price: '20.00', promotion_link: 'https://s.click.aliexpress.com/e/_def' },
  ] } } } } });
});
const amzState = { tokenCalls: 0, searches: [], price: 0 };
const amz = await listen(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || '{}');
  if (req.url === '/token') { amzState.tokenCalls++; return body.client_id === 'CRED1' && body.client_secret === AMZ_SECRET && body.scope === 'creatorsapi::default' && body.grant_type === 'client_credentials' ? send(res, 200, { access_token: 'amztok', expires_in: 3600 }) : send(res, 400, { error: 'invalid_client' }); }
  if (req.url === '/catalog/v1/getItems') {
    if (req.headers.authorization !== 'Bearer amztok') return send(res, 401, { errors: [{ code: 'Unauthorized', message: 'token inválido' }] });
    if (!body.itemIds.includes('B0TEST0001')) return send(res, 200, { itemsResult: { items: [] } });
    return send(res, 200, { itemsResult: { items: [{ asin: 'B0TEST0001', detailPageURL: 'https://www.amazon.com.br/dp/B0TEST0001?tag=lucas-20', itemInfo: { title: { displayValue: 'Echo Dot' } }, offersV2: { listings: [{ isBuyBoxWinner: true, price: { money: { amount: amzState.price || 249.9 }, savingBasis: { money: { amount: 449.9 } } } }] } }] } });
  }
  if (req.url === '/catalog/v1/searchItems') {
    if (req.headers.authorization !== 'Bearer amztok') return send(res, 401, { errors: [{ code: 'Unauthorized', message: 'token inválido' }] });
    amzState.searches.push({ body, mkt: req.headers['x-marketplace'] });
    return send(res, 200, { searchResult: { items: [
      { asin: 'B0TEST0001', detailPageURL: 'https://www.amazon.com.br/dp/B0TEST0001?tag=lucas-20', itemInfo: { title: { displayValue: 'Echo Dot' } }, images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/x.jpg' } } },
        offersV2: { listings: [{ isBuyBoxWinner: true, merchantInfo: { name: 'Amazon.com.br' }, availability: { type: 'IN_STOCK' }, price: { money: { amount: 249.9 }, savingBasis: { money: { amount: 449.9 } }, savings: { percentage: 44 } } }] } },
      { asin: 'B0TEST0002', detailPageURL: 'https://www.amazon.com.br/dp/B0TEST0002?tag=lucas-20', itemInfo: { title: { displayValue: 'Sem oferta' } }, offersV2: { listings: [] } },
    ] } });
  }
  send(res, 404, {});
});

/* ---------- Supabase falso (em memória) com checagem de contrato ---------- */
const sql = readdirSync(join(root, 'db', 'migrations')).map((f) => readFileSync(join(root, 'db', 'migrations', f), 'utf8')).join('\n');
const params = {}; for (const m of sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)) params[m[1]] = m[2].split(',').map((x) => x.trim().split(/\s+/)[0]).filter((x) => /^p(_|$)/.test(x));
const db = {
  secrets: { evolution_api_key: EVO_KEY, telegram_bot_token: TG_TOKEN, telegram_webhook_secret: TG_HOOK, ml_client_secret: ML_SECRET, shopee_secret: SP_SECRET },
  evolution: { base_url: evoSrv.url, instance: 'central', webhook_url: 'https://worker.exemplo.com/hook/whatsapp-x', send_delay_min_s: 1, send_delay_max_s: 1, alerts: true },
  telegram: { enabled: true, mode: 'polling', webhook_url: 'https://worker.exemplo.com/hook/telegram-x', admin_chat_id: '555', alerts: true },
  groups: { whatsapp: { only_admins_send: true, lock_info: true, ephemeral_seconds: 604800, add_disclosure: true, add_batch_size: 2, add_delay_s: 2, invite_after_create: true }, telegram: {} }, disclosure: 'Link de afiliado: posso receber comissão.',
  status: {}, runs: [], offers: [], rejectedOffers: [], reprices: [], revalidated: [], shortTargets: [], signals: [], radarQueue: [], captured: [], sources: [], linkCache: {}, autoApproved: 0, watch: [], watchUpdates: [], commissions: [], jobGate: {}, snapshot: null, alertSent: {}, pubCtx: null, jobs: [], pubs: [], outbox: [], tests: [], ingested: [], calls: [], completed: {}, failed: {}, pubResults: [],
  connectors: { shopee: { mode: 'api_ready', config: { app_id: 'APP1', api_endpoint: null } }, mercadolivre: { mode: 'api_pending', config: { app_id: '111' } }, amazon: { mode: 'disabled', config: {} } },
};
const unchecked = new Set();
const rpc = async (name, args) => {
  db.calls.push(name);
  if (params[name]) { for (const k of Object.keys(args || {})) if (!params[name].includes(k)) throw new Error(`argumento "${k}" não existe em ${name}(${params[name].join(', ')})`); }
  else unchecked.add(name);
  switch (name) {
    case 'get_integration_runtime': return JSON.parse(JSON.stringify({ evolution: db.evolution, telegram: db.telegram, groups: db.groups, disclosure: db.disclosure, paused: false, status: db.status, secrets: db.secrets, connectors: db.connectors }));
    case 'claim_channel_job': { const j = db.jobs.find((x) => x.status === 'pending'); if (!j) return null; j.status = 'claimed'; return { id: j.id, kind: j.kind, channel: j.channel, payload: j.payload }; }
    case 'complete_channel_job': { const j = db.jobs.find((x) => x.id === args.p_id); j.status = 'done'; j.result = args.p_result; return null; }
    case 'fail_channel_job': { const j = db.jobs.find((x) => x.id === args.p_id); j.status = 'failed'; j.error = args.p_error; return null; }
    case 'report_integration_status': db.status[args.p_provider] = { ...args.p_status, checked_at: 'agora' }; return null;
    case 'claim_next_publication': { const i = db.pubs.findIndex((p) => !args.p_channel || p.channel === args.p_channel); return i < 0 ? null : db.pubs.splice(i, 1)[0]; }
    case 'reshorten_pending': return 0;
    case 'complete_publication': db.pubResults.push(['sent', args.p_id, args.p_external_message_id]); return null;
    case 'fail_publication': db.pubResults.push(['failed', args.p_id, args.p_error_code, args.p_permanent, args.p_retry_in_seconds]); return 'x';
    case 'mark_publication_unknown': db.pubResults.push(['unknown', args.p_id, args.p_note]); return null;
    case 'claim_chat_outbox': return db.outbox.shift() || null;
    case 'complete_chat_outbox': db.completed[args.p_id] = args.p_external_message_id; return null;
    case 'fail_chat_outbox': db.failed[args.p_id] = args.p_error; return null;
    case 'claim_destination_test': return db.tests.shift() || null;
    case 'complete_destination_test': db.completed['t' + args.p_test] = args.p_ok; return null;
    case 'store_integration_token': if (args.p_value) db.secrets[args.p_key] = args.p_value; else delete db.secrets[args.p_key]; return null;
    case 'start_run': db.runs.push({ platform: args.p_platform, status: 'running' }); return 'run' + db.runs.length;
    case 'finish_run': Object.assign(db.runs[Number(String(args.p_run).slice(3)) - 1], { status: args.p_status, seen: args.p_seen, accepted: args.p_accepted, rejected: args.p_rejected, error: args.p_error }); return null;
    case 'ingest_offer': { db.offers.push(args.p); const dup = db.offers.filter((o) => o.external_id === args.p.external_id).length > 1; return dup ? { status: 'duplicate', reason: 'open_offer' } : args.p.platform === 'shopee' && args.p.title === 'Caixa de Som' && db.rejectShopee ? { status: 'rejected', failures: [{ code: 'domain_not_allowed' }] } : { status: 'created', offer_id: 'of' + db.offers.length, score: db.score ?? 80 }; }
    case 'reject_offer': db.rejectedOffers.push(args.p_offer); return null;
    case 'get_publication_context': return db.pubCtx;
    case 'reprice_offer': db.reprices.push(args); return null;
    case 'mark_offer_revalidated': db.revalidated.push(args.p_offer); return null;
    case 'set_short_link_target': db.shortTargets.push(args); return null;
    case 'set_offer_signals': db.signals.push(args); return null;
    case 'category_guess': return 'eletronicos';
    case 'claim_radar_messages': { const q = db.radarQueue; db.radarQueue = []; return q; }
    case 'record_captured_link': db.captured.push(args.p); return db.captured.length;
    case 'register_offer_source': db.sources.push(args); return 1;
    case 'link_cache_get': return db.linkCache[args.p_hash] || null;
    case 'link_cache_put': db.linkCache[args.p_hash] = { final_url: args.p_final, platform: args.p_platform, external_id: args.p_external }; return null;
    case 'run_auto_approve': return { approved: db.autoApproved, errors: 0 };
    case 'expire_offers': return 0;
    case 'watchlist_due': { const d = db.watch; db.watch = []; return d; }
    case 'watchlist_update': db.watchUpdates.push(args); return null;
    case 'upsert_commissions': db.commissions.push(...args.p); return args.p.length;
    case 'job_should_run': { if (db.jobGate[args.p_key]) return false; db.jobGate[args.p_key] = true; return true; }
    case 'housekeeping': return { ok: true };
    case 'ops_snapshot': return db.snapshot;
    case 'alert_should_send': { if (db.alertSent[args.p_key]) return false; db.alertSent[args.p_key] = true; return true; }
    case 'alert_clear': delete db.alertSent[args.p_key]; return null;
    case 'save_integration': (db.savedInt = db.savedInt || []).push(args); return null;
    case 'ingest_chat_message': db.ingested.push(args.p); return { status: 'created' };
    default: return null;
  }
};

/* ---------- ctx de teste ---------- */
const ctx = {
  followHost: /^127\.0\.0\.1$/, rpc, urls: { telegram: tgSrv.url, ml: ml.url, amazon: amz.url, amazonToken: amz.url + '/token' }, now: () => new Date(), rand: () => 0, log: () => {}, sleep: async () => {},
  sha256hex: async (t) => crypto.createHash('sha256').update(t).digest('hex'),
  http: async (o) => {
    let body = o.body; const headers = { ...(o.headers || {}) };
    if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(o.form).toString(); } else if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
    try {
      const r = await fetch(o.url, { method: o.method, headers, body, redirect: o.redirect || 'follow', signal: AbortSignal.timeout(Math.min(o.timeoutMs || 20000, 1500)) });
      const t = await r.text(); let d = t; try { d = JSON.parse(t); } catch { /* texto */ } return { status: r.status, data: d, location: r.headers.get('location') || undefined };
    } catch (e) { throw { code: /timeout|abort/i.test(String(e.name + e.message)) ? 'timeout' : 'network' }; }
  },
};
const job = (kind, channel, payload) => { const j = { id: crypto.randomUUID(), kind, channel, payload, status: 'pending' }; db.jobs.push(j); return j; };
const pub = (o) => db.pubs.push({ publication_id: crypto.randomUUID(), offer_id: 'o', destination_id: 'd', rendered_text: '<b>Oferta</b>', is_simulated: false, image_url: null, ...o });

/* ================== CASOS ================== */
let j = job('integration', 'whatsapp', { provider: 'evolution', action: 'status' });
await W.runJobs(ctx);
ok(j.status === 'done' && j.result.state === 'close' && j.result.version === '2.3.7' && j.result.phone === '5511999990001', 'evolution/status: estado, versão e número');
ok(db.status.evolution && db.status.evolution.state === 'close', 'estado gravado para o painel');
ok(!JSON.stringify(db.status).includes(EVO_KEY), 'status não contém segredo');

j = job('integration', 'whatsapp', { provider: 'evolution', action: 'connect' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.qr.startsWith('data:image/png;base64,'), 'connect devolve QR como data URL');
j = job('integration', 'whatsapp', { provider: 'evolution', action: 'connect', pairing_number: '5511999990001' }); await W.runJobs(ctx);
ok(j.result.pairing_code === 'ABCD-1234', 'connect com número devolve código de pareamento');
evo.state = 'open'; j = job('integration', 'whatsapp', { provider: 'evolution', action: 'connect' }); await W.runJobs(ctx);
ok(j.result.already === true, 'connect em instância já conectada não gera QR');

j = job('integration', 'whatsapp', { provider: 'evolution', action: 'set_webhook' }); await W.runJobs(ctx);
ok(j.status === 'done' && evo.webhook.url === 'https://worker.exemplo.com/hook/whatsapp-x', 'set_webhook configura a Evolution (formato v2)');
db.secrets.evolution_api_key = 'errada' + rnd(20);
j = job('integration', 'whatsapp', { provider: 'evolution', action: 'status' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /401/.test(j.error), 'chave errada vira erro claro');
db.secrets.evolution_api_key = EVO_KEY;

j = job('refresh_groups', 'whatsapp', {}); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.groups.length === 1 && j.result.groups[0].external_id.endsWith('@g.us'), 'refresh_groups lista só grupos');
j = job('create_group', 'whatsapp', { name: 'Ofertas Carro BR', description: 'x', participants: [{ external_id: '5511999990001' }, { external_id: '+55 (11) 98888-0002' }] }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.external_id === '120363999999999999@g.us' && evo.created.participants[1] === '5511988880002', 'create_group cria e normaliza telefones');

/* ---------- gerenciamento de grupos (WhatsApp) ---------- */
const ga = (channel, external_id, action, params = {}) => { const x = job('group_action', channel, { external_id, action, params }); return x; };
evo.calls.length = 0;
j = ga('whatsapp', GJ, 'info'); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.chat.title === 'Grupo A' && j.result.chat.we_are_admin === true && j.result.participants.length === 2 && j.result.participants[0].role === 'admin', 'group info: título, admin (nosso número) e participantes');
j = ga('whatsapp', GJ, 'invite_code'); await W.runJobs(ctx);
ok(j.result.invite_url === 'https://chat.whatsapp.com/ABC123', 'invite_code devolve o link');
j = ga('whatsapp', GJ, 'revoke_invite'); await W.runJobs(ctx);
ok(j.result.invite_url === 'https://chat.whatsapp.com/NOVO99', 'revoke_invite devolve o novo link');
j = ga('whatsapp', GJ, 'set_subject', { subject: 'Ofertas Tech' }); await W.runJobs(ctx);
ok(j.status === 'done' && evo.grp.subject === 'Ofertas Tech' && j.result.chat.title === 'Ofertas Tech', 'set_subject altera e devolve o grupo atualizado');
j = ga('whatsapp', GJ, 'set_only_admins_send', { value: true }); await W.runJobs(ctx);
ok(evo.grp.announce === true && j.result.flags.only_admins_send === true, 'só admins enviam (announcement)');
j = ga('whatsapp', GJ, 'set_lock_info', { value: true }); await W.runJobs(ctx);
ok(evo.grp.restrict === true, 'trava edição de dados (locked)');
j = ga('whatsapp', GJ, 'set_ephemeral', { seconds: 604800 }); await W.runJobs(ctx);
ok(evo.calls.at(-3).act === 'toggleEphemeral' && evo.calls.at(-3).expiration === 604800, 'mensagens temporárias');
evo.calls.length = 0;
j = ga('whatsapp', GJ, 'add_participants', { numbers: ['5511977770001', '5511977770002', '5511977770003', '5511977770004', '5511977770005'] }); await W.runJobs(ctx);
const adds = evo.calls.filter((c) => c.act === 'updateParticipant' && c.action === 'add');
ok(j.status === 'done' && adds.length === 3 && adds[0].participants.length === 2 && j.result.added.length === 5, 'add_participants em lotes do tamanho configurado (2) com espera entre eles');
j = ga('whatsapp', GJ, 'promote', { numbers: ['5511977770001'] }); await W.runJobs(ctx);
ok(evo.calls.at(-3).action === 'promote', 'promover a admin');
j = ga('whatsapp', GJ, 'remove_participants', { numbers: ['5511977770001'] }); await W.runJobs(ctx);
ok(!evo.grp.members.some((m) => m.startsWith('5511977770001')), 'remover participante');
j = ga('whatsapp', GJ, 'send_invite', { numbers: ['5511966660001'], text: 'Entre!' }); await W.runJobs(ctx);
ok(j.result.sent_to === 1 && evo.calls.at(-1).act === 'sendInvite' && evo.calls.at(-1).groupJid === GJ, 'enviar convite por mensagem privada');
j = ga('whatsapp', GJ, 'apply_defaults'); await W.runJobs(ctx);
ok(j.result.applied.only_admins_send === true && j.result.applied.lock_info === true && j.result.applied.ephemeral === true, 'aplicar padrões em grupo existente');
evo.gmode = 'server';
j = ga('whatsapp', GJ, 'set_subject', { subject: 'X' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /incerto/i.test(j.error) && /confira/i.test(j.error), 'erro 5xx numa alteração vira "resultado incerto" (sem repetir)');
evo.gmode = 'ok';
j = ga('whatsapp', GJ, 'leave'); await W.runJobs(ctx);
ok(j.result.left === true && evo.calls.at(-1).act === 'leaveGroup', 'sair do grupo');
db.secrets.evolution_api_key = 'x' + rnd(20);
j = ga('whatsapp', GJ, 'info'); await W.runJobs(ctx);
ok(j.status === 'failed' && /401/.test(j.error) && !j.error.includes(EVO_KEY), 'chave errada em ação de grupo: erro claro, sem segredo');
db.secrets.evolution_api_key = EVO_KEY;

/* criação de grupo aplica os padrões */
evo.calls.length = 0;
j = job('create_group', 'whatsapp', { name: 'Ofertas Casa', description: 'Promoções da casa', participants: ['5511911110001', '5511911110002', '5511911110003', '5511911110004', '5511911110005'].map((n) => ({ external_id: n })) }); await W.runJobs(ctx);
ok(j.status === 'done' && evo.created.participants.length === 2 && evo.created.description.includes('Link de afiliado') && evo.created.description.startsWith('Promoções da casa'), 'create_group: primeiro lote + aviso de afiliado na descrição');
ok(j.result.participants.length === 5 && !j.result.pending_numbers, 'create_group: restante entra em lotes');
ok(j.result.applied.only_admins_send === true && j.result.applied.lock_info === true && j.result.applied.ephemeral === true, 'create_group: padrões aplicados');
ok(j.result.invite_url === 'https://chat.whatsapp.com/ABC123', 'create_group: devolve o link de convite');

/* ---------- gerenciamento de grupos (Telegram) ---------- */
const TGC = '-1001234567890';
j = ga('telegram', TGC, 'info'); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.chat.participant_count === 42 && j.result.chat.we_are_admin === true && j.result.participants.length === 2 && j.result.participants[0].role === 'owner', 'telegram info: membros, admin e lista de administradores');
j = ga('telegram', TGC, 'create_invite'); await W.runJobs(ctx);
ok(j.result.invite_url === 'https://t.me/+AbCdEf123456', 'telegram: cria link de convite');
j = ga('telegram', TGC, 'revoke_invite', { link: 'https://t.me/+AbCdEf123456' }); await W.runJobs(ctx);
ok(j.result.revoked === true && tgs.group.at(-1)[0] === 'revokeChatInviteLink', 'telegram: revoga link');
j = ga('telegram', TGC, 'set_title', { subject: 'Ofertas Tech' }); await W.runJobs(ctx);
ok(tgs.group.at(-1)[0] === 'setChatTitle' && tgs.group.at(-1)[1].title === 'Ofertas Tech', 'telegram: título');
j = ga('telegram', TGC, 'set_description', { description: 'Só ofertas' }); await W.runJobs(ctx);
ok(tgs.group.at(-1)[0] === 'setChatDescription', 'telegram: descrição');
j = ga('telegram', TGC, 'set_permissions', { can_send_messages: false }); await W.runJobs(ctx);
ok(tgs.group.at(-1)[0] === 'setChatPermissions' && tgs.group.at(-1)[1].permissions.can_send_messages === false, 'telegram: membros não enviam');
tgs.gmode = 'kicked';
j = ga('telegram', TGC, 'set_title', { subject: 'Y' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /not enough rights/i.test(j.error), 'telegram: sem permissão vira erro claro');
tgs.gmode = 'ok';
j = ga('telegram', TGC, 'leave'); await W.runJobs(ctx);
ok(j.result.left === true && tgs.group.at(-1)[0] === 'leaveChat', 'telegram: sair do chat');

/* ---------- Worker: autoteste, webhooks de entrada, SHA-256 puro ---------- */
for (const t of ['abc', '', 'Shopee 123 ação ✓ ' + rnd(60), 'x'.repeat(200)]) ok(W.sha256Hex(t) === crypto.createHash('sha256').update(t).digest('hex'), `sha256 puro confere (${JSON.stringify(t).slice(0, 18)})`);
const hookSrv = await listen(async (req, res) => {
  const b = JSON.parse((await readBody(req)) || '{}');
  if (req.url === '/webhook/wa') return send(res, b.instance === 'central' && b.event === 'central.ping' ? 200 : 403, { ok: b.instance === 'central' });
  if (req.url === '/webhook/tg') return req.headers['x-telegram-bot-api-secret-token'] === TG_HOOK ? send(res, 200, { ok: true }) : send(res, 401, { ok: false });
  send(res, 404, { message: 'not found' });
});
db.evolution.webhook_url = hookSrv.url + '/webhook/wa'; db.telegram.webhook_url = hookSrv.url + '/webhook/tg';
ctx.env = { has_url: true, has_key: true, supabase_host: 'meu.supabase.co' };
j = job('integration', null, { provider: 'worker', action: 'selftest' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.ok === true && j.result.checks.find((c) => c.id === 'sha').ok && j.result.checks.find((c) => c.id === 'env').detail.includes('meu.supabase.co'), 'worker/selftest: tudo certo');
ok(db.status.worker && db.status.worker.ok === true, 'worker/selftest grava o resultado para o painel');
ok(!JSON.stringify(j.result).includes(EVO_KEY) && !JSON.stringify(j.result).includes(TG_TOKEN) && !JSON.stringify(j.result).includes(TG_HOOK), 'selftest não vaza segredos');
ctx.env = { has_url: false, has_key: true, supabase_host: '' };
j = job('integration', null, { provider: 'worker', action: 'selftest' }); await W.runJobs(ctx);
ok(j.result.ok === false && j.result.checks.find((c) => c.id === 'env').ok === false, 'selftest acusa variável faltando');
ctx.env = { has_url: true, has_key: true, supabase_host: 'meu.supabase.co' };
j = job('integration', null, { provider: 'worker', action: 'webhook_check' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.ok === true && j.result.webhooks.length === 2 && j.result.webhooks.every((w) => w.ok), 'webhook_check: WhatsApp e Telegram respondem');
ok(!JSON.stringify(j.result).includes('/webhook/wa') , 'webhook_check mascara o caminho secreto');
db.secrets.telegram_webhook_secret = 'errado' + rnd(10);
j = job('integration', null, { provider: 'worker', action: 'webhook_check' }); await W.runJobs(ctx);
ok(j.result.ok === false && /401/.test(j.result.webhooks[1].detail), 'webhook_check: segredo do Telegram errado vira explicação');
db.secrets.telegram_webhook_secret = TG_HOOK;
db.evolution.webhook_url = hookSrv.url + '/nada';
j = job('integration', null, { provider: 'worker', action: 'webhook_check' }); await W.runJobs(ctx);
ok(/404/.test(j.result.webhooks[0].detail), 'webhook_check: 404 sugere conferir o worker');
db.evolution.webhook_url = 'https://worker.exemplo.com/hook/whatsapp-x'; db.telegram.webhook_url = 'https://worker.exemplo.com/hook/telegram-x';
j = job('integration', null, { provider: 'worker', action: 'run_monitor' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.monitor && 'evolution' in j.result.monitor, 'run_monitor roda o monitor');
hookSrv.s.close();

j = job('integration', 'telegram', { provider: 'telegram', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.bot_username === 'central_bot' && j.result.mode_live === 'polling', 'telegram/check: bot e modo');
j = job('integration', 'telegram', { provider: 'telegram', action: 'set_webhook' }); await W.runJobs(ctx);
ok(j.status === 'done' && tgs.webhook.secret_token === TG_HOOK && !JSON.stringify(j.result).includes('x=1'), 'set_webhook usa o segredo e não vaza parâmetros na resposta');
j = job('integration', 'telegram', { provider: 'telegram', action: 'delete_webhook' }); await W.runJobs(ctx);
ok(j.status === 'done' && tgs.webhook === null, 'delete_webhook');
j = job('verify_chat', 'telegram', { ref: '@ofertas_tech' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.chat.kind === 'channel' && j.result.chat.we_are_admin === true, 'verify_chat: canal e permissão de admin');
j = job('verify_chat', 'telegram', { ref: '@sumiu' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /chat not found/i.test(j.error), 'verify_chat: chat inexistente falha com motivo');
j = job('integration', 'telegram', { provider: 'telegram', action: 'send_test', to: '-1001234567890', text: 'Oi' }); await W.runJobs(ctx);
ok(j.status === 'done' && tgs.sent.at(-1).text === 'Oi', 'send_test do Telegram');

j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.ok === true && db.status.mercadolivre.ok === true, 'Mercado Livre: credenciais aceitas');
db.secrets.ml_client_secret = 'outra' + rnd(20); j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === false && /recusou/.test(j.result.error), 'Mercado Livre: credencial errada explicada');
db.secrets.ml_client_secret = ML_SECRET;
db.connectors.shopee.config.api_endpoint = shopee.url;
j = job('integration', null, { provider: 'shopee', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === true, 'Shopee: assinatura SHA256 aceita');
db.secrets.shopee_secret = 'errado' + rnd(20); j = job('integration', null, { provider: 'shopee', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /Invalid Signature/.test(j.error), 'Shopee: assinatura inválida explicada');
db.secrets.shopee_secret = SP_SECRET;
j = job('integration', null, { provider: 'amazon', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === false && /Falta informar/.test(j.result.error), 'Amazon: aponta o que falta');

evo.state = 'open'; evo.mode = 'ok';
pub({ channel: 'whatsapp', external_chat_id: '120363000000000001@g.us', rendered_text: '*Oferta*', image_url: 'https://img/x.jpg' });
pub({ channel: 'telegram', external_chat_id: '-1001234567890', rendered_text: '<b>Oferta</b>' });
pub({ channel: 'whatsapp', external_chat_id: '120363000000000001@g.us', is_simulated: true });
await W.runSender(ctx, { budgetMs: 60000 });
ok(evo.sent[0] && evo.sent[0].p.includes('sendMedia') && tgs.sent.at(-1).method === 'sendMessage', 'publicações: imagem no WhatsApp, texto no Telegram');
ok(db.pubResults.filter((x) => x[0] === 'sent').length === 3 && String(db.pubResults[2][2]).startsWith('simulado-') && evo.sent.length === 1, 'conclusões registradas; simulada não envia');

evo.mode = 'media'; db.pubResults = []; evo.sent = [];
pub({ channel: 'whatsapp', external_chat_id: 'a@g.us', image_url: 'https://img/x.jpg' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0] && db.pubResults[0][0] === 'sent' && evo.sent[0].p.includes('sendText'), 'imagem recusada: reenvia como texto na mesma tentativa');
evo.mode = 'noexists'; db.pubResults = [];
pub({ channel: 'whatsapp', external_chat_id: '5511000000000' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0][0] === 'failed' && db.pubResults[0][2] === 'no_whatsapp' && db.pubResults[0][3] === true, 'número sem WhatsApp: falha permanente');
evo.mode = 'server'; db.pubResults = [];
pub({ channel: 'whatsapp', external_chat_id: 'a@g.us' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0][0] === 'unknown', 'erro 500: marca unknown e NÃO reenvia');
evo.mode = 'timeout'; db.pubResults = [];
pub({ channel: 'whatsapp', external_chat_id: 'a@g.us' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0][0] === 'unknown', 'timeout: marca unknown');
evo.mode = 'ok'; tgs.mode = 'blocked'; db.pubResults = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0][2] === 'blocked_bot' && db.pubResults[0][3] === true, 'Telegram: bot removido = permanente');
tgs.mode = 'rate'; db.pubResults = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0][3] === false && db.pubResults[0][4] >= 7, 'Telegram 429: tenta de novo respeitando retry_after');
tgs.mode = 'ok';
db.telegram.enabled = false; db.pubResults = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(db.pubResults[0][0] === 'failed' && db.pubResults[0][3] === false, 'Telegram desligado: adia sem falha permanente');
db.telegram.enabled = true;

db.outbox.push({ outbox_id: 'ob1', channel: 'whatsapp', chat_external_id: '5511999990001@s.whatsapp.net', text: 'Oi!' });
db.tests.push({ test_id: 't1', channel: 'telegram', external_chat_id: '-100', name: 'Ofertas' });
evo.mode = 'ok'; await W.runSender(ctx, { budgetMs: 60000 });
ok(db.completed.ob1 && db.completed.tt1 === true, 'resposta manual e teste de destino concluídos');
evo.mode = 'server'; db.outbox.push({ outbox_id: 'ob3', channel: 'whatsapp', chat_external_id: 'a@g.us', text: 'x' }); await W.runSender(ctx, { budgetMs: 60000 });
ok(/confira no aplicativo/.test(db.failed.ob3 || ''), 'resposta manual ambígua não é reenviada e avisa para conferir');
evo.mode = 'ok';

tgs.updates = [{ update_id: 10, channel_post: { message_id: 5, date: 1790000000, chat: { id: -1001234567890, type: 'channel', title: 'Ofertas Tech', username: 'ofertas_tech' }, text: 'Funcionou?' } },
  { update_id: 11, message: { message_id: 6, date: 1790000001, chat: { id: 42, type: 'private', first_name: 'Ana' }, from: { id: 42, first_name: 'Ana' }, text: 'Oi' } }];
db.ingested = []; await W.runMonitor(ctx);
ok(db.ingested.length === 2 && db.status.telegram.offset === 12, 'polling grava mensagens e avança o offset');
db.ingested = []; await W.runMonitor(ctx); ok(db.ingested.length === 0, 'segunda consulta não repete (offset)');
let hook = await W.handleTelegramWebhook(ctx, { 'x-telegram-bot-api-secret-token': 'errado' }, tgs.updates[1]);
ok(hook.status === 401, 'webhook do Telegram recusa segredo errado');
db.ingested = []; hook = await W.handleTelegramWebhook(ctx, { 'x-telegram-bot-api-secret-token': TG_HOOK }, tgs.updates[1]);
ok(hook.status === 200 && db.ingested.length === 1, 'webhook do Telegram aceita com segredo certo');
const waBody = { event: 'messages.upsert', instance: 'central', data: { key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'ABC', participant: '5511988880002@s.whatsapp.net' }, pushName: 'João', message: { conversation: 'Quero a oferta' }, messageTimestamp: 1790000000 } };
db.ingested = []; let wh = await W.handleEvolutionWebhook(ctx, waBody);
ok(db.ingested.length === 1 && db.ingested[0].chat.kind === 'group' && db.ingested[0].direction === 'in', 'webhook da Evolution grava mensagem de grupo');
wh = await W.handleEvolutionWebhook(ctx, { ...waBody, instance: 'outra' }); ok(wh.status === 403, 'webhook da Evolution recusa outra instância');
wh = await W.handleEvolutionWebhook(ctx, { ...waBody, event: 'connection.update' }); ok(wh.ignored === true, 'outros eventos são ignorados');
ok(W.mapEvolutionMessage({ data: { key: { remoteJid: 'status@broadcast', id: '1' }, message: { conversation: 'x' } } }).length === 0, 'status@broadcast ignorado');

db.status.evolution = { state: 'open' }; evo.state = 'close'; tgs.sent = []; await W.runMonitor(ctx);
ok(tgs.sent.some((m) => String(m.chat_id) === '555'), 'monitor: avisa o administrador quando o WhatsApp cai');
ok(db.status.evolution.state === 'close', 'monitor: estado atualizado');

const used = [...new Set(db.calls)]; const missing = used.filter((n) => !params[n]);
ok(missing.length === 0, 'contrato: toda função RPC usada existe nas migrações' + (missing.length ? ' — faltam: ' + missing.join(', ') : ''));


/* ---------- Contas de afiliado: Mercado Livre (OAuth), Shopee e coleta ---------- */
console.log('\n— contas de afiliado —');
delete db.secrets.ml_refresh_token; delete db.secrets.ml_access_token;
db.connectors.mercadolivre = { mode: 'api_ready', config: { app_id: '111', redirect_uri: 'https://painel.exemplo.com/oauth/mercadolivre', min_discount_pct: 20, categories: ['eletronicos'], keywords: ['fone'] } };
j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.ok === true && j.result.connected === false && j.result.partial === true, 'ML: sem conta conectada só valida o aplicativo e pede para conectar');
j = job('integration', null, { provider: 'mercadolivre', action: 'collect' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /Conecte a conta/.test(j.error), 'ML: coleta sem conta conectada é recusada com instrução');
j = job('integration', null, { provider: 'mercadolivre', action: 'exchange_code', code: 'CODEERRADO12345', redirect_uri: 'https://painel.exemplo.com/oauth/mercadolivre' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /não aceitou a autorização/.test(j.error) && !JSON.stringify(j).includes(ML_SECRET), 'ML: código inválido é explicado e nenhum segredo vaza');
j = job('integration', null, { provider: 'mercadolivre', action: 'exchange_code', code: 'CODEOK1234567', redirect_uri: 'https://painel.exemplo.com/oauth/mercadolivre' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.account.nickname === 'LUCAS_AFILIADO', 'ML: código trocado por tokens e conta lida (/users/me)');
ok(db.secrets.ml_access_token === ML_ACCESS && db.secrets.ml_refresh_token === mlState.refresh && Number(db.secrets.ml_token_expires_at) > Date.now() / 1000, 'ML: tokens e validade guardados no cofre');
ok(db.status.mercadolivre.connected === true && db.status.mercadolivre.account.nickname === 'LUCAS_AFILIADO' && !JSON.stringify(db.status.mercadolivre).includes(ML_ACCESS), 'ML: status mostra a conta, sem token');
j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.result.connected === true && j.result.sample.length >= 1 && j.result.sample[0].discount_pct === 50, 'ML: teste devolve conta e amostra real com desconto');
j = job('integration', null, { provider: 'mercadolivre', action: 'preview' }); await W.runJobs(ctx);
ok(j.result.dry === true && j.result.items.length === 1 && j.result.items[0].title === 'Fone Bluetooth Bom' && db.offers.length === 0, 'ML: prévia mostra só o que passa nos filtros e não grava nada');
ok(j.result.skipped.sem_desconto === 1 && j.result.skipped.usado === 1 && j.result.skipped.sem_estoque === 1 && j.result.skipped.repetido === 1, 'ML: filtros explicam o que foi descartado (sem desconto, usado, sem estoque, repetido)');
j = job('integration', null, { provider: 'mercadolivre', action: 'collect' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.created === 1 && db.offers.length === 1 && db.offers[0].source_kind === 'api' && db.offers[0].previous_price === 160 && db.offers[0].image_url.startsWith('https://') && db.offers[0].image_url.endsWith('-O.jpg'), 'ML: coleta entrega a oferta à fila de revisão (fonte API, preço anterior da API, imagem https)');
ok(db.runs.at(-1).status === 'success' && db.runs.at(-1).accepted === 1, 'ML: execução registrada com resultado');
j = job('integration', null, { provider: 'mercadolivre', action: 'collect' }); await W.runJobs(ctx);
ok(j.result.created === 0 && j.result.duplicates === 1, 'ML: segunda coleta não duplica a oferta');
db.offers = []; db.connectors.mercadolivre.config.min_score = 90; db.score = 60;
j = job('integration', null, { provider: 'mercadolivre', action: 'collect' }); await W.runJobs(ctx);
ok(j.result.created === 0 && j.result.low_score === 1 && db.rejectedOffers.length === 1, 'ML: oferta abaixo do score mínimo é rejeitada automaticamente');
delete db.connectors.mercadolivre.config.min_score; db.score = 80; db.offers = [];
db.connectors.mercadolivre.config.link_template = '{url}?matt_tool=lucas';
j = job('integration', null, { provider: 'mercadolivre', action: 'collect' }); await W.runJobs(ctx);
ok(db.offers[0].affiliate_url === 'https://produto.mercadolivre.com.br/MLB-1-fone?matt_tool=lucas', 'ML: link de afiliado montado pelo modelo configurado');
delete db.connectors.mercadolivre.config.link_template; db.offers = [];
// renovação automática do token (expira em < 5 min)
db.secrets.ml_token_expires_at = String(Math.floor(Date.now() / 1000) + 60); const oldRef = db.secrets.ml_refresh_token;
j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.result.connected === true && mlState.refreshCalls === 1 && db.secrets.ml_refresh_token !== oldRef && db.secrets.ml_refresh_token === mlState.refresh, 'ML: token perto de vencer é renovado e o novo refresh_token é guardado');
// refresh_token inválido: pede para conectar de novo
db.secrets.ml_token_expires_at = '1'; db.secrets.ml_refresh_token = 'invalido' + rnd(10);
j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === false && /Conecte a conta de novo/.test(j.result.error) && db.status.mercadolivre.ok === false, 'ML: renovação recusada vira aviso para reconectar');
db.secrets.ml_refresh_token = mlState.refresh; db.secrets.ml_access_token = mlState.access; db.secrets.ml_token_expires_at = String(Math.floor(Date.now() / 1000) + 3600);
mlState.searchStatus = 403; mlState.catalog = true; j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === true && !j.result.partial && j.result.sample && j.result.sample.length === 1, 'ML: busca 403 cai no catálogo e devolve a amostra');
ok(j.result.sample[0].price === 90 && j.result.sample[0].title === 'Fone Catálogo Bluetooth', 'ML catálogo: usa a menor oferta NOVA (ignora a usada mais barata do que o preço cheio)');
ok(mlState.catalogCalls === 1, 'ML catálogo: uma consulta de busca por verificação');
mlState.catalog = false;
j = job('integration', null, { provider: 'mercadolivre', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === true && j.result.partial === true && /40[34]/.test(j.result.search_error), 'ML: busca e catálogo bloqueados viram "atenção" explicando o erro');
j = job('integration', null, { provider: 'mercadolivre', action: 'collect' }); await W.runJobs(ctx);
ok(j.status === 'failed' && db.runs.at(-1).status === 'error', 'ML: falha na coleta registra execução com erro');
mlState.searchStatus = 200;
j = job('integration', null, { provider: 'mercadolivre', action: 'disconnect' }); await W.runJobs(ctx);
ok(j.result.disconnected === true && !db.secrets.ml_access_token && !db.secrets.ml_refresh_token && db.status.mercadolivre.connected === false, 'ML: desconectar apaga os tokens do cofre');

db.connectors.shopee = { mode: 'api_ready', config: { app_id: 'APP1', api_endpoint: shopee.url, min_discount_pct: 10, keywords: ['caixa de som'] } };
j = job('integration', null, { provider: 'shopee', action: 'check' }); await W.runJobs(ctx);
ok(j.result.connected === true && j.result.sample[0].commission_pct === 12 && j.result.account.report.commission === 20 && j.result.account.report.conversions === 2, 'Shopee: teste devolve amostra com comissão e o relatório de 30 dias');
j = job('integration', null, { provider: 'shopee', action: 'collect' }); await W.runJobs(ctx);
ok(j.result.created === 1 && db.offers.at(-1).affiliate_url === 'https://s.shopee.com.br/abc' && db.offers.at(-1).external_id === '9.55' && db.offers.at(-1).previous_price === 150, 'Shopee: oferta entra com o link rastreado da própria API e o preço anterior derivado do desconto');
ok(db.offers.at(-1).evidence.preco_anterior_derivado === true && db.offers.at(-1).evidence.comissao_pct === 12, 'Shopee: evidência registra que o preço anterior foi derivado e a comissão');
ok(spState.queries.every((q) => !q.includes('$')), 'Shopee: consultas sem variáveis (não dependem de nomes de tipos do schema)');

// coleta automática
db.offers = []; db.runs = []; db.connectors.mercadolivre.mode = 'disabled'; db.connectors.shopee.config.poll_minutes = 60; delete db.connectors.shopee.last_run_at;
let col = await W.runCollectors(ctx);
ok(/1 nova/.test(col.shopee || '') && db.runs.length === 1, 'coleta automática: conector api_ready sem execução recente coleta');
db.connectors.shopee.last_run_at = new Date().toISOString(); db.runs = [];
col = await W.runCollectors(ctx);
ok(Object.keys(col).length === 0 && db.runs.length === 0, 'coleta automática: respeita o intervalo (poll_minutes)');
db.connectors.shopee.last_run_at = new Date(Date.now() - 2 * 3600000).toISOString(); db.connectors.shopee.mode = 'manual_only';
col = await W.runCollectors(ctx);
ok(Object.keys(col).length === 0, 'coleta automática: só roda em modo "API pronta"');
db.connectors.shopee.mode = 'api_ready';
db.secrets.shopee_secret = 'errado' + rnd(20); db.connectors.shopee.last_run_at = undefined;
col = await W.runCollectors(ctx);
ok(/erro/.test(col.shopee) && db.runs.at(-1).status === 'error', 'coleta automática: credencial recusada registra execução com erro');
db.secrets.shopee_secret = SP_SECRET;
ok(W.selectOffers([{ external_id: 'a', url: 'u', title: 't', price: 10, previous: 20 }], { min_discount_pct: 60 }, 5).skip.sem_desconto === 1, 'filtro: desconto mínimo exige preço anterior comprovado');

/* ---------- AliExpress, Amazon (Creators API) e Magalu ---------- */
console.log('\n— novas plataformas —');
ok(W.hmacSha256Hex('chave', 'mensagem ação ✓') === crypto.createHmac('sha256', 'chave').update('mensagem ação ✓').digest('hex'), 'HMAC-SHA256 puro confere com o do Node');
ok(W.hmacSha256Hex('k'.repeat(100), 'x') === crypto.createHmac('sha256', 'k'.repeat(100)).update('x').digest('hex'), 'HMAC com chave maior que o bloco confere');
db.offers = []; db.runs = [];
db.connectors.aliexpress = { mode: 'api_ready', config: { app_id: 'ALIKEY1', api_endpoint: ali.url, tracking_id: 'trk1', min_discount_pct: 20, keywords: ['fone'] } };
db.secrets.aliexpress_app_secret = 'errado' + rnd(20);
j = job('integration', null, { provider: 'aliexpress', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /IncompleteSignature/.test(j.error) && !j.error.includes(AL_SECRET), 'AliExpress: assinatura errada é explicada sem vazar segredo');
db.secrets.aliexpress_app_secret = AL_SECRET;
j = job('integration', null, { provider: 'aliexpress', action: 'check' }); await W.runJobs(ctx);
ok(j.result.connected === true && j.result.sample[0].commission_pct === 7.5 && j.result.sample[0].discount_pct === 50, 'AliExpress: assinatura HMAC aceita e amostra com comissão');
ok(alState.calls.at(-1).sign_method === 'sha256' && alState.calls.at(-1).target_currency === 'BRL' && alState.calls.at(-1).ship_to_country === 'BR' && alState.calls.at(-1).tracking_id === 'trk1', 'AliExpress: pede preços em BRL para o Brasil com o tracking id');
j = job('integration', null, { provider: 'aliexpress', action: 'collect' }); await W.runJobs(ctx);
ok(j.result.created === 1 && db.offers[0].affiliate_url === 'https://s.click.aliexpress.com/e/_abc' && db.offers[0].original_url === 'https://pt.aliexpress.com/item/1005001.html' && db.offers[0].previous_price === 79.8 && db.offers[0].source_name === 'AliExpress Affiliate API', 'AliExpress: oferta entra com link de afiliado da própria API');
db.connectors.aliexpress.config = { app_id: 'ALIKEY1', api_endpoint: ali.url };
j = job('integration', null, { provider: 'aliexpress', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === false && /Tracking ID/.test(j.result.error), 'AliExpress: sem Tracking ID pede para informar');

db.offers = []; db.runs = [];
db.connectors.amazon = { mode: 'api_ready', config: { client_id: 'CRED1', partner_tag: 'lucas-20', marketplace: 'www.amazon.com.br', credential_version: '3.1', min_discount_pct: 20, keywords: ['echo dot'] } };
db.secrets.amazon_client_secret = 'errado' + rnd(20);
j = job('integration', null, { provider: 'amazon', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /recusou as credenciais/.test(j.error), 'Amazon: credencial recusada é explicada');
db.secrets.amazon_client_secret = AMZ_SECRET;
j = job('integration', null, { provider: 'amazon', action: 'check' }); await W.runJobs(ctx);
ok(j.result.connected === true && j.result.account.id === 'lucas-20' && j.result.sample.length === 1 && j.result.sample[0].discount_pct === 44.45, 'Amazon: OAuth aceito e amostra (itens sem oferta são ignorados)');
ok(amzState.searches.at(-1).mkt === 'www.amazon.com.br' && amzState.searches.at(-1).body.partnerTag === 'lucas-20' && amzState.searches.at(-1).body.minSavingPercent === 20 && amzState.searches.at(-1).body.resources.includes('offersV2.listings.price'), 'Amazon: consulta leva loja, tag, desconto mínimo e recursos de preço');
j = job('integration', null, { provider: 'amazon', action: 'collect' }); await W.runJobs(ctx);
ok(j.result.created === 1 && db.offers[0].affiliate_url.includes('tag=lucas-20') && db.offers[0].original_url === 'https://www.amazon.com.br/dp/B0TEST0001' && db.offers[0].previous_price === 449.9 && db.offers[0].external_id === 'B0TEST0001', 'Amazon: oferta entra com o link que já traz a tag de associado e o preço de referência da API');
db.connectors.amazon.config.credential_version = '9.9';
j = job('integration', null, { provider: 'amazon', action: 'check' }); await W.runJobs(ctx);
ok(j.status === 'failed' && /Versão da credencial/.test(j.error), 'Amazon: versão de credencial inválida é explicada');
db.connectors.amazon.config = { partner_tag: 'lucas-20' };
j = job('integration', null, { provider: 'amazon', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === false && /Credential ID/.test(j.result.error), 'Amazon: campos faltando são listados');

db.connectors.magalu = { mode: 'manual_only', config: {} };
j = job('integration', null, { provider: 'magalu', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === false, 'Magalu: sem ID ou modelo de link pede o preenchimento');
db.connectors.magalu.config = { affiliate_id: 'lucas' };
j = job('integration', null, { provider: 'magalu', action: 'check' }); await W.runJobs(ctx);
ok(j.result.ok === true && j.result.partial === true && /API pública/.test(j.result.detail), 'Magalu: avisa com franqueza que a entrada é manual');
j = job('integration', null, { provider: 'magalu', action: 'collect' }); await W.runJobs(ctx);
ok(j.status === 'failed', 'Magalu: coleta automática não existe');

/* ---------- Fases 1 a 6: revalidação, Radar, acompanhamento, automação, comissões e alertas ---------- */
console.log('\n— fases 1 a 6 —');
db.connectors.shopee = { mode: 'api_ready', config: { app_id: 'APP1', api_endpoint: shopee.url, min_discount_pct: 10, keywords: ['caixa de som'] } };
db.secrets.shopee_secret = SP_SECRET; db.telegram.enabled = true; tgs.mode = 'ok';
const sendCtx = { offer_id: 'o1', platform: 'shopee', external_id: '9.55', current_price: 74, revalidated_at: null, short_code: null, sub_id: 'gabc', original_url: 'https://shopee.com.br/produto-i.9.55', affiliate_url: 'https://s.shopee.com.br/abc' };
db.pubCtx = { ...sendCtx, publication_id: 'p1' }; db.pubResults = []; tgs.sent = []; db.reprices = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); let rs = await W.runSender(ctx, { budgetMs: 60000 });
ok(rs.sent === 1 && rs.repriced === 0 && db.revalidated.length === 1 && tgs.sent.length === 1, 'revalidação: oscilação pequena (1,4%) segue para o envio e marca como revalidada');
db.pubCtx = { ...sendCtx, publication_id: 'p2', current_price: 100 }; tgs.sent = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); rs = await W.runSender(ctx, { budgetMs: 60000 });
ok(rs.repriced === 1 && rs.sent === 0 && tgs.sent.length === 0 && db.reprices[0].p_price === 75 && db.reprices[0].p_available === true && /Preço mudou/.test(db.reprices[0].p_note), 'revalidação: preço mudou 25%: NÃO envia, devolve a oferta para revisão com o preço novo');
db.pubCtx = { ...sendCtx, publication_id: 'p3', external_id: '9.999' }; tgs.sent = []; db.reprices = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); rs = await W.runSender(ctx, { budgetMs: 60000 });
ok(rs.sent === 1 && db.reprices.length === 0, 'revalidação: produto não encontrado na API não bloqueia o envio');
db.pubCtx = { ...sendCtx, publication_id: 'p4', revalidated_at: new Date().toISOString(), current_price: 10 }; tgs.sent = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); rs = await W.runSender(ctx, { budgetMs: 60000 });
ok(rs.sent === 1 && rs.repriced === 0, 'revalidação: oferta checada há pouco não é consultada de novo');
// link por destino
db.connectors.amazon = { mode: 'api_ready', config: { client_id: 'CRED1', partner_tag: 'lucas-20', marketplace: 'www.amazon.com.br', credential_version: '3.1' } }; db.secrets.amazon_client_secret = AMZ_SECRET;
db.pubCtx = { offer_id: 'o2', publication_id: 'p5', platform: 'amazon', external_id: 'B0TEST0001', current_price: 249.9, revalidated_at: null, short_code: 'abc12345', sub_id: 'g1x', original_url: 'https://www.amazon.com.br/dp/B0TEST0001', affiliate_url: 'https://www.amazon.com.br/dp/B0TEST0001?tag=lucas-20' };
db.shortTargets = []; pub({ channel: 'telegram', external_chat_id: '-100' }); rs = await W.runSender(ctx, { budgetMs: 60000 });
ok(rs.sent === 1 && db.shortTargets[0].p_url.includes('tag=lucas-20') && db.shortTargets[0].p_url.includes('ascsubtag=g1x'), 'link por destino (Amazon): acrescenta o subtag do destino ao link curto');
db.pubCtx = { ...sendCtx, publication_id: 'p6', current_price: 75, short_code: 'abc12345' }; db.shortTargets = [];
pub({ channel: 'telegram', external_chat_id: '-100' }); rs = await W.runSender(ctx, { budgetMs: 60000 });
ok(rs.sent === 1 && db.shortTargets[0].p_url === 'https://s.shopee.com.br/sub1', 'link por destino (Shopee): gera o link curto com o subId do destino');
db.pubCtx = null;
// freio quando o WhatsApp limita
evo.mode = 'rate'; db.pubResults = [];
pub({ channel: 'whatsapp', external_chat_id: 'a@g.us' }); pub({ channel: 'whatsapp', external_chat_id: 'b@g.us' });
evo.mode = 'ok';
db.pubs = db.pubs.slice(-0);

// ---- Radar: funções puras
ok(W.extractUrls('Olha https://s.shopee.com.br/abc, e https://a.co/x. fim').join('|') === 'https://s.shopee.com.br/abc|https://a.co/x', 'radar: extrai links ignorando pontuação final');
ok(W.identifyProduct('https://produto.mercadolivre.com.br/MLB-3456789012-fone-bluetooth')?.external_id === 'MLB3456789012', 'radar: identifica produto do Mercado Livre');
ok(W.identifyProduct('https://shopee.com.br/Fone-i.9.55?sp=1')?.external_id === '9.55' && W.identifyProduct('https://shopee.com.br/product/9/55')?.external_id === '9.55', 'radar: identifica produto da Shopee (dois formatos)');
ok(W.identifyProduct('https://www.amazon.com.br/Echo/dp/B0TEST0001/ref=x')?.external_id === 'B0TEST0001', 'radar: identifica ASIN da Amazon');
ok(W.identifyProduct('https://pt.aliexpress.com/item/1005001.html')?.external_id === '1005001', 'radar: identifica produto da AliExpress');
ok(W.identifyProduct('https://exemplo.com/produto') === null, 'radar: ignora loja desconhecida');
{ const pr = W.parsePrices('De R$ 1.299,90 por R$ 899,90 no pix'); ok(pr.price === 899.9 && pr.previous === 1299.9, 'radar: lê "de/por" em reais do texto'); }
{ const b = W.mapTelegramUpdate({ message: { message_id: 1, chat: { id: -100, type: 'supergroup', title: 'Fonte' }, text: 'Oferta boa', entities: [{ type: 'text_link', url: 'https://s.shopee.com.br/oculto' }], reply_markup: { inline_keyboard: [[{ text: 'Comprar', url: 'https://amzn.to/xyz' }]] }, date: 1760000000 } });
  ok(/shopee\.com\.br\/oculto/.test(b.body) && /amzn\.to\/xyz/.test(b.body), 'telegram: links escondidos em texto e botões entram no texto capturado'); }

// ---- Radar: resolução de encurtadores (domínios injetados) e fluxo completo
const shortSrv = await listen(async (req, res) => {
  if (req.url === '/s1') { res.writeHead(302, { location: 'https://shopee.com.br/Produto-i.9.55' }); return res.end(); }
  if (req.url === '/s2') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><a href="https://www.amazon.com.br/dp/B0TEST0001?tag=outro">x</a></html>'); }
  if (req.url === '/s3') { res.writeHead(302, { location: 'https://exemplo-malicioso.com/x' }); return res.end(); }
  if (req.url === '/s4') { res.writeHead(302, { location: 'https://www.magazineluiza.com.br/tv/p/237578300/et/' }); return res.end(); }
  if (req.url === '/s5') { res.writeHead(302, { location: 'https://shopee.com.br/Outro-i.9.999' }); return res.end(); }
  send(res, 404, {});
});
let rl = await W.resolveLink(ctx, shortSrv.url + '/s1');
ok(rl.platform === 'shopee' && rl.external_id === '9.55', 'radar: segue o encurtador até a loja');
rl = await W.resolveLink(ctx, shortSrv.url + '/s2'); ok(rl.platform === 'amazon' && rl.external_id === 'B0TEST0001', 'radar: acha a loja no HTML quando o encurtador não redireciona');
rl = await W.resolveLink(ctx, shortSrv.url + '/s3'); ok(!rl.platform && /exemplo-malicioso/.test(rl.final_url), 'radar: destino desconhecido não vira oferta (e não é visitado)');
const cacheKeys = Object.keys(db.linkCache).length; await W.resolveLink(ctx, shortSrv.url + '/s1'); ok(Object.keys(db.linkCache).length === cacheKeys, 'radar: resultado vem do cache na segunda vez');
{ const hostile = { ...ctx, followHost: undefined }; const r2 = await W.resolveLink(hostile, 'http://127.0.0.1:1/x'); ok(!r2.platform, 'radar: domínio fora da lista nunca é acessado (anti-SSRF)'); }

const src = { id: 'src1', mode: 'review', platforms: [], blocked_words: ['réplica'], min_discount_pct: null, max_per_hour: 20, created_last_hour: 0 };
const mkMsg = (body, extra = {}) => ({ id: crypto.randomUUID(), body, chat_title: 'Fonte A', channel: 'telegram', source: { ...src, ...extra } });
const runMsg = async (m, state = { created: {} }) => { db.captured = []; db.offers = []; db.sources = []; db.signals = []; const rt = await (async () => JSON.parse(JSON.stringify(await rpc('get_integration_runtime', {}))))(); return { r: await W.processRadarMessage(ctx, rt, m, state), state }; };
let o = await runMsg(mkMsg('Caixa de som top! ' + shortSrv.url + '/s1 por R$ 75,00'));
ok(o.r[0] === 'created' && db.offers.length === 1 && db.captured[0].status === 'offer_created', 'radar: promoção do grupo vira oferta na fila');
ok(db.offers[0].affiliate_url === 'https://s.shopee.com.br/abc' && db.offers[0].source_layer === 'C' && /Radar: Fonte A/.test(db.offers[0].source_name) && db.offers[0].source_kind === 'api', 'radar: usa o SEU link de afiliado (da API), camada C e origem do grupo');
ok(db.offers[0].price === 75 && db.offers[0].previous_price === 150 && db.offers[0].title === 'Caixa de Som', 'radar: preço e título vêm da API da loja, não do texto');
ok(db.offers[0].evidence.fonte === 'Fonte A' && db.sources.length === 1 && db.signals[0].p_commission === 12 && db.signals[0].p_auto_ok === false, 'radar: registra a fonte, a comissão e não aprova sozinho no modo revisão');
o = await runMsg(mkMsg(shortSrv.url + '/s1', { mode: 'auto' })); ok(db.signals[0].p_auto_ok === true, 'radar: fonte em modo automático marca a oferta como elegível à aprovação automática');
o = await runMsg(mkMsg('Caixa de som RÉPLICA ' + shortSrv.url + '/s1')); ok(o.r[0] === 'created', 'radar: palavra bloqueada só vale se estiver no título da loja');
o = await runMsg(mkMsg(shortSrv.url + '/s1', { blocked_words: ['caixa'] })); ok(o.r[0] === 'filtered' && /Palavra bloqueada/.test(db.captured[0].reason) && db.offers.length === 0, 'radar: palavra bloqueada recusa a oferta');
o = await runMsg(mkMsg(shortSrv.url + '/s1', { platforms: ['amazon'] })); ok(o.r[0] === 'filtered' && /fora das aceitas/.test(db.captured[0].reason), 'radar: loja fora das aceitas pela fonte é recusada');
o = await runMsg(mkMsg('de R$ 100 por R$ 40 ' + shortSrv.url + '/s1')); ok(o.r[0] === 'filtered' && /acima do anunciado/.test(db.captured[0].reason), 'radar: preço atual maior que o anunciado = promoção encerrada, não publica');
o = await runMsg(mkMsg(shortSrv.url + '/s1', { min_discount_pct: 70 })); ok(o.r[0] === 'filtered' && /Desconto comprovado abaixo/.test(db.captured[0].reason), 'radar: respeita o desconto mínimo da fonte');
o = await runMsg(mkMsg(shortSrv.url + '/s5')); ok(o.r[0] === 'ineligible' && /programa de afiliados/.test(db.captured[0].reason), 'radar: produto que não está no seu programa é descartado (nunca usa o link de terceiros)');
o = await runMsg(mkMsg(shortSrv.url + '/s4')); ok(o.r[0] === 'ineligible' && /Magalu/.test(db.captured[0].reason), 'radar: Magalu (sem API) é descartada com motivo claro');
o = await runMsg(mkMsg(shortSrv.url + '/s3')); ok(o.r[0] === 'ignored', 'radar: link que não é de loja é ignorado');
o = await runMsg(mkMsg(shortSrv.url + '/s1', { created_last_hour: 20 })); ok(o.r[0] === 'filtered' && /Limite por hora/.test(db.captured[0].reason), 'radar: limite por hora da fonte é respeitado');
db.connectors.shopee.mode = 'disabled'; o = await runMsg(mkMsg(shortSrv.url + '/s1')); ok(o.r[0] === 'ineligible' && /desligado/.test(db.captured[0].reason), 'radar: conector desligado não gera oferta'); db.connectors.shopee.mode = 'api_ready';
o = await runMsg(mkMsg(shortSrv.url + '/s1')); db.offers.push({ ...db.offers[0] }); // simula a mesma oferta já na fila
o = await (async () => { db.captured = []; const rt = JSON.parse(JSON.stringify(await rpc('get_integration_runtime', {}))); const r = await W.processRadarMessage(ctx, rt, mkMsg(shortSrv.url + '/s1'), { created: {} }); return { r }; })();
ok(o.r[0] === 'duplicate' && db.captured[0].status === 'duplicate', 'radar: mesmo produto em outra fonte vira "duplicada" (soma como sinal de oferta quente)');
// fila completa
db.offers = []; db.captured = [];
db.radarQueue = [mkMsg('A ' + shortSrv.url + '/s1'), mkMsg('B ' + shortSrv.url + '/s3'), mkMsg('sem link nenhum ainda')];
{ const r = await W.runRadar(ctx, { max: 10 }); ok(r.messages === 3 && r.created === 1 && r.ignored === 1, 'radar: processa a fila (1 oferta, 1 ignorado)'); }
ok((await W.runRadar(ctx)).messages === 0, 'radar: fila vazia não faz nada');
// teste manual de link pelo painel
db.jobs = []; j = job('integration', null, { provider: 'worker', action: 'radar_test', url: shortSrv.url + '/s1' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.ok === true && j.result.steps.length === 3 && j.result.steps.every((x) => x.ok) && j.result.item.title === 'Caixa de Som', 'painel: "Testar link" mostra cada etapa e o produto');
j = job('integration', null, { provider: 'worker', action: 'radar_test', url: shortSrv.url + '/s3' }); await W.runJobs(ctx);
ok(j.status === 'done' && j.result.ok === false && j.result.steps[0].ok === false, 'painel: "Testar link" explica quando não é link de loja');
shortSrv.s.close();

// ---- Fase 1/2: produtos acompanhados, termos, ordenação
db.offers = []; db.watchUpdates = [];
db.watch = [{ id: 'w1', platform: 'shopee', external_id: '9.55', url: 'https://shopee.com.br/x-i.9.55', title: null, target_price: null, min_drop_pct: 10, last_price: 100 }, { id: 'w2', platform: 'shopee', external_id: '9.999', url: 'x', min_drop_pct: 10, last_price: 50 }];
{ const r = await W.runWatchlist(ctx);
  ok(r.checked === 2 && r.offers === 1 && db.offers.length === 1 && db.offers[0].previous_price === 100 && db.offers[0].source_name === 'Produto acompanhado', 'acompanhamento: queda de 25% vira oferta com o último preço como referência');
  ok(db.watchUpdates.find((u) => u.p_id === 'w1').p_offer === true && db.watchUpdates.find((u) => u.p_id === 'w1').p_price === 75 && db.watchUpdates.find((u) => u.p_id === 'w2').p_offer === false, 'acompanhamento: atualiza o último preço e marca quando gerou oferta'); }
ok(W.selectOffers([{ external_id: 'a', url: 'u', title: 't', price: 10, previous: 20, commission_pct: 3 }, { external_id: 'b', url: 'u', title: 't', price: 10, previous: 12, commission_pct: 12 }], { sort_by: 'commission' }, 5).list[0].external_id === 'b', 'coleta: ordena por comissão quando configurado');
db.connectors.mercadolivre = { mode: 'api_ready', config: { app_id: '111', categories: ['eletronicos'] } };
{ const rt2 = JSON.parse(JSON.stringify(await rpc('get_integration_runtime', {}))); rt2.search_terms = { eletronicos: ['meu termo 1', 'meu termo 2'] };
  const tf = await W.termsForRt(ctx, rt2, 'shopee', { categories: ['eletronicos'] }); ok(tf.map((x) => x.q).join('|') === 'meu termo 1|meu termo 2', 'termos de busca: usa os termos editados no painel em vez dos padrões'); }

// ---- Fase 4/5/6: automação, comissões, alertas, limpeza
db.autoApproved = 2; { const r = await W.runAutomation(ctx); ok(r.auto.approved === 2, 'automação: executa a aprovação automática e a expiração'); }
db.commissions = []; { const r = await W.runCommissionSync(ctx); ok(r.synced === 2 && db.commissions[0].sub_id === 'gabc' && db.commissions[0].external_ref === 'cv1' && db.commissions[0].amount === 12.5, 'comissões: sincroniza o relatório da Shopee com o subId'); }
{ const r = await W.runCommissionSync(ctx); ok(r.skipped === 'intervalo', 'comissões: respeita o intervalo entre sincronizações'); }
{ const r = await W.runHousekeeping(ctx); ok(r && r.ok === true, 'limpeza: roda na primeira vez'); ok((await W.runHousekeeping(ctx)) === null, 'limpeza: não repete antes do intervalo'); }
db.snapshot = { pending_old: 2, unknown: 0, failed_24h: 0, review_waiting: 25, destinations_enabled: 1, collect_errors: [{ platform: 'shopee', error: 'assinatura' }] };
tgs.sent = []; { const r = await W.runAlerts(ctx);
  ok(r.fired.includes('pending_old') && r.fired.includes('collect') && r.fired.includes('review') && tgs.sent.some((m) => /aguardando há mais de 45 min/.test(m.text)), 'alertas: fila parada, coleta com erro e fila grande avisam o administrador'); }
tgs.sent = []; { const r = await W.runAlerts(ctx); ok(r.fired.length === 0 && tgs.sent.length === 0, 'alertas: o mesmo problema não repete dentro do intervalo'); }
db.snapshot = { pending_old: 0, unknown: 0, failed_24h: 0, review_waiting: 0, destinations_enabled: 1, collect_errors: [] }; await W.runAlerts(ctx);
ok(!db.alertSent.pending_old, 'alertas: problema resolvido limpa o estado (avisa de novo se voltar)');

/* ---------- Conexão gerenciada pelo servidor (worker.env): o painel não pede endereço, instância nem chave ---------- */
console.log('\n— conexão gerenciada —');
const MGD = { evolution: { base_url: evoSrv.url, instance: 'central', api_key: EVO_KEY, webhook_url: 'http://promo-worker:8787/hook/whatsapp-abc' },
  telegram: { bot_token: TG_TOKEN, webhook_url: 'https://worker.exemplo.com/hook/telegram-abc', webhook_secret: 'S'.repeat(48) } };
const mctx = { ...ctx, managed: MGD };
const keep = { ev: db.evolution, tg: db.telegram, sec: db.secrets };
db.evolution = { send_delay_min_s: 1, send_delay_max_s: 1, alerts: true }; db.telegram = { enabled: false, mode: 'polling', alerts: true };
db.secrets = { ...db.secrets }; delete db.secrets.evolution_api_key; delete db.secrets.telegram_bot_token; delete db.secrets.telegram_webhook_secret;
db.jobs = []; evo.state = 'close'; evo.webhook = null;
j = job('integration', 'whatsapp', { provider: 'evolution', action: 'status' }); await W.runJobs(mctx);
ok(j.status === 'done' && j.result.state === 'close' && j.result.managed.api_key === true && j.result.managed.base_url === true && j.result.managed.instance === true, 'gerenciado: status usa endereço, instância e chave do servidor (banco vazio)');
ok(evo.webhook && evo.webhook.url === MGD.evolution.webhook_url && j.result.webhook_fixed === true && j.result.webhook.matches === true, 'gerenciado: o webhook da Evolution é corrigido sozinho para o endereço interno do worker');
ok(!JSON.stringify(j.result).includes(EVO_KEY), 'gerenciado: a chave nunca aparece no resultado');
j = job('integration', 'whatsapp', { provider: 'evolution', action: 'connect_poll' }); await W.runJobs(mctx);
ok(j.status === 'done' && j.result.state === 'connecting' && /^data:image\//.test(j.result.qr), 'QR ao vivo: desconectado devolve o QR code para o painel mostrar');
j = job('integration', 'whatsapp', { provider: 'evolution', action: 'connect_poll', pairing_number: '5511999990001' }); await W.runJobs(mctx);
ok(j.result.pairing_code === 'ABCD-1234', 'QR ao vivo: também devolve o código de pareamento (conectar sem câmera)');
evo.state = 'open'; db.jobs = [];
j = job('integration', 'whatsapp', { provider: 'evolution', action: 'connect_poll' }); await W.runJobs(mctx);
ok(j.result.state === 'open' && j.result.phone === '5511999990001' && !j.result.qr, 'QR ao vivo: depois de ler o QR devolve "conectado" com o número');
ok(db.status.evolution.state === 'open' && db.status.evolution.managed.api_key === true, 'QR ao vivo: grava o estado conectado para o painel');
evo.state = 'close';

j = job('integration', 'telegram', { provider: 'telegram', action: 'connect' }); await W.runJobs(mctx);
ok(j.status === 'done' && j.result.connected === true && j.result.bot_username === 'central_bot', 'Telegram: "Conectar" confere o bot com o token do servidor');
ok(tgs.webhook && tgs.webhook.url === MGD.telegram.webhook_url && tgs.webhook.secret_token === 'S'.repeat(48), 'Telegram: registra o webhook público com o segredo derivado (sem digitar nada)');
ok(JSON.stringify(db.savedInt.at(-1).p_config) === JSON.stringify({ enabled: true, mode: 'webhook', webhook_url: MGD.telegram.webhook_url }), 'Telegram: deixa o bot ativo e em modo webhook no banco');
ok(db.status.telegram.managed.token === true && db.status.telegram.managed.webhook === true, 'Telegram: o painel sabe que o token vem do servidor');
{ const w1 = await W.handleTelegramWebhook(mctx, { 'x-telegram-bot-api-secret-token': 'S'.repeat(48) }, { update_id: 1, message: { message_id: 1, chat: { id: -1, type: 'group', title: 'G' }, text: 'oi', date: 1760000000 } });
  const w2 = await W.handleTelegramWebhook(mctx, { 'x-telegram-bot-api-secret-token': 'outro' + 'x'.repeat(30) }, { update_id: 2 });
  ok(w1.ok === true && w2.status === 401, 'Telegram: o webhook aceita só o segredo derivado do servidor'); }
{ const noPub = { ...mctx, managed: { ...MGD, telegram: { ...MGD.telegram, webhook_url: '' } } }; tgs.webhook = { url: 'https://velho.exemplo.com/x' };
  j = job('integration', 'telegram', { provider: 'telegram', action: 'connect' }); await W.runJobs(noPub);
  ok(j.status === 'done' && tgs.webhook === null && db.savedInt.at(-1).p_config.mode === 'polling', 'Telegram: sem endereço público usa consulta (polling) e remove webhook antigo'); }
{ const semToken = { ...ctx, managed: { evolution: {}, telegram: {} } }; db.jobs = [];
  j = job('integration', 'telegram', { provider: 'telegram', action: 'connect' }); await W.runJobs(semToken);
  ok(j.status === 'failed' && /TELEGRAM_BOT_TOKEN/.test(j.error), 'Telegram: sem token em lugar nenhum explica onde colocar'); }
db.evolution = keep.ev; db.telegram = keep.tg; db.secrets = keep.sec; db.jobs = [];

for (const s of [evoSrv, tgSrv, ml, shopee, ali, amz]) s.s.close();
// ---- porteiro dos webhooks de entrada ----
const mkLimit = () => { const n = {}; return (key) => { n[key] = (n[key] || 0) + 1; return { ok: n[key] <= 120, retryAfter: 30 }; }; };
const gctx = () => ({ limits: { webhookPorMin: 120, corpoMaxKb: 256 }, limit: mkLimit() });
let g = W.guardWebhook(gctx(), 'telegram', { headers: {}, body: { update_id: 1 } });
ok(g.blocked === true && g.status === 401, 'porteiro Telegram: sem segredo é recusado (401) antes do banco');
g = W.guardWebhook(gctx(), 'telegram', { headers: { 'x-telegram-bot-api-secret-token': 'a'.repeat(32) }, body: { update_id: 1 } });
ok(g.blocked === false, 'porteiro Telegram: com cabeçalho passa para validação');
g = W.guardWebhook(gctx(), 'whatsapp', { headers: {}, body: { foo: 1 } });
ok(g.blocked === true && g.status === 400, 'porteiro WhatsApp: formato inválido é recusado (400)');
g = W.guardWebhook(gctx(), 'whatsapp', { headers: {}, body: { instance: 'a', event: 'x', lixo: 'x'.repeat(300 * 1024) } });
ok(g.blocked === true && g.status === 413, 'porteiro WhatsApp: corpo gigante é recusado (413)');
{ const c = gctx(); let last; for (let i = 0; i < 125; i++) last = W.guardWebhook(c, 'whatsapp', { headers: {}, body: { instance: 'a', event: 'messages.upsert' } });
  ok(last.blocked === true && last.status === 429, 'porteiro WhatsApp: acima de 120/min vira 429'); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES DO WORKER PASSARAM');
process.exit(fails ? 1 : 0);
