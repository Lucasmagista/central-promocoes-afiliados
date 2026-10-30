# Coletor da Central de Promoções (extensão do Chrome)

Lê as páginas do seu programa de afiliados já logadas no seu Chrome, gera os links de afiliado e envia os produtos
para a fila de aprovação da Central. Sua senha e sua sessão **não saem do navegador**: a Central recebe só produtos e links,
com um token que você gera em **Configurações → Coleta de ofertas**.

## Instalar (uma vez)
1. Chrome → `chrome://extensions` → ligue **Modo do desenvolvedor** → **Carregar sem compactação** → escolha esta pasta (`extension`).
2. Clique no ícone da extensão. Cole o **endereço do worker** (ex.: `https://worker.seudominio.com.br`) e o **token** → **Salvar** (o Chrome pede permissão para falar com o worker: permita).
3. Entre nas suas contas do Mercado Livre (hub de afiliados) e do portal de afiliados da Shopee, neste mesmo Chrome.
4. Deixe o Chrome aberto. A cada 3 horas (ajustável) a extensão abre as páginas em segundo plano, coleta e fecha. **Coletar agora** faz na hora.

## O que ela faz
- **Mercado Livre** — `afiliados/hub`: lê a lista "Produtos selecionados para você" (título, preço, desconto no Pix, comissão, avaliação) e usa o botão **Compartilhar → Copiar link** de cada produto para obter o link `meli.la` do seu perfil.
- **Shopee** — `offer/product_offer`: lê os cards de cada aba (preço, selo de desconto, comissão) e usa **Obter link** para obter o link `s.shopee.com.br`. Como a página não mostra o preço antigo, ele é calculado a partir do selo "% OFF" (a Central marca como "derivado").
- Links já gerados ficam em cache por 14 dias, para não gerar de novo a cada coleta.

## Limites e cuidados
- Depende do layout das páginas do Mercado Livre e da Shopee. Se mudarem, a coleta pode parar de achar produtos: a extensão avisa "Nenhum produto encontrado".
- Faz poucos cliques por coleta, com pausas, como uma pessoa. Não aumente demais "Itens por página" nem a frequência.
- Confira os termos dos programas de afiliados antes de usar automações em contas de produção.
- O token fica guardado só neste Chrome. Se perder, gere outro na Central (o antigo deixa de valer).
