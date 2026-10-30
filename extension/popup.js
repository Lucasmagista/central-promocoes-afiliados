const $ = (id) => document.getElementById(id);
const DEFAULTS = { workerUrl: '', token: '', everyMin: 180, perSource: 15, mercadolivre: true, shopee: true };
const msg = (t, cls = '') => { const m = $('msg'); m.textContent = t; m.className = cls; };

function describe(st) {
  if (!st || !st.at) return '';
  const when = new Date(st.at).toLocaleString('pt-BR');
  if (st.error) return `Última tentativa (${when}):\n${st.error}`;
  const lines = Object.entries(st.result || {}).map(([k, v]) => `${k === 'mercadolivre' ? 'Mercado Livre' : 'Shopee'}: ` + (v.ok === false ? `erro — ${v.error}` : `${v.enviados ?? 0} enviada(s), ${v.created ?? 0} nova(s), ${v.duplicates ?? 0} repetida(s)${v.warning ? ' — ' + v.warning : ''}`));
  return `Última coleta (${when}):\n` + lines.join('\n');
}

(async () => {
  const cfg = { ...DEFAULTS, ...((await chrome.storage.local.get('cfg')).cfg || {}) };
  $('workerUrl').value = cfg.workerUrl; $('token').value = cfg.token; $('everyMin').value = cfg.everyMin; $('perSource').value = cfg.perSource;
  $('mercadolivre').checked = !!cfg.mercadolivre; $('shopee').checked = !!cfg.shopee;
  const st = (await chrome.storage.local.get('status')).status; msg(describe(st), st && st.error ? 'err' : '');
})();

$('save').addEventListener('click', async () => {
  let url = $('workerUrl').value.trim().replace(/\/+$/, '');
  try { const u = new URL(url); if (u.protocol !== 'https:') throw new Error(); url = u.origin; } catch { return msg('Informe o endereço do worker com https://', 'err'); }
  const token = $('token').value.trim(); if (token.length < 20) return msg('Cole o token gerado na Central.', 'err');
  const granted = await chrome.permissions.request({ origins: [url + '/*'] }).catch(() => false);
  if (!granted) return msg('Sem permissão para falar com o worker. Clique em Salvar de novo e permita.', 'err');
  const cfg = { workerUrl: url, token, everyMin: Math.max(15, Number($('everyMin').value) || 180), perSource: Math.max(1, Math.min(Number($('perSource').value) || 15, 40)), mercadolivre: $('mercadolivre').checked, shopee: $('shopee').checked };
  await chrome.storage.local.set({ cfg }); await chrome.runtime.sendMessage({ cmd: 'schedule' }); msg('Salvo. A coleta automática está ligada.', 'ok');
});

$('now').addEventListener('click', async () => {
  $('now').disabled = true; msg('Coletando… isso leva alguns minutos. Pode fechar este quadro.');
  const r = await chrome.runtime.sendMessage({ cmd: 'runNow' }).catch((e) => ({ ok: false, error: String(e) }));
  $('now').disabled = false; const st = (await chrome.storage.local.get('status')).status; msg(r && r.ok === false ? r.error : describe(st), r && r.ok === false ? 'err' : 'ok');
});
