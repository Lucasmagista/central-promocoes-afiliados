# 01 — Visão e requisitos

## Produto

A Central de Promoções e Afiliados transforma ofertas recebidas por fontes autorizadas em publicações revisáveis para Telegram e WhatsApp. O objetivo é preservar qualidade, rastreabilidade e controle editorial: preço, desconto, estoque, cupom e comissão jamais são inventados.

O sistema opera em **simulação**, **revisão** e **automação controlada**. A configuração inicial obrigatória é simulação, com publicação automática desligada.

## O que já existe

- cadastro, normalização e revisão de ofertas;
- destinos, categorias, templates e regras de publicação;
- fila com limites, janela de silêncio, idempotência, retentativa e reconciliação de envio ambíguo;
- conversas Telegram e WhatsApp, com retenção configurável;
- perfis administrador, operador e leitor aplicados no banco;
- auditoria e armazenamento de segredos sem leitura pelo navegador;
- worker n8n para Telegram, Evolution API e conectores.

## Limites de escopo

Não há scraping sem autorização, bypass de autenticação ou anti-bot, compras, promessas de comissão ou coleta de dados privados. Conectores de afiliados ficam manuais ou sob revisão até que conta, API e regras de divulgação sejam confirmadas por plataforma.

## Requisitos essenciais

1. Toda oferta guarda fonte, horário, URL canônica e evidência de dados comerciais.
2. Publicações exigem validação, aprovação quando configurada, destino habilitado e respeito aos limites.
3. Timeout após envio produz `unknown`; não há reenvio automático.
4. A `service_role` fica exclusivamente no n8n. O painel usa só a chave `anon`.
5. Webhooks autenticam o remetente e limitam payloads e frequência.
6. Eventos relevantes registram ator, entidade e horário sem segredos.
7. Mensagens obedecem retenção e acesso por papel.

## Critérios para produção

Migrações, testes e build sem erro; backup e restauração testados; painel e n8n sob HTTPS; administrador inicial criado; canais homologados em grupos de teste; conectores oficialmente autorizados; monitoramento da fila e do worker configurado.
