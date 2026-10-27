# 07 — Oito fases de implantação

Estado de partida: o **banco (SQL + testes)** e o **painel admin** já estão escritos e testados em simulação.
As fases abaixo levam o projeto a produção com segurança. Cada fase só termina quando o **critério de saída** é verificado.
Durações são estimativas para uma pessoa com Claude Code; recalibrar ao fim da Fase 2.

| Fase | Foco | Duração | Critério de saída |
|---|---|---|---|
| 1 | Descoberta e acessos | 1 semana | Checklist de acessos completo; nichos, domínio do redirecionador, número do WhatsApp e servidor definidos |
| 2 | Fundação em simulação | 1–2 semanas | Migrações aplicadas e testes passando; stacks isoladas no ar; bots criados; oferta fictícia percorre o fluxo inteiro em simulação; backup restaurado com sucesso |
| 3 | Painel admin e bot admin | 1–2 semanas | Painel com HTTPS ligado ao Supabase; primeiro administrador criado; fila, pausa global e reconciliação de unknown operadas só pelo painel |
| 4 | Pilotos de canal | 2 semanas | Telegram real em modo revisão; WhatsApp em grupo de teste com aquecimento; redirecionador contando cliques; 14 dias sem unknown pendente e sem bloqueio |
| 5 | Operação assistida | 4 semanas | Rotina diária cumprida; linha de base de 4 semanas (envios, cliques, aprovação); templates e limites ajustados com dados |
| 6 | Fontes automáticas | 3–4 semanas | Watchlist com histórico de preço; primeiro conector oficial com revisão de termos registrada; redes de afiliados avaliadas |
| 7 | Automação e escala | contínua | Auto-aprovação por categoria (regras duras + nota de corte); novos nichos; revisão mensal de termos e métricas |
| 8 | Produto Hubly (decisão) | após a Fase 7 | Decisão documentada sobre multiusuário, isolamento por cliente e suporte, com números reais |

Regras que atravessam todas as fases: WhatsApp real só depois da validação da Fase 4; auto-aprovação só a partir da Fase 7 com dados da Fase 5;
nenhum preço, desconto ou link inventado; `unknown` nunca é reenviado sozinho; segredos só em variáveis de ambiente.

---

## Fase 1 — Descoberta e acessos
**Objetivo:** eliminar incertezas que mudam o desenho antes de gastar tempo de implementação.
- [ ] Mercado Livre: confirmar elegibilidade no programa de afiliados, como gerar links e se há API/feed. Registrar a data de revisão dos termos.
- [ ] Shopee: mesmo levantamento (solicitar acesso à API de afiliados se existir).
- [ ] Amazon Brasil: Associados; confirmar regras de uso de links curtos e de exibição de preço (o preço só pode ser mostrado conforme a política vigente).
- [ ] Definir 1–2 nichos iniciais e o público.
- [ ] Domínio/subdomínio do redirecionador (ex.: `go.seudominio.com.br`).
- [ ] Número de WhatsApp **dedicado** (chip separado) e grupo de teste.
- [ ] Servidor: onde roda (Linux com Portainer ou home server), recursos livres, Supabase na nuvem ou autohospedado.
- [ ] Criar o projeto Supabase **dedicado** a esta operação.

## Fase 2 — Fundação em simulação
- [ ] Aplicar `db/migrations/001…009` no Supabase (ordem numérica) e rodar `db/tests` num Postgres de teste.
- [ ] Subir stacks isoladas: n8n, Evolution API, redirecionador. Sem portas de banco publicadas; sem socket do Docker montado.
- [ ] Criar os dois bots do Telegram (publicador e admin) com BotFather.
- [ ] Workflows do n8n chamando as funções `claim_next_publication`, `complete_publication`, `fail_publication`, `mark_publication_unknown`, `release_stale_claims`, `heartbeat` (ver `08-PAINEL-ADMIN-E-BANCO.md`).
- [ ] Modo **simulação**: uma oferta fictícia percorre cadastro → aprovação → fila → envio simulado → clique.
- [ ] Backup do banco agendado **e restauração testada** num ambiente limpo.

## Fase 3 — Painel admin e bot admin
- [ ] Build e deploy do painel (`deploy/docker-compose.admin.yml`) atrás do Nginx Proxy Manager com HTTPS.
- [ ] Criar a conta no painel e promover o primeiro administrador com `select public.bootstrap_admin('seu@email');`.
- [ ] Desativar o cadastro público no Supabase (Auth → Providers → Email → "Allow new users to sign up" desligado) depois de criar as contas necessárias, ou manter ligado sabendo que toda conta nova fica **inativa** até você aprovar.
- [ ] Bot admin do Telegram (atalhos: aprovar/rejeitar, pausar, status) chamando as mesmas funções SQL.
- [ ] Teste de aceite: operar uma semana simulada **somente** pelo painel (aprovar, rejeitar, pausar/retomar, reconciliar um unknown forçado).

## Fase 4 — Pilotos de canal
- [ ] Telegram real em **modo revisão**, limites baixos (ex.: 2/h, 8/dia).
- [ ] WhatsApp: aquecer o número, grupo de teste, validar formato do JID do grupo, envio com legenda e pré-visualização de links na versão instalada da Evolution API.
- [ ] Redirecionador no ar contando cliques (`record_click`).
- [ ] Horário de silêncio e intervalos mínimos configurados por destino.
- [ ] Saída: 14 dias sem `unknown` pendente e sem restrição do número.

## Fase 5 — Operação assistida
- [ ] Rotina diária: revisar fila, tratar falhas/unknown, olhar Saúde e Analytics.
- [ ] Coletar 4 semanas de linha de base (envios, cliques por envio, taxa de aprovação, categorias/plataformas que funcionam).
- [ ] Ajustar templates e limites com dados; definir metas numéricas **só agora**.

## Fase 6 — Fontes automáticas
- [ ] Watchlist com histórico de preço (alimenta `price_observations` e o preço anterior confiável).
- [ ] Primeiro conector oficial: marcar `api_ready` só com revisão de termos registrada.
- [ ] Avaliar redes de afiliados (conector `network`).
- [ ] Toda oferta coletada entra na **mesma** `ingest_offer` e passa pelas mesmas regras duras.

## Fase 7 — Automação e escala
- [ ] Ligar auto-aprovação **por categoria**, com nota de corte alta e acompanhamento semanal de rejeições.
- [ ] Novos nichos e novos destinos (um de cada vez).
- [ ] Revisão mensal de termos dos programas (o painel alerta quando vence).

## Fase 8 — Produto Hubly (decisão)
- [ ] Com os números das fases 5–7, decidir se vira produto: multiusuário real, isolamento por cliente (multi-tenant), suporte e cobrança.
- [ ] Se sim, o painel e as funções SQL já têm RBAC e auditoria como base; falta o isolamento por cliente (coluna de tenant + RLS).
