// Gera os workflows importáveis do n8n (deploy/n8n/*.json) embutindo deploy/n8n/central-worker.mjs.
// Uso: npm run n8n:build
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'deploy', 'n8n');
// O Code node do n8n não aceita `export`; o restante do módulo é JavaScript comum.
const worker = readFileSync(join(out, 'central-worker.mjs'), 'utf8').replace(/^export (async function|function|const)/gm, '$1');

const migrations = readdirSync(join(root, 'db', 'migrations')).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/i.test(f)).sort().map((version) => ({ version, sql: readFileSync(join(root, 'db', 'migrations', version), 'utf8') }));

// Adaptadores: ligam o worker ao Supabase e ao HTTP do n8n.
const mkAdapter = (withMig) => `
// Configuração embutida no arquivo (o script de instalação troca os dois textos COLE_AQUI_...). Sem isso, tenta as variáveis de ambiente do n8n.
const CFG = { url: 'COLE_AQUI_A_URL_DO_SUPABASE', key: 'COLE_AQUI_A_SERVICE_ROLE_KEY' };
const real = (v) => !!v && !/^COLE_AQUI/.test(v);
let SB = real(CFG.url) ? String(CFG.url).replace(/\\/+$/, '') : '', KEY = real(CFG.key) ? String(CFG.key) : '', ENVERR = '';
if (!SB || !KEY) {
  try { SB = SB || String($env.SUPABASE_URL || '').replace(/\\/+$/, ''); KEY = KEY || String($env.SUPABASE_SERVICE_ROLE_KEY || ''); }
  catch (e) { ENVERR = 'A chave do Supabase ainda não está no arquivo do workflow (troque ' + 'COLE_AQUI_A_' + 'SERVICE_ROLE_KEY) e o n8n bloqueia variáveis de ambiente (N8N_BLOCK_ENV_ACCESS_IN_NODE=false resolve, ou use o script subir-n8n).'; }
}
const MISSING = ENVERR || 'Falta configurar o Supabase: troque ' + 'COLE_AQUI_A_URL' + '_DO_SUPABASE e COLE_AQUI_A_' + 'SERVICE_ROLE_KEY no arquivo do workflow (ou defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis do n8n).';
const hostOfUrl = (u) => { try { return parseUrl(u).host; } catch (e) { return ''; } };
const envNum = (k, d, min, max) => { try { const v = Number($env[k]); return Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : d; } catch (e) { return d; } };
// Limites de segurança (mude pelas variáveis CENTRAL_* do n8n; sem elas valem estes padrões)
const SEG = {
  webhookPorMin: envNum('CENTRAL_WEBHOOK_MAX_POR_MIN', 120, 10, 5000),
  corpoMaxKb: envNum('CENTRAL_WEBHOOK_MAX_KB', 256, 8, 4096),
  tarefasPorExecucao: envNum('CENTRAL_MAX_TAREFAS', 5, 1, 20),
  enviosPorExecucao: envNum('CENTRAL_MAX_ENVIOS', 20, 1, 100),
  orcamentoEnvioMs: envNum('CENTRAL_ORCAMENTO_ENVIO_MS', 50000, 10000, 100000),
  autotestePorMin: envNum('CENTRAL_AUTOTESTE_MAX_POR_MIN', 6, 1, 60),
};
// Memória do próprio workflow (persiste entre execuções). Se o n8n não oferecer, os limites ficam desligados e o autoteste avisa.
let STORE = null; try { STORE = $getWorkflowStaticData('global'); } catch (e) { STORE = null; }
const limit = (key, max, windowMs) => {
  if (!STORE) return { ok: true, unlimited: true };
  const now = Date.now(); const b = (STORE.rl = STORE.rl || {});
  for (const k of Object.keys(b)) if (now - b[k].t0 > 600000) delete b[k];
  const e = b[key] = b[key] && now - b[key].t0 < windowMs ? b[key] : { t0: now, n: 0 }; e.n++;
  return { ok: e.n <= max, n: e.n, retryAfter: Math.max(1, Math.ceil((e.t0 + windowMs - now) / 1000)) };
};
const lockTake = (key, ttlMs) => { if (!STORE) return true; const now = Date.now(); const m = (STORE.mx = STORE.mx || {}); if (m[key] && now - m[key] < ttlMs) return false; m[key] = now; return true; };
const lockFree = (key) => { if (STORE && STORE.mx) delete STORE.mx[key]; };
const keyRole = () => { try { const p = JSON.parse(Buffer.from(KEY.split('.')[1], 'base64').toString('utf8')); return String(p.role || 'desconhecido'); } catch (e) { return 'desconhecido'; } };
// Saída: só http/https e nunca para metadados de nuvem (anti-SSRF). Redirecionamento já é recusado.
const assertOut = (u) => { const x = parseUrl(u); if (!/^https?:$/.test(x.protocol)) throw new Error('Protocolo não permitido'); if (/^(169\\.254\\.|0\\.0\\.0\\.0|metadata\\.|\\[?fe80:)/i.test(x.hostname) || /^metadata\\.google\\.internal$/i.test(x.hostname)) throw new Error('Endereço bloqueado por segurança'); };
const helpers = this.helpers;
const http = async (o) => {
  assertOut(o.url);
  const headers = { ...(o.headers || {}) }; let body = o.body;
  if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = Object.keys(o.form).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(o.form[k]))).join('&'); }
  else if (o.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(o.json); }
  try {
    const r = await helpers.httpRequest({ method: o.method, url: o.url, headers, body, json: false, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: o.timeoutMs || 20000, redirect: 'error' });
    let data = r.body; if (Buffer.isBuffer(data)) data = data.toString('utf8'); if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { /* texto puro */ } }
    return { status: r.statusCode, data };
  } catch (e) { const c = String((e && (e.code || e.message)) || ''); throw { code: /TIMEDOUT|ABORT|timeout/i.test(c) ? 'timeout' : 'network' }; }
};
const ctx = {
  http, now: () => new Date(), rand: Math.random, log: () => {},
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  env: { has_url: !!SB, has_key: !!KEY, supabase_host: hostOfUrl(SB), key_role: KEY ? keyRole() : '' },
  migrations: ${withMig ? JSON.stringify(migrations) : '[]'},
  limits: SEG, limit, hasStore: !!STORE,
  rpc: async (name, args) => {
    if (!SB || !KEY) throw new Error(MISSING);
    const r = await http({ method: 'POST', url: SB + '/rest/v1/rpc/' + name, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, json: args || {}, timeoutMs: 30000 });
    if (r.status >= 300) throw new Error('Supabase ' + name + ' respondeu ' + r.status + ': ' + (r.data && (r.data.message || JSON.stringify(r.data)) || '').toString().slice(0, 200));
    return r.data;
  },
};
`;
const adapter = mkAdapter(false); const adapterMig = mkAdapter(true); // só quem aplica migrações leva os SQLs

