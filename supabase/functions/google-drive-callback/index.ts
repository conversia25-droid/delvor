// Supabase Edge Function: google-drive-callback
// Google redirects here with ?code=...&state=...
// This function:
//  1. Exchanges code for access_token + refresh_token
//  2. Fetches the connected Google profile (email/name/picture)
//  3. Creates an "Infinity CRM" root folder in the user's Drive
//  4. Upserts everything in public.company_google_drive
//  5. Redirects back to SITE_URL/automacoes (or return_to)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const siteUrl = Deno.env.get("SITE_URL") || "";
    const fallbackPath = "/automations";

    const redirectBack = (params: Record<string, string>) => {
      const target = new URL(siteUrl || "http://localhost:5173");
      target.pathname = fallbackPath;
      Object.entries(params).forEach(([k, v]) => target.searchParams.set(k, v));
      return Response.redirect(target.toString(), 302);
    };

    if (error) {
      return redirectBack({ google_oauth_error: error });
    }

    if (!code || !state) {
      return redirectBack({ google_oauth_error: "missing_code_or_state" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI")!;

    if (
      !supabaseUrl ||
      !serviceKey ||
      !googleClientId ||
      !googleClientSecret ||
      !redirectUri
    ) {
      console.error("missing_env in google-drive-callback");
      return redirectBack({ google_oauth_error: "missing_env" });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // 1) Load state row (and PKCE verifier)
    const { data: st, error: stErr } = await admin
      .from("google_oauth_states")
      .select("company_id,user_id,code_verifier,return_to,expires_at")
      .eq("state", state)
      .maybeSingle();

    if (stErr || !st) {
      console.error("state_not_found:", stErr);
      return redirectBack({ google_oauth_error: "invalid_state" });
    }

    if (new Date(st.expires_at).getTime() < Date.now()) {
      await admin.from("google_oauth_states").delete().eq("state", state);
      return redirectBack({ google_oauth_error: "state_expired" });
    }

    // 2) Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: st.code_verifier,
      }).toString(),
    });

    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error("token_exchange_failed:", tokenRes.status, tokenJson);
      await admin.from("google_oauth_states").delete().eq("state", state);
      return redirectBack({ google_oauth_error: "token_exchange_failed" });
    }

    const access_token: string = tokenJson?.access_token;
    const refresh_token: string | null = tokenJson?.refresh_token ?? null;
    const scope: string | null = tokenJson?.scope ?? null;
    const token_type: string | null = tokenJson?.token_type ?? null;
    const expires_in: number | null = tokenJson?.expires_in ?? null;

    if (!access_token || !refresh_token) {
      console.error("missing_tokens", {
        hasAccess: !!access_token,
        hasRefresh: !!refresh_token,
      });
      await admin.from("google_oauth_states").delete().eq("state", state);
      return redirectBack({ google_oauth_error: "missing_refresh_token" });
    }

    let expires_at: string | null = null;
    if (typeof expires_in === "number") {
      expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
    }

    // 3) Fetch user profile (email + name + picture)
    let userInfo: any = null;
    try {
      const uiRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${access_token}` } },
      );
      userInfo = await uiRes.json().catch(() => null);
    } catch (_) {}

    const google_email: string | null = userInfo?.email ?? null;
    const display_name: string | null = userInfo?.name ?? null;
    const avatar_url: string | null = userInfo?.picture ?? null;

    // 4) Verifica se já existe pasta raiz (em caso de re-conexão)
    const { data: existing } = await admin
      .from("company_google_drive")
      .select("root_folder_id, root_folder_name")
      .eq("company_id", st.company_id)
      .maybeSingle();

    let root_folder_id: string | null = existing?.root_folder_id ?? null;
    const root_folder_name: string =
      existing?.root_folder_name || "Infinity CRM";

    // Se não existe (ou foi deletada do Drive), cria uma nova
    if (!root_folder_id) {
      try {
        const createRes = await fetch(
          "https://www.googleapis.com/drive/v3/files?fields=id,name",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: root_folder_name,
              mimeType: "application/vnd.google-apps.folder",
            }),
          },
        );
        const createJson = await createRes.json().catch(() => ({}));
        if (createRes.ok && createJson?.id) {
          root_folder_id = createJson.id;
        } else {
          console.error("create_root_folder_failed:", createRes.status, createJson);
        }
      } catch (e) {
        console.error("create_root_folder_exception:", e);
      }
    } else {
      // Verifica se a pasta ainda existe; se não, recria
      try {
        const checkRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${root_folder_id}?fields=id,trashed`,
          { headers: { Authorization: `Bearer ${access_token}` } },
        );
        const checkJson = await checkRes.json().catch(() => ({}));
        if (!checkRes.ok || checkJson?.trashed) {
          // Recria
          const createRes = await fetch(
            "https://www.googleapis.com/drive/v3/files?fields=id",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: root_folder_name,
                mimeType: "application/vnd.google-apps.folder",
              }),
            },
          );
          const createJson = await createRes.json().catch(() => ({}));
          if (createRes.ok && createJson?.id) {
            root_folder_id = createJson.id;
          }
        }
      } catch (_) {}
    }

    // 5) Upsert connection (one per company)
    const { error: upErr } = await admin
      .from("company_google_drive")
      .upsert(
        {
          company_id: st.company_id,
          connected_by_user_id: st.user_id,
          google_email,
          display_name,
          avatar_url,
          access_token,
          refresh_token,
          scope,
          token_type,
          expires_at,
          obtained_at: new Date().toISOString(),
          root_folder_id,
          root_folder_name,
          raw_token_response: tokenJson,
          raw_user_response: userInfo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" },
      );

    // Limpa o state (one-shot)
    await admin.from("google_oauth_states").delete().eq("state", state);

    if (upErr) {
      console.error("upsert_failed:", upErr);
      return redirectBack({ google_oauth_error: "db_upsert_failed" });
    }

    // 6) Redireciona pro app
    const targetPath = st.return_to || fallbackPath;
    const okUrl = new URL(targetPath, siteUrl || undefined);
    okUrl.searchParams.set("google_drive", "connected");
    return Response.redirect(okUrl.toString(), 302);
  } catch (e) {
    console.error("google-drive-callback unexpected:", e);
    return new Response("Unexpected error", { status: 500 });
  }
});
