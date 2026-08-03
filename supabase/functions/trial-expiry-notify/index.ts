// Edge Function: trial-expiry-notify
// Envia emails de aviso pra empresas com trial vencendo.
//
// Marcos de envio (dias restantes):
//   7 → "Faltam 7 dias pro fim do seu teste"
//   3 → "Faltam 3 dias — quase no fim do teste"
//   1 → "Último dia do teste!"
//   0 → "Seu teste expirou"
//
// Anti-spam: usa email_logs.context_type='trial_warning' + context_id=`{company_id}::{milestone}`
// pra garantir que cada empresa recebe cada marco no MÁXIMO uma vez.
//
// Modos de uso:
//   POST sem body                        → bate todas empresas em trial, manda os marcos atingidos
//   POST { company_id }                  → testa em UMA empresa
//   POST { company_id, force: true }     → ignora deduplicação
//   POST { company_id, milestone:"7d" }  → força um marco específico (debug)
//
// Schedule (pg_cron):
//   SELECT cron.schedule('trial-expiry-notify-daily', '0 11 * * *',
//     $$ SELECT net.http_post(url:='https://api.zapcompany.com.br/functions/v1/trial-expiry-notify',
//                             headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $$);
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY,
//   EMAIL_FROM_ADDRESS (default: onboarding@resend.dev),
//   EMAIL_FROM_NAME (default: "Infinity CRM"),
//   APP_URL (opcional, default https://app.infnityleads.com.br)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ").trim();
}

interface TrialMilestone {
  days: number;
  suffix: string;
  subject: string;
  buildHtml: (vars: { companyName: string; adminName: string; daysLeft: number; expiresAt: string; plansUrl: string }) => string;
}

const MILESTONES: TrialMilestone[] = [
  {
    days: 7, suffix: "7d",
    subject: "Seu período de teste termina em 7 dias",
    buildHtml: ({ companyName, adminName, daysLeft, expiresAt, plansUrl }) => buildEmail({
      title: `Seu teste do Infinity CRM termina em ${daysLeft} dias`,
      greeting: `Olá, ${adminName || "tudo certo"}!`,
      body: `<p>O período de teste de <strong>${companyName}</strong> termina em <strong>${daysLeft} dias</strong> (${expiresAt}).</p>
        <p>Pra continuar usando o sistema sem interrupção, escolha um plano e ative sua assinatura agora.</p>`,
      ctaText: "Ver planos", ctaUrl: plansUrl,
    }),
  },
  {
    days: 3, suffix: "3d",
    subject: "Restam 3 dias do seu teste — quase no fim",
    buildHtml: ({ companyName, adminName, expiresAt, plansUrl }) => buildEmail({
      title: "Faltam apenas 3 dias do seu teste",
      greeting: `Olá, ${adminName || "tudo certo"}!`,
      body: `<p>Estamos chegando perto. Sua conta <strong>${companyName}</strong> entra em vencimento em <strong>3 dias</strong> (${expiresAt}).</p>
        <p>Não perca o acesso aos seus leads, conversas e relatórios — escolha um plano agora.</p>`,
      ctaText: "Escolher plano", ctaUrl: plansUrl,
    }),
  },
  {
    days: 1, suffix: "1d",
    subject: "Último dia do seu teste!",
    buildHtml: ({ companyName, adminName, expiresAt, plansUrl }) => buildEmail({
      title: "É hoje — último dia do teste",
      greeting: `Olá, ${adminName || "tudo certo"}!`,
      body: `<p>Hoje é o <strong>último dia</strong> do período de teste de <strong>${companyName}</strong>. Após ${expiresAt}, o acesso aos recursos pagos será bloqueado.</p>
        <p>Ative seu plano em poucos cliques pra continuar atendendo seus clientes sem pausa.</p>`,
      ctaText: "Ativar agora", ctaUrl: plansUrl,
    }),
  },
  {
    days: 0, suffix: "0d",
    subject: "Seu teste expirou — reative agora",
    buildHtml: ({ companyName, adminName, plansUrl }) => buildEmail({
      title: "Seu teste expirou",
      greeting: `Olá, ${adminName || "tudo certo"}!`,
      body: `<p>O período de teste de <strong>${companyName}</strong> chegou ao fim.</p>
        <p>Os recursos pagos foram bloqueados. Pra reativar imediatamente, escolha um plano abaixo — todos seus dados continuam salvos e prontos pra retomar.</p>`,
      ctaText: "Reativar conta", ctaUrl: plansUrl,
      footer: "Caso queira cancelar definitivamente ou tenha dúvidas, responda este email.",
    }),
  },
];

