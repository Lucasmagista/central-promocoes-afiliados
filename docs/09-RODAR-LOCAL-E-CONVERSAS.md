# 09 — Rodar local primeiro, conversas do WhatsApp/Telegram

## 1. Fluxo recomendado: local → servidor

1. **Local, sem banco (2 minutos):** `npm run setup` e depois `npm run demo`. O painel abre com dados fictícios, inclusive as telas de WhatsApp e Telegram. Nada é enviado de verdade.
2. **Local, com Supabase de teste:** crie um projeto Supabase só para testes, rode as migrações `db/migrations/001…011` no SQL Editor, copie `admin/.env.example` para `admin/.env.local`, preencha URL e chave **anon** e rode `npm run dev`.
3. **Servidor:** com tudo aprovado, use `deploy/docker-compose.admin.yml` (ver doc 08, seção 3) e o Supabase de produção.

## 2. Comandos (na raiz do projeto)

| Comando | O que faz |
|---|---|
| `npm run setup` | Instala as dependências do painel |
| `npm run dev` | Painel em http://localhost:5173 (usa seu Supabase se `admin/.env.local` existir; senão, demonstração) |
| `npm run demo` | Painel sempre em demonstração, mesmo com `.env.local` |
| `npm test` | Verificação de tipos + testes unitários |
| `npm run check` | Tipos + testes + build de produção (rode antes de subir) |
| `npm run build` / `npm run preview` | Gera e serve a versão de produção |
| `npm run db:up` / `db:test` / `db:down` | Postgres 16 descartável no Docker; aplica as migrações 001–006 e roda os testes SQL e de concorrência |

Requisitos: Node 18.18+ (recomendado 20 LTS). Docker só é necessário para `db:*`.

Atalhos no painel: `Ctrl+K` busca e comandos, `?` lista de atalhos, `g` e depois `v`/`r`/`o`/`p`/`w`/`t`/`d`/`a` navegam, e na Fila de aprovação `j`/`k` navegam, `a` aprova, `r` rejeita.

## 3. Telas WhatsApp e Telegram

Cada tela tem três áreas: lista de conversas (filtro por grupos, canais, privadas, não lidas, arquivadas e busca), a conversa (mensagens por dia, ofertas publicadas destacadas, resposta manual) e informações (participantes, permissão, vínculo com destino de ofertas, silenciar/arquivar).

- Cada oferta enviada aparece sozinha na conversa do destino (gatilho `mirror_publication_to_chat`).
- A resposta manual entra na fila `chat_outbox`. Ela respeita a pausa global, a lista de termos proibidos, o limite de 4096 (Telegram) / 4000 (WhatsApp) caracteres e no máximo 5 pendentes por conversa. Perfil `viewer` só lê.
- Mensagem enviada cuja confirmação não chegou vira `failed` e **nunca é reenviada sozinha**: confira no app antes.
- Mensagens comuns são apagadas após `retention_days_messages` (padrão 90 dias); ofertas publicadas ficam.

## 4. O que o n8n precisa chamar (service_role)

| Evento | Função | Entrada principal |
|---|---|---|
| Mensagem recebida (Evolution `messages.upsert` / Telegram `getUpdates`/webhook) | `ingest_chat_message(p jsonb)` | `{chat:{channel,external_id,kind,title,username,participant_count,we_are_admin}, direction:'in', external_id, sender_external_id, sender_name, body, kind, sent_at}` |
| Lista de membros (a cada hora, por grupo) | `sync_chat_participants(p_chat uuid, p jsonb)` | `p_chat` é o `chat_id` devolvido por `ingest_chat_message`/`upsert_chat`; `p` = `[{external_id, display_name, role}]` |
| Dados do grupo mudaram | `upsert_chat(p jsonb)` | mesmo objeto `chat` acima |
| Fluxo de saída (a cada 10 s) | `claim_chat_outbox(worker)` → enviar → `complete_chat_outbox(id, message_id)` ou `fail_chat_outbox(id, erro)` | `claim` devolve `null` se não houver nada ou se estiver pausado |
| Limpeza (diária) | `purge_old_messages()` | — |

Mensagens enviadas pelo próprio n8n (ofertas) **não** precisam ser ingeridas: o gatilho já espelha a publicação.

## 5. Tipos de produto por destino (migração 007)

Cada destino pode aceitar **só certos tipos** (ex.: um grupo só de itens para carro). A lista fica em `product_categories` (17 tipos: eletrônicos, informática, games, casa, cozinha, carro e moto, moda, beleza, saúde, esporte, bebês, brinquedos, ferramentas, pet, mercado, livros, outros) e o destino guarda os *slugs* em `destinations.categories`. Lista vazia = aceita tudo.

