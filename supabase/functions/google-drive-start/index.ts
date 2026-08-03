// Supabase Edge Function: google-drive-start
// Returns a Google OAuth authorize URL using PKCE + state stored in DB.
// Invoke from the frontend via:
//   supabase.functions.invoke('google-drive-start', { body: { company_id, return_to } })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function base64url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64;
}

async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(hash));
}

function randomUrlSafeString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, length);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!;

    if (!supabaseUrl || !supabaseAnon || !googleClientId || !redirectUri) {
      return new Response(JSON.stringify({ error: "missing_env" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const company_id = body?.company_id;
    const return_to = body?.return_to || null;

    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const state = randomUrlSafeString(48);
    const code_verifier = randomUrlSafeString(64);
    const code_challenge = await sha256Base64url(code_verifier);

    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const { error: insErr } = await supabase
      .from("google_oauth_states")
      .insert({
        state,
        company_id,
        user_id: user.id,
        code_verifier,
        return_to,
        expires_at,
      });

    if (insErr) {
      console.error("google-drive-start insert state error:", insErr);
      return new Response(JSON.stringify({ error: "state_insert_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Scopes:
    //  - drive.file: only files created/opened by the app (no Google verification required)
    //  - userinfo.email + userinfo.profile: para mostrar "Conectado como X" na UI
    const scope = [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(" ");

    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.searchParams.set("client_id", googleClientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", code_challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    // Necessário para receber refresh_token e forçar tela de consentimento
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "consent");
    authorizeUrl.searchParams.set("include_granted_scopes", "true");

    return new Response(JSON.stringify({ url: authorizeUrl.toString() }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("google-drive-start unexpected:", e);
    return new Response(JSON.stringify({ error: "unexpected_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
