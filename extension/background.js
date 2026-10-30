// Coletor da Central de Promoções: de tempos em tempos abre, em segundo plano, as páginas do programa de afiliados
// (já logadas no seu Chrome), lê os produtos e envia para a Central. A Central só recebe produtos e links.
const SOURCES = {
  mercadolivre: { label: 'Mercado Livre', url: 'https://www.mercadolivre.com.br/afiliados/hub' },
  shopee: { label: 'Shopee', url: 'https://affiliate.shopee.com.br/offer/product_offer' },
};
const DEFAULTS = { workerUrl: '', token: '', everyMin: 180, perSource: 15, mercadolivre: true, shopee: true };

const getCfg = async () => ({ ...DEFAULTS, ...((await chrome.storage.local.get('cfg')).cfg || {}) });
const setStatus = (p) => chrome.storage.local.get('status').then((r) => chrome.storage.local.set({ status: { ...(r.status || {}), ...p } }));

async function schedule() {
  const cfg = await getCfg(); await chrome.alarms.clear('coletar');
  if (cfg.workerUrl && cfg.token && cfg.everyMin >= 15) chrome.alarms.create('coletar', { periodInMinutes: Number(cfg.everyMin), delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'coletar') void runAll(); });
chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg && msg.cmd === 'schedule') { schedule().then(() => send({ ok: true })); return true; }
  if (msg && msg.cmd === 'runNow') { runAll(msg.only).then((r) => send(r)); return true; }
});

const waitComplete = (tabId, ms = 40000) => new Promise((resolve) => {
  const done = (ok) => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(ok); };
  const on = (id, info) => { if (id === tabId && info.status === 'complete') done(true); };
  const t = setTimeout(() => done(false), ms); chrome.tabs.onUpdated.addListener(on);
  chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') done(true); }).catch(() => done(false));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(cfg, body) {
  const base = cfg.workerUrl.replace(/\/+$/, '');
  const r = await fetch(base + '/ingest/browser', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-token': cfg.token }, body: JSON.stringify(body) });
  let data = {}; try { data = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 401) throw new Error('Token recusado: gere um novo na Central (Configurações → Coleta) e cole na extensão.');
  if (!r.ok) throw new Error('A Central respondeu HTTP ' + r.status);
  return data;
}

async function runSource(cfg, key) {
  const src = SOURCES[key]; const tab = await chrome.tabs.create({ url: src.url, active: false });
  try {
    if (!(await waitComplete(tab.id))) throw new Error('A página demorou demais para abrir.');
    await sleep(2500);
    let res; try { res = await chrome.tabs.sendMessage(tab.id, { cmd: 'collect', max: Number(cfg.perSource) || 15 }); }
    catch { throw new Error('A página não respondeu. Recarregue a extensão e confira se está logado.'); }
    if (!res || res.error) throw new Error(res && res.error === 'login' ? `Entre na sua conta do ${src.label} no Chrome e tente de novo.` : res && res.error === 'sem_produtos' ? 'Nenhum produto encontrado na página.' : (res && res.error) || 'Sem resposta da página.');
    if (!res.items.length) return { ok: true, lidos: res.lidos, enviados: 0 };
    const out = await post(cfg, { platform: res.platform, items: res.items });
    return { ok: true, lidos: res.lidos, enviados: res.items.length, links_novos: res.links_novos, ...out };
  } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}

let running = false;
async function runAll(only) {
  if (running) return { ok: false, error: 'Já existe uma coleta em andamento.' };
  running = true; const cfg = await getCfg(); const result = {};
  try {
    if (!cfg.workerUrl || !cfg.token) throw new Error('Informe o endereço do worker e o token.');
    try { const p = await post(cfg, { action: 'ping' }); if (p.paused) throw new Error('A Central está com o coletor desligado (Configurações → Coleta).'); } catch (e) { throw e; }
    for (const key of Object.keys(SOURCES)) {
      if (only && only !== key) continue; if (!only && !cfg[key]) continue;
      try { result[key] = await runSource(cfg, key); } catch (e) { result[key] = { ok: false, error: String((e && e.message) || e) }; }
      await sleep(3000);
    }
    await setStatus({ at: Date.now(), result, error: null });
    return { ok: true, result };
  } catch (e) { await setStatus({ at: Date.now(), result: null, error: String((e && e.message) || e) }); return { ok: false, error: String((e && e.message) || e) }; }
  finally { running = false; }
}
