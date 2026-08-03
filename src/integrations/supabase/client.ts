import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Resolve uma variável de ambiente preferindo runtime (window.__OSM_ENV__)
 * sobre build-time (import.meta.env).
 *
 *  - **Em produção (Docker/EasyPanel)**: o `docker-entrypoint.sh` gera
 *    `/env.js` no startup, populando `window.__OSM_ENV__` com os valores
 *    reais. Isso permite mudar credenciais sem rebuild.
 *
 *  - **Em desenvolvimento (npm run dev)**: o `env.js` é servido com os
 *    placeholders literais (`${VITE_SUPABASE_URL}` etc). A função detecta
 *    placeholders não-substituídos e cai pro `import.meta.env` (que lê
 *    `.env.local` / `.env`).
 */
function resolveEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY"): string | undefined {
  // 1) Runtime (window.__OSM_ENV__)
  if (typeof window !== "undefined") {
    const w = (window as any).__OSM_ENV__;
    const v = w?.[name];
    if (typeof v === "string" && v && !v.startsWith("${") && !v.includes("VITE_")) {
      return v;
    }
  }
  // 2) Build-time (Vite / dev)
  return (import.meta.env as any)?.[name];
}

const SUPABASE_URL = resolveEnv("VITE_SUPABASE_URL");
const SUPABASE_ANON_KEY = resolveEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Variáveis de ambiente do Supabase não definidas. " +
    "Em desenvolvimento, defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env.local. " +
    "Em produção, defina-as como Environment no painel do EasyPanel."
  );
}

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);
