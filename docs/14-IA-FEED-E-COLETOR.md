# 14 — IA (OpenRouter), feed da Shopee e coletor do navegador

Migração: `db/migrations/020_ia_e_coletor.sql` (rode no SQL Editor depois da 019). Painel: **Configurações → IA (OpenRouter)** e **Configurações → Coleta de ofertas**.

## IA para criar os textos
- Chave do OpenRouter guardada no cofre do banco (só escrita; o painel mostra só os 4 últimos caracteres). Modelo, tom, instruções de estilo e limite por hora ficam em `settings.ai_config`.
- O worker pede a legenda das ofertas **em revisão** (maior score primeiro, antes do modo automático aprovar): uma manchete com emoji + uma linha de benefício. Só vão para a IA: nome do produto, plataforma, categoria, desconto e se há cupom.
- `{{title}}` passa a usar a manchete da IA (senão o nome curto) e `{{ai_text}}` é a linha de benefício. A migração 020 insere `{{ai_text}}` logo abaixo do título nos modelos atuais; a linha some se estiver vazia.
- Termos proibidos, links e tamanhos inválidos são barrados no banco (`set_offer_ai_text`); uma segunda tentativa pede para reescrever. Chave recusada ou sem saldo pausa a IA por 10 min e o erro aparece na aba.
- Limite: a legenda só é gerada para ofertas em revisão. Oferta já aprovada antes da IA ligar mantém o texto que tinha.

## Feed de produtos da Shopee
- Portal de afiliados → Criativo → Feed de produto → **Ver Link**. Cadastre o endereço (https) ou o nome de um CSV copiado para `deploy/feeds/` no servidor (montado em `/feeds`).
- O worker lê o CSV em fluxo (110 mil produtos em ~2 s), filtra por desconto, nota, preço e categoria (por padrão ficam de fora peças de veículos, livros, alimentos e saúde) e importa as melhores para a fila usando o **link de afiliado do próprio feed**.
- "Simular" mostra quantos passam nos filtros sem gravar. Importação automática a cada N horas (padrão 24).
- O "preço antigo" do feed é o preço de lista declarado pelo vendedor.

## Coletor do navegador (extensão do Chrome, pasta `extension/`)
- Lê o hub de afiliados do Mercado Livre e a página "Oferta de produto" da Shopee **na sua sessão do Chrome**, gera o link de afiliado de cada produto (como se você clicasse) e envia para `POST /ingest/browser` do worker com um token (guardado só como hash; aparece uma vez em Configurações → Coleta).
- Instalação e limites: `extension/LEIAME.md`.
- No Mercado Livre o preço mostrado é o do **Pix** ("73% OFF no Pix"). Na Shopee o preço antigo é calculado a partir do selo "% OFF" e fica marcado como derivado.
- Conferido ao vivo (somente leitura e geração de links como você faria): leitura dos produtos do hub e dos cards da Shopee, e captura do link `meli.la` pela resposta da chamada `createLink`. **Não foi testado carregando a extensão de ponta a ponta.**
- Depende do layout dessas páginas; se mudarem, a coleta pode parar de achar produtos (a extensão avisa).
- Confira os termos dos programas de afiliados antes de usar automação em contas de produção.
