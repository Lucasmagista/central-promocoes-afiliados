# 12 — Radar de grupos, automação, medição e operação (migração 016)

## 1. O que existe agora

| Área | O que faz | Onde |
|---|---|---|
| **Radar de grupos** | Lê as mensagens dos grupos que você monitora (WhatsApp e Telegram), segue os links encurtados até a loja, confere o produto na API da loja, gera **o seu** link de afiliado (só se o produto estiver no seu programa) e manda a oferta para a Fila de aprovação | painel → Radar de grupos |
| **Revalidação** | Antes de enviar, confere o preço na loja. Mudou mais que o limite ou acabou o estoque: cancela o envio e devolve a oferta para revisão | automático |
| **Score v2** | Soma comissão, vendas, nota e nº de fontes; rebaixa "de/por" inflado | automático |
| **Variação de texto** | `[[opção 1\|opção 2]]` nos templates sorteia uma opção a cada envio | Templates |
| **Roteamento e aprovação automática** | Regras "este tipo de oferta vai para este grupo" e aprovação sozinha com nota de corte e limite diário | painel → Regras e automação |
| **Produtos acompanhados** | Confere o preço a cada 30 min e cria oferta na queda ou no preço-alvo | painel → Produtos acompanhados |
| **Coleta melhor** | Várias páginas, ordenação por comissão/vendas/desconto, termos de busca editáveis, tendências do Mercado Livre, "mais vendidos" da AliExpress | Conectores e Regras e automação |
| **Link curto + cliques** | O worker redireciona `/r/<código>` e conta cliques (robôs de pré-visualização não contam) | `https://worker.hubly.software/r` |
| **Rastreio por grupo** | Cada destino tem um identificador; no link curto o worker personaliza o link por grupo (Amazon: subtag; Shopee: subId) | automático |
| **Comissões** | Sincroniza o relatório de conversões da Shopee a cada 2 h e mostra por loja e por grupo | Analytics |
| **Operação** | Alertas no Telegram (fila parada, coleta com erro, token do ML…), limpeza periódica, backup do Supabase, CI | ver §6 |
| **Colocar no ar** | Checklist na Visão geral enquanto falta algo essencial | Visão geral |

## 2. Como subir

1. **Supabase → SQL Editor:** rode `db/migrations/016_radar_automacao.sql` (a 015 já foi) e depois `db/migrations/017_conexao_guiada.sql` (conexão guiada + imagens).
2. No computador: `.\deploy\servidor\subir.ps1 "Radar e automação"`.
3. **Configurações → Operação → Link curto:** `https://worker.hubly.software/r` (sem isso, o texto leva o link direto e não há cliques nem rastreio por grupo).
4. **Configurações → Worker → Rodar autoteste** e confira o sinal de vida.
5. Opcional, uma vez, no servidor: `sudo ./deploy/servidor/instalar-auto-update.sh` (atualiza a cada push) e o backup (§6).

## 3. Roteiro de testes (nesta ordem)

1. **Visão geral:** o card "Colocar no ar" lista o que falta.
2. **Radar → Testar um link:** cole um link de produto da Shopee/Amazon/AliExpress (pode ser encurtado). Deve mostrar as 3 etapas e o produto. Se parar em "Seguir o link", o encurtador não foi reconhecido; se parar em "Consultar o produto", o produto não está no seu programa ou o conector não está configurado.
3. **Radar → Monitorar um grupo:** escolha um grupo (pré-requisitos no §4), deixe em **revisão** e mande um link de teste nele.
4. Em até ~30 s o link aparece em "Últimos links capturados" e, se elegível, uma oferta na **Fila de aprovação** (origem "Radar: nome do grupo", camada C).
5. **Aprove e confira o envio** no grupo de teste. Clique no link curto e veja o clique em Analytics.
6. **Revalidação:** aprove uma oferta, mude o preço-alvo de teste ou use um produto que oscila; se o preço mudar mais que o limite, a publicação é cancelada e a oferta volta para revisão com nota explicando.
7. **Produtos acompanhados:** adicione um produto com preço-alvo acima do preço atual: a oferta deve surgir em até 30 min.
8. **Regras e automação:** crie uma regra e ligue "Aprovar sozinho" **só depois** de validar o grupo de teste.

## 4. Radar: pré-requisitos e regras

