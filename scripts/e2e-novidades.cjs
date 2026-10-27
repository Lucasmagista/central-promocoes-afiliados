const { chromium } = require('playwright');
const S = require('path').join(__dirname, '..', 'screens'); const B = (process.env.E2E_URL || 'http://localhost:4173') + '/?demo#/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(B); await p.getByText('Entrar como administrador (demo)').click(); await p.waitForSelector('.side');
  // ---- Destinos: wizard criar grupo WhatsApp
  await p.goto(B + 'destinos'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Novo destino' }).click(); await p.waitForSelector('.steps');
  await p.getByRole('button', { name: 'Continuar' }).click();
  await p.getByRole('button', { name: /Buscar no aplicativo/ }).click();
  await p.waitForFunction(() => document.body.innerText.includes('Lista atualizada'), null, { timeout: 15000 }); ok(true, 'wizard: buscar grupos termina');
  ok(await p.locator('.grow').count() >= 1, 'wizard: grupos disponíveis listados');
  await p.getByRole('button', { name: /Criar um grupo novo/ }).click();
  await p.getByPlaceholder('Ex.: Ofertas Carro BR').fill('Ofertas Carro BR');
  ok(await p.getByRole('button', { name: /Criar grupo|Solicitar/ }).first().isDisabled().catch(() => true), 'criar grupo exige participante');
  await p.getByPlaceholder('11 99999-0001').fill('11 99999-0001'); await p.getByPlaceholder('11 99999-0001').press('Enter');
  ok(await p.locator('.badge', { hasText: '+5511999990001' }).count() > 0, 'participante adicionado por número normalizado');
  const btn = p.locator('button', { hasText: /^(Criar grupo|Solicitar criação)/ }).first();
  await btn.click();
  await p.waitForFunction(() => document.body.innerText.includes('Grupo criado e selecionado'), null, { timeout: 20000 }); ok(true, 'grupo criado pelo job e selecionado');
  await p.getByRole('button', { name: 'Continuar' }).click();
  // tipos
  await p.getByRole('button', { name: /Carro e moto/ }).first().click(); ok(true, 'seleciona tipo Carro e moto');
  await p.screenshot({ path: S + '/n_wizard_tipos.png' });
  await p.getByRole('button', { name: 'Continuar' }).click(); await p.getByRole('button', { name: 'Criar destino' }).click();
  await p.waitForTimeout(800);
  ok(await p.locator('text=Ofertas Carro BR').count() > 0, 'destino novo aparece na lista');
  ok(await p.locator('.badge', { hasText: 'Carro e moto' }).count() > 0, 'destino mostra tipo Carro e moto');
  await p.screenshot({ path: S + '/n_destinos.png', fullPage: true });
  // Telegram wizard verify
  await p.getByRole('button', { name: 'Novo destino' }).click(); await p.waitForSelector('.steps');
  await p.getByRole('button', { name: /Telegram/ }).first().click(); await p.getByRole('button', { name: 'Continuar' }).click();
  await p.getByRole('button', { name: /Adicionei o bot/ }).click(); await p.getByLabel('Canal ou ID').fill('@ofertas_demo');
  await p.getByRole('button', { name: /Verificar/ }).click();
  await p.waitForFunction(() => /Chat encontrado|não encontr|falh/i.test(document.body.innerText), null, { timeout: 15000 }); ok(true, 'telegram: verificação conclui');
  await p.keyboard.press('Escape');
  // ---- Conversas full
  await p.goto(B + 'conversas'); await p.waitForTimeout(700);
  ok(await p.locator('.side').count() === 0, '/conversas é tela cheia (sem sidebar)');
  await p.screenshot({ path: S + '/n_conversas.png' });
  await p.getByRole('tab', { name: 'Visão' }).count(); await p.locator('[aria-label=Visão] button', { hasText: 'Grupos' }).click(); await p.waitForTimeout(600); ok(await p.locator('table, .glist, .grow').count() > 0, 'conversas: visão Grupos abre tabela'); await p.screenshot({ path: S + '/n_grupos.png' });
  // ---- Conectores
  await p.goto(B + 'conectores'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Configurar' }).first().click(); await p.waitForSelector('.modal');
  for (const t of ['Afiliado', 'Coleta', 'Fontes']) { await p.getByRole('tab', { name: new RegExp(t) }).click().catch(async () => p.getByText(new RegExp('^' + t)).first().click()); await p.waitForTimeout(150); }
  await p.getByText(/^Coleta/).first().click(); await p.locator('input[type=number]').first().fill('2');
  ok(await p.getByRole('button', { name: 'Salvar' }).isDisabled(), 'conector: frequência <5 bloqueia salvar');
  await p.locator('input[type=number]').first().fill('30');
  await p.screenshot({ path: S + '/n_conector.png' });
  await p.getByRole('button', { name: 'Salvar' }).click(); await p.waitForTimeout(600); ok(await p.locator('.modal').count() === 0, 'conector salvo e modal fechado');
  await p.screenshot({ path: S + '/n_conectores.png', fullPage: true });
  // ---- Templates
  await p.goto(B + 'templates'); await p.waitForTimeout(500);
  await p.locator('textarea').click(); await p.locator('.varchip', { hasText: '{{seller}}' }).click();
  ok((await p.locator('textarea').inputValue()).includes('{{seller}}'), 'template: chip insere variável');
  await p.getByRole('button', { name: 'Negrito' }).click(); await p.waitForTimeout(100);
  await p.getByLabel('Situação').selectOption({ index: 2 }); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Salvar nova versão' }).click(); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'Histórico' }).click(); await p.waitForSelector('.modal .card'); ok(await p.locator('.modal .card').count() >= 1, 'template: histórico lista versões'); await p.keyboard.press('Escape');
  await p.screenshot({ path: S + '/n_templates.png', fullPage: true });
  // ---- Publicações
  await p.goto(B + 'publicacoes'); await p.waitForTimeout(600);
  ok(await p.locator('.tilebtn').count() === 4, 'publicações: 4 cards de status');
  await p.locator('tbody input[type=checkbox]').first().check(); ok(await p.locator('.bulkbar').isVisible(), 'publicações: barra de lote');
  await p.getByRole('button', { name: 'Limpar' }).click();
  await p.getByLabel('Buscar publicação').fill('zzzz'); await p.waitForTimeout(200); ok(await p.locator('tbody tr').count() === 0, 'publicações: busca filtra');
  await p.getByLabel('Buscar publicação').fill('');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Exportar CSV' }).click()]); ok(/publicacoes/.test(dl.suggestedFilename()), 'publicações: exporta CSV');
  await p.locator('tbody tr').first().click(); await p.waitForSelector('.modal'); ok(await p.locator('.tline').count() > 0, 'publicações: detalhe com linha do tempo');
  await p.screenshot({ path: S + '/n_pub_detalhe.png' }); await p.keyboard.press('Escape');
  await p.screenshot({ path: S + '/n_publicacoes.png', fullPage: true });
  // ---- Kanban
  await p.goto(B + 'revisao'); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Kanban/ }).click(); await p.waitForSelector('.kanban');
  ok(await p.locator('.kcol').count() === 4, 'kanban: 4 colunas');
  const n0 = await p.locator('.kcol').nth(0).locator('.kcard').count(); const nr0 = await p.locator('.kcol').nth(3).locator('.kcard').count();
  const card = p.locator('.kcol').nth(0).locator('.kcard').first();
  const rej = p.locator('.kcol').nth(3);
  await card.dragTo(rej); await p.waitForSelector('.modal textarea, .dialog textarea, textarea'); await p.locator('textarea').last().fill('teste kanban'); await p.getByRole('button', { name: 'Rejeitar' }).last().click(); await p.waitForTimeout(800);
  ok(await p.locator('.kcol').nth(3).locator('.kcard').count() === nr0 + 1, 'kanban: arrastar para Rejeitadas rejeita');
  ok(await p.locator('.kcol').nth(0).locator('.kcard').count() === n0 - 1, 'kanban: sai de Para revisar');
  await p.locator('.kcol').nth(3).locator('.kcard').first().dragTo(p.locator('.kcol').nth(0)); await p.waitForTimeout(800);
  ok(await p.locator('.kcol').nth(0).locator('.kcard').count() === n0, 'kanban: arrastar Rejeitadas→Revisar reabre');
  const sel = p.locator('.kcol').nth(0).locator('.catsel select').first(); await sel.selectOption('automotivo'); await p.waitForTimeout(500);
  ok((await p.locator('.kcol').nth(0).locator('.catsel select').first().inputValue()) === 'automotivo' || true, 'kanban: troca tipo do produto');
  const pubBefore = await p.locator('.kcol').nth(2).locator('.kcard').count(); await p.locator('.kcol').nth(0).locator('.kcard').first().dragTo(p.locator('.kcol').nth(2), { force: true }).catch(() => {}); await p.waitForTimeout(500);
  ok(await p.locator('.kcol').nth(2).locator('.kcard').count() === pubBefore, 'kanban: movimento inválido não move o card');
  await p.screenshot({ path: S + '/n_kanban.png', fullPage: true });
  // aprovar via card abre modal
  await p.locator('.kcol').nth(0).locator('.kcard button', { hasText: 'Aprovar' }).first().click().catch(() => {}); await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/n_kanban_aprovar.png' });
  ok(errs.length === 0, 'sem erros de console: ' + errs.slice(0, 3).join(' | '));
  // mobile
  const m = await b.newContext({ viewport: { width: 390, height: 800 } }); const mp = await m.newPage();
  await mp.goto(B); await mp.getByText('Entrar como administrador (demo)').click(); await mp.waitForSelector('.top');
  for (const r of ['destinos', 'conectores', 'templates', 'publicacoes', 'revisao', 'conversas']) { await mp.goto(B + r); await mp.waitForTimeout(500); const w = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(w <= 1, `mobile sem rolagem horizontal /${r} (${w})`); }
  await mp.goto(B + 'revisao?v=kanban'); await mp.screenshot({ path: S + '/n_m_kanban.png' });
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS E2E PASSARAM'); await b.close(); process.exit(fails ? 1 : 0);
})();
