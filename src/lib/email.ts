import { supabase } from "@/integrations/supabase/client";

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  /** Anexos em base64. Útil pra mandar boleto PDF junto. */
  attachments?: Array<{
    filename: string;
    content: string; // base64 sem o prefixo "data:..."
    contentType?: string;
  }>;
  /** Tipo do contexto pra rastreio (ex: 'boleto', 'lembrete', 'manual'). */
  context_type?: string;
  /** ID do recurso relacionado (ex: id da cobrança). */
  context_id?: string;
}

export interface SendEmailResult {
  ok: boolean;
  log_id?: string;
  error?: string;
  message?: string;
}

/**
 * Envia email pelo CRM via Edge Function `send-email`.
 *
 * - Roda no servidor (Edge Function), nunca expõe credenciais SMTP no browser.
 * - Cada chamada cria uma linha em `email_logs` com status (sending → sent/failed).
 * - O JWT do usuário autenticado é validado e o `company_id` é derivado do profile.
 *
 * Exemplo:
 * ```ts
 * await sendEmail({
 *   to: "cliente@email.com",
 *   subject: "Boleto da mensalidade",
 *   html: "<p>Olá, segue seu boleto...</p>",
 *   context_type: "boleto",
 *   context_id: "uuid-da-cobranca",
 * });
 * ```
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!params.to || (Array.isArray(params.to) && params.to.length === 0)) {
    return { ok: false, error: "missing_to", message: "Destinatário (to) é obrigatório." };
  }
  if (!params.subject) return { ok: false, error: "missing_subject" };
  if (!params.html) return { ok: false, error: "missing_html" };

  try {
    // Usa fetch() direto pra conseguir ler o body em respostas non-2xx
    // (supabase.functions.invoke esconde o body real em erro).
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      return { ok: false, error: "no_session", message: "Sessão expirada — faça login de novo." };
    }

    const sb: any = supabase as any;
    const supabaseUrl: string =
      sb.supabaseUrl ||
      (sb.restUrl ? String(sb.restUrl).replace(/\/rest\/v1\/?$/, "") : "") ||
      (sb.functionsUrl ? String(sb.functionsUrl).replace(/\/functions\/v1\/?$/, "") : "");
    if (!supabaseUrl) {
      return { ok: false, error: "no_supabase_url", message: "Não consegui descobrir a URL do Supabase." };
    }

    const fnUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/send-email`;
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(params),
    });

    let bodyJson: any = null;
    let bodyText = "";
    try {
      bodyText = await res.text();
      bodyJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      bodyJson = bodyText ? { raw: bodyText.slice(0, 500) } : null;
    }

    if (!res.ok) {
      const dump = JSON.stringify(bodyJson, null, 2);
      console.error("[sendEmail] Edge Function HTTP " + res.status + ":\n" + dump);
      console.error("[sendEmail] body recebido (objeto):", bodyJson);
      return {
        ok: false,
        error: bodyJson?.error || `http_${res.status}`,
        message: bodyJson?.message || bodyJson?.raw || `Edge Function retornou HTTP ${res.status}`,
      };
    }
    return (bodyJson as SendEmailResult) || { ok: false, error: "no_response" };
  } catch (e: any) {
    console.error("[sendEmail] exception:", e);
    return { ok: false, error: "exception", message: e?.message || String(e) };
  }
}

// ─────────────────── Logs ───────────────────

export interface EmailLog {
  id: string;
  company_id: string;
  sent_by_user_id: string | null;
  from_email: string;
  to_emails: string[];
  cc_emails: string[] | null;
  bcc_emails: string[] | null;
  subject: string;
  status: "pending" | "sending" | "sent" | "failed";
  error_message: string | null;
  context_type: string | null;
  context_id: string | null;
  sent_at: string | null;
  created_at: string;
}

export async function listEmailLogs(companyId?: string, limit = 50): Promise<EmailLog[]> {
  let q = supabase
    .from("email_logs" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (companyId) q = q.eq("company_id", companyId);

  const { data, error } = await q;
  if (error) {
    console.error("listEmailLogs error:", error);
    return [];
  }
  return (data || []) as any as EmailLog[];
}

/**
 * Helper pra montar um HTML simples padronizado pro CRM.
 * Use como base e customize por contexto (boleto, lembrete, etc).
 */
export function buildSimpleEmailHtml(opts: {
  title: string;
  greeting?: string;
  body: string; // pode ter <p>, <a>, etc
  ctaText?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const greeting = opts.greeting ? `<p>${opts.greeting}</p>` : "";
  const cta = opts.ctaText && opts.ctaUrl
    ? `<p style="text-align:center;margin:24px 0">
         <a href="${opts.ctaUrl}" style="background:#10b981;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block">${opts.ctaText}</a>
       </p>`
    : "";
  const footer = opts.footer
    ? `<p style="color:#666;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">${opts.footer}</p>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <h1 style="margin:0 0 16px;font-size:20px;color:#111">${opts.title}</h1>
      ${greeting}
      <div style="font-size:15px;line-height:1.6;color:#222">${opts.body}</div>
      ${cta}
      ${footer}
    </div>
  </div>
</body></html>`;
}
