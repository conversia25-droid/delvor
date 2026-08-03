// =====================================================================
// Delvor — Runtime configuration template.
// Os marcadores ${...} são substituídos pelo docker-entrypoint.sh no
// startup do container, lendo as Environment Variables do EasyPanel.
//
// Em desenvolvimento (npm run dev), o arquivo é carregado mas tem os
// placeholders literais — daí o cliente Supabase faz fallback pra
// import.meta.env (lido do .env / .env.local).
// =====================================================================
window.__OSM_ENV__ = {
  VITE_SUPABASE_URL: "${VITE_SUPABASE_URL}",
  VITE_SUPABASE_PUBLISHABLE_KEY: "${VITE_SUPABASE_PUBLISHABLE_KEY}",

  // Evolution API (WhatsApp não-oficial via QR). Opcionais — se vazias,
  // o sistema cai pro modo wa.me (abre WhatsApp Web com texto pronto).
  VITE_EVOLUTION_URL: "${VITE_EVOLUTION_URL}",
  VITE_EVOLUTION_API_KEY: "${VITE_EVOLUTION_API_KEY}",

  // Webhook n8n pra envio de mensagens (texto + mídia). Quando setado,
  // o front posta aqui em vez de chamar a Evolution direto. Sem ele,
  // o envio cai pro wa.me (mídia não suportada).
  VITE_WHATSAPP_WEBHOOK_URL: "${VITE_WHATSAPP_WEBHOOK_URL}",

  // Webhook DEDICADO pra notificações automáticas de OS (técnico).
  // Se vazio, cai pro VITE_WHATSAPP_WEBHOOK_URL acima.
  VITE_OS_NOTIFICATION_WEBHOOK_URL: "${VITE_OS_NOTIFICATION_WEBHOOK_URL}"
};
