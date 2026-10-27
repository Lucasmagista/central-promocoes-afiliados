# 05 — Integrações e conformidade

## Regra comum

Cada integração começa em `disabled` ou `manual_only`. Só vira `api_ready` após confirmação de conta, credenciais, permissões, termos vigentes e teste controlado. URL válida não comprova comissão.

| Plataforma | Antes da homologação | Para automação |
|---|---|---|
| Mercado Livre | entrada manual com link oficial | programa aprovado e fluxo/API autorizado |
| Shopee | entrada manual com link oficial | API de afiliados e limites documentados |
| Amazon | entrada manual compatível | regras de API/Creators e divulgação validadas |

Não use cookies de navegador, scraping contrário aos termos ou tracking inventado. Registre método de geração do link, data de validação e restrições de cada conector.

## Telegram

Use bot oficial, permissões mínimas e chats configurados. Em webhook, valide o cabeçalho `X-Telegram-Bot-Api-Secret-Token` com segredo longo. Teste em canal privado e mantenha limites baixos no piloto.

## WhatsApp e Evolution API

Use instância dedicada, isolando número, sessão e credencial. O webhook deve exigir autenticação verificável suportada pela Evolution, além de conferir instância e evento. Nome de instância não autentica origem. Limite payload, taxa e eventos aceitos; registre somente erros sanitizados.

## Dados pessoais

Conversas podem conter dados pessoais. Aplique menor acesso necessário, retenção configurada e limpeza diária; não ponha telefones completos, tokens ou conteúdo desnecessário em logs. Antes do uso comercial, publique política de privacidade e valide as regras aplicáveis.
