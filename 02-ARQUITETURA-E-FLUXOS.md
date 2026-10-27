# 02 — Arquitetura e fluxos

## Componentes

- **Supabase gerenciado:** PostgreSQL, Auth, RLS, RPC e auditoria; fonte de verdade.
- **Painel React/Vite:** build estático servido por Nginx na Oracle; usa a chave pública `anon`.
- **n8n na Oracle:** worker, agendamentos, webhooks e chamadas externas; usa `service_role` somente no seu ambiente.
- **Telegram e Evolution API:** adaptadores externos; a Evolution deve usar instância dedicada.

```text
Painel ─→ funções RPC protegidas ─→ Supabase
                                      │
                                      ├─ fila, regras, RLS e auditoria
                                      └─ ofertas e conversas
                                                   │
                                      n8n ────────┘
                                       │       │
                                  Telegram  Evolution/API oficial
```

O banco decide autorização, estados, limites, idempotência e persistência. O painel solicita ações autorizadas. O n8n executa rede e devolve resultados. Regra crítica não pode viver apenas em workflow.

## Publicação

1. Oferta chega por cadastro manual ou conector autorizado.
2. O banco normaliza, valida, deduplica e define o estado.
3. A aprovação cria a publicação no banco antes de chamada externa.
4. O n8n reserva, envia e confirma por RPC.
5. Resposta ambígua vira `unknown`; erro transitório pode entrar em retry limitado.

## Conversas

Webhooks ou polling chegam ao n8n, que valida origem, converte o payload e chama `ingest_chat_message`. Respostas manuais entram em `chat_outbox`, passam por regras do banco e são enviadas pelo worker. A limpeza remove mensagens comuns após o prazo configurado.

## Decisão de infraestrutura

Manter Supabase reduz operação porque Auth, RLS e API já atendem ao código. A Oracle hospeda painel, n8n, proxy e Evolution. PostgreSQL próprio só deve ser considerado com plano para substituir autenticação, API, backup, observabilidade e atualizações do Supabase.
