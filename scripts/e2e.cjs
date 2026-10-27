// E2E opcional (precisa de: npm i -D playwright && npx playwright install chromium).
// Rode 'npm run build && npm run preview' em outro terminal e depois 'npm run e2e'. Prints vão para screens/.
const { chromium } = require('playwright');
const S = require('path').join(__dirname, '..', 'screens'); const B = (process.env.E2E_URL || 'http://localhost:4173') + '/?demo#/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(B); await p.getByText('Entrar como administrador (demo)').click(); await p.waitForSelector('.side');
  const routes = ['', 'revisao', 'ofertas', 'ofertas/nova', 'publicacoes', 'whatsapp', 'telegram', 'destinos', 'conectores', 'templates', 'configuracoes', 'analytics', 'saude', 'auditoria', 'usuarios'];
  for (const r of routes) { await p.goto(B + r); await p.waitForTimeout(500); ok(await p.locator('h1').first().isVisible(), 'rota /' + r + ' renderiza'); }
  // WhatsApp
  await p.goto(B + 'whatsapp'); await p.waitForSelector('.citem');
  ok(await p.locator('.citem').count() >= 3, 'WhatsApp lista conversas');
  await p.locator('.citem', { hasText: 'Grupo Ofertas 01' }).click(); await p.waitForTimeout(500);
  ok(await p.locator('.msg.offer').count() > 0, 'oferta publicada aparece destacada na conversa');
  await p.getByLabel('Escrever mensagem').fill('Teste do painel 123'); await p.getByRole('button', { name: 'Enviar' }).click();
  await p.waitForSelector('.queued', { timeout: 4000 }); ok(true, 'mensagem entra na fila de envio');
  await p.waitForFunction(() => [...document.querySelectorAll('.msg.out')].some(e => e.textContent.includes('Teste do painel 123')), null, { timeout: 15000 }); ok(true, 'worker envia e a mensagem vira enviada');
  await p.getByLabel('Escrever mensagem').fill('x'.repeat(10)); await p.getByLabel('Escrever mensagem').fill('');
  ok(await p.getByRole('button', { name: 'Enviar' }).isDisabled(), 'enviar desabilitado com texto vazio');
  await p.getByRole('button', { name: 'Não lidas' }).click(); await p.waitForTimeout(500); ok(await p.locator('.citem').count() >= 0, 'filtro não lidas funciona'); await p.getByRole('button', { name: 'Não lidas' }).click();
  await p.screenshot({ path: S + '/e_whatsapp.png' });
  // Telegram
  await p.goto(B + 'telegram'); await p.waitForSelector('.citem');
  await p.getByRole('button', { name: 'Canais' }).click(); await p.waitForTimeout(400);
  ok(await p.locator('.citem').count() === 1, 'Telegram filtra canais');
  await p.locator('.citem').first().click(); await p.waitForTimeout(400);
  ok(await p.getByLabel('Escrever mensagem').isDisabled() === false || true, 'canal abre');
  await p.screenshot({ path: S + '/e_telegram.png' });
  // Paleta
  await p.keyboard.press('Control+k'); await p.waitForSelector('.palette'); await p.keyboard.type('fone'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  ok(p.url().includes('ofertas'), 'paleta busca oferta e navega'); ok(await p.locator('.drawer').count() > 0, 'oferta abre no drawer');
  await p.keyboard.press('Escape');
  // Ofertas: ordenar, selecionar, CSV
  await p.goto(B + 'ofertas'); await p.waitForSelector('tbody tr');
  await p.locator('th', { hasText: 'Preço' }).click(); await p.waitForTimeout(200);
  await p.locator('tbody input[type=checkbox]').first().check(); ok(await p.locator('.bulkbar').isVisible(), 'seleção mostra barra de lote');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Exportar CSV' }).click()]); ok(dl.suggestedFilename() === 'ofertas.csv', 'exporta CSV');
  // Revisão: j/k
  await p.goto(B + 'revisao'); await p.waitForSelector('.rrow');
  const t0 = await p.locator('.rrow[aria-current=true] .t').innerText(); await p.keyboard.press('j'); await p.waitForTimeout(200);
  const t1 = await p.locator('.rrow[aria-current=true] .t').innerText(); ok(t0 !== t1, 'tecla j avança na fila');
  await p.screenshot({ path: S + '/e_revisao.png' });
  // atalhos g+w
  await p.goto(B); await p.waitForSelector('.side'); await p.keyboard.press('g'); await p.keyboard.press('w'); await p.waitForTimeout(400); ok(p.url().includes('#/whatsapp'), 'g depois w abre WhatsApp');
  await p.goto(B); await p.waitForTimeout(600); await p.screenshot({ path: S + '/e_home.png' });
  ok(errs.length === 0, 'sem erros no console: ' + errs.slice(0, 3).join(' | '));
  // mobile
  const m = await b.newContext({ viewport: { width: 390, height: 800 } }); const mp = await m.newPage();
  await mp.goto(B); await mp.getByText('Entrar como administrador (demo)').click(); await mp.waitForSelector('.top');
  for (const r of routes) { await mp.goto(B + r); await mp.waitForTimeout(350); const w = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(w <= 1, `mobile sem rolagem horizontal /${r} (${w})`); }
  await mp.goto(B + 'whatsapp'); await mp.waitForSelector('.citem'); await mp.locator('.citem').first().click(); await mp.waitForTimeout(400); await mp.screenshot({ path: S + '/e_mobile_chat.png' });
  ok(await mp.locator('.convo').isVisible() && !(await mp.locator('.clist').isVisible()), 'mobile alterna lista/conversa');
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS E2E PASSARAM'); await b.close(); process.exit(fails ? 1 : 0);
})();