- O tipo de uma oferta vem do texto da categoria da plataforma (`category_slug`, por palavra-chave). Sem correspondência vira `outros`; categoria vazia fica sem tipo e é aceita em qualquer destino.
- `approve_offer` **bloqueia** o envio para destinos cujo filtro não inclui o tipo. No painel, o destino fica desabilitado no modal de aprovação, com o motivo.
- Se a classificação automática errou, troque o tipo na fila de aprovação (lista ou Kanban): `set_offer_category`.
- As palavras-chave são editáveis em `product_categories.keywords`.

## 6. Grupos: listar, criar e verificar (tarefas `channel_jobs`)

O painel nunca fala com a Evolution API nem com o Telegram. Ele grava um pedido em `channel_jobs` e o **n8n** executa, no mesmo padrão das filas de envio.

| Pedido no painel (`authenticated`) | `kind` | O que o n8n faz |
|---|---|---|
| `request_group_refresh(canal)` | `refresh_groups` | WhatsApp: Evolution `group/fetchAllGroups`. Telegram: chats já conhecidos pelo bot. Devolve `{groups:[{external_id,title,kind,username,participant_count,we_are_admin}]}` |
| `request_group_creation(canal, nome, descrição, participantes, chave)` | `create_group` | Somente WhatsApp (admin; 3 a 100 caracteres no nome; 1 a 256 participantes; máx. 3 por dia). Evolution `group/create`. Devolve `{external_id,title,participants:[…]}` |
| `request_chat_verify(canal, @usuário ou id)` | `verify_chat` | Somente Telegram: `getChat` + `getChatMember` do bot. Devolve `{chat:{external_id,kind,title,username,participant_count,we_are_admin}}` |
| `cancel_channel_job(id)` | — | Cancela tarefa ainda pendente |

Fluxo do n8n (a cada 10 s, igual ao de saída): `claim_channel_job(worker)` → executar → `complete_channel_job(id, resultado)` ou `fail_channel_job(id, erro)`. `claim` devolve `null` se não há nada.

Regras de segurança:
- **Criar grupo nunca é repetido.** Se a reserva vence (180 s) a tarefa vira `failed` com a instrução de conferir no aplicativo antes de tentar de novo; assim não nascem dois grupos.
- A pausa global bloqueia criação de grupo e envios; a leitura (`refresh_groups`) continua.
- O pedido é idempotente pela chave enviada (duplo clique não cria dois grupos).
- Nomes passam pela lista de termos proibidos; telefones são normalizados (10 a 15 dígitos, sem duplicados).
- **Telegram não deixa bots criarem grupos ou canais.** O assistente de novo destino explica isso e oferece “Adicionei o bot em um canal novo”: o painel verifica se o bot enxerga e é administrador.

## 7. Conectores: configuração validada

`connectors.config` aceita apenas: `affiliate_id`/`affiliate_tag`, `credential_ref` (só o *nome* da credencial no n8n), `poll_minutes` (5–1440), `min_discount_pct` (0–95), `min_score` (0–100), `max_items_per_run` (1–500), `min_price`/`max_price` (≥ 0), `categories` (slugs conhecidos) e `sources` (https e domínios permitidos). O banco recusa chaves com nome de segredo (token, senha, api_key…) e valores que parecem chaves. O modo **API pronta** só é aceito com o checklist completo.

## 8. Telas novas do painel

- **/#/conversas**: WhatsApp e Telegram em tela cheia (abre em outra aba pelo botão do menu), com a visão **Grupos** (tabela de grupos, permissões, vínculo com destino e atalho “Criar destino”).
- **Destinos**: assistente em 4 passos (canal → grupo existente/criar/verificar/informar → tipos de produto → regras de envio).
- **Templates**: variáveis clicáveis, negrito/itálico/link, prévia por situação, histórico com restauração (`template_versions`).
- **Publicações**: cards por status, filtros, seleção em massa (cancelar/enviar agora), reagendar (`reschedule_publication`), linha do tempo, exportar CSV.
- **Fila de aprovação**: modo lista e **Kanban** (Para revisar → Aprovadas / Rejeitadas; Rejeitadas → Para revisar via `reopen_offer`). Também troca o tipo do produto.

## 9. Integrações (WhatsApp, Telegram, lojas) e n8n

Tudo é configurado em **Configurações** (abas WhatsApp, Telegram, n8n) e em **Conectores → Configurar → API oficial**.

**Como funciona.** O painel nunca fala com a Evolution, o Telegram ou as lojas. Ele grava uma ordem no banco (tarefa) e o n8n executa e devolve o resultado. Por isso o n8n precisa estar com os workflows ativos.

