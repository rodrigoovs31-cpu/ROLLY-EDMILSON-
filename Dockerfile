# Imagen multi-etapa de Maus / DocuMaus:
#   target "api" → rolly_api: Node.js 22 en Alpine + qpdf + Ghostscript (webhook de WhatsApp)
#   target "web" → nginx:alpine con la web estática ya generada para tu dominio
#
#   docker compose build            (usa ambos targets)
#   docker build --target api -t rolly/api .

ARG NODE_IMAGE=node:22-alpine

# ---------- 1) Dependencias de la API (con las de desarrollo, para compilar) ----------
FROM ${NODE_IMAGE} AS api-deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2) Compilar TypeScript → JavaScript ----------
FROM api-deps AS api-build
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---------- 3) Imagen final de la API (pequeña, sin compiladores, usuario sin privilegios) ----------
FROM ${NODE_IMAGE} AS api
RUN apk add --no-cache qpdf ghostscript tini \
 && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=api-build --chown=node:node /app/package.json ./
COPY --from=api-build --chown=node:node /app/node_modules ./node_modules
COPY --from=api-build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

# ---------- 4) Generar la web estática para tu dominio ----------
FROM ${NODE_IMAGE} AS web-build
ARG SITE_URL=""
ARG API_BASE="/api"
WORKDIR /site
COPY package.json ./
COPY scripts ./scripts
COPY assets ./assets
COPY vendor ./vendor
COPY manifest.webmanifest ./
RUN SITE_URL="$SITE_URL" API_BASE="$API_BASE" node scripts/build.mjs \
 && node scripts/export-web.mjs /web-dist

# ---------- 5) nginx con la web, HTTPS y proxy a la API ----------
FROM nginx:stable-alpine AS web
RUN apk add --no-cache openssl
COPY deploy/nginx/templates/ /etc/nginx/templates/
COPY deploy/nginx/snippets/ /etc/nginx/snippets/
COPY deploy/nginx/ssl-link.sh deploy/nginx/reload-loop.sh /usr/local/bin/
COPY deploy/nginx/40-ssl-link.sh deploy/nginx/50-reload-loop.sh /docker-entrypoint.d/
COPY --from=web-build /web-dist /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf \
 && chmod +x /usr/local/bin/ssl-link.sh /usr/local/bin/reload-loop.sh /docker-entrypoint.d/40-ssl-link.sh /docker-entrypoint.d/50-reload-loop.sh
EXPOSE 80 443
