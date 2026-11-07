# syntax=docker/dockerfile:1
# dashboard-ts 0.1.0 — multi-stage. Build: node:20-slim (npm ci + build).
# Run: nginx:alpine serving the static build as the non-root nginx user.
#
# API access choice: nginx proxies /api and /ws to api-node:3000, so the
# built app calls RELATIVE paths (VITE_API_URL left empty at build time).
# That keeps the dashboard usable from any host, not just localhost.
# To call the API directly instead, build with
#   --build-arg VITE_API_URL=http://localhost:3000
# (then the browser must reach that URL itself).
FROM node:20-slim AS builder

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

ARG VITE_API_URL=""
ARG VITE_WS_URL=""
ENV VITE_API_URL=${VITE_API_URL} VITE_WS_URL=${VITE_WS_URL}
RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/dist /usr/share/nginx/html

# nginx:alpine already ships a non-root `nginx` user; run as it.
# /var/cache/nginx and /var/run need write access for that user.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run \
    && chmod -R 755 /usr/share/nginx/html

USER nginx:nginx

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/"]

CMD ["nginx", "-g", "daemon off;"]
