# 08 — Painel admin, banco e permissões

> Para publicação completa na Oracle, incluindo HTTPS, n8n, backup e recuperação, siga primeiro [06-IMPLANTACAO-E-ROADMAP.md](../06-IMPLANTACAO-E-ROADMAP.md). Este documento detalha as partes de banco e painel.

## O que existe
- `db/migrations/001…011` — esquema, funções, relatórios, RLS, conversas, integrações, ações de grupo e provedores de banco.
- `db/tests` — testes em PostgreSQL real (inclui concorrência da fila).
- `admin/` — painel web (Vite + React + TypeScript). Sem as variáveis do Supabase abre em **modo demonstração** (dados fictícios em memória).
- `deploy/` — Docker Compose do painel atrás do Nginx Proxy Manager.

## 1. Banco (Supabase)
1. Crie um projeto Supabase **dedicado**.
2. No SQL Editor, rode **uma vez e na ordem numérica** todas as migrações de `001_schema.sql` até `011_database_providers.sql`.
3. A migração 011 cria o histórico de versões. Depois dela, administradores podem pedir atualizações pendentes pela aba **Banco de dados**, usando token da Management API oculto no cofre de segredos.
3. Em Authentication → Providers → Email: deixe e-mail/senha ligado.
4. No painel (já publicado), crie sua conta. Depois, no SQL Editor:
   ```sql
   select public.bootstrap_admin('seu@email.com');
   ```
   Isso só funciona **enquanto não existir administrador ativo**. Novas contas ficam inativas até um admin aprovar em *Usuários*.
5. Cole a **service_role key** apenas no n8n (credencial segura). **Nunca** no painel.

### Testes do banco (opcional, num Postgres 16 local)
```bash
cd db/tests
PGHOST=/tmp PGPORT=5544 PGUSER=pgtest ./run.sh   # ajuste host/porta/usuário
```

## 2. Painel — desenvolvimento
```bash
cd admin
npm install
npm run dev        # http://localhost:5173  (modo demonstração se não houver .env.local)
npm run typecheck && npm test && npm run build
```
Para conectar ao Supabase real: copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (**somente a anon**). Para forçar a demo mesmo com .env: abra `/?demo`.

## 3. Painel — produção (Docker)
```bash
cp deploy/admin.env.example deploy/admin.env      # preencha URL e anon key
docker compose -f deploy/docker-compose.admin.yml --env-file deploy/admin.env up -d --build
```
No Nginx Proxy Manager: novo Proxy Host → `promo-admin:80`, SSL Let's Encrypt, Force SSL. O container é somente leitura, sem capabilities extras e sem porta publicada.
Se o Supabase for autohospedado em outro domínio, ajuste `connect-src` em `admin/nginx.conf`.

## 4. O que o n8n precisa chamar (RPC com a service_role)
| Função | Quando |
|---|---|
| `claim_next_publication(worker)` | A cada ciclo: devolve **uma** publicação liberada (respeita pausa, modo, silêncio, limites e intervalo) ou `null` |
| `complete_publication(id, external_message_id)` | Envio confirmado |
| `fail_publication(id, código, permanente, retry_em_s)` | Falha conhecida (backoff exponencial até `max_attempts`) |
| `mark_publication_unknown(id, nota)` | Resposta **ambígua** (timeout depois do envio): nunca reenviar sozinho |
| `release_stale_claims()` | A cada minuto: reserva vencida vira `unknown` |
| `claim_destination_test()` / `complete_destination_test(id, ok, erro)` | Atende o botão "Enviar teste" dos destinos |
| `heartbeat(serviço, status)` | A cada minuto, por serviço (n8n, evolution-api, redirecionador) |
| `record_click(código, …)` | Redirecionador, a cada clique |
| `expire_offers()` | A cada 10–15 min |

## 5. Perfis
- **Administrador**: tudo (destinos, templates, conectores, configurações, retomar publicações, usuários).
- **Operador**: cadastra/aprova/rejeita ofertas, trata publicações, testa destinos, pode pausar tudo.
- **Leitor**: somente consulta.
O banco aplica as mesmas regras (RLS e checagem dentro das funções); esconder botões no painel é só conforto.

> Atalho: na raiz do projeto use `npm run demo`, `npm test`, `npm run check` e `npm run n8n:test` (ver doc 09).
