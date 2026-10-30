# 11 — Conectores com conta real e o worker

## 0. Novidades da migração 013 (Amazon, AliExpress, Magalu)

| Plataforma | Como conecta | Coleta automática | Observações |
|---|---|---|---|
| **Amazon** | Creators API (OAuth 2.0): Credential ID + Secret + versão (3.1 = Américas, inclui Brasil) + tag de associado | Sim, por palavra-chave | O `detailPageURL` já traz a sua tag. Preço de referência vem do `savingBasis` da própria Amazon. Exige vendas qualificadas, ~1 consulta/s e preços atualizados (até 24 h). Mantenha link curto desligado. |
| **AliExpress** | Affiliate API: App Key + App Secret (console Open Platform) + Tracking ID (portal de afiliados). Assinatura HMAC-SHA256 | Sim, mais vendidos por termo, em BRL, entrega para o Brasil | Sem Tracking ID a API devolve lista vazia sem erro. O endereço da API é configurável. |
| **Magalu** | Sem API pública de afiliados confirmada | Não: entrada manual em “Nova oferta” | Há ID de afiliado e modelo de link. Se o Parceiro Magalu liberar API, o encaixe é o mesmo das outras lojas. |

**Antes de confiar:** a Amazon (endereço do token e `searchItems`) foi conferida na documentação oficial da Creators API; o formato exato da AliExpress (gateway `api-sg.aliexpress.com/sync`, timestamp em ms, HMAC-SHA256) vem de guias de terceiros e **não foi confirmado na documentação oficial**, e nada foi rodado com as suas credenciais. O botão “Testar conexão” mostra o erro exato devolvido pela loja. Para outras redes que você já assinou (Awin, Lomadee, Hotmart, Americanas, Casas Bahia…), diga quais são: cada uma precisa de uma API verificada antes de entrar.

## 1. O que existia (diagnóstico)

| Área | Situação antes |
|---|---|
| Painel de conectores | Cartões com 12 linhas iguais (“nunca”, “não informado”, “—”), tudo vazio, sem dizer o próximo passo. Configuração em 5 abas técnicas (Geral, Afiliado, API, Coleta, Fontes) e um checklist que pedia “nome da credencial no worker”. |
| ML e Shopee | Só existia o botão “Testar conexão”. O Mercado Livre usava `client_credentials` (valida o app, **não** a sua conta). Nenhum código buscava ofertas: a tabela de execuções ficava vazia (“Fase 6”). |
| Worker | Executa as tarefas do painel (5 s), envio e monitor (1 min), webhooks da Evolution/Telegram e coleta das lojas, tudo em `deploy/worker`. |
| Bug latente | `011_database_providers.sql` filtrava o status das integrações com `'int\\_status\\_%'`, que não casa com `int_status_*`: o worker recebia status vazio (alertas de queda do WhatsApp comparavam com “nada”). Corrigido na 012. |

## 2. O que mudou

### Painel (Conectores)
- Resumo no topo: contas conectadas, coleta automática ligada, última coleta.
- Cada cartão mostra **o próximo passo**: Conectar → Autorizar conta → Testar → Ligar coleta.
- Conta conectada aparece no cartão (ML: apelido, reputação, ID; Shopee: App ID e comissão/conversões dos últimos 30 dias).
- Ações diretas: **Ver amostra** (produtos reais, sem gravar nada), **Coletar agora**, **Testar**, interruptor **Coleta automática** (pede confirmação e registra a revisão dos termos de hoje).
- Editor reorganizado: *Conta e API* (passo a passo, credenciais, conectar/testar) · *Coleta* (frequência, filtros, termos de busca) · *Afiliado e links* (ID, modelo do link) · *Avançado* (modo, termos, fontes).
- Aviso quando o worker está parado (antes o botão ficava “aguardando” sem explicação).

### Integração real
- **Mercado Livre — OAuth.** “Conectar conta” leva ao login oficial, volta para `/oauth/mercadolivre` e o worker troca o código pelos tokens. Os tokens ficam no cofre (`integration_secrets`), o `refresh_token` é renovado automaticamente (ele é de uso único; há proteção contra duas renovações simultâneas) e o código do OAuth é apagado da tarefa assim que ela termina. O painel nunca vê token nem Secret.
- **Shopee — Open API.** A “conta” é o par App ID + Secret. O worker lê produtos (`productOfferV2`) já com o link rastreado (`offerLink`) e a taxa de comissão, e o relatório de conversões (`conversionReport`).
- **Coleta.** Busca por termos (por tipo de produto ou os seus), filtra (desconto comprovado, estoque, novo/usado, faixa de preço, score) e entrega por `ingest_offer` com `source_kind = 'api'`. Tudo cai na **Fila de aprovação**; nada publica sozinho. Cada execução aparece em “Execuções recentes”. Automática a cada `poll_minutes`, só no modo *API pronta*.

