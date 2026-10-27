# 10 — Deploy automático e domínio (promocoes.hubly.software)

## 1. Atualização automática (GitHub → servidor)
Dois mecanismos, use os dois:
- **Timer no servidor (procura):** a cada minuto o servidor compara com o GitHub e, se houver commit novo, faz `git merge --ff-only`, rebuild e `up -d`. Instalar uma vez:
  `cd <pasta-do-projeto> && sudo bash deploy/servidor/instalar-auto-update.sh`
  Log: `deploy/servidor/atualizar.log`. Manual: `bash deploy/servidor/atualizar.sh [--force]`.
- **GitHub Actions (envia):** `.github/workflows/deploy.yml` roda a cada push na `main` e executa o script por SSH. Crie uma chave só para deploy (`ssh-keygen -t ed25519 -f deploy_key -N ""`), ponha a `.pub` em `~/.ssh/authorized_keys` do servidor e cadastre os secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` (privada) e `SSH_APP_DIR`.

Pré-requisitos no servidor: projeto clonado via `git clone` (não cópia solta), `deploy/admin.env` preenchido, Docker, rede `proxy` (o script cria se faltar).

## 2. Erro 525 (SSL handshake failed)
Significa: a Cloudflare está OK, mas o **servidor de origem (Nginx Proxy Manager) não completou HTTPS** para esse domínio. Causas, em ordem de probabilidade:
1. **Sem certificado no NPM** para `promocoes.hubly.software` (o Proxy Host está sem SSL) e o modo da Cloudflare em *Full/Full (strict)*.
2. **Portas 80/443 fechadas.** Em servidor Oracle Cloud (faixa do IP) é comum: libere TCP 80 e 443 na *Security List/NSG* da VCN **e** no iptables do Ubuntu (`sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT; sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT; sudo netfilter-persistent save`).
3. **Let's Encrypt não emite** porque a porta 80 está fechada ou o DNS aponta para outro lugar.
4. Proxy Host aponta para destino errado (deve ser `promo-admin`, porta 80, http, na rede `proxy`).

### Correção recomendada (não depende de porta 80)
**Certificado de origem da Cloudflare:**
1. Cloudflare → domínio `hubly.software` → SSL/TLS → Origin Server → *Create Certificate* (inclua `*.hubly.software` e `hubly.software`, 15 anos). Copie o certificado e a chave privada.
2. NPM → Certificates → Add → *Custom* → cole certificado e chave.
3. NPM → Proxy Host `promocoes.hubly.software` → SSL → selecione esse certificado, ative *Force SSL* e *HTTP/2*.
4. Cloudflare → SSL/TLS → Overview → modo **Full (strict)**.
Alternativa: no NPM, certificado Let's Encrypt com **DNS Challenge → Cloudflare** usando um API Token com permissão *Zone:DNS:Edit* apenas nessa zona.

### Conferir
- DNS: registro `promocoes` (A → IP do servidor) com nuvem laranja.
- Do seu PC: `curl -vk https://137.131.204.59 -H "Host: promocoes.hubly.software"` — deve completar o TLS; se travar, é porta/firewall.
- No servidor: `sudo ss -tlnp | grep -E ':80|:443'` e `docker logs nginx-proxy-manager` (nome pode variar).