- **WhatsApp:** o número conectado na Evolution precisa estar dentro do grupo. Use um número dedicado.
- **Telegram:** o bot precisa estar no grupo e receber todas as mensagens: BotFather → `/setprivacy` → *Disable* (ou torne o bot administrador). **Canais de terceiros não dá com bot** (só quem é administrador lê). O encaminhamento de ofertas para uma conversa privada com o bot ainda não está implementado.
- Grupos que já são **destinos** não podem ser fonte (evita repostar as próprias ofertas).
- Descarta-se tudo que não for de loja suportada; encurtadores só são seguidos por uma lista de domínios (anti-SSRF).
- **O texto e a imagem da mensagem original não são copiados.** Título, preço, imagem e link vêm da API da loja.
- **O preço do texto não é confiado:** se o preço atual na loja estiver mais de 20% acima do anunciado, a oferta é descartada como "promoção encerrada".
- **Produto fora do seu programa → descartado.** Nunca se usa o link de afiliado de terceiros.
- Mercado Livre: precisa de conta conectada e do **modelo do link** (sem API de afiliados). Magalu: sem API, não entra no Radar (cadastro manual).
- Limites por fonte (ofertas por hora), palavras bloqueadas no título e desconto mínimo por fonte.
- Mensagens das fontes são apagadas em 7 dias; links capturados em 30.

## 5. Automação

- **Aprovação automática** só roda em modo *revisão* ou *automático* (nunca em simulação), respeita a categoria aceita por cada destino, os limites de envio e um teto diário. Aprovação sem usuário aparece na auditoria.
- Fontes do Radar em modo **automático** ficam elegíveis se a nota passar de `radar_auto_min_score`. Comece sempre em **revisão**.
- Se o WhatsApp devolver erro de limite, o ciclo de envio para e tenta de novo no minuto seguinte (a publicação volta com atraso).

## 6. Operação

- **Alertas** (Telegram do administrador): publicações paradas há +45 min, envio incerto, 3+ falhas definitivas em 24 h, coleta com erro, 20+ ofertas esperando e acesso do Mercado Livre expirado. Cada alerta repete no máximo a cada 2 h (`alert_cooldown_min`).
- **Limpeza** a cada 6 h: ofertas vencidas, mensagens antigas, cache, cliques e capturas antigas.
- **Backup do Supabase:** crie `deploy/backup.env` com `SUPABASE_DB_URL` (senha do banco) e rode `sudo ./deploy/servidor/instalar-backup.sh`. Gera `/mnt/data/backups/supabase/*.sql.gz` por dia (14 dias).
- **CI:** `.github/workflows/ci.yml` roda os testes do worker, do painel e do banco a cada push (o job do banco começa como aviso).
- **/status e /metrics** do worker só respondem pela rede interna (sem `x-forwarded-for`): `docker exec promo-worker wget -qO- localhost:8787/status`.

## 7. O que NÃO foi validado com as APIs reais (confira no primeiro uso)

Os testes usam servidores falsos. Estes pontos vêm da documentação pública ou de guias e podem precisar de ajuste; o painel mostra o erro exato da loja:
- **Shopee:** o filtro por `itemId`, a mutation `generateShortLink` (link por grupo) e os campos de `conversionReport` (`conversionId`, `utmContent`). Se uma consulta falhar, o worker tenta um conjunto menor de campos; sem isso, a oferta/revalidação é ignorada com aviso.
- **Amazon:** o formato da resposta de `getItems` e o parâmetro `ascsubtag` (rastreio por grupo).
- **AliExpress:** `productdetail.get` e `hotproduct.query` (campos e assinatura).
- **Mercado Livre:** `/items/{id}`, `/trends/MLB` e o modelo `matt_tool` do link.
- **Telegram:** captura de links escondidos em texto e botões depende de o bot receber a mensagem inteira (privacy mode desligado).

## 8. Fora do escopo desta entrega (de propósito)

Resumo diário de ofertas, janelas de "maior movimento", termos proibidos por plataforma, cupons confirmados, userbot do Telegram (viola os termos), encaminhamento privado para o bot, testes de ponta a ponta no navegador e leitura do `/metrics` pelo Beszel (ele não faz scraping; use o `/status`).

## 9. Arquivos principais

`db/migrations/016_radar_automacao.sql` · `db/tests/18_tests_radar.sql` · `deploy/worker/central-worker.mjs` (revalidação, Radar, acompanhamento, comissões, alertas) · `deploy/worker/server.mjs` (agendador, redirecionador, `/status`) · `scripts/worker-test.mjs` · `admin/src/pages/{Radar,Automation,Watchlist}.tsx` · `admin/src/components/{GoLive,CommissionsCard}.tsx` · `deploy/servidor/{backup-supabase,instalar-backup}.sh` · `.github/workflows/ci.yml`
