// Roda dentro da própria página (world MAIN), desde o início do carregamento, antes dos scripts do site.
// Quando o site gera/copia o link de afiliado, repassa SÓ esse link para a extensão. Há três caminhos, para não depender de um só:
//   1) texto copiado pela área de transferência (writeText / write / execCommand)   2) resposta da chamada que cria o link.
(() => {
  if (window.__centralHook) return; window.__centralHook = true;
  const LINK = /https:\/\/(?:meli\.la|s\.shopee\.com\.br)\/[A-Za-z0-9_-]+/;
  const send = (text) => { try { const m = LINK.exec(String(text)); if (m) window.postMessage({ __central: 'clip', text: m[0] }, '*'); } catch { /* ignora */ } };
  try {
    const cb = navigator.clipboard;
    if (cb && cb.writeText) { const o = cb.writeText.bind(cb); cb.writeText = function (t) { send(t); return o(t).catch(() => {}); }; }
    if (cb && cb.write) {
      const o = cb.write.bind(cb);
      cb.write = function (items) {
        try { for (const it of items || []) if (it.types && it.types.includes('text/plain')) it.getType('text/plain').then((b) => b.text()).then(send).catch(() => {}); } catch { /* ignora */ }
        return o(items).catch(() => {});
      };
    }
  } catch { /* sem acesso à área de transferência */ }
  try { const ec = document.execCommand.bind(document); document.execCommand = function (cmd) { if (cmd === 'copy') send(String(document.getSelection() || '')); return ec.apply(document, arguments); }; } catch { /* ignora */ }
  // resposta da criação do link (só as chamadas "createLink" do programa de afiliados)
  try {
    const of = window.fetch;
    window.fetch = function (input, init) {
      const p = of.apply(this, arguments); const u = String((input && input.url) || input || '');
      if (/createLink/i.test(u)) p.then((r) => r.clone().text()).then(send).catch(() => {});
      return p;
    };
    const oo = XMLHttpRequest.prototype.open; const os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__central = /createLink/i.test(String(u)); return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () { if (this.__central) this.addEventListener('load', () => send(this.responseText)); return os.apply(this, arguments); };
  } catch { /* ignora */ }
})();
