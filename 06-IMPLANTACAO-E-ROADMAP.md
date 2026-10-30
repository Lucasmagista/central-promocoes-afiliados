# 06 — Implantação, operação e recuperação

Este guia publica o painel e o worker na Oracle Cloud, mantendo o Supabase gerenciado. Execute primeiro em ambiente de teste; produção começa em simulação.

## 1. Pré-requisitos

- domínio para o painel, como `promocoes.seudominio.com.br`, e outro para worker;
- Oracle com Docker Engine e Docker Compose plugin instalados;
- proxy reverso HTTPS já funcional na rede Docker externa `proxy`;
- projeto Supabase de produção dedicado;
- Node 20 LTS em máquina de desenvolvimento para validar e gerar workflows;
- conta administrativa para Supabase, Telegram e Evolution API.

Não exponha portas de Postgres, worker ou Evolution diretamente à internet. Exponha só 80/443 pelo proxy; o editor do worker deve exigir autenticação forte e, preferencialmente, acesso por VPN ou IP permitido.

## 2. Preparar e validar o pacote

Na cópia que será publicada:

```powershell
npm run setup
npm run check
npm run worker:test
```

Copie apenas os arquivos do projeto. Não inclua `.env`, `node_modules`, sessões do WhatsApp, dumps nem a pasta `_to_delete` no artefato de produção. Versione o projeto em Git antes do primeiro deploy para que a versão publicada seja rastreável.

## 3. Criar e preparar o Supabase

1. Crie um projeto dedicado de produção e salve URL, chave `anon` e `service_role` em um gerenciador de segredos.
2. No SQL Editor, aplique **uma vez e nesta ordem** `db/migrations/001_schema.sql` até `011_database_providers.sql`.
3. Confirme que cada migração terminou sem erro. Não reaplique arquivos completos em banco já alterado; crie uma migração incremental para qualquer mudança futura.
4. Em Auth, deixe e-mail/senha habilitado. Após criar as contas necessárias, desative cadastro público ou mantenha-o sabendo que perfis novos ficam inativos até aprovação.
5. Crie a primeira conta no painel e execute `select public.bootstrap_admin('seu@email');` no SQL Editor. A função é inicial e não deve ser usada como mecanismo cotidiano de acesso.

Faça backup lógico antes de alterações de esquema. O Supabase gerenciado já tem recursos próprios de backup conforme o plano; mantenha também exportações periódicas e teste restauração em projeto separado.

## 4. Publicar o painel na Oracle

No servidor, crie um diretório sem segredos versionados, por exemplo `/opt/central-promocoes`. Copie o projeto e prepare `deploy/admin.env` a partir do exemplo:

```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON
```

Essas variáveis entram no build e são públicas por definição. Nunca substitua a `anon` por `service_role`.

```bash
cd /opt/central-promocoes
docker network inspect proxy >/dev/null
docker compose -f deploy/docker-compose.admin.yml --env-file deploy/admin.env up -d --build
docker compose -f deploy/docker-compose.admin.yml ps
curl -fsS http://promo-admin/healthz
```

No proxy, crie um host HTTPS apontando para `promo-admin:80`, force HTTPS e habilite certificado. O compose não publica porta diretamente e já usa filesystem somente leitura e capacidades reduzidas. Caso a rede se chame diferente de `proxy`, ajuste o compose antes de publicar.

Valide no navegador: login, carregamento das páginas, ausência de erros de CSP e a URL correta do Supabase. Configure domínio e redirecionamentos permitidos no Supabase Auth para o endereço final do painel.

## 5. Configurar o worker

O worker (`deploy/worker`) é um processo Node sem dependências que executa as tarefas do painel, publica as ofertas aprovadas, recebe os webhooks da Evolution e do Telegram e coleta ofertas das lojas. No servidor, crie `deploy/worker/worker.env` (fora do Git):

```dotenv
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=VALOR_PRIVADO
```

A `service_role` dá acesso integral ao Supabase: não a adicione ao painel, ao frontend, a logs ou ao repositório. Suba com `./deploy/servidor/atualizar.sh --force` (ou `deploy/servidor/subir.ps1`, no seu computador). Os endereços de webhook aparecem em `docker logs promo-worker`: a Evolution usa o interno (`http://promo-worker:8787/hook/whatsapp-…`) e o Telegram precisa de um https público (host no proxy apontando para `promo-worker:8787`).

### Atualização de banco pelo painel

A primeira aplicação de `011_database_providers.sql` é manual e cria o histórico de versões. Depois, em **Configurações → Banco de dados**, informe o `project ref`, escolha **Pelo worker** e guarde um token da Management API com escopo mínimo `database_read` e `database_write`. O valor fica somente no cofre de segredos; a tela mostra apenas se está configurado. O botão aplica somente arquivos posteriores aos já registrados. Faça backup e revise o SQL antes de solicitar uma atualização.

Confira no painel o heartbeat do worker. Simule uma ação e confirme que ela percorre `channel_jobs` sem chamar um canal real.

## 6. Homologar integrações

1. **Telegram:** configure token no painel, valide bot, adicione-o como administrador de canal de teste e publique uma oferta simulada.
2. **Evolution:** configure base URL, instância dedicada e chave; conecte por QR; configure webhook e exija autenticação verificável além do nome da instância.
3. **Conversas:** envie mensagem de teste, confirme ingestão, resposta enfileirada, auditoria e limpeza configurada.
4. **Marketplaces:** valide conta, API, geração de link e regras de divulgação antes de mudar para `api_ready`.

Mantenha o modo revisão durante o piloto. Use limites baixos, acompanhe `unknown`, falhas e bloqueios de canal; não habilite publicação automática até obter operação estável.

## 7. Rotina operacional

Diariamente, acompanhe painel de saúde, fila pendente, `unknown`, falhas permanentes, conversas e espaço de disco. Semanalmente, revise logs sanitizados, atualizações do worker/Evolution e configurações de conectores. Mensalmente, teste um backup/restauração, revise acesso de usuários e confirme termos dos programas de afiliados.

## 8. Recuperação

Para incidente de integração, pause publicações pelo painel e preserve registros para análise. Para envio ambíguo, confira o canal antes de resolver a publicação; nunca reenvie por suposição. Para rollback do painel, publique a imagem ou commit anterior e verifique `/healthz`. Para mudança de banco, restaure em projeto de teste, rode verificações de RLS e só então planeje janela de produção.

## Checklist de liberação

- [ ] `npm run check` e `npm run worker:test` concluídos.
- [ ] Migrações 001–011 aplicadas e registradas.
- [ ] Painel HTTPS, com `healthz` respondendo.
- [ ] worker HTTPS, autenticado, com backup e `service_role` fora do navegador.
- [ ] Primeiro administrador validado e cadastro público decidido.
- [ ] Webhooks com segredo/autenticação e URLs de produção.
- [ ] Telegram e WhatsApp testados em destinos privados.
- [ ] Backup e restauração testados.
- [ ] Publicação automática desativada até o fim do piloto.
