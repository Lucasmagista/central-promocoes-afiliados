// Gera os workflows importáveis do n8n (deploy/n8n/*.json) embutindo deploy/n8n/central-worker.mjs.
// Uso: npm run n8n:build
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'deploy', 'n8n');
// O Code node do n8n não aceita `export`; o restante do módulo é JavaScript comum.
const worker = readFileSync(join(out, 'central-worker.mjs'), 'utf8').replace(/^export (async function|function|const)/gm, '$1');
const migrations = readdirSync(join(root, 'db', 'migrations')).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/i.test(f)).sort().map((version) => ({ version, sql: readFileSync(join(root, 'db', 'migrations', version), 'utf8') }));

// Adaptadores: ligam o worker ao Supabase e ao HTTP do n8n.
const adapter = `
let SB = '', KEY = '', ENVERR = '';
try { SB = String($env.SUPABASE_URL || '').replace(/\\/+$/, ''); KEY = String($env.SUPABASE_SERVICE_ROLE_KEY || ''); } catch (e) { ENVERR = 'O n8n bloqueou o acesso às variáveis de ambiente: defina N8N_BLOCK_ENV_ACCESS_IN_NODE=false e reinicie o n8n.'; }
const MISSING = ENVERR || 'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do n8n (e N8N_BLOCK_ENV_ACCESS_IN_NODE=false).';
const hostOfUrl = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };
const helpers = this.helpers;
const http = async (o) => {
  const headers = { ...(o.headers || {}) }; let body = o.body;
  if (o.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(o.form).toString(); }
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
  migrations: ${JSON.stringify(migrations)},
  env: { has_url: !!SB, has_key: !!KEY, supabase_host: hostOfUrl(SB) },
  rpc: async (name, args) => {
    if (!SB || !KEY) throw new Error(MISSING);
    const r = await http({ method: 'POST', url: SB + '/rest/v1/rpc/' + name, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, json: args || {}, timeoutMs: 30000 });
    if (r.status >= 300) throw new Error('Supabase ' + name + ' respondeu ' + r.status + ': ' + (r.data && (r.data.message || JSON.stringify(r.data)) || '').toString().slice(0, 200));
    return r.data;
  },
};
`;

const node = (id, name, type, version, parameters, position) => ({ id, name, type, typeVersion: version, parameters, position });
const code = (id, name, js, pos) => node(id, name, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: js }, pos);
const wf = (name, nodes, connections, extra = {}) => ({ name, nodes, connections, active: false, settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveManualExecutions: false, ...extra }, tags: [] });
const link = (a, b) => ({ [a]: { main: [[{ node: b, type: 'main', index: 0 }]] } });
const files = {};

