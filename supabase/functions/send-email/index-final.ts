// Edge Function: send-email
// Roda em self-hosted Supabase (Deno-based edge-runtime).
// Envia emails via SMTP (Zoho ou compatível) e registra log em public.email_logs.
//
// Env vars necessárias no edge-runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, ZOHO_SMTP_USER, ZOHO_SMTP_PASSWORD, ZOHO_FROM_NAME

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(html) {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ ok: false, error: "method_not_allowed" }, 405);

  // 1) Auth: Bearer token obrigatório
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResp({ ok: false, error: "missing_token" }, 401);
  }
  const token = authHeader.slice(7);

  // 2) Env vars
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SMTP_HOST = Deno.env.get("ZOHO_SMTP_HOST") || "smtp.zoho.com";
  const SMTP_PORT = parseInt(Deno.env.get("ZOHO_SMTP_PORT") || "587", 10);
  const SMTP_USER = Deno.env.get("ZOHO_SMTP_USER") || "";
  const SMTP_PASSWORD = Deno.env.get("ZOHO_SMTP_PASSWORD") || "";
  const FROM_NAME = Deno.env.get("ZOHO_FROM_NAME") || "CRM";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResp({ ok: false, error: "supabase_not_configured" }, 500);
  }
  if (!SMTP_USER || !SMTP_PASSWORD) {
    return jsonResp({
      ok: false,
      error: "smtp_not_configured",
      message: "Configure ZOHO_SMTP_USER e ZOHO_SMTP_PASSWORD nas env vars do edge-runtime.",
    }, 500);
  }

  // 3) Valida JWT
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return jsonResp({ ok: false, error: "invalid_token", message: userError?.message }, 401);
  }
  const userId = userData.user.id;

  // 4) Lookup company_id (opcional - master pode nao ter)
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("company_id, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return jsonResp({ ok: false, error: "profile_lookup_failed", message: profileError.message }, 500);
  }
  const companyId = profile?.company_id || null;
  const userRole = profile?.role || null;
  if (!companyId) {
    console.log(`[send-email] usuario ${userId} (role=${userRole || "?"}) sem company_id - log ficara orfao`);
  }

  // 5) Body
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid_json" }, 400);
  }
  if (!body.to || !body.subject || !body.html) {
    return jsonResp({ ok: false, error: "missing_fields", message: "Campos obrigatorios: to, subject, html" }, 400);
  }
  const toArr = Array.isArray(body.to) ? body.to : [body.to];

  // 6) Cria log inicial (status=sending)
  const { data: logEntry, error: logError } = await adminClient
    .from("email_logs")
    .insert({
      company_id: companyId,
      sent_by_user_id: userId,
      from_email: SMTP_USER,
      to_emails: toArr,
      cc_emails: body.cc || null,
      bcc_emails: body.bcc || null,
      subject: body.subject,
      status: "sending",
      context_type: body.context_type || null,
      context_id: body.context_id || null,
    })
    .select()
    .single();

  if (logError) {
    console.error("Falha ao criar email_log:", logError);
  }
  const logId = logEntry?.id || null;

  // 7) Envia via SMTP
  let smtpClient = null;
  try {
    smtpClient = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: SMTP_PORT === 465,
        auth: { username: SMTP_USER, password: SMTP_PASSWORD },
      },
    });

    await smtpClient.send({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to: toArr,
      cc: body.cc,
      bcc: body.bcc,
      replyTo: body.reply_to,
      subject: body.subject,
      content: body.text || stripHtml(body.html),
      html: body.html,
      attachments: body.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType || "application/octet-stream",
        encoding: "base64",
      })),
    });

    await smtpClient.close();

    if (logId) {
      await adminClient
        .from("email_logs")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", logId);
    }

    return jsonResp({ ok: true, log_id: logId });
  } catch (e) {
    const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("Falha ao enviar email:", errMsg);

    if (smtpClient) {
      try { await smtpClient.close(); } catch (_) { /* ignore */ }
    }

    if (logId) {
      await adminClient
        .from("email_logs")
        .update({ status: "failed", error_message: errMsg })
        .eq("id", logId);
    }

    return jsonResp({ ok: false, error: "smtp_failed", message: errMsg, log_id: logId }, 500);
  }
});
