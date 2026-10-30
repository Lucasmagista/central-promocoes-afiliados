// Shopee — portal de afiliados, página "Oferta de produto" (https://affiliate.shopee.com.br/offer/product_offer).
// Cada card mostra nome, preço, selo de desconto, vendas e taxa de comissão; "Obter link" abre o link de afiliado (s.shopee.com.br).
(() => {
  if (window.__centralShopee) return; window.__centralShopee = true;
  const CARD = '.ItemCard__container';

  function parseCard(card) {
    const txt = card.innerText.replace(/\s+/g, ' ');
    const name = card.querySelector('.ItemCard__name'); const title = name ? name.textContent.trim() : '';
    const off = /(\d{1,2})%\s*OFF/i.exec(txt); const price = Central.money(txt.slice(txt.indexOf('R$')));
    const com = /Taxa de comiss[ãa]o\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(txt);
    const sold = /(\d+(?:[.,]\d+)?)\s*(mil)?\+?\s*vendas/i.exec(txt);
    const img = [...card.querySelectorAll('img')].map((i) => i.src).find((s) => /^https:/.test(s) && /susercontent|shopee/.test(s));
    const file = img ? img.split('?')[0].split('/').pop().replace(/@.*$|_tn$|\.(jpg|jpeg|png|webp)$/gi, '') : '';
    const d = off ? Number(off[1]) : 0;
    return { id: file ? 'img:' + file : '', title, price: price || 0, previous: d > 0 && d < 95 && price ? Central.round2(price / (1 - d / 100)) : null, derived_previous: d > 0,
      commission_pct: com ? Number(com[1].replace(',', '.')) : null, sold: sold ? Math.round(Number(sold[1].replace(',', '.')) * (sold[2] ? 1000 : 1)) : null, image: img || null, off: d };
  }
  const cardButton = (card) => [...card.querySelectorAll('span,button,a')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Obter link');

  async function linkFor(card) {
    const b = cardButton(card); if (!b) return '';
    b.click();
    const ta = await Central.waitFor(() => { const t = document.querySelector('textarea'); return t && /^https:\/\/s\.shopee\.com\.br\/\S+/.test(t.value) ? t : null; }, 5000);
    const link = ta ? ta.value.trim() : '';
    const close = document.querySelector('.shopee-modal__close, [class*="modal"] [class*="close"], .shopee-modal__header-close'); if (close) close.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Central.sleep(300);
    return link;
  }

  // abas de categoria da página (Todos, Comissão da marca, Melhor performance, ...)
  function tabs() {
    const bar = [...document.querySelectorAll('div,ul')].find((e) => e.children.length >= 4 && /^Todos/.test(e.children[0].textContent.trim()) && !e.querySelector(CARD));
    return bar ? [...bar.children] : [];
  }

  async function collect({ max = 15 } = {}) {
    await Central.waitFor(() => document.querySelector(CARD), 12000);
    if (!document.querySelector(CARD)) return { error: /login|entrar/i.test(document.body.innerText.slice(0, 600)) ? 'login' : 'sem_produtos' };
    const cache = await Central.cacheGet('spLinks'); const items = []; const seen = new Set(); let made = 0; let lidos = 0;
    const bar = tabs(); const rounds = bar.length ? Math.min(bar.length, 4) : 1;
    for (let r = 0; r < rounds && items.length < max; r++) {
      if (bar.length) { bar[r].click(); await Central.sleep(2200); }
      for (const card of document.querySelectorAll(CARD)) {
        if (items.length >= max) break;
        const c = parseCard(card); lidos++; if (!c.id || !c.title || !(c.price > 0) || seen.has(c.id) || c.off < 10) continue; seen.add(c.id);
        let link = cache[c.id] && cache[c.id].link;
        if (!link) { card.scrollIntoView({ block: 'center' }); link = await linkFor(card); if (link) { cache[c.id] = { link, at: Date.now() }; made++; } await Central.jitter(500, 1100); }
        if (!link) continue;
        items.push({ id: c.id, title: c.title, price: c.price, previous: c.previous, derived_previous: c.derived_previous, url: 'https://shopee.com.br/', affiliate_url: link, image: c.image, commission_pct: c.commission_pct, sold: c.sold });
      }
    }
    await Central.cacheSet('spLinks', cache);
    return { platform: 'shopee', items, links_novos: made, lidos };
  }

  window.__centralShopeeParse = () => [...document.querySelectorAll(CARD)].map(parseCard);
  chrome.runtime.onMessage.addListener((msg, _s, send) => { if (msg && msg.cmd === 'collect') { collect(msg).then(send, (e) => send({ error: String(e && e.message || e) })); return true; } });
})();
