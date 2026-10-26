import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    /**
     * PWA — habilita instalação no celular ("Adicionar à tela inicial") e
     * cache offline. Foco principal: app do técnico em campo.
     *
     * registerType: "autoUpdate" — quando a gente faz deploy, o SW atualiza
     * em background e a próxima abertura já carrega a versão nova (com um
     * reload silencioso). Sem prompt chato pro usuário.
     *
     * workbox.navigateFallback: o app é SPA — qualquer rota cai no index.html.
     * Sem isso, abrir direto em /m/orders offline daria 404.
     */
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        name: "Delvor",
        short_name: "Delvor",
        description: "CRM, ERP e WhatsApp pra empresas de serviço técnico.",
        // theme_color: cor da barra de status no Android quando o PWA tá aberto
        // background_color: tela cheia da splash screen no Android (cor pura,
        //   antes da app carregar). Blue-900 combina com o mark azul do BrandLogo.
        theme_color: "#1e3a8a",
        background_color: "#1e3a8a",
        display: "standalone",
        orientation: "portrait",
        // Abre na raiz: o RootRedirect manda cada papel pro lugar certo
        // (técnico puro → /m/orders; admin/gerente/vendedor → /dashboard).
        start_url: "/",
        scope: "/",
        lang: "pt-BR",
        icons: [
          // "any" — Chrome, iOS, splash. Fundo TRANSPARENTE — o sistema
          // preenche com o background_color do manifest (violet).
          { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // "maskable" — Android Adaptive Icons aplicam recorte (círculo,
          // squircle, etc). Esses já têm fundo violet cheio + 20% de safe-zone
          // pro logo não ser cortado em formato algum.
          { src: "/maskable-icon-192x192.png",  sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/maskable-icon-512x512.png",  sizes: "512x512", type: "image/png", purpose: "maskable" },
          // iOS — sempre mostra com cantos arredondados (sem máscara). Já tem
          // fundo violet também pra ficar coerente.
          { src: "/apple-touch-icon.png",       sizes: "180x180", type: "image/png" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Não cachear chamadas pra Supabase/MinIO — sempre buscar fresco
        navigateFallbackDenylist: [/^\/api/, /supabase\.co/, /minio/],
        // Limite generoso pra cachear o bundle (chunks ficam ~700KB)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          // Imagens dos equipamentos / logos podem ser cacheadas
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        // Habilita SW em dev pra testar instalação. Desliga se atrapalhar HMR.
        enabled: false,
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
