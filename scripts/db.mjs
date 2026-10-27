// Banco local de teste via Docker. Aplica as migrações em um Postgres 16 descartável e roda os testes SQL.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'deploy', 'docker-compose.local-db.yml');
const [cmd] = process.argv.slice(2);
const docker = (args, opts = {}) => spawnSync('docker', args, { stdio: 'inherit', ...opts });
const has = spawnSync('docker', ['--version'], { stdio: 'ignore' });
if (has.status !== 0) { console.error('Docker não encontrado. Instale o Docker Desktop (ou use um Postgres 16 próprio e rode db/tests/run.sh com PGHOST/PGUSER).'); process.exit(1); }
const compose = (args) => docker(['compose', '-f', file, ...args]).status ?? 1;

switch (cmd) {
  case 'up': process.exit(compose(['up', '-d', '--wait']));
  case 'down': process.exit(compose(['down', '-v']));
  case 'psql': process.exit(docker(['exec', '-it', 'promo-local-db', 'psql', '-U', 'postgres']).status ?? 1);
  case 'test': {
    const r = docker(['exec', '-e', 'PGUSER=postgres', '-w', '/db/tests', 'promo-local-db', 'bash', 'run.sh']);
    if (r.status !== 0) console.error('\nSe o contêiner não existe, rode antes: npm run db:up');
    process.exit(r.status ?? 1);
  }
  default: console.log('Uso: node scripts/db.mjs <up|down|test|psql>');
}
