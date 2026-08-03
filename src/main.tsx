import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/* =========================================================
   BOOTSTRAP DO APP
   - StrictMode ajuda a identificar efeitos quebrados
   - melhora comportamento ao sair/voltar da aba
========================================================= */

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container #root não encontrado");
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* =========================================================
   PWA — registra o service worker pra habilitar instalação
   e atualização automática em background. Modo "autoUpdate"
   (configurado em vite.config) faz com que ao subir deploy
   novo, o SW puxe os novos arquivos e troque silenciosamente.
========================================================= */
if ("serviceWorker" in navigator) {
  // Import dinâmico — o módulo `virtual:pwa-register` só existe em build
  // (gerado pelo vite-plugin-pwa). Se falhar (ex: tipos não resolvidos
  // num ambiente de dev sem o plugin), a gente engole sem quebrar o app.
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      /* PWA register não disponível — segue sem offline */
    });
}
