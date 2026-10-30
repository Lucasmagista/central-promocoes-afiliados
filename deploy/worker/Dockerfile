# Worker da Central. Sem dependências: só Node.
FROM node:22-alpine
WORKDIR /app
COPY worker/central-worker.mjs worker/server.mjs ./worker/
USER node
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "worker/server.mjs"]
