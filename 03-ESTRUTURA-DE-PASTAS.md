# 03 — Estrutura inicial do repositório

Sugestão de nome: `central-promocoes-afiliados`.

```text
central-promocoes-afiliados/
├── README.md
├── PROMPT-INICIAL-CLAUDE.md
├── docs/
│   ├── 01-VISAO-E-REQUISITOS.md
│   ├── 02-ARQUITETURA-E-FLUXOS.md
│   ├── 03-ESTRUTURA-DE-PASTAS.md
│   ├── 04-DADOS-E-API.md
│   ├── 05-INTEGRACOES-E-COMPLIANCE.md
│   └── 06-IMPLANTACAO-E-ROADMAP.md
├── .env.example
├── .gitignore
├── Dockerfile
├── compose.yaml
├── pyproject.toml
├── alembic.ini
├── migrations/
│   ├── env.py
│   └── versions/
├── src/
│   └── promo_hub/
│       ├── __init__.py
│       ├── main.py
│       ├── config.py
│       ├── logging_config.py
│       ├── api/
│       │   ├── __init__.py
│       │   ├── health.py
│       │   ├── offers.py
│       │   ├── destinations.py
│       │   └── review.py
│       ├── domain/
│       │   ├── __init__.py
│       │   ├── models.py
│       │   ├── enums.py
│       │   ├── rules.py
│       │   └── exceptions.py
│       ├── db/
│       │   ├── __init__.py
│       │   ├── session.py
│       │   └── repositories/
│       ├── services/
│       │   ├── __init__.py
│       │   ├── ingestion.py
│       │   ├── normalization.py
│       │   ├── validation.py
│       │   ├── deduplication.py
│       │   ├── affiliate_links.py
│       │   ├── templates.py
│       │   └── publishing.py
│       ├── adapters/
│       │   ├── __init__.py
│       │   ├── marketplaces/
│       │   │   ├── __init__.py
│       │   │   ├── base.py
│       │   │   ├── manual_import.py
│       │   │   ├── mercadolivre.py
│       │   │   ├── shopee.py
│       │   │   └── amazon.py
│       │   └── channels/
│       │       ├── __init__.py
│       │       ├── base.py
│       │       ├── telegram.py
│       │       └── whatsapp_evolution.py
│       ├── workers/
│       │   ├── __init__.py
│       │   ├── scheduler.py
│       │   └── tasks.py
│       └── cli/
│           ├── __init__.py
│           └── commands.py
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── scripts/
│   ├── bootstrap.sh
│   ├── backup-db.sh
│   └── restore-db.sh
└── deploy/
    ├── README.md
    └── nginx/
```

## Orientações

- Criar apenas os arquivos necessários para a etapa atual; não gerar módulos vazios em excesso.
- O código da aplicação fica em `src/promo_hub`.
- `adapters/marketplaces` contém a integração externa. A lógica de validação não deve ficar dentro dos conectores.
- `adapters/channels` cuida de enviar mensagens, não de decidir quais ofertas são boas.
- `services` implementa regras de negócio e deve poder ser testado sem chamar APIs reais.
- `domain` não deve depender de FastAPI, Redis ou clientes de marketplaces.
- `tests/fixtures` usa dados fictícios e sem credenciais.
- Migrações do banco são versionadas no Git.
- `docs/` guarda as decisões e procedimentos operacionais.

## `.gitignore` mínimo

```gitignore
.env
.env.*
!.env.example
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/
dist/
build/
*.log
data/
secrets/
```

Não adicionar diretórios de sessão do WhatsApp, cookies ou dumps de banco ao repositório.