const node = (id, name, type, version, parameters, position) => ({ id, name, type, typeVersion: version, parameters, position });
const code = (id, name, js, pos) => node(id, name, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: js }, pos);
const wf = (name, nodes, connections, extra = {}) => ({ name, nodes, connections, active: false, settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveManualExecutions: false, ...extra }, tags: [] });
const link = (a, b) => ({ [a]: { main: [[{ node: b, type: 'main', index: 0 }]] } });
const files = {};

files['01-acoes-do-painel.json'] = wf('Central — Ações do painel (a cada 5 s)', [
  node('t1', 'A cada 5 segundos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'seconds', secondsInterval: 5 }] } }, [0, 0]),
  code('c1', 'Executar tarefas', `${worker}\n${adapterMig}\nconst r = await runJobs(ctx, { max: 5 });\nreturn [{ json: r }];`, [260, 0]),
], link('A cada 5 segundos', 'Executar tarefas'), { executionTimeout: 240 });

files['02-envios-e-monitor.json'] = wf('Central — Envios, respostas e monitor (a cada 1 min)', [
  node('t2', 'A cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, [0, 0]),
  code('c2', 'Enviar e monitorar', `${worker}\n${adapter}\nconst a = await runSender(ctx, { budgetMs: 50000 });\nconst b = await runMonitor(ctx);\nreturn [{ json: { ...a, monitor: b } }];`, [260, 0]),
], link('A cada minuto', 'Enviar e monitorar'), { executionTimeout: 110 });

const webhook = (id, name, path) => node(id, name, 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path, responseMode: 'responseNode', options: { rawBody: false } }, [0, 0]);
const respond = (id) => node(id, 'Responder', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ { ok: $json.ok } }}', options: { responseCode: '={{ $json.status || 200 }}' } }, [520, 0]);

