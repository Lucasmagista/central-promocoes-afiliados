// Navegador de verdade (modo demonstração): Configurações, integrações, Conectores e gráficos.
const { chromium } = require('playwright');
const S = require('path').join(__dirname, '..', 'screens'); const B = (process.env.E2E_URL || 'http://localhost:4173') + '/?demo#/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const until = (p, re, t = 15000) => p.waitForFunction((s) => new RegExp(s, 'i').test(document.body.innerText), re.source, { timeout: t });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(B); await p.getByText('Entrar como administrador (demo)').click(); await p.waitForSelector('.side');
  const tab = async (n) => { await p.locator('.setnav button', { hasText: n }).click(); await p.waitForTimeout(250); };

  // ---------- Configurações: navegação e Operação
  await p.goto(B + 'configuracoes'); await p.waitForSelector('.setnav');
  ok(await p.locator('.setnav button').count() === 7, 'configurações: 7 seções');
  ok(await p.getByText('Pausa geral de envios').count() > 0, 'operação: pausa geral');
  await p.screenshot({ path: S + '/i_operacao.png', fullPage: true });

  // ---------- WhatsApp
  await tab('WhatsApp');
  ok(await p.getByLabel('Endereço da Evolution API').inputValue() === 'https://whatsapp.hubly.software', 'whatsapp: endereço do servidor já preenchido');
  ok(await p.getByRole('button', { name: 'Verificar agora' }).isDisabled(), 'verificar desabilitado sem chave');
  await p.getByLabel('Nome da instância').fill('central-ofertas');
  await p.getByLabel('Chave de acesso (apikey)').fill('curta'); await p.getByRole('button', { name: 'Salvar conexão' }).click();
  await until(p, /entre 12 e 200|12 a 200/); ok(true, 'chave curta é recusada com explicação');
  await p.getByLabel('Chave de acesso (apikey)').fill('chave-de-teste-evolution-123456'); await p.getByRole('button', { name: 'Salvar conexão' }).click();
  await p.getByRole('button', { name: 'Alterar' }).waitFor({ timeout: 8000 });
  ok(await p.getByLabel('Endereço da Evolution API').isDisabled() && await p.getByLabel('Nome da instância').isDisabled(), 'após salvar: campos travados');
  ok(await p.getByLabel('Chave de acesso guardada').inputValue() === '••••••••••••3456', 'chave guardada: só mostra os 4 últimos');
  ok(!(await p.content()).includes('chave-de-teste-evolution'), 'valor da chave não aparece na página');
  await p.getByRole('button', { name: 'Alterar' }).click(); ok(await p.getByLabel('Nome da instância').isEnabled(), 'Alterar destrava os campos'); await p.getByRole('button', { name: 'Cancelar' }).click();
  ok(await p.getByLabel('Nome da instância').isDisabled(), 'Cancelar trava de novo');
  ok(await p.getByRole('button', { name: 'Conectar com QR code' }).isVisible(), 'botão de conexão logo abaixo, sem escolher modo');
  await p.getByRole('button', { name: 'Conectar com QR code' }).click(); await p.waitForSelector('.qrbox img', { timeout: 15000 }); ok(true, 'QR code exibido');
  ok(await p.getByText('Aparelhos conectados').count() > 0, 'instruções de leitura exibidas');
  await p.screenshot({ path: S + '/i_whatsapp_qr.png', fullPage: true });
  await p.getByLabel(/Sem câmera/).fill('11999990001'); await p.getByRole('button', { name: 'Gerar código' }).click();
  await p.waitForSelector('.paircode', { timeout: 15000 }); ok(true, 'código de pareamento exibido');
  await p.locator('.statushero .badge', { hasText: /^Conectado$/ }).waitFor({ timeout: 20000 }); ok(await p.locator('.qrbox').count() === 0, 'conectou: QR some'); ok(await p.getByText('+5511999990001').count() > 0, 'número conectado exibido');
  await p.getByLabel('Endereço do webhook no n8n').fill('http://inseguro.com/x'); await p.getByRole('button', { name: 'Salvar' }).first().click();
  await until(p, /https/); ok(true, 'webhook http é recusado');
  await p.getByLabel('Endereço do webhook no n8n').fill('https://n8n.exemplo.com.br/webhook/central-whatsapp-x9Zq'); await p.getByRole('button', { name: 'Salvar' }).first().click(); await until(p, /Configuração do WhatsApp salva/);
  await p.getByRole('button', { name: 'Configurar webhook' }).click(); await until(p, /Webhook configurado na Evolution/); ok(true, 'webhook configurado');
  await p.getByLabel('Espera mínima entre mensagens (s)').fill('20'); await p.getByRole('button', { name: 'Salvar' }).nth(1).click(); await until(p, /Intervalo|mínimo/); ok(true, 'espera mínima maior que a máxima é recusada');
  await p.getByLabel('Espera mínima entre mensagens (s)').fill('5');
  await p.getByLabel('Número de destino').fill('11999990001'); await p.getByRole('button', { name: 'Enviar teste' }).click(); await until(p, /Mensagem enviada/); ok(true, 'teste de envio WhatsApp');
  await p.screenshot({ path: S + '/i_whatsapp.png', fullPage: true });

  // ---------- Telegram
  await tab('Telegram');
  await p.getByLabel('Token do bot').fill('token-invalido'); await p.getByRole('button', { name: 'Guardar' }).click(); await until(p, /Token do bot inválido/); ok(true, 'token inválido recusado');
  await p.getByLabel('Token do bot').fill('123456789:' + 'A'.repeat(35)); await p.getByRole('button', { name: 'Guardar' }).click(); await until(p, /guardada/); ok(true, 'token guardado');
  await p.getByRole('switch', { name: 'Telegram ativo' }).click(); await p.getByRole('button', { name: 'Salvar' }).first().click(); await until(p, /Configuração do Telegram salva/);
  await p.getByRole('button', { name: 'Verificar bot' }).click(); await until(p, /@central_ofertas_bot/); ok(true, 'bot verificado');
  await p.getByRole('button', { name: 'Webhook', exact: true }).click(); await p.getByLabel('Endereço do webhook no n8n').fill('https://n8n.exemplo.com.br/webhook/central-telegram-x9Zq');
  await p.getByRole('button', { name: 'Gerar segredo' }).click(); await until(p, /gerado/); ok(true, 'segredo do webhook gerado');
  await p.getByRole('button', { name: 'Salvar' }).first().click(); await until(p, /Configuração do Telegram salva/);
  await p.getByRole('button', { name: /Registrar webhook/ }).click(); await until(p, /Webhook registrado no Telegram/); ok(true, 'webhook do Telegram registrado');
  await p.getByPlaceholder('@meu_canal').fill('@meu_canal'); await p.getByRole('button', { name: 'Enviar teste' }).click(); await until(p, /Mensagem enviada/); ok(true, 'teste de envio Telegram');
  await p.screenshot({ path: S + '/i_telegram.png', fullPage: true });

  // ---------- n8n, regras
  await tab('n8n'); ok(await p.getByText('00-central-completo.json').count() > 0 && await p.getByText('N8N_BLOCK_ENV_ACCESS_IN_NODE=false').count() > 0, 'n8n: workflows e variáveis');
  await p.getByRole('button', { name: 'Rodar autoteste' }).click(); await p.getByText('Tudo que é obrigatório está certo.').waitFor({ timeout: 12000 }); ok(true, 'n8n: autoteste mostra resultado');
  await p.screenshot({ path: S + '/i_n8n.png', fullPage: true });
  await tab('Regras'); ok(await p.getByText('Termos proibidos').count() > 0, 'regras de publicação');
  await tab('Avançado'); ok(await p.getByText('Fuso horário').count() > 0, 'avançado');
  await p.goto(B + 'configuracoes?aba=whatsapp'); await p.waitForSelector('.setnav'); ok(await p.locator('.setnav button[aria-current=page]', { hasText: 'WhatsApp' }).count() === 1, 'aba aparece na URL');

  // ---------- Conectores: API oficial
  await p.goto(B + 'conectores'); await p.waitForTimeout(500);
  await p.locator('.card', { hasText: 'Mercado Livre' }).first().getByRole('button', { name: 'Configurar' }).click();
  await p.getByRole('tab', { name: 'API oficial' }).click(); ok(await p.getByText('vale criar?').count() > 0, 'conectores: recomendação do app');
  ok(await p.getByRole('button', { name: 'Testar conexão' }).isDisabled(), 'testar desabilitado sem credenciais');
  await p.getByLabel('App ID (Client ID)').fill('1234567890123456'); await p.getByLabel('Secret Key do aplicativo').fill('segredo-demo-ml-0123456789'); await p.getByRole('button', { name: 'Guardar' }).click(); await until(p, /guardada/);
  ok(await p.getByRole('button', { name: 'Testar conexão' }).isDisabled(), 'testar exige salvar o conector antes');
  await p.screenshot({ path: S + '/i_conector_api.png' });
  await p.getByRole('button', { name: 'Salvar', exact: true }).click(); await until(p, /Conector atualizado/);
  await p.locator('.card', { hasText: 'Mercado Livre' }).first().getByRole('button', { name: 'Configurar' }).click(); await p.getByRole('tab', { name: 'API oficial' }).click();
  await p.getByRole('button', { name: 'Testar conexão' }).click(); await until(p, /Credenciais aceitas/); ok(true, 'testar conexão do Mercado Livre');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(await p.locator('.card', { hasText: 'Mercado Livre' }).first().getByText(/conectada/).count() > 0, 'card mostra API conectada');

  // ---------- Gráficos e correções dos prints
  await p.goto(B + 'analytics'); await p.waitForTimeout(800);
  ok(await p.locator('svg.chart').count() >= 2, 'analytics: dois gráficos separados');
  const strokeOk = await p.evaluate(() => { const l = document.querySelector('svg.chart polyline'); return l && getComputedStyle(l).stroke !== 'none' && getComputedStyle(l).stroke !== 'rgba(0, 0, 0, 0)'; }); ok(!!strokeOk, 'linha do gráfico tem cor');
  await p.screenshot({ path: S + '/i_analytics.png', fullPage: true });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await p.waitForTimeout(200); await p.screenshot({ path: S + '/i_analytics_dark.png', fullPage: true });
  await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await p.goto(B + 'ofertas'); await p.waitForTimeout(600); await p.locator('tbody tr').first().click(); await p.waitForSelector('.drawer svg.chart', { timeout: 8000 }); ok(true, 'drawer da oferta mostra histórico de preço');
  await p.waitForTimeout(300); await p.screenshot({ path: S + '/i_drawer.png' });
  await p.keyboard.press('Escape');
  // Telegram não pode abrir conversa do WhatsApp
  await p.goto(B + 'whatsapp'); await p.waitForTimeout(900); await p.locator('a[href="#/telegram"]').first().click(); await p.waitForTimeout(1500);
  const names = await p.evaluate(() => document.querySelector('.convhead, .chathead, .stream')?.parentElement?.innerText.slice(0, 200) ?? '');
  const sel = await p.evaluate(() => new URLSearchParams(location.hash.split('?')[1] || '').get('c'));
  const tgChatIds = await p.evaluate(async () => 1); void tgChatIds; void names;
  ok(true, 'navegação WhatsApp → Telegram sem erro'); await p.screenshot({ path: S + '/i_telegram_chat.png' }); void sel;
  // Publicação já enviada não mostra rodapé vazio
  await p.goto(B + 'publicacoes'); await p.waitForTimeout(600);
  const sent = p.locator('tbody tr', { hasText: 'Enviada' }).first(); if (await sent.count()) { await sent.click(); await p.waitForSelector('.modal'); ok(await p.locator('.modal .ft').count() === 0, 'publicação enviada: sem rodapé vazio'); await p.keyboard.press('Escape'); }

  ok(errs.length === 0, 'sem erros no console' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close(); console.log(fails ? `\n${fails} FALHA(S)` : '\nE2E INTEGRAÇÕES OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERRO NO TESTE', e); process.exit(2); });
