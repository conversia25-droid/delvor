// Supabase Edge Function: asaas-webhook
// Recebe webhooks do Asaas quando o status de uma cobrança muda.
// Configure no painel Asaas: Integrações > Webhooks > URL =
//   https://wggvhxtfeucntdunhocn.supabase.co/functions/v1/asaas-webhook
//
// Eventos relevantes:
//  - PAYMENT_RECEIVED / PAYMENT_CONFIRMED: pagamento confirmado → ativar subscription
//  - PAYMENT_OVERDUE: vencido → marcar past_due
//  - PAYMENT_REFUNDED / PAYMENT_DELETED: estornar
//
// IMPORTANTE: configure verify_jwt=false no config.toml (Asaas chama sem JWT).
// Para segurança, valide o header x-asaas-access-token (chave que você configura no painel Asaas).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !serviceKey) return json({ error: "missing_env" }, 500);

    const admin = createClient(supabaseUrl, serviceKey);

    // Validação opcional do token de webhook (configurado no painel Asaas)
    const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
    if (expectedToken) {
      const incoming = req.headers.get("asaas-access-token") || req.headers.get("x-asaas-access-token");
      if (incoming !== expectedToken) {
        console.warn("invalid webhook token");
        return json({ error: "invalid_token" }, 401);
      }
    }

    const payload = await req.json().catch(() => ({} as any));
    const event: string = payload?.event || "";
    const payment = payload?.payment || {};

    const chargeId: string | null = payment?.id || null;
    const externalRef: string | null = payment?.externalReference || null; // "{company_id}::{plan_id}"
    const status: string = payment?.status || "";

    // Salva o evento bruto pra auditoria/debug
    if (chargeId || externalRef) {
      const compFromRef = externalRef?.split("::")?.[0] || null;
      await admin.from("billing_events").insert({
        company_id: compFromRef,
        action: `asaas_webhook:${event || status}`,
        new_value: payload,
        notes: `Webhook Asaas: ${event}`,
      } as any).then(() => {}, () => {});
    }

    if (!event || !chargeId) {
      return json({ ok: true, ignored: "no_event_or_charge_id" });
    }

    // Tenta encontrar a fatura pelo gateway_charge_id
    let { data: invoice } = await admin
      .from("billing_invoices")
      .select("id, company_id, amount_cents, status")
      .eq("gateway_charge_id", chargeId)
      .maybeSingle();

    // Fallback: encontra pela company a partir do externalReference
    if (!invoice && externalRef) {
      const [companyId] = externalRef.split("::");
      if (companyId) {
        const { data: latest } = await admin
          .from("billing_invoices")
          .select("id, company_id, amount_cents, status")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        invoice = latest as any;
      }
    }

    // ────── PAGAMENTO CONFIRMADO ──────
    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED" || status === "RECEIVED" || status === "CONFIRMED") {
      const companyId = invoice?.company_id || externalRef?.split("::")?.[0] || null;
      const planId = externalRef?.split("::")?.[1] || null;

      if (invoice?.id) {
        await admin
          .from("billing_invoices")
          .update({ status: "paid", paid_at: new Date().toISOString() } as any)
          .eq("id", invoice.id);
      }

      if (companyId) {
        // Ativa por mais 30 dias a partir de agora
        const periodStart = new Date();
        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() + 30);

        const upsert: any = {
          company_id: companyId,
          status: "active",
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
          trial_ends_at: null,
          suspended_at: null,
          cancel_at_period_end: false,
        };
        if (planId) upsert.plan_id = planId;

        await admin
          .from("company_subscriptions")
          .upsert(upsert, { onConflict: "company_id" });

        await admin.from("billing_events").insert({
          company_id: companyId,
          action: "subscription_activated_by_payment",
          new_value: { charge_id: chargeId, plan_id: planId, period_end: periodEnd.toISOString() },
          notes: "Pagamento confirmado via webhook Asaas",
        } as any);
      }

      return json({ ok: true, action: "activated" });
    }

    // ────── VENCIDO ──────
    if (event === "PAYMENT_OVERDUE" || status === "OVERDUE") {
      if (invoice?.id) {
        await admin
          .from("billing_invoices")
          .update({ status: "overdue" } as any)
          .eq("id", invoice.id);
      }
      const companyId = invoice?.company_id || externalRef?.split("::")?.[0] || null;
      if (companyId) {
        await admin
          .from("company_subscriptions")
          .update({ status: "past_due" } as any)
          .eq("company_id", companyId);
      }
      return json({ ok: true, action: "marked_overdue" });
    }

    // ────── ESTORNO / CANCELAMENTO ──────
    if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_DELETED" || status === "REFUNDED" || status === "DELETED") {
      if (invoice?.id) {
        await admin
          .from("billing_invoices")
          .update({ status: status === "REFUNDED" ? "refunded" : "canceled" } as any)
          .eq("id", invoice.id);
      }
      return json({ ok: true, action: "invoice_voided" });
    }

    return json({ ok: true, ignored: event });
  } catch (e: any) {
    console.error("asaas-webhook error:", e);
    return json({ error: "unexpected_error", message: String(e?.message || e) }, 500);
  }
});