**Passo a passo**
1. Aplique a migração `db/migrations/008_integracoes.sql` (SQL Editor do Supabase, depois das anteriores).
2. No n8n defina as variáveis de ambiente `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, e reinicie o n8n. A service_role fica só no n8n.
3. Importe os 4 arquivos de `deploy/n8n/` (Workflows → Import from file) e ative. Nos dois de entrada, troque `TROQUE-ESTE-TEXTO` no caminho do webhook por um texto longo e aleatório.
4. WhatsApp: endereço `https://whatsapp.hubly.software`, nome da instância, chave (apikey). Salve, “Conectar com QR code”, leia no celular. Cole o endereço do webhook do n8n e clique em “Configurar na Evolution”.
5. Telegram: token do @BotFather, ative, “Verificar bot”. Adicione o bot como administrador do canal e use Destinos → Buscar grupos.
6. Lojas: Conectores → Configurar → API oficial. Salve o conector e clique em “Testar conexão”.

**Segredos.** Chaves e tokens são só de escrita: vão para a tabela `integration_secrets` (sem acesso pelo navegador) e a tela mostra apenas os 4 últimos caracteres. A auditoria registra que foram trocados, nunca o valor.

**Regenerar os workflows** após mexer em `deploy/n8n/central-worker.mjs`: `npm run n8n:build`. **Testar o worker** sem tocar em nada real: `npm run n8n:test`.

**Limites conhecidos.** O formato da API da Shopee e o fluxo OAuth do Mercado Livre foram escritos conforme a documentação pública e ainda não foram validados com as suas credenciais; a verificação da Amazon só confere o preenchimento.

## 10. Gerenciar grupos e conexão direta (migração 009)

**Migração:** rode `db/migrations/009_grupos_acoes.sql` depois da 008 e reimporte os 4 workflows do n8n (`npm run n8n:build` gera de novo). O workflow "Ações do painel" agora tem tempo limite de 240 s porque adicionar muita gente é feito em lotes com espera.

**Gerenciar grupo** (Conversas → Grupos → *Gerenciar*, ou no painel de informações de uma conversa; só administrador do painel):
- WhatsApp: nome, descrição, só administradores enviam, só administradores editam dados, mensagens temporárias, link de convite (ver/revogar), adicionar/remover/promover/rebaixar, convite por mensagem privada e sair.
- Telegram: título, descrição, membros podem enviar, link de convite (criar/revogar), administradores, contagem de membros e sair. Bots não criam grupos nem adicionam pessoas.
- Leituras (info, participantes, link) funcionam mesmo com a pausa geral; alterações não. Alteração com reserva vencida nunca é repetida: a tarefa falha e pede conferência no aplicativo.
- Limites: 30 alterações a cada 10 min por usuário e 200 participantes adicionados em 24 h (`max_participant_adds_per_day`).

**Padrões de grupo novo:** Configurações → WhatsApp/Telegram → "Grupos: padrões…". Ao criar um grupo o worker aplica só-admins-enviam, travar dados, mensagens temporárias, aviso de afiliado na descrição, link de convite e adiciona os participantes em lotes (`add_batch_size`, `add_delay_s`).

**Conexão direta (WhatsApp):** no passo 2 escolha "Direto (QR na hora)". O navegador fala com a Evolution sem passar pelo n8n: o QR renova a cada 20 s e a tela detecta quando o celular lê. A chave fica só na sessão da aba (some ao fechar) e não vai ao banco; a Evolution precisa aceitar o endereço do painel em `CORS_ORIGIN`. Se der erro de CORS, use "Via n8n". Essas chamadas diretas não entram na auditoria.

**Tema escuro e barra lateral:** a barra lateral recolhe pelo botão redondo na borda ou por Ctrl/Cmd+B.

## 11. n8n: arquivo único e testes pelo painel (migração 010)

**Arquivo:** `deploy/n8n/00-central-completo.json` reúne tudo num workflow só (ações do painel a cada 5 s, envios e monitor a cada minuto, webhook do WhatsApp, webhook do Telegram, autoteste por GET e autoteste manual). Importe só ele e ative. Os caminhos dos webhooks têm código aleatório, guardado em `deploy/n8n/webhook-paths.json` (não compartilhe). `npm run n8n:build` regenera os arquivos mantendo os mesmos caminhos.

**Variáveis do n8n:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. Não precisa mais de `NODE_FUNCTION_ALLOW_BUILTIN` (o SHA-256 da Shopee agora é feito sem `crypto`).

**Testes (Configurações → n8n):** autoteste completo, webhooks de entrada, WhatsApp, Telegram, monitor agora, ciclo de envio agora e contagem de mensagens recebidas em 24 h. Cada teste mostra em quantos segundos o n8n respondeu. O autoteste também pode ser aberto no navegador pelo nó “Autoteste (GET)”.
