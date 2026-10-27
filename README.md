# Central de Promoções e Afiliados

Painel operacional para revisar ofertas, publicar em Telegram e WhatsApp, acompanhar conversas e manter auditoria. O projeto usa Supabase gerenciado como plataforma de dados e autorização, painel React estático e n8n na Oracle Cloud para integrações externas.

## Arquitetura em produção

```text
Navegador ─HTTPS→ proxy reverso ─→ painel React/Nginx (Oracle)
                                  └→ n8n (Oracle, acesso administrativo restrito)
Painel ─anon key→ Supabase (Auth, Postgres, RLS, RPC e auditoria)
n8n ─service_role→ Supabase ─→ Telegram / Evolution API / conectores autorizados
```

O navegador nunca recebe `service_role`, tokens de bots ou chaves de marketplaces. O banco aplica autorização, fila, limites e idempotência; o n8n executa tarefas e chamadas externas.

## Estado das integrações

| Área | Estado | Observação |
|---|---|---|
| Painel, RBAC, fila e auditoria | Implementado | Requer migrações 001 a 011 |
| Telegram | Implementado | Homologar bot e destino de teste |
| WhatsApp/Evolution | Implementado | Exige instância dedicada e webhook autenticado |
| Mercado Livre e Shopee | Parcial | Homologar acesso oficial antes de automação |
| Amazon | Parcial | A verificação atual não comprova geração de links |

## Local e testes

Requisito: Node 18.18+; recomendado Node 20 LTS.

```powershell
npm run setup
npm run demo
npm run check
npm run db:up
npm run db:test
```

`demo` não usa dados nem canais reais. Para Supabase, copie `admin/.env.example` para `admin/.env.local` e informe somente URL e chave `anon`.

## Implantação na Oracle

O guia completo está em [06-IMPLANTACAO-E-ROADMAP.md](06-IMPLANTACAO-E-ROADMAP.md). A ordem segura é aplicar migrações, publicar painel, configurar n8n, importar workflows, testar em simulação e homologar cada canal antes de liberar produção. A partir da migração 011, a aba **Banco de dados** registra o provedor e pode solicitar ao worker a aplicação de arquivos SQL pendentes no Supabase; a primeira instalação da 011 permanece manual.

## Documentação

- [Visão e requisitos](01-VISAO-E-REQUISITOS.md)
- [Arquitetura e fluxos](02-ARQUITETURA-E-FLUXOS.md)
- [Dados e contratos](04-DADOS-E-API.md)
- [Integrações e conformidade](05-INTEGRACOES-E-COMPLIANCE.md)
- [Implantação, operação e recuperação](06-IMPLANTACAO-E-ROADMAP.md)
- [Banco, painel e permissões](docs/08-PAINEL-ADMIN-E-BANCO.md)
- [Desenvolvimento, conversas e n8n](docs/09-RODAR-LOCAL-E-CONVERSAS.md)

## Segurança

Não versione `.env`, dumps, sessões do WhatsApp ou chaves. Antes de abrir o painel ao público, valide HTTPS, RLS, webhooks, backup e restauração. O sistema deve iniciar em simulação e com publicação automática desligada.