## 3. Limites honestos das APIs (leia antes de ligar)

- **Mercado Livre não tem API de afiliados.** A API lê conta e produtos, mas não gera link de afiliado nem informa comissão. Por isso existe o *modelo do link* (`{url}?matt_tool=SEU_ID`): copie o formato de um link gerado no painel do programa e troque o endereço do produto por `{url}`. Sem modelo, a oferta chega sem link e você cola o link ao aprovar. **Confira a primeira oferta** antes de confiar no rastreio.
- O ML tem restringido a busca pública para alguns aplicativos. Se “Ver amostra” devolver 403, o painel mostra o motivo; é o aplicativo (escopos/permissões), não o painel.
- **Shopee:** o preço anterior é derivado de `priceDiscountRate` (preço ÷ (1 − desconto)). A evidência da oferta registra `preco_anterior_derivado`. Os nomes dos campos GraphQL foram escritos conforme a documentação pública; se a Shopee recusar algum campo, o worker repete a consulta com um conjunto mínimo.
- Nada disto foi executado contra as APIs reais (precisa das suas credenciais). Os testes usam servidores falsos. **O primeiro teste de verdade é o botão “Testar conexão”.**
- Respeite os termos de cada programa (frequência, uso de dados, links encurtados). O interruptor de coleta registra a data da revisão e o painel cobra nova revisão a cada 30 dias.

## 4. O worker

Um processo Node sem dependências (`deploy/worker/server.mjs` + `central-worker.mjs`), em Docker (`deploy/docker-compose.worker.yml`). Faz o cron de 5 s e de 1 min com trava contra execução dupla, recebe os webhooks (com porteiro, limite de taxa e caminho secreto) e guarda a `service_role` só no `worker.env`. Testes: `npm run worker:test`.

### Subir
1. Aplique as migrações `012` a `015` no Supabase.
2. No servidor: `deploy/worker/worker.env` com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. `./deploy/servidor/atualizar.sh --force` (ou `deploy/servidor/subir.ps1`, no seu computador).
4. Configurações → Worker → *Rodar autoteste*.

## 5. Conectar o Mercado Livre (passo a passo)
1. Em Mercado Livre Developers, crie um aplicativo (conta do Programa de Afiliados). Em *URL de redirecionamento* cadastre `https://SEU-PAINEL/oauth/mercadolivre` (o painel mostra o endereço exato e tem botão Copiar).
2. Conectores → Mercado Livre → *Configurar* → cole App ID e Secret Key → *Salvar e testar* (deve dizer “falta autorizar a conta”).
3. *Conectar conta* → autorize → volta ao painel conectado.
4. *Ver amostra* → confira produtos e descontos. Ajuste filtros na aba *Coleta*.
5. Aba *Afiliado e links*: configure o modelo do link.
6. Ligue *Coleta automática* no cartão.

O domínio do painel precisa ser servido em `/oauth/mercadolivre` (o `nginx.conf` já devolve o `index.html` para qualquer caminho).

## 6. Conectar a Shopee
Painel de afiliados da Shopee → Open API → copie App ID e Secret → Conectores → Shopee → *Configurar* → *Salvar e testar* → *Ver amostra* → ligue a coleta.

## 7. Arquivos
- `db/migrations/012_contas_afiliado.sql` e `013_novas_plataformas.sql` · `db/tests/17_tests_contas.sql`
- `deploy/worker/central-worker.mjs` (lojas, OAuth, coleta) · `scripts/worker-test.mjs`
- `deploy/worker/` e `deploy/docker-compose.worker.yml` (worker)
- `admin/src/pages/Connectors.tsx` (painel) · `admin/src/main.tsx` (retorno do OAuth)

## 8. Servidor (Oracle)
- **nginx do painel** (`admin/nginx.conf` + `admin/security-headers.conf`): cabeçalhos de segurança em todas as rotas.
- **Webhook da Evolution pela rede interna** (migração `014`): `http://promo-worker:8787/hook/whatsapp-…`. O **Telegram** precisa de https público (ex.: `https://worker.seudominio.com.br/hook/telegram-…`, host no proxy apontando para `promo-worker:8787`).
- **Deploy:** `deploy/servidor/atualizar.sh` (no servidor) e `deploy/servidor/subir.ps1` (no seu computador: testa, envia ao GitHub e atualiza o servidor). O worker sobe junto quando existe `deploy/worker/worker.env`.