function buildEmail(opts: { title: string; greeting?: string; body: string; ctaText?: string; ctaUrl?: string; footer?: string }): string {
  const greeting = opts.greeting ? `<p>${opts.greeting}</p>` : "";
  const cta = opts.ctaText && opts.ctaUrl
    ? `<p style="text-align:center;margin:28px 0">
         <a href="${opts.ctaUrl}" style="background:#7c3aed;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;font-size:15px">${opts.ctaText}</a>
       </p>` : "";
  const footer = opts.footer
    ? `<p style="color:#666;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">${opts.footer}</p>`
    : `<p style="color:#999;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;text-align:center">Infinity CRM · contato@infnityleads.com.br</p>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:580px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;padding:36px;box-shadow:0 4px 20px rgba(124,58,237,0.08)">
      <div style="text-align:center;margin-bottom:8px">
        <div style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:12px;line-height:48px;color:#fff;font-weight:700;font-size:20px">⏱</div>
      </div>
      <h1 style="margin:8px 0 16px;font-size:22px;color:#111;text-align:center">${opts.title}</h1>
      ${greeting}
      <div style="font-size:15px;line-height:1.6;color:#374151">${opts.body}</div>
      ${cta}
      ${footer}
    </div>
  </div>
</body></html>`;
}

async function findAdminEmail(admin: any, companyId: string): Promise<{ email: string | null; name: string | null }> {
  // 1) owner_user_id da empresa
  const { data: company } = await admin.from("companies").select("owner_user_id").eq("id", companyId).maybeSingle();
  if (company?.owner_user_id) {
    const { data } = await admin.from("profiles").select("nome,email").eq("id", company.owner_user_id).maybeSingle();
    if (data?.email) return { email: data.email, name: data.nome };
  }
  // 2) Primeiro user com role 'admin' em user_roles
  const { data: rolesData } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = ((rolesData || []) as any[]).map((r: any) => r.user_id);
  if (adminIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,nome,email")
      .eq("company_id", companyId)
      .in("id", adminIds)
      .order("created_at", { ascending: true })
      .limit(1);
    if (profiles && profiles[0]?.email) return { email: profiles[0].email, name: profiles[0].nome };
  }
  // 3) Primeiro profile da empresa
  const { data } = await admin
    .from("profiles")
    .select("nome,email")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (data && data[0]?.email) return { email: data[0].email, name: data[0].nome };
  return { email: null, name: null };
}

