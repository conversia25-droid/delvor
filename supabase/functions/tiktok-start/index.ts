// Supabase Edge Function: tiktok-start
// Returns a TikTok authorize URL using PKCE + state stored in DB.
// Invoke from the frontend via supabase.functions.invoke('tiktok-start', { body: { company_id, return_to } })

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

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const tiktokClientKey = Deno.env.get("TIKTOK_CLIENT_KEY")!;
    const redirectUri = Deno.env.get("TIKTOK_REDIRECT_URI")!;

    if (!supabaseUrl || !supabaseAnon || !tiktokClientKey || !redirectUri) {
      return new Response(JSON.stringify({ error: "missing_env" }), { status: 500 });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const company_id = body?.company_id;
    const return_to = body?.return_to || null;

    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id_required" }), { status: 400 });
    }

    const state = randomUrlSafeString(48);
    const code_verifier = randomUrlSafeString(64);
    const code_challenge = await sha256Base64url(code_verifier);

    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    const { error: insErr } = await supabase
      .from("tiktok_oauth_states")
      .insert({
        state,
        company_id,
        user_id: user.id,
        code_verifier,
        return_to,
        expires_at,
      });

    if (insErr) {
      console.error("tiktok-start insert state error:", insErr);
      return new Response(JSON.stringify({ error: "state_insert_failed" }), { status: 500 });
    }

    // Scopes: keep minimal; expand later as needed.
    const scope = "user.info.basic";
    const authorizeUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authorizeUrl.searchParams.set("client_key", tiktokClientKey);
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", code_challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return new Response(JSON.stringify({ url: authorizeUrl.toString() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tiktok-start unexpected:", e);
    return new Response(JSON.stringify({ error: "unexpected_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