files['03-entrada-whatsapp.json'] = wf('Central — Entrada WhatsApp (webhook da Evolution)', [
  webhook('w3', 'Webhook Evolution', 'central-whatsapp-TROQUE-ESTE-TEXTO'),
  code('c3', 'Gravar mensagem', `${worker}\n${adapter}\nconst item = $input.first().json;\nconst r = await handleEvolutionWebhook(ctx, item.body || item);\nreturn [{ json: r }];`, [260, 0]),
  respond('r3'),
], { ...link('Webhook Evolution', 'Gravar mensagem'), ...link('Gravar mensagem', 'Responder') });

files['04-entrada-telegram.json'] = wf('Central — Entrada Telegram (webhook do bot)', [
  webhook('w4', 'Webhook Telegram', 'central-telegram-TROQUE-ESTE-TEXTO'),
  code('c4', 'Validar e gravar', `${worker}\n${adapter}\nconst item = $input.first().json;\nconst r = await handleTelegramWebhook(ctx, item.headers || {}, item.body || {});\nreturn [{ json: r }];`, [260, 0]),
  respond('r4'),
], { ...link('Webhook Telegram', 'Validar e gravar'), ...link('Validar e gravar', 'Responder') });


/* ---------- Arquivo único: tudo num workflow só (importe este e ative) ---------- */
const pathsFile = join(out, 'webhook-paths.json');
let paths = existsSync(pathsFile) ? JSON.parse(readFileSync(pathsFile, 'utf8')) : {};
for (const k of ['whatsapp', 'telegram', 'autoteste']) if (!paths[k]) paths[k] = `central-${k}-${randomBytes(12).toString('hex')}`;
writeFileSync(pathsFile, JSON.stringify(paths, null, 2) + '\n');
const sticky = (id, name, content, position, width, height, color = 7) => node(id, name, 'n8n-nodes-base.stickyNote', 1, { content, width, height, color }, position);
// webhookId estável (derivado do caminho): reimportar não muda a URL de produção.
const stableId = (path) => { const h = createHash('sha256').update(path).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const wh = (id, name, path, method, position) => ({ ...node(id, name, 'n8n-nodes-base.webhook', 2, { httpMethod: method, path, responseMode: 'responseNode', options: {} }, position), webhookId: stableId(path) });
const ifNode = (id, name, position) => node(id, name, 'n8n-nodes-base.if', 1, { conditions: { boolean: [{ value1: '={{ $json.blocked === true }}', value2: true }] } }, position);
const respondNode = (id, name, position) => node(id, name, 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ { ok: $json.ok === true } }}', options: { responseCode: '={{ $json.status || 200 }}' } }, position);
const guardJs = (kind) => `${worker}\n${adapter}\nconst item = $input.first().json;\nconst g = guardWebhook(ctx, '${kind}', item);\nreturn [{ json: { ...g, body: item.body, headers: item.headers } }];`;
const selftestJs = `${worker}\n${adapter}\nlet r;\ntry { const rt = await loadRuntime(ctx); r = await selfTest(ctx, rt); }\ncatch (e) { r = { ok: false, checks: [{ id: 'env', label: 'Conexão com o Supabase', ok: false, required: true, detail: String((e && e.message) || e).slice(0, 300) }], at: new Date().toISOString() }; }\nreturn [{ json: r }];`;
const selftestGuardJs = `${worker}\n${adapter}\nconst r = ctx.limit('autoteste', SEG.autotestePorMin, 60000);\nreturn [{ json: r.ok ? { blocked: false } : { blocked: true, ok: false, status: 429, retryAfter: r.retryAfter } }];`;

