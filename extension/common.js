// Utilidades usadas pelos leitores de página (Mercado Livre e Shopee).
var Central = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => sleep(a + Math.random() * (b - a));
  async function waitFor(fn, timeoutMs = 5000, stepMs = 150) {
    const t0 = Date.now();
    for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) return null; await sleep(stepMs); }
  }
  // espera o próximo texto copiado pelo site (hook-main.js repassa por postMessage)
  function nextClip(timeoutMs = 6000) {
    return new Promise((resolve) => {
      const done = (v) => { window.removeEventListener('message', on); clearTimeout(t); resolve(v); };
      const on = (e) => { if (e.source === window && e.data && e.data.__central === 'clip') done(String(e.data.text || '')); };
      const t = setTimeout(() => done(''), timeoutMs); window.addEventListener('message', on);
    });
  }
  const money = (s) => { const m = /(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/.exec(String(s || '')); return m ? Number(m[1].replace(/\./g, '') + '.' + m[2]) : null; };
  const round2 = (n) => Math.round(n * 100) / 100;
  // cache dos links já gerados (evita criar link de novo toda vez): { id: { link, at } }
  async function cacheGet(key) { try { const r = await chrome.storage.local.get(key); return r[key] || {}; } catch { return {}; } }
  async function cacheSet(key, obj) {
    try { const cut = Date.now() - 14 * 86400000; const clean = Object.fromEntries(Object.entries(obj).filter(([, v]) => v && v.at > cut).slice(-600)); await chrome.storage.local.set({ [key]: clean }); } catch { /* sem cache */ }
  }
  return { sleep, jitter, waitFor, nextClip, money, round2, cacheGet, cacheSet };
})();