files['01-acoes-do-painel.json'] = wf('Central — Ações do painel (a cada 5 s)', [
  node('t1', 'A cada 5 segundos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'seconds', secondsInterval: 5 }] } }, [0, 0]),
  code('c1', 'Executar tarefas', `${worker}\n${adapter}\nconst r = await runJobs(ctx, { max: 5 });\nreturn [{ json: r }];`, [260, 0]),
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
const wh = (id, name, path, method, position) => ({ ...node(id, name, 'n8n-nodes-base.webhook', 2, { httpMethod: method, path, responseMode: 'responseNode', options: {} }, position), webhookId: `${id}-0000-4000-8000-${randomBytes(6).toString('hex')}` });
const selftestJs = `${worker}\n${adapter}\nlet r;\ntry { const rt = await loadRuntime(ctx); r = await selfTest(ctx, rt); }\ncatch (e) { r = { ok: false, checks: [{ id: 'env', label: 'Conexão com o Supabase', ok: false, required: true, detail: String((e && e.message) || e).slice(0, 300) }], at: new Date().toISOString() }; }\nreturn [{ json: r }];`;
const nodes = [
  sticky('s0', 'Leia primeiro', [
    '## Central de Promoções — workflow completo',
    '**1.** No servidor do n8n defina `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` e reinicie.',
    '**2.** Rode as migrações do banco (até a `010`).',
    '**3.** Ative este workflow (chave no topo) e abra o painel → Configurações → n8n → “Rodar autoteste”.',
    '**4.** Cole as URLs dos webhooks (nós abaixo, aba *Production URL*) nas abas WhatsApp e Telegram do painel.',
    '**Testar daqui:** clique em “Executar workflow” no nó **Autoteste manual**, ou abra o endereço do webhook **Autoteste (GET)** no navegador.',
  ].join('\n\n'), [-120, -420], 560, 330, 4),
  sticky('s1', 'Ações do painel', '### Ações do painel\nA cada 5 s executa o que o painel pediu: QR code, status, grupos, testes.', [-120, -40], 560, 150),
  sticky('s2', 'Envios', '### Envios e monitor\nA cada minuto publica as ofertas aprovadas, envia respostas e vigia WhatsApp/Telegram.', [-120, 150], 560, 150),
  sticky('s3', 'Entradas', '### Entrada de mensagens\nWebhooks que recebem WhatsApp (Evolution) e Telegram. Os caminhos são secretos: não compartilhe as URLs.', [-120, 340], 760, 330),
  sticky('s4', 'Autoteste', '### Autoteste\nConfere variáveis, banco e configurações. Não mostra segredos.', [-120, 700], 760, 330),
  node('t1', 'A cada 5 segundos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'seconds', secondsInterval: 5 }] } }, [-80, 0]),
  code('c1', 'Executar tarefas do painel', `${worker}\n${adapter}\nconst r = await runJobs(ctx, { max: 5 });\nreturn [{ json: r }];`, [200, 0]),
  node('t2', 'A cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }, [-80, 190]),
  code('c2', 'Enviar e monitorar', `${worker}\n${adapter}\nconst a = await runSender(ctx, { budgetMs: 50000 });\nconst b = await runMonitor(ctx);\nreturn [{ json: { ...a, monitor: b } }];`, [200, 190]),
  wh('w3', 'Webhook WhatsApp (Evolution)', paths.whatsapp, 'POST', [-80, 380]),
  code('c3', 'Gravar mensagem do WhatsApp', `${worker}\n${adapter}\nconst item = $input.first().json;\nconst r = await handleEvolutionWebhook(ctx, item.body || item);\nreturn [{ json: r }];`, [200, 380]),
  { ...respond('r3'), name: 'Responder WhatsApp' },
  wh('w4', 'Webhook Telegram (bot)', paths.telegram, 'POST', [-80, 530]),
  code('c4', 'Validar e gravar Telegram', `${worker}\n${adapter}\nconst item = $input.first().json;\nconst r = await handleTelegramWebhook(ctx, item.headers || {}, item.body || {});\nreturn [{ json: r }];`, [200, 530]),
  { ...respond('r4'), name: 'Responder Telegram' },
  wh('w5', 'Autoteste (GET)', paths.autoteste, 'GET', [-80, 740]),
  code('c5', 'Rodar autoteste', selftestJs, [200, 740]),
  node('r5', 'Responder autoteste', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'firstIncomingItem', options: {} }, [520, 740]),
  node('m1', 'Autoteste manual', 'n8n-nodes-base.manualTrigger', 1, {}, [-80, 890]),
  code('c6', 'Rodar autoteste (manual)', selftestJs, [200, 890]),
];
// posições dos nós de resposta
nodes.find((n) => n.id === 'r3').position = [520, 380]; nodes.find((n) => n.id === 'r4').position = [520, 530];
const conns = {
  ...link('A cada 5 segundos', 'Executar tarefas do painel'), ...link('A cada minuto', 'Enviar e monitorar'),
  ...link('Webhook WhatsApp (Evolution)', 'Gravar mensagem do WhatsApp'), ...link('Gravar mensagem do WhatsApp', 'Responder WhatsApp'),
  ...link('Webhook Telegram (bot)', 'Validar e gravar Telegram'), ...link('Validar e gravar Telegram', 'Responder Telegram'),
  ...link('Autoteste (GET)', 'Rodar autoteste'), ...link('Rodar autoteste', 'Responder autoteste'), ...link('Autoteste manual', 'Rodar autoteste (manual)'),
};
files['00-central-completo.json'] = { ...wf('Central de Promoções — COMPLETO (importe só este)', nodes, conns, { executionTimeout: 240, saveManualExecutions: true }), tags: [] };

for (const [f, w] of Object.entries(files)) writeFileSync(join(out, f), JSON.stringify(w, null, 2) + '\n');
console.log('Webhooks (caminho após /webhook/):', JSON.stringify(paths));
console.log('Gerados:', Object.keys(files).map((f) => 'deploy/n8n/' + f).join(', '));
