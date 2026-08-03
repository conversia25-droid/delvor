// Edge Function: send-email
//
// Envia emails via Resend HTTP API e registra log em public.email_logs.
//
// Pré-requisitos (env vars no edge runtime):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//   - RESEND_API_KEY                (chave do Resend, começa com re_)
//   - EMAIL_FROM_ADDRESS            (opcional — default: onboarding@resend.dev se domínio não verificado)
//   - EMAIL_FROM_NAME               (opcional — default: "Infinity CRM")
//   - EMAIL_REPLY_TO                (opcional — endereço pra reply-to padrão)
//
// Exemplo de chamada do frontend:
//   await supabase.functions.invoke("send-email", {
//     body: {
//       to: "cliente@email.com",
//       subject: "Boleto da mensalidade",
//       html: "<p>Segue boleto...</p>",
//     },
//   });

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

interface SendEmailRequest {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType?: string;
  }>;
  /** Sobrescreve EMAIL_FROM_ADDRESS pra esse envio especifico (precisa estar no dominio verificado) */
  from_address?: string;
  /** Sobrescreve EMAIL_FROM_NAME pra esse envio especifico */
  from_name?: string;
  // Metadados pra rastreio (opcional)
  context_type?: string;
  context_id?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ ok: false, error: "method_not_allowed" }, 405);
  }

  // 1) Auth: precisa de JWT do usuário autenticado
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResp({ ok: false, error: "missing_token" }, 401);
  }
  const token = authHeader.slice(7);

  // 2) Vars de ambiente
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
  const FROM_ADDRESS_DEFAULT = Deno.env.get("EMAIL_FROM_ADDRESS") || "onboarding@resend.dev";
  const FROM_NAME_DEFAULT = Deno.env.get("EMAIL_FROM_NAME") || "Infinity CRM";
  const REPLY_TO_DEFAULT = Deno.env.get("EMAIL_REPLY_TO") || "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResp({ ok: false, error: "supabase_not_configured" }, 500);
  }
  if (!RESEND_API_KEY) {
    return jsonResp({
      ok: false,
      error: "resend_not_configured",
      message: "Configure RESEND_API_KEY nas env vars do edge runtime.",
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

  // 4) Lookup company_id (opcional — master users podem não ter)
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return jsonResp({ ok: false, error: "profile_lookup_failed", message: profileError.message }, 500);
  }
  const companyId: string | null = (profile as any)?.company_id || null;
  if (!companyId) {
    console.log(`[send-email] usuario ${userId} sem company_id - log ficara orfao`);
  }

  // 5) Body
  let body: SendEmailRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok: false, error: "invalid_json" }, 400);
  }
  if (!body.to || !body.subject || !body.html) {
    return jsonResp({ ok: false, error: "missing_fields", message: "Campos obrigatórios: to, subject, html" }, 400);
  }
  const toArr = Array.isArray(body.to) ? body.to : [body.to];

  const fromAddress = body.from_address || FROM_ADDRESS_DEFAULT;
  const fromName = body.from_name || FROM_NAME_DEFAULT;
  const fromCombined = `${fromName} <${fromAddress}>`;
  const replyTo = body.reply_to || REPLY_TO_DEFAULT || undefined;

  // 6) Cria log inicial (status=sending)
  const { data: logEntry, error: logError } = await adminClient
    .from("email_logs")
    .insert({
      company_id: companyId,
      sent_by_user_id: userId,
      from_email: fromAddress,
      to_emails: toArr,
      cc_emails: body.cc || null,
      bcc_emails: body.bcc || null,
      subject: body.subject,
      status: "sending",
      context_type: body.context_type || null,
      context_id: body.context_id || null,
    })
    .select("id")
    .single();

  if (logError) {
    console.error("Falha ao criar email_log:", logError);
  }
  const logId = (logEntry as any)?.id || null;

  // 7) Envia via Resend HTTP API
  try {
    const payload: any = {
      from: fromCombined,
      to: toArr,
      subject: body.subject,
      html: body.html,
    };
    if (body.text) payload.text = body.text;
    if (body.cc && body.cc.length) payload.cc = body.cc;
    if (body.bcc && body.bcc.length) payload.bcc = body.bcc;
    if (replyTo) payload.reply_to = replyTo;
    if (body.attachments && body.attachments.length) {
      payload.attachments = body.attachments.map((a) => ({
        filename: a.filename,
        content: a.content, // Resend aceita base64 string direto
      }));
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const respBody = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const errMsg = (respBody?.message || respBody?.name || `HTTP ${resp.status}`).slice(0, 500);
      console.error("[send-email] Resend retornou erro:", resp.status, respBody);
      if (logId) {
        await adminClient
          .from("email_logs")
          .update({ status: "failed", error_message: errMsg } as any)
          .eq("id", logId);
      }
      return jsonResp({ ok: false, error: "resend_failed", message: errMsg, status: resp.status, details: respBody, log_id: logId }, 500);
    }

    // Sucesso — Resend retorna { id: "..." }
    const resendId = respBody?.id || null;
    if (logId) {
      await adminClient
        .from("email_logs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: null,
        } as any)
        .eq("id", logId);
    }

    return jsonResp({ ok: true, log_id: logId, resend_id: resendId });
  } catch (e) {
    const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("[send-email] Exception:", errMsg);
    if (logId) {
      await adminClient
        .from("email_logs")
        .update({ status: "failed", error_message: errMsg } as any)
        .eq("id", logId);
    }
    return jsonResp({ ok: false, error: "exception", message: errMsg, log_id: logId }, 500);
  }
});
