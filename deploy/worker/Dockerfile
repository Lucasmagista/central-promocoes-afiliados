# Worker próprio da Central (substitui o n8n). Sem dependências: só Node.
FROM node:22-alpine
WORKDIR /app
COPY n8n/central-worker.mjs ./n8n/central-worker.mjs
COPY worker/server.mjs ./worker/server.mjs
USER node
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "worker/server.mjs"]
