# =====================================================================
# OSManager / InfnityServices — Build & runtime
#
# Estágio 1: build do Vite (gera /app/dist com env.template.js)
# Estágio 2: nginx + entrypoint que faz envsubst no startup
#            populando /env.js com os valores REAIS de runtime
#            (definidos em "Environment" no EasyPanel).
#
# Vantagem desta abordagem: muda credencial Supabase no painel sem
# precisar rebuild — só restart do container.
# =====================================================================

# ---------- 1) BUILD ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Cache de dependências
COPY package*.json ./
RUN npm ci --include=dev

# Build (sem precisar das envs VITE_* aqui — elas viram em runtime)
COPY . .
RUN npm run build

# ---------- 2) RUNTIME ----------
FROM nginx:1.27-alpine AS runtime

# Pacotes pra envsubst (já vem por padrão em alpine, mas garantimos)
RUN apk add --no-cache gettext

# Configuração nginx (SPA fallback + cache + gzip)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Estático buildado
COPY --from=builder /app/dist /usr/share/nginx/html

# Entrypoint que substitui ${VITE_*} no env.template.js → env.js
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
