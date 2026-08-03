// Supabase Edge Function: google-drive-upload
// Upload de arquivo para o Google Drive da empresa.
//
// Aceita POST com FormData:
//   - file        : Blob (obrigatório)
//   - file_name   : string (opcional, default = file.name)
//   - subfolder   : string (opcional) — cria/reusa subpasta dentro da raiz da empresa
//   - mime_type   : string (opcional) — sobrescreve o mime do arquivo
//
// Retorna JSON: { id, name, webViewLink, webContentLink }

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

// Garante que existe uma subpasta dentro de parentId, retorna o id.
async function ensureSubfolder(
  accessToken: string,
  parentId: string,
  name: string,
): Promise<string> {
  // Tenta achar uma já existente, sem trash
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const findRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const findJson = await findRes.json().catch(() => ({}));
  if (findRes.ok && findJson?.files?.[0]?.id) {
    return findJson.files[0].id;
  }
  // Cria
  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  );
  const createJson = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createJson?.id) {
    throw new Error(`subfolder_create_failed: ${JSON.stringify(createJson)}`);
  }
  return createJson.id;
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

    // Auth user (usa o token do front)
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

    // Pega o company_id do user
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr || !profile?.company_id) {
      return json({ error: "no_company" }, 400);
    }

    // Admin client pra mexer com tokens
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: conn, error: connErr } = await admin
      .from("company_google_drive")
      .select(
        "access_token, refresh_token, expires_at, root_folder_id, root_folder_name",
      )
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

    // Refresh do access_token se faltar < 60s pra expirar
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

    // Lê multipart
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return json({ error: "file_required" }, 400);
    }

    const fileName =
      (form.get("file_name") as string | null) || file.name || "untitled";
    const subfolder = (form.get("subfolder") as string | null) || null;
    const mimeOverride = (form.get("mime_type") as string | null) || null;
    const mimeType = mimeOverride || file.type || "application/octet-stream";

    // Resolve a pasta de destino
    let parentId = conn.root_folder_id as string;
    if (subfolder && subfolder.trim()) {
      try {
        parentId = await ensureSubfolder(accessToken, parentId, subfolder.trim());
      } catch (e) {
        console.error("ensure_subfolder_error:", e);
        return json({ error: "subfolder_failed" }, 500);
      }
    }

    // Upload multipart pro Drive (metadata + media em uma única request)
    const boundary = "----InfinityCRMBoundary" + crypto.randomUUID();
    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType,
    };
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
    );
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + fileBytes.length + tail.length);
    body.set(head, 0);
    body.set(fileBytes, head.length);
    body.set(tail, head.length + fileBytes.length);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,mimeType",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    const uploadJson = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      console.error("upload_failed:", uploadRes.status, uploadJson);
      return json(
        { error: "upload_failed", status: uploadRes.status, details: uploadJson },
        500,
      );
    }

    return json({
      ok: true,
      id: uploadJson.id,
      name: uploadJson.name,
      mimeType: uploadJson.mimeType,
      webViewLink: uploadJson.webViewLink ?? null,
      webContentLink: uploadJson.webContentLink ?? null,
      parent_id: parentId,
    });
  } catch (e) {
    console.error("google-drive-upload unexpected:", e);
    return json({ error: "unexpected_error", message: String(e) }, 500);
  }
});
