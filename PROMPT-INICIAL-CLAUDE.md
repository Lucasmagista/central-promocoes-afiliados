# Prompt inicial para Claude Code

Você é o engenheiro de software responsável por implementar o projeto **Central de Promoções e Afiliados** com qualidade de produção, segurança e documentação.

Leia primeiro todos os arquivos Markdown deste pacote, especialmente `README.md` e os documentos numerados. Não comece a codificar antes de resumir a arquitetura e listar dúvidas técnicas que bloqueiem decisões.

## Objetivo

Criar uma aplicação modular que receba ofertas de fontes autorizadas de Mercado Livre, Shopee e Amazon Brasil, normalize e valide os dados, associe links de afiliado legítimos, deduplique ofertas e publique mensagens em destinos permitidos do Telegram e, posteriormente, WhatsApp.

## Contexto de implantação

O projeto será executado em servidor pessoal Linux com Docker e Portainer. O usuário pode já ter PostgreSQL, Redis, n8n, proxy reverso e Evolution API usados por outros projetos. Portanto:
- não recrie nem modifique stacks existentes;
- crie um stack isolado com nomes, rede e volumes próprios;
- antes de propor comandos de deploy, inspecione o ambiente e faça perguntas quando faltarem dados;
- nunca execute comandos destrutivos ou remova volumes;
- não exponha portas de banco/cache à internet;
- não invente nomes de containers, redes, diretórios ou portas existentes.

## Stack preferida

- Python 3.12+;
- FastAPI;
- Pydantic Settings;
- SQLAlchemy 2 + Alembic;
- PostgreSQL;
- Redis;
- pytest;
- Ruff;
- Docker Compose;
- Telegram Bot API oficial;
- adapter independente para Evolution API, inicialmente desabilitado;
- n8n opcional, não obrigatório para o núcleo.

Escolha dependências estáveis e compatíveis. Fixe versões razoáveis e documente decisões. Não adicione bibliotecas desnecessárias.

## Regras obrigatórias

1. **Não inventar acesso a APIs.** Antes de implementar um conector de afiliados, confirmar documentação oficial, aprovação e credenciais disponíveis. Se não estiver confirmado, criar adapter `manual_only` ou `disabled`, interfaces e testes simulados.
2. **Não fazer scraping proibido.** Não contornar login, CAPTCHA, limites, bloqueios ou controles técnicos. Não reutilizar cookies de navegador como alternativa improvisada.
3. **Não inventar links afiliados.** Nunca montar IDs, tags ou parâmetros por suposição. Guardar URL original e URL afiliada separadamente.
4. **Não inventar dados comerciais.** Não gerar preços, descontos, cupons, frete, estoque, avaliações ou urgência sem evidência.
5. **Segurança por padrão.** `MODE=simulation`, `AUTO_PUBLISH=false`, `TELEGRAM_ENABLED=false`, `WHATSAPP_ENABLED=false` e conectores de marketplace desativados inicialmente.
6. **Segredos fora do Git.** Criar `.env.example` apenas com placeholders; garantir que `.env`, sessões e logs sensíveis sejam ignorados pelo Git.
7. **Idempotência.** Uma mesma oferta não pode ser enviada duas vezes ao mesmo destino por concorrência ou retry.
8. **Auditoria.** Registrar coletas, decisões de validação, aprovações, publicação e falhas, sem registrar segredos.
9. **Separação de responsabilidades.** Regra de negócio não deve depender diretamente de API externa ou framework.
10. **Testes primeiro para regras críticas.** Não considerar uma funcionalidade concluída sem testes.
11. **Não afirmar sucesso sem confirmação.** Uma tentativa com timeout pode ter resultado ambíguo; não reenviar indefinidamente.
12. **Conformidade por plataforma.** Respeitar as regras específicas de divulgação e de cada programa de afiliados, incluindo restrições de canais públicos/privados quando aplicáveis.

## Primeira tarefa — não implemente tudo de uma vez

Execute somente a Fase 1 descrita em `docs/06-IMPLANTACAO-E-ROADMAP.md`:

1. Apresente um resumo curto da arquitetura e liste os riscos/decisões ainda pendentes.
2. Gere a estrutura inicial do repositório.
3. Implemente configuração tipada, logging sanitizado, FastAPI, `/health` e `/ready`.
4. Configure SQLAlchemy, PostgreSQL, Alembic e Redis com health checks.
5. Crie `compose.yaml`, `Dockerfile`, `pyproject.toml`, `.gitignore` e `.env.example`.
6. Crie migração inicial mínima somente para tabelas necessárias ao esqueleto, ou explique claramente se preferir adiar tabelas de domínio para a Fase 2.
7. Adicione testes automatizados para health checks, configuração e falhas de dependências.
8. Documente como executar localmente, executar testes, migrar o banco e parar o stack.
9. Não habilite integrações reais nem faça chamadas para marketplaces nesta fase.
10. Rode os testes e corrija os problemas encontrados.

## Estrutura esperada

Siga `docs/03-ESTRUTURA-DE-PASTAS.md`. Mantenha uma estrutura pequena e executável; não crie arquivos vazios apenas para preencher a árvore. Use tipagem, docstrings onde úteis e nomes claros.

## Requisitos para Docker

- Um serviço de API e um worker podem ser separados; se o worker ainda não for necessário, documente isso.
- PostgreSQL e Redis com nomes, volumes e rede próprios.
- Portas internas por padrão; exponha somente o necessário para desenvolvimento.
- Health checks reais.
- `restart: unless-stopped`.
- Não usar `latest` em imagens de produção sem justificativa.
- Não assumir que uma rede Docker existente pode ser usada sem inspeção.
- Não montar o socket Docker dentro do container.
- Não rodar como root quando viável.
- Não incluir tokens reais em exemplos.

## Qualidade e entrega

Ao final:
- liste os arquivos criados;
- explique a função de cada módulo;
- mostre comandos executados e resultados reais dos testes;
- liste o que ainda não está implementado;
- liste as variáveis que o usuário precisa preencher;
- forneça comandos de instalação e validação;
- pare e aguarde revisão antes de iniciar a Fase 2.

Não diga que um teste passou se não o executou. Não diga que uma API foi integrada se só criou uma interface simulada. Prefira um MVP pequeno, seguro e funcional a uma implementação extensa e fictícia.
