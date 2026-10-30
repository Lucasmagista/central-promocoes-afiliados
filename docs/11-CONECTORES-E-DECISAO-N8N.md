# 11 — Conectores com conta real e a decisão sobre o n8n

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
| Painel de conectores | Cartões com 12 linhas iguais (“nunca”, “não informado”, “—”), tudo vazio, sem dizer o próximo passo. Configuração em 5 abas técnicas (Geral, Afiliado, API, Coleta, Fontes) e um checklist que pedia “nome da credencial no n8n”. |
| ML e Shopee | Só existia o botão “Testar conexão”. O Mercado Livre usava `client_credentials` (valida o app, **não** a sua conta). Nenhum código buscava ofertas: a tabela de execuções ficava vazia (“Fase 6”). |
| n8n | Rodava 4 coisas: tarefas do painel (5 s), envio+monitor (1 min), webhooks da Evolution/Telegram e autoteste. Nenhuma delas precisa do n8n em si: a lógica inteira já morava em `deploy/n8n/central-worker.mjs`. |
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

## 4. Precisamos manter o n8n?

**Resposta: não. Mantenha só se você já usa o n8n para outras coisas.** Para esta Central ele é um intermediário sem função própria.

| O que o n8n faz aqui | Precisa dele? | Alternativa (já implementada) |
|---|---|---|
| Cron de 5 s e de 1 min | Não | `setInterval` com trava contra execução dupla |
| Receber webhooks (Evolution, Telegram) | Não | Servidor HTTP de 30 linhas, com porteiro, limite de taxa e segredo |
| Guardar segredos | Não (e piora) | A `service_role` já fica só no worker; os demais segredos estão no cofre do banco |
| Editor visual / retries | Não usado: a lógica é código, não nós |  |

Custos de mantê-lo: reimportar o JSON (~100 KB de código embutido) a cada atualização; variável `N8N_BLOCK_ENV_ACCESS_IN_NODE`; sandbox sem `URL` nem `crypto` (o worker traz SHA-256 próprio por causa disso); a chave `service_role` embutida no workflow exportado; 17 mil execuções por dia só para “perguntar se há tarefa”; um serviço a mais para atualizar e monitorar.

**Recomendação:** use o worker próprio (`deploy/worker`, mesma lógica, mesma bateria de 133 testes) e desligue os workflows do n8n depois de validar. O sinal de vida (`heartbeat n8n`) e a aba Configurações → Worker continuam valendo.

### Migrar (10 minutos, reversível)
1. Aplique `db/migrations/012_contas_afiliado.sql` e `013_novas_plataformas.sql`.
2. Na pasta `deploy/`: copie `worker/worker.env.example` para `worker/worker.env` e preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. `docker compose -f docker-compose.worker.yml --env-file worker/worker.env up -d --build`
4. Aponte o Nginx Proxy Manager para `promo-worker:8787` (ex.: `https://worker.seudominio.com.br`). Os caminhos dos webhooks aparecem em `docker logs promo-worker`.
5. Cole os novos endereços de webhook nas abas WhatsApp e Telegram do painel e use “Definir webhook”.
6. **Desative** o workflow no n8n (não rode os dois juntos: seriam dois consumidores da mesma fila).
7. Configurações → Worker → *Rodar autoteste*.

Para voltar ao n8n: pare o contêiner, reative o workflow e reponha os webhooks.

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
- `deploy/n8n/central-worker.mjs` (lojas, OAuth, coleta) · `scripts/n8n-test.mjs` (133 verificações)
- `deploy/worker/` e `deploy/docker-compose.worker.yml` (worker próprio)
- `admin/src/pages/Connectors.tsx` (painel) · `admin/src/main.tsx` (retorno do OAuth)

## 8. Servidor (Oracle) — o que mudou no projeto
- **nginx do painel** (`admin/nginx.conf` + `admin/security-headers.conf`): os cabeçalhos de segurança (CSP, X-Frame-Options, nosniff…) agora valem em todas as rotas. Antes o `add_header` do `location /` anulava os do `server`.
- **Webhook da Evolution pela rede interna** (migração `014`): a Evolution e o worker estão na `hubly-network`, então use `http://promo-worker:8787/hook/whatsapp-…` (o caminho aparece em `docker logs promo-worker`). Só nome de serviço Docker é aceito; para qualquer outro endereço continua valendo https. O **Telegram** precisa de https público (quem chama é o Telegram), por exemplo `https://worker.seudominio.com.br/hook/telegram-…` com um host no Nginx Proxy Manager apontando para `promo-worker:8787`.
- **`deploy/servidor/atualizar.sh`** agora também sobe o worker quando existir `deploy/worker/worker.env` (ignorado pelo Git). Para agendar: `sudo ./deploy/servidor/instalar-auto-update.sh` (roda uma vez).
- **Migração no servidor, em ordem:** aplicar `012`, `013`, `014` no Supabase → criar `worker.env` → `atualizar.sh --force` → autoteste → trocar webhooks → desativar o workflow no n8n.
