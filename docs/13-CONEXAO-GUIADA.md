# 13 — Conexão guiada (WhatsApp e Telegram), Monitorar grupos e imagens (migração 017)

## O que mudou
- **Nada de endereço, instância ou chave no painel.** Endereço da Evolution, nome da instância, chave (`apikey`) e token do bot ficam só no arquivo protegido do servidor: `deploy/worker/worker.env` (permissão 600, fora do git). O painel nunca vê esses valores.
- **WhatsApp:** Configurações → WhatsApp → **Conectar WhatsApp**. Aparece o QR code (ou código de pareamento, para quem não tem câmera) e a janela fecha sozinha quando o celular conecta. O webhook da Evolution é corrigido automaticamente para o endereço interno do worker.
- **Telegram:** Configurações → Telegram → **Conectar Telegram**. O worker confere o bot, registra o webhook público (com segredo derivado) e ativa tudo. O chat do administrador é escolhido numa lista.
- **Envio e proteção** foi mantido e melhorado (ritmos Conservador / Equilibrado / Rápido, estimativa de mensagens por hora); *Grupos (padrões)* e *Teste de envio* continuam.
- **Banco de dados:** mostra "Supabase já conectado" (projeto, endereço, tempo de resposta, migrações aplicadas, worker). Trocar de banco fica em "opções avançadas".
- **Monitorar grupos (Radar):** abas WhatsApp e Telegram, lista de todos os grupos conhecidos com interruptor para monitorar, busca, seleção em massa, "Sincronizar grupos" e janela de configuração com os pré-requisitos de cada canal.
- **Imagens dos produtos** em Fila de aprovação, Ofertas, detalhe da oferta, Publicações, Radar e Produtos acompanhados.

## Como subir (uma vez)
1. **Supabase → SQL Editor:** rode `db/migrations/016_radar_automacao.sql` (se ainda não rodou) e `db/migrations/017_conexao_guiada.sql`.
2. No PowerShell, na pasta do projeto: `.\deploy\servidor\subir.ps1 "conexão guiada"`.
3. **No servidor** (SSH, pasta do projeto), passe o que já estava salvo no banco para o arquivo seguro:
   ```bash
   bash deploy/servidor/configurar-conexoes.sh --importar
   ```
   Ele copia endereço, instância, chave e token para o `worker.env`, define `PUBLIC_URL=https://worker.hubly.software` e reinicia o worker. Sem nada salvo, rode `bash deploy/servidor/configurar-conexoes.sh` e responda às perguntas (os segredos não aparecem na tela). `--status` mostra o que está configurado, sem revelar segredos.
4. No painel: **Configurações → WhatsApp → Conectar WhatsApp** (leia o QR) e **Telegram → Conectar Telegram**.
5. Em **Radar de grupos**, ligue o interruptor dos grupos que quer monitorar.

## Observações
- Enquanto o `worker.env` não tiver os dados, o painel continua funcionando com o cadastro antigo do banco (modo "avançado"), mas o recomendado é o arquivo.
- O botão "Conectar" cria tarefas para o worker (limite de 30 por minuto); o QR atualiza a cada poucos segundos.
- Para o Radar ler grupos do Telegram, o bot precisa ser administrador ou estar com o modo de privacidade desligado (`/setprivacy → Disable` no @BotFather).
- Arquivos: `db/migrations/017_conexao_guiada.sql`, `db/tests/19_tests_conexao.sql`, `deploy/worker/{central-worker,server}.mjs`, `deploy/servidor/configurar-conexoes.sh`, `admin/src/components/WhatsAppConnect.tsx`, `admin/src/pages/settings/{WhatsApp,Telegram,Database}Tab.tsx`, `admin/src/pages/Radar.tsx`, `admin/src/ui/ProductImage.tsx`.