async function alreadyNotified(admin: any, companyId: string, milestone: string): Promise<boolean> {
  const { data } = await admin
    .from("email_logs")
    .select("id")
    .eq("context_type", "trial_warning")
    .eq("context_id", `${companyId}::${milestone}`)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function sendResendEmail(opts: {
  apiKey: string; fromAddress: string; fromName: string;
  to: string; subject: string; html: string;
}): Promise<{ ok: boolean; error?: string; resend_id?: string }> {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${opts.fromName} <${opts.fromAddress}>`,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    const respBody = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (respBody?.message || respBody?.name || `HTTP ${resp.status}`);
      return { ok: false, error: String(msg).slice(0, 500) };
    }
    return { ok: true, resend_id: respBody?.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
  const FROM_ADDRESS = Deno.env.get("EMAIL_FROM_ADDRESS") || "onboarding@resend.dev";
  const FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") || "Infinity CRM";
  const APP_URL = Deno.env.get("APP_URL") || "https://app.infnityleads.com.br";

  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResp({ ok: false, error: "missing_supabase_env" }, 500);
  if (!RESEND_API_KEY) return jsonResp({ ok: false, error: "missing_resend_api_key" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any = {};
  try { body = await req.json(); } catch { /* sem body é OK */ }

  const targetCompanyId: string | null = body?.company_id || null;
  const force: boolean = !!body?.force;
  const forcedMilestoneSuffix: string | null = body?.milestone || null;
  const TRIAL_DAYS = 30;

  const results: Array<{ company_id: string; company_name: string; milestone: string; email: string | null; sent: boolean; error?: string; reason?: string }> = [];

  // Lista empresas alvo
  let companies: any[] = [];
  if (targetCompanyId) {
    const { data } = await admin.from("companies").select("id,name,created_at").eq("id", targetCompanyId);
    companies = data || [];
  } else {
    const { data } = await admin.from("companies").select("id,name,created_at");
    companies = data || [];
  }

  // Subscriptions de todas
  const ids = companies.map((c) => c.id);
  const { data: subs } = await admin
    .from("company_subscriptions" as any)
    .select("company_id,status,trial_ends_at")
    .in("company_id", ids);
  const subByCompany = new Map<string, any>();
  ((subs || []) as any[]).forEach((s) => { if (s?.company_id) subByCompany.set(s.company_id, s); });

  for (const company of companies) {
    const sub = subByCompany.get(company.id);
    const status = sub?.status || null;
    if (status && status !== "trialing") continue;

    // trial_ends_at: do sub OU created_at + 30 dias
    let trialEndsAt: Date | null = null;
    if (sub?.trial_ends_at) trialEndsAt = new Date(sub.trial_ends_at);
    else if (company.created_at) {
      const d = new Date(company.created_at);
      if (!Number.isNaN(d.getTime())) trialEndsAt = new Date(d.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    }
    if (!trialEndsAt || Number.isNaN(trialEndsAt.getTime())) continue;

    const msLeft = trialEndsAt.getTime() - Date.now();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

    // Escolhe marco — por padrão usa daysLeft, mas se forçado usa o solicitado
    let milestone: TrialMilestone | undefined;
    if (forcedMilestoneSuffix) {
      milestone = MILESTONES.find((m) => m.suffix === forcedMilestoneSuffix);
    } else {
      milestone = MILESTONES.find((m) => m.days === daysLeft);
    }
    if (!milestone) {
      results.push({ company_id: company.id, company_name: company.name, milestone: "—", email: null, sent: false, reason: `daysLeft=${daysLeft} não bate marco` });
      continue;
    }

    // Anti-spam
    if (!force) {
      const sent = await alreadyNotified(admin, company.id, milestone.suffix);
      if (sent) {
        results.push({ company_id: company.id, company_name: company.name, milestone: milestone.suffix, email: null, sent: false, reason: "já notificado" });
        continue;
      }
    }

    // Email do admin
    const { email, name } = await findAdminEmail(admin, company.id);
    if (!email) {
      results.push({ company_id: company.id, company_name: company.name, milestone: milestone.suffix, email: null, sent: false, error: "admin sem email" });
      continue;
    }

    // Renderiza
    const expiresFmt = trialEndsAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    const html = milestone.buildHtml({
      companyName: company.name, adminName: name || "", daysLeft,
      expiresAt: expiresFmt, plansUrl: `${APP_URL}/settings`,
    });

    // Cria log "sending"
    const { data: logEntry } = await admin
      .from("email_logs")
      .insert({
        company_id: company.id,
        sent_by_user_id: null,
        from_email: FROM_ADDRESS,
        to_emails: [email],
        cc_emails: null, bcc_emails: null,
        subject: milestone.subject,
        status: "sending",
        context_type: "trial_warning",
        context_id: `${company.id}::${milestone.suffix}`,
      } as any)
      .select("id")
      .single();
    const logId = (logEntry as any)?.id || null;

    // Envia via Resend HTTP API
    const sendRes = await sendResendEmail({
      apiKey: RESEND_API_KEY, fromAddress: FROM_ADDRESS, fromName: FROM_NAME,
      to: email, subject: milestone.subject, html,
    });

    if (logId) {
      if (sendRes.ok) {
        await admin.from("email_logs").update({ status: "sent", sent_at: new Date().toISOString() } as any).eq("id", logId);
      } else {
        await admin.from("email_logs").update({ status: "failed", error_message: sendRes.error || "" } as any).eq("id", logId);
      }
    }

    if (sendRes.ok) {
      results.push({ company_id: company.id, company_name: company.name, milestone: milestone.suffix, email, sent: true });
    } else {
      results.push({ company_id: company.id, company_name: company.name, milestone: milestone.suffix, email, sent: false, error: sendRes.error });
    }
  }

  return jsonResp({
    ok: true,
    total_companies: companies.length,
    sent: results.filter((r) => r.sent).length,
    skipped: results.filter((r) => !r.sent && r.reason).length,
    failed: results.filter((r) => !r.sent && r.error).length,
    results,
  });
});
