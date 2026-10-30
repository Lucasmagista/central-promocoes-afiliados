// Mercado Livre — hub do programa de afiliados (https://www.mercadolivre.com.br/afiliados/hub).
// Os produtos vêm no próprio HTML da página (lista "polycards"): título, preço, desconto, comissão e avaliação.
// O link de afiliado (meli.la) é gerado pelo botão Compartilhar → Copiar link, exatamente como você faria à mão.
(() => {
  if (window.__centralMl) return; window.__centralMl = true;

  function pageData() {
    const t = [...document.querySelectorAll('script')].map((x) => x.textContent || '').find((x) => x.startsWith('_n.ctx.r='));
    if (!t) return null;
    for (const end of [t.lastIndexOf('};') + 1, t.indexOf(';_n.'), t.indexOf(';\n'), t.length]) {
      if (end <= 9) continue;
      try { return JSON.parse(t.slice(9, end)); } catch { /* tenta o próximo corte */ }
    }
    return null;
  }
  function findPolycards(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 14) return null;
    if (Array.isArray(o.polycards)) return o.polycards;
    for (const k of Object.keys(o)) { const r = findPolycards(o[k], depth + 1); if (r) return r; }
    return null;
  }
  const comp = (c, type, id) => (c.components || []).find((k) => k.type === type && (!id || k.id === id));
  const kmil = (txt) => { const m = /(?:mais de|\+)\s*(\d+(?:[.,]\d+)?)\s*(mil|milh)?/i.exec(txt || ''); if (!m) return null; const n = Number(m[1].replace(',', '.')); return Math.round(n * (m[2] ? (/^milh/i.test(m[2]) ? 1e6 : 1e3) : 1)); };

  function parseCards() {
    const data = pageData(); const list = data && findPolycards(data); if (!list) return [];
    return list.map((c) => {
      const meta = c.metadata || {}; const p = comp(c, 'price'); const price = p && p.price;
      const cur = price && price.current_price && Number(price.current_price.value); const prev = price && price.previous_price && Number(price.previous_price.value);
      const label = (price && price.discount_label && price.discount_label.text) || '';
      // selo "GANHOS 5%" ou "GANHOS EXTRAS 20%": é a comissão do afiliado nesse produto
      const chip = (c.components || []).filter((k) => k.type === 'chip').find((k) => /GANHOS/i.test(JSON.stringify(k))); const com = chip && chip.chip && chip.chip.label && /(\d+(?:[.,]\d+)?)\s*%/.exec(chip.chip.label.text || '');
      const rev = comp(c, 'review_compacted'); const alt = (rev && rev.review_compacted && rev.review_compacted.alt_text) || '';
      const rating = /(\d(?:[.,]\d)?)\s*de\s*5/.exec(alt);
      let url = String(meta.url || ''); if (url && !/^https?:/.test(url)) url = 'https://' + url;
      return { id: meta.product_id || meta.id || '', title: ((comp(c, 'title') || {}).title || {}).text || '', price: cur || 0, previous: prev || null, discount_label: label, pix: /pix/i.test(label),
        commission_pct: com ? Number(com[1].replace(',', '.')) : null, rating: rating ? Number(rating[1].replace(',', '.')) : null, sold: kmil(alt), url: url.split('#')[0].split('?')[0] };
    });
  }

  // Cada card tem um botão "Compartilhar", na mesma ordem da lista.
  const shareButtons = () => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Compartilhar');

  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const copyButton = () => [...document.querySelectorAll('button,[role=button],a')].filter((b) => /^\s*Copiar link\s*$/i.test(b.textContent) && visible(b)).pop();
  // O diálogo de compartilhar NÃO fecha sozinho depois de copiar: sem fechar, o próximo clique devolveria o link do produto anterior.
  async function closeDialog() {
    for (let i = 0; i < 3 && copyButton(); i++) {
      const x = document.querySelector('.andes-modal__close-button'); if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Central.waitFor(() => !copyButton(), 1500, 100);
    }
    return !copyButton();
  }
  async function linkFor(btn) {
    if (!(await closeDialog())) return '';
    const clip = Central.nextClip(6000); btn.click();
    const copy = await Central.waitFor(copyButton, 4000);
    if (!copy) return '';
    copy.click(); const text = await clip; await closeDialog();
    return /^https:\/\/meli\.la\/[A-Za-z0-9]+$/.test(text.trim()) ? text.trim() : '';
  }

  async function collect({ max = 15 } = {}) {
    const cards = parseCards(); if (!cards.length) return { error: document.querySelector('input[type=password],[name=user_id]') ? 'login' : 'sem_produtos' };
    const btns = shareButtons(); const cache = await Central.cacheGet('mlLinks'); const items = []; let made = 0; const used = new Set(Object.values(cache).map((v) => v && v.link));
    for (let i = 0; i < cards.length && i < btns.length && items.length < max; i++) {
      const c = cards[i]; if (!c.id || !c.title || !(c.price > 0)) continue;
      let link = cache[c.id] && cache[c.id].link;
      if (!link) {
        link = await linkFor(btns[i]);
        if (link && used.has(link)) link = ''; // o mesmo link para dois produtos: algo deu errado, descarta
        if (link) { cache[c.id] = { link, at: Date.now() }; used.add(link); made++; }
        await Central.jitter(500, 1100);
      }
      if (!link) continue;
      const card = btns[i].closest('li,article,[class*=card]'); const im = card && card.querySelector('img'); const src = im && (im.currentSrc || im.src);
      items.push({ id: c.id, title: c.title, price: c.price, previous: c.previous, url: c.url, affiliate_url: link, image: /^https:/.test(src || '') ? src : null, commission_pct: c.commission_pct, rating: c.rating, sold: c.sold, pix: c.pix });
    }
    await Central.cacheSet('mlLinks', cache);
    return { platform: 'mercadolivre', items, links_novos: made, lidos: cards.length };
  }

  window.__centralMlParse = parseCards; // útil para conferir no console
  chrome.runtime.onMessage.addListener((msg, _s, send) => { if (msg && msg.cmd === 'collect') { collect(msg).then(send, (e) => send({ error: String(e && e.message || e) })); return true; } });
})();
