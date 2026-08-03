#!/bin/sh
# =====================================================================
# Delvor — Runtime configuration entrypoint
#
# Lê as variáveis VITE_* do ambiente (definidas pelo EasyPanel) e gera
# /usr/share/nginx/html/env.js com os valores reais. Roda toda vez que
# o container inicia, então mudanças nas envs não exigem rebuild.
# =====================================================================
set -e

TEMPLATE=/usr/share/nginx/html/env.template.js
OUTPUT=/usr/share/nginx/html/env.js

if [ ! -f "$TEMPLATE" ]; then
  echo "[entrypoint] Template não encontrado em $TEMPLATE — pulando envsubst."
else
  echo "[entrypoint] Gerando $OUTPUT com runtime env..."
  # Substitui apenas as variáveis VITE_*. Outras ${...} no template
  # ficariam intactas (não usamos isso, mas é boa prática).
  envsubst '${VITE_SUPABASE_URL} ${VITE_SUPABASE_PUBLISHABLE_KEY} ${VITE_EVOLUTION_URL} ${VITE_EVOLUTION_API_KEY} ${VITE_WHATSAPP_WEBHOOK_URL} ${VITE_OS_NOTIFICATION_WEBHOOK_URL}' < "$TEMPLATE" > "$OUTPUT"
  echo "[entrypoint] env.js gerado com sucesso."
fi

# Inicia o nginx em foreground (PID 1)
exec nginx -g 'daemon off;'
