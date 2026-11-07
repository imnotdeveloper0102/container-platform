# syntax=docker/dockerfile:1
# api-node 0.1.0 — multi-stage, final image node:20-slim, non-root.
# Pure JS (no TypeScript, no build step): the runtime image only needs
# node_modules + src. HEALTHCHECK uses node itself (global fetch in
# Node 20) — node:20-slim ships no wget/curl, so do not rely on them.
FROM node:20-slim AS builder

WORKDIR /src

# Layer cache: dependencies first, source code last.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim

ENV NODE_ENV=production

RUN groupadd -r api && useradd -r -g api api \
    && mkdir -p /app && chown api:api /app

WORKDIR /app

COPY --from=builder /src/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER api:api

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.API_PORT || 3000}/healthz`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "src/server.js"]
