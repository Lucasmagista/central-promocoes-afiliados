// Comandos multiplataforma (Windows/Linux/macOS) que delegam para a pasta admin/.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = join(root, 'admin');
const [cmd, ...rest] = process.argv.slice(2);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) { console.error(`Node ${process.versions.node} é antigo demais. Instale o Node 18.18 ou superior (recomendado: 20 LTS).`); process.exit(1); }

function sh(args, extra = [], env = {}) {
  // cwd em vez de --prefix: caminhos com espaço (ex.: "Lucas Magista") quebram no cmd do Windows.
  const r = spawnSync(npm, [...args, ...extra], { cwd: admin, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const ready = () => { if (!existsSync(join(admin, 'node_modules'))) { console.log('Dependências ainda não instaladas: rodando "npm run setup" antes.\n'); sh(['install']); } };
const step = (t) => console.log(`\n▶ ${t}`);

switch (cmd) {
  case 'setup': step('Instalando dependências do painel (admin/)'); sh(['install']);
    console.log('\nPronto. Próximos passos:\n  npm run demo   → painel com dados fictícios (não precisa de banco)\n  npm run dev    → painel ligado ao seu Supabase (copie admin/.env.example para admin/.env.local)\n  npm test       → verificação de tipos + testes'); break;
  case 'dev': ready();
    if (rest.includes('--demo')) console.log('Modo demonstração: abra o endereço mostrado abaixo. Dados fictícios, nada é enviado.\n');
    else if (!existsSync(join(admin, '.env.local')) && !existsSync(join(admin, '.env'))) console.log('Sem admin/.env.local: o painel abre em modo demonstração. Para usar seu Supabase, copie admin/.env.example.\n');
    sh(['run', 'dev', '--', '--host'], [], rest.includes('--demo') ? { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' } : {}); break;
  case 'test': ready(); step('Verificação de tipos (tsc)'); sh(['run', 'typecheck']); step('Testes unitários (vitest)'); sh(['test']);
    console.log('\nTestes do painel passaram. Testes do banco: "npm run db:up" e depois "npm run db:test" (precisa de Docker).'); break;
  case 'build': ready(); sh(['run', 'build']); break;
  case 'preview': ready(); sh(['run', 'preview']); break;
  case 'check': ready(); step('Tipos'); sh(['run', 'typecheck']); step('Testes'); sh(['test']); step('Build de produção'); sh(['run', 'build']); console.log('\nTudo certo para subir.'); break;
  default: console.log('Uso: node scripts/run.mjs <setup|dev|test|build|preview|check>'); process.exit(cmd ? 1 : 0);
}
