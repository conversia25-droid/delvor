// Supabase Edge Function: google-drive-list
// Lista arquivos e subpastas dentro de uma pasta do Google Drive da empresa.
//
// POST JSON:
//   { folder_id?: string, page_token?: string, page_size?: number, query?: string }
//
// - folder_id: id da pasta a listar. Se omitido, usa a root_folder_id da empresa.
// - page_token: token de paginação da Drive API
// - page_size: 1..200 (default 100)
// - query: filtro adicional de nome (case-insensitive "contains")
//
// Retorna:
//   {
//     folder_id, root_folder_id, is_root,
//     files: [{ id, name, mimeType, iconLink, webViewLink, webContentLink,
//               modifiedTime, size, thumbnailLink, parents, is_folder }],
//     next_page_token
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.access_token) {
      console.error("refresh_failed:", res.status, j);
      return null;
    }
    return { access_token: j.access_token, expires_in: j.expires_in ?? 3600 };
  } catch (e) {
    console.error("refresh_exception:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    if (
      !supabaseUrl ||
      !supabaseAnon ||
      !serviceKey ||
      !googleClientId ||
      !googleClientSecret
    ) {
      return json({ error: "missing_env" }, 500);
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
      return json({ error: "unauthorized" }, 401);
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr || !profile?.company_id) {
      return json({ error: "no_company" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: conn, error: connErr } = await admin
      .from("company_google_drive")
      .select("access_token, refresh_token, expires_at, root_folder_id")
      .eq("company_id", profile.company_id)
      .maybeSingle();

    if (connErr || !conn) {
      return json({ error: "drive_not_connected" }, 400);
    }
    if (!conn.refresh_token) {
      return json({ error: "missing_refresh_token" }, 400);
    }
    if (!conn.root_folder_id) {
      return json({ error: "missing_root_folder" }, 400);
    }

    let accessToken = conn.access_token as string;
    const expiresAt = conn.expires_at
      ? new Date(conn.expires_at as string).getTime()
      : 0;
    const needsRefresh = !accessToken || Date.now() > expiresAt - 60_000;

    if (needsRefresh) {
      const refreshed = await refreshAccessToken(
        googleClientId,
        googleClientSecret,
        conn.refresh_token as string,
      );
      if (!refreshed) {
        return json({ error: "token_refresh_failed" }, 401);
      }
      accessToken = refreshed.access_token;
      const newExpiresAt = new Date(
        Date.now() + refreshed.expires_in * 1000,
      ).toISOString();
      await admin
        .from("company_google_drive")
        .update({
          access_token: accessToken,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", profile.company_id);
    }

    const body = await req.json().catch(() => ({}));
    const rootFolderId = conn.root_folder_id as string;
    const folderId = (body?.folder_id as string | undefined) || rootFolderId;
    const pageToken = (body?.page_token as string | undefined) || null;
    const pageSize = Math.min(Math.max(Number(body?.page_size) || 100, 1), 200);
    const nameQuery = (body?.query as string | undefined) || null;

    // Monta a query da Drive API
    const qParts = [
      `'${folderId}' in parents`,
      `trashed = false`,
    ];
    if (nameQuery && nameQuery.trim()) {
      const safe = nameQuery.trim().replace(/'/g, "\\'");
      qParts.push(`name contains '${safe}'`);
    }
    const q = qParts.join(" and ");

    const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
    listUrl.searchParams.set("q", q);
    listUrl.searchParams.set("pageSize", String(pageSize));
    listUrl.searchParams.set(
      "fields",
      "nextPageToken, files(id,name,mimeType,iconLink,webViewLink,webContentLink,modifiedTime,size,thumbnailLink,parents)",
    );
    // Pastas primeiro, depois por nome
    listUrl.searchParams.set("orderBy", "folder,name");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listJson = await listRes.json().catch(() => ({}));
    if (!listRes.ok) {
      console.error("list_failed:", listRes.status, listJson);
      return json(
        { error: "list_failed", status: listRes.status, details: listJson },
        500,
      );
    }

    const FOLDER_MIME = "application/vnd.google-apps.folder";
    const files = (listJson.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      is_folder: f.mimeType === FOLDER_MIME,
      iconLink: f.iconLink ?? null,
      webViewLink: f.webViewLink ?? null,
      webContentLink: f.webContentLink ?? null,
      thumbnailLink: f.thumbnailLink ?? null,
      modifiedTime: f.modifiedTime ?? null,
      size: f.size ? Number(f.size) : null,
      parents: f.parents ?? [],
    }));

    return json({
      ok: true,
      folder_id: folderId,
      root_folder_id: rootFolderId,
      is_root: folderId === rootFolderId,
      files,
      next_page_token: listJson.nextPageToken ?? null,
    });
  } catch (e) {
    console.error("google-drive-list unexpected:", e);
    return json({ error: "unexpected_error", message: String(e) }, 500);
  }
});