const X = [0, 300, 600, 900, 1200]; // colunas
const SEC = (id, title, text, y, h, color) => sticky(id, title, `### ${title}\n${text}`, [-60, y], 1520, h, color);
const nodes = [
  sticky('s0', 'Leia primeiro', [
    '## Central de Promoções — workflow completo',
    '**Já vem configurado:** não precisa de variáveis de ambiente do n8n.',
    '**1.** Se a chave ainda aparecer como `COLE_AQUI_A_SERVICE_ROLE_KEY`, troque pelo valor da *service_role* do Supabase (Project Settings → API). Dica: use o script `subir-n8n.ps1`, que faz isso e importa sozinho.',
    '**2.** Rode as migrações do banco (até a `011`).',
    '**3.** Ative este workflow (chave *Active*, no topo).',
    '**4.** Painel → Configurações → n8n → **Rodar autoteste**.',
    '**5.** Copie a *Production URL* dos nós **Webhook WhatsApp** e **Webhook Telegram** e cole nas abas WhatsApp e Telegram do painel.',
    '**Testar daqui:** botão **Execute workflow** no nó *Autoteste manual*, ou abra a URL do nó *Autoteste (GET)* no navegador.',
    '**Atenção:** este arquivo guarda a chave service_role. Não compartilhe nem publique o workflow exportado.',
  ].join('\n\n'), [-60, -560], 760, 510, 4),
  sticky('s9', 'Segurança', [
    '## Segurança embutida',
    '- **Porteiro** antes de tudo: recusa corpo grande, formato estranho e requisição sem segredo **sem consultar o banco** (uma inundação não chega ao Supabase).',
    '- **Limite de requisições** por webhook (padrão 120/min) → responde 429.',
    '- **Telegram:** segredo comparado em tempo constante; segredo fraco (<16) é recusado.',
    '- **WhatsApp:** só aceita a instância configurada e só grava eventos de mensagem (máx. 50 por chamada).',
    '- **Anti-sobreposição:** o envio não roda duas vezes ao mesmo tempo.',
    '- **Saída segura:** só http/https, sem metadados de nuvem, sem redirecionamento.',
    '- **Segredos** nunca aparecem em logs, resultados ou no autoteste.',
    '- **Execuções:** sucesso não é gravado (privacidade); erros ficam para diagnóstico.',
    '',
    '**Ajustes (variáveis do n8n, opcionais):** `CENTRAL_WEBHOOK_MAX_POR_MIN` (120) · `CENTRAL_WEBHOOK_MAX_KB` (256) · `CENTRAL_MAX_TAREFAS` (5) · `CENTRAL_MAX_ENVIOS` (20) · `CENTRAL_ORCAMENTO_ENVIO_MS` (50000) · `CENTRAL_AUTOTESTE_MAX_POR_MIN` (6).',
    '',
    '**Extra recomendado:** coloque o n8n atrás de HTTPS e, no nó de cada webhook, em *Options → IP(s) Whitelist*, restrinja ao IP da sua Evolution e à faixa do Telegram (149.154.160.0/20 e 91.108.4.0/22), se o seu n8n aceitar.',
  ].join('\n'), [740, -520], 760, 470, 6),

  SEC('a', 'Ações do painel', 'A cada 5 segundos executa o que o painel pediu: QR code, status, grupos, testes. Até 5 tarefas por rodada.', 0, 300, 5),
  node('t1', 'A cada 5 segundos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'seconds', secondsInterval: 5 }] } }, [X[0], 130]),
  code('c1', 'Executar tarefas do painel', `${worker}\n${adapterMig}\nconst r = await runJobs(ctx, { max: SEG.tarefasPorExecucao });\nreturn [{ json: r }];`, [X[1], 130]),

  SEC('b', 'Envios e monitor', 'A cada minuto publica as ofertas aprovadas, envia respostas e vigia WhatsApp e Telegram. Trava contra execução dupla; respeita pausa geral, janelas e limites por destino.', 340, 300, 5),
  node('t2', 'A cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, [X[0], 470]),
  code('c2', 'Enviar e monitorar', `${worker}\n${adapter}\nif (!lockTake('sender', 110000)) return [{ json: { skipped: 'execução anterior ainda em andamento' } }];\ntry {\n  const a = await runSender(ctx, { budgetMs: SEG.orcamentoEnvioMs, maxPerRun: SEG.enviosPorExecucao });\n  const b = await runMonitor(ctx);\n  return [{ json: { ...a, monitor: b } }];\n} finally { lockFree('sender'); }`, [X[1], 470]),

  SEC('c', 'Entrada do WhatsApp (Evolution → n8n)', 'Porteiro valida e limita; só então grava a mensagem. Bloqueado responde direto, sem tocar no banco.', 680, 340, 3),
  wh('w3', 'Webhook WhatsApp (Evolution)', paths.whatsapp, 'POST', [X[0], 800]),
  code('g3', 'Porteiro WhatsApp (segurança)', guardJs('whatsapp'), [X[1], 800]),
  ifNode('i3', 'Bloqueado? (WhatsApp)', [X[2], 800]),
  code('c3', 'Gravar mensagem do WhatsApp', `${worker}\n${adapter}\nconst item = $input.first().json;\nconst r = await handleEvolutionWebhook(ctx, item.body || item);\nreturn [{ json: r }];`, [X[3], 860]),
  respondNode('r3', 'Responder WhatsApp', [X[4], 800]),

  SEC('d', 'Entrada do Telegram (bot → n8n)', 'Exige o segredo do webhook no cabeçalho (comparado em tempo constante). Sem segredo válido, nem consulta o banco.', 1060, 340, 3),
  wh('w4', 'Webhook Telegram (bot)', paths.telegram, 'POST', [X[0], 1180]),
  code('g4', 'Porteiro Telegram (segurança)', guardJs('telegram'), [X[1], 1180]),
  ifNode('i4', 'Bloqueado? (Telegram)', [X[2], 1180]),
  code('c4', 'Validar e gravar Telegram', `${worker}\n${adapter}\nconst item = $input.first().json;\nconst r = await handleTelegramWebhook(ctx, item.headers || {}, item.body || {});\nreturn [{ json: r }];`, [X[3], 1240]),
  respondNode('r4', 'Responder Telegram', [X[4], 1180]),

  SEC('e', 'Autoteste', 'Confere variáveis, banco, limites e configuração. Não mostra segredos. Limitado a 6 chamadas por minuto.', 1440, 440, 7),
  wh('w5', 'Autoteste (GET)', paths.autoteste, 'GET', [X[0], 1560]),
  code('g5', 'Limitar autoteste', selftestGuardJs, [X[1], 1560]),
  ifNode('i5', 'Bloqueado? (autoteste)', [X[2], 1560]),
  code('c5', 'Rodar autoteste', selftestJs, [X[3], 1620]),
  { ...respondNode('r5', 'Responder autoteste', [X[4], 1560]), parameters: { respondWith: 'json', responseBody: '={{ $json }}', options: { responseCode: '={{ $json.status || 200 }}' } } },
  node('m1', 'Autoteste manual', 'n8n-nodes-base.manualTrigger', 1, {}, [X[0], 1760]),
  code('c6', 'Rodar autoteste (manual)', selftestJs, [X[1], 1760]),
];
const to = (n) => [{ node: n, type: 'main', index: 0 }];
const branch = (blocked, pass) => ({ main: [to(blocked), to(pass)] });
const conns = {
  ...link('A cada 5 segundos', 'Executar tarefas do painel'), ...link('A cada minuto', 'Enviar e monitorar'),
  ...link('Webhook WhatsApp (Evolution)', 'Porteiro WhatsApp (segurança)'), ...link('Porteiro WhatsApp (segurança)', 'Bloqueado? (WhatsApp)'),
  'Bloqueado? (WhatsApp)': branch('Responder WhatsApp', 'Gravar mensagem do WhatsApp'), ...link('Gravar mensagem do WhatsApp', 'Responder WhatsApp'),
  ...link('Webhook Telegram (bot)', 'Porteiro Telegram (segurança)'), ...link('Porteiro Telegram (segurança)', 'Bloqueado? (Telegram)'),
  'Bloqueado? (Telegram)': branch('Responder Telegram', 'Validar e gravar Telegram'), ...link('Validar e gravar Telegram', 'Responder Telegram'),
  ...link('Autoteste (GET)', 'Limitar autoteste'), ...link('Limitar autoteste', 'Bloqueado? (autoteste)'),
  'Bloqueado? (autoteste)': branch('Responder autoteste', 'Rodar autoteste'), ...link('Rodar autoteste', 'Responder autoteste'),
  ...link('Autoteste manual', 'Rodar autoteste (manual)'),
};
files['00-central-completo.json'] = { ...wf('Central de Promoções — COMPLETO (importe só este)', nodes, conns, { executionTimeout: 240, saveManualExecutions: true, saveDataErrorExecution: 'all', saveExecutionProgress: false, callerPolicy: 'none', timezone: 'America/Sao_Paulo' }), tags: [] };

const bake = (t) => {
  const u = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''); const k = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (u) t = t.split('COLE_AQUI_A_URL_DO_SUPABASE').join(u);
  if (k) t = t.split('COLE_AQUI_A_SERVICE_ROLE_KEY').join(k);
  return t;
};
import('node:fs').then(({ mkdirSync }) => {
  mkdirSync(join(out, 'separados'), { recursive: true });
  for (const [f, w] of Object.entries(files)) writeFileSync(join(out, f === '00-central-completo.json' ? f : join('separados', f)), bake(JSON.stringify(w, null, 2) + '\n'));
  console.log('Webhooks (caminho após /webhook/):', JSON.stringify(paths));
  console.log('Gerados:', Object.keys(files).map((f) => 'deploy/n8n/' + (f === '00-central-completo.json' ? '' : 'separados/') + f).join(', '));
});
