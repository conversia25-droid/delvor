// Supabase Edge Function: tiktok-callback
// TikTok redirects here with ?code=...&state=...
// This function exchanges the code for tokens and stores them in public.tiktok_connections.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const error_description = url.searchParams.get("error_description") || url.searchParams.get("description");

    const siteUrl = Deno.env.get("SITE_URL") || "";
    const redirectOk = (params: Record<string, string>) => {
      const target = new URL(siteUrl || "http://localhost:5173");
      target.pathname = "/integrations";
      Object.entries(params).forEach(([k, v]) => target.searchParams.set(k, v));
      return Response.redirect(target.toString(), 302);
    };

    if (error) {
      return redirectOk({ tiktok_oauth_error: error, desc: error_description || "oauth_error" });
    }

    if (!code || !state) {
      return redirectOk({ tiktok_oauth_error: "missing_code_or_state" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const tiktokClientKey = Deno.env.get("TIKTOK_CLIENT_KEY")!;
    const tiktokClientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("TIKTOK_REDIRECT_URI")!;

    if (!supabaseUrl || !serviceKey || !tiktokClientKey || !tiktokClientSecret || !redirectUri) {
      console.error("missing_env");
      return redirectOk({ tiktok_oauth_error: "missing_env" });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Load state (and PKCE verifier)
    const { data: st, error: stErr } = await admin
      .from("tiktok_oauth_states")
      .select("company_id,user_id,code_verifier,return_to,expires_at")
      .eq("state", state)
      .maybeSingle();

    if (stErr || !st) {
      console.error("state_not_found:", stErr);
      return redirectOk({ tiktok_oauth_error: "invalid_state" });
    }

    if (new Date(st.expires_at).getTime() < Date.now()) {
      await admin.from("tiktok_oauth_states").delete().eq("state", state);
      return redirectOk({ tiktok_oauth_error: "state_expired" });
    }

    // Exchange authorization code for token
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: tiktokClientKey,
        client_secret: tiktokClientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: st.code_verifier,
      }).toString(),
    });

    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error("token_exchange_failed:", tokenRes.status, tokenJson);
      await admin.from("tiktok_oauth_states").delete().eq("state", state);
      return redirectOk({ tiktok_oauth_error: "token_exchange_failed" });
    }

    const access_token = tokenJson?.access_token;
    const refresh_token = tokenJson?.refresh_token ?? null;
    const scope = tokenJson?.scope ?? null;
    const token_type = tokenJson?.token_type ?? null;
    const expires_in = tokenJson?.expires_in ?? null;

    let expires_at: string | null = null;
    if (typeof expires_in === "number") {
      expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
    }

    // Fetch user info (optional but recommended for UI)
    let userInfo: any = null;
    try {
      const uiRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      userInfo = await uiRes.json().catch(() => null);
    } catch (_) {}

    const open_id = userInfo?.data?.user?.open_id ?? null;
    const union_id = userInfo?.data?.user?.union_id ?? null;
    const avatar_url = userInfo?.data?.user?.avatar_url ?? null;
    const display_name = userInfo?.data?.user?.display_name ?? null;

    // Upsert connection
    const { error: upErr } = await admin
      .from("tiktok_connections")
      .upsert(
        {
          company_id: st.company_id,
          user_id: st.user_id,
          open_id,
          union_id,
          display_name,
          avatar_url,
          access_token,
          refresh_token,
          scope,
          token_type,
          expires_at,
          obtained_at: new Date().toISOString(),
          raw_token_response: tokenJson,
          raw_user_response: userInfo,
        },
        { onConflict: "company_id,user_id" },
      );

    // Clean state
    await admin.from("tiktok_oauth_states").delete().eq("state", state);

    if (upErr) {
      console.error("upsert_failed:", upErr);
      return redirectOk({ tiktok_oauth_error: "db_upsert_failed" });
    }

    // Redirect back
    const target = st.return_to || (siteUrl ? `${siteUrl}/integrations` : "/integrations");
    const okUrl = new URL(target, siteUrl || undefined);
    okUrl.searchParams.set("tiktok", "connected");
    return Response.redirect(okUrl.toString(), 302);
  } catch (e) {
    console.error("tiktok-callback unexpected:", e);
    return new Response("Unexpected error", { status: 500 });
  }
});
