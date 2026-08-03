// Supabase Edge Function: asaas-subscribe
// Customer-facing checkout: admin escolhe um plano e a função:
//  1. Autentica o usuário e confirma que é admin da empresa
//  2. Cria customer no Asaas (se ainda não existir)
//  3. Gera uma cobrança PIX (vencimento em 3 dias) com o valor do plano
//  4. Grava a fatura em billing_invoices (status="open")
//  5. Atualiza company_subscriptions.plan_id (mas NÃO ativa — só o webhook ativa)
//  6. Retorna { payment_link, invoice_id, charge_id, qr_code? }
//
// POST body: { plan_id: string }

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

async function getAsaasConfig(admin: any): Promise<{ apiKey: string; baseUrl: string } | null> {
  const [{ data: keyRow }, { data: envRow }] = await Promise.all([
    admin.from("master_settings").select("value").eq("key", "asaas_api_key").maybeSingle(),
    admin.from("master_settings").select("value").eq("key", "asaas_env").maybeSingle(),
  ]);
  const apiKey = keyRow?.value;
  if (!apiKey) return null;
  const env = envRow?.value || "sandbox";
  const baseUrl = env === "production"
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/api/v3";
  return { apiKey, baseUrl };
}

async function asaasFetch(baseUrl: string, apiKey: string, method: string, path: string, body?: any) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      access_token: apiKey,
      "Content-Type": "application/json",
      "User-Agent": "InfinityCRM/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.description || data?.error || `Asaas ${res.status}`);
  }
  return data;
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

    if (!supabaseUrl || !supabaseAnon || !serviceKey) {
      return json({ error: "missing_env" }, 500);
    }

    // Auth user
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    // Confirma admin
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = roles?.some((r: any) => r.role === "admin" || r.role === "super_admin");
    if (!isAdmin) return json({ error: "forbidden_admin_only" }, 403);

    // Pega company_id
    const { data: profile } = await admin
      .from("profiles")
      .select("company_id, nome, email, whatsapp")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.company_id) return json({ error: "no_company" }, 400);

    // Lê o body
    const body = await req.json().catch(() => ({}));
    const planId = body?.plan_id;
    if (!planId) return json({ error: "plan_id_required" }, 400);

    // Carrega o plano e a empresa
    const [{ data: plan }, { data: company }] = await Promise.all([
      admin.from("billing_plans").select("id, code, name, price_cents").eq("id", planId).maybeSingle(),
      admin.from("companies").select("id, name, asaas_customer_id, cnpj, document").eq("id", profile.company_id).maybeSingle(),
    ]);

    if (!plan) return json({ error: "plan_not_found" }, 404);
    if (!plan.price_cents || plan.price_cents <= 0) {
      return json({ error: "plan_has_no_price", message: "Este plano não tem preço definido. Contate o suporte." }, 400);
    }
    if (!company) return json({ error: "company_not_found" }, 404);

    // Config do Asaas
    const cfg = await getAsaasConfig(admin);
    if (!cfg) {
      return json({
        error: "asaas_not_configured",
        message: "A integração com Asaas ainda não foi configurada pelo administrador da plataforma.",
      }, 500);
    }

    // 1) Cria customer se necessário
    let asaasCustomerId = company.asaas_customer_id as string | null;
    if (!asaasCustomerId) {
      const customerInput: any = {
        name: company.name,
        externalReference: company.id,
      };
      if (profile.email) customerInput.email = profile.email;
      if (profile.whatsapp) customerInput.mobilePhone = profile.whatsapp;
      if ((company as any).cnpj) customerInput.cpfCnpj = (company as any).cnpj;
      else if ((company as any).document) customerInput.cpfCnpj = (company as any).document;

      const created = await asaasFetch(cfg.baseUrl, cfg.apiKey, "POST", "/customers", customerInput);
      asaasCustomerId = created?.id;
      if (!asaasCustomerId) {
        return json({ error: "customer_create_failed", details: created }, 500);
      }
      await admin.from("companies").update({ asaas_customer_id: asaasCustomerId } as any).eq("id", company.id);
    }

    // 2) Cria a cobrança (PIX, vencendo em 3 dias)
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const valueReais = plan.price_cents / 100;

    const charge = await asaasFetch(cfg.baseUrl, cfg.apiKey, "POST", "/payments", {
      customer: asaasCustomerId,
      billingType: "UNDEFINED", // cliente escolhe (PIX, boleto ou cartão)
      value: valueReais,
      dueDate,
      description: `Assinatura mensal — ${plan.name} — Infinity CRM`,
      externalReference: `${company.id}::${plan.id}`,
    });

    const chargeId = charge?.id as string | undefined;
    const paymentLink: string | null =
      charge?.invoiceUrl || charge?.bankSlipUrl || null;

    if (!chargeId) {
      return json({ error: "charge_create_failed", details: charge }, 500);
    }

    // 3) Salva a fatura
    const { data: invoiceRow } = await admin
      .from("billing_invoices")
      .insert({
        company_id: company.id,
        amount_cents: plan.price_cents,
        status: "open",
        due_date: dueDate,
        payment_link: paymentLink,
        gateway: "asaas",
        gateway_charge_id: chargeId,
      } as any)
      .select("id")
      .single();

    // 4) Atualiza só o plan_id na subscription (NÃO muda status — só webhook ativa)
    await admin.from("company_subscriptions").upsert({
      company_id: company.id,
      plan_id: plan.id,
    } as any, { onConflict: "company_id" });

    // 5) Audita
    await admin.from("billing_events").insert({
      company_id: company.id,
      action: "checkout_link_generated",
      new_value: { plan_id: plan.id, charge_id: chargeId, amount_cents: plan.price_cents },
      notes: `Link de pagamento gerado por ${profile.nome || profile.email || user.id}`,
    } as any);

    return json({
      ok: true,
      payment_link: paymentLink,
      invoice_id: invoiceRow?.id || null,
      charge_id: chargeId,
      due_date: dueDate,
      amount_cents: plan.price_cents,
    });
  } catch (e: any) {
    console.error("asaas-subscribe error:", e);
    return json({ error: "unexpected_error", message: String(e?.message || e) }, 500);
  }
});
