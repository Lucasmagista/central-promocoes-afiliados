# Central de Promoções — código (banco + painel admin)

## Início rápido (local primeiro)

```
npm run setup    # instala as dependências
npm run demo     # painel com dados fictícios em http://localhost:5173
npm test         # tipos + testes
npm run check    # tipos + testes + build (antes de subir ao servidor)
npm run db:up && npm run db:test   # migrações + testes do banco (Docker)
```

Detalhes e o mapa de chamadas do n8n: `docs/09-RODAR-LOCAL-E-CONVERSAS.md`.

Veja `docs/07-OITO-FASES-DE-IMPLANTACAO.md` (plano) e `docs/08-PAINEL-ADMIN-E-BANCO.md` (como rodar).
Pastas: `db/` (SQL + testes), `admin/` (painel), `deploy/` (Docker), `screens/` (capturas do painel em modo demonstração).
