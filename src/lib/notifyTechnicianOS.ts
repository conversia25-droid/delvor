/**
 * Notificação automática pro técnico via WhatsApp quando uma OS
 * é criada/transferida pra ele.
 *
 * Fluxo:
 *  1. Lê dados da OS (cliente, equipamento, técnico)
 *  2. Confirma que técnico tem WhatsApp cadastrado (`profiles.whatsapp`)
 *  3. Monta mensagem formatada
 *  4. Envia via `sendWhatsApp` (que usa webhook do n8n)
 *
 * Pode ser desligado por empresa via `companies.notify_technician_new_os = false`.
 */

import { supabase } from "@/integrations/supabase/client";
import { sendWhatsApp, pickWhatsapp } from "./whatsapp";

/* ====================================================================
   ENV — webhook DEDICADO pra notificações (fallback no de envio geral)
==================================================================== */
function readEnv(name: string): string | undefined {
  if (typeof window !== "undefined") {
    const w = (window as any).__OSM_ENV__;
    const v = w?.[name];
    if (typeof v === "string" && v && !v.startsWith("${") && !v.includes("VITE_")) {
      return v;
    }
  }
  return (import.meta.env as any)?.[name];
}

function getNotifyWebhookUrl(): string | null {
  const dedicated = readEnv("VITE_OS_NOTIFICATION_WEBHOOK_URL");
  if (dedicated && dedicated.startsWith("http")) return dedicated;
  return null;
}

export type NotifyReason = "new" | "transferred";

interface NotifyOpts {
  osId: string;
  companyId: string;
  userId?: string | null;
  reason?: NotifyReason;
}

export async function notifyTechnicianAboutOS(opts: NotifyOpts): Promise<{ ok: boolean; reason?: string }> {
  // 0. Confirma que a empresa quer notificar (silencia erro 400 se coluna ainda não existir)
  try {
    const { data: company } = await supabase
      .from("companies")
      .select("notify_technician_new_os")
      .eq("id", opts.companyId)
      .maybeSingle();
    if (company && (company as any).notify_technician_new_os === false) {
      return { ok: false, reason: "disabled_by_company" };
    }
  } catch {
    // Coluna ainda não criada — segue como se estivesse habilitado
  }

  // 1. Carrega OS (sem joins, pra evitar erro 400 do PostgREST)
  const { data: os, error } = await supabase
    .from("service_orders" as any)
    .select(
      "id, number, status, priority, reported_issue, scheduled_at, due_at, pickup_required, pickup_address, technician_id, customer_id, equipment_id"
    )
    .eq("id", opts.osId)
    .maybeSingle();
  if (error || !os) return { ok: false, reason: "os_not_found" };

  const osAny = os as any;
  if (!osAny.technician_id) return { ok: false, reason: "no_technician" };

  // 1b. Cliente (separadamente)
  let customer: any = null;
  if (osAny.customer_id) {
    const { data } = await supabase
      .from("customers")
      .select("name, phone, whatsapp, street, number, district, city, state")
      .eq("id", osAny.customer_id)
      .maybeSingle();
    customer = data;
  }
  // 1c. Equipamento (separadamente)
  let equipment: any = null;
  if (osAny.equipment_id) {
    const { data } = await supabase
      .from("customer_equipments" as any)
      .select("brand, model, serial_number, asset_tag, category, location")
      .eq("id", osAny.equipment_id)
      .maybeSingle();
    equipment = data;
  }
  osAny.customer = customer;
  osAny.equipment = equipment;

  // 2. Carrega o técnico (whatsapp obrigatório)
  const { data: tech } = await supabase
    .from("profiles")
    .select("nome, whatsapp, phone")
    .eq("id", osAny.technician_id)
    .maybeSingle();
  if (!tech) return { ok: false, reason: "technician_not_found" };

  const techPhone = (tech as any).whatsapp || (tech as any).phone;
  if (!techPhone) return { ok: false, reason: "technician_no_whatsapp" };

  // 3. Monta a mensagem — versão enxuta
  const num = String(osAny.number ?? "").padStart(6, "0");
  const title =
    opts.reason === "transferred"
      ? "🔄 *OS transferida pra você*"
      : "🔧 *Nova OS atribuída*";

  const lines: string[] = [title, "", `*OS:* #${num}`];

  if (osAny.customer?.name) lines.push(`*Cliente:* ${osAny.customer.name}`);

  if (osAny.equipment) {
    const eq = osAny.equipment;
    const brandModel = [eq.brand, eq.model].filter(Boolean).join(" ").trim();
    const equipLabel = brandModel || eq.category || "Equipamento";
    lines.push(`*Equipamento:* ${equipLabel}`);
    if (eq.category && brandModel) lines.push(`*Tipo:* ${eq.category}`);
    else if (eq.category && !brandModel) {
      // já mostrou category no Equipamento, evita duplicação
    }
  }

  if (osAny.reported_issue) {
    lines.push("", "*Problema relatado:*", osAny.reported_issue);
  }

  if (osAny.customer?.phone || osAny.customer?.whatsapp) {
    const cp = osAny.customer.whatsapp || osAny.customer.phone;
    lines.push("", `☎️ *Telefone:* ${cp}`);
  }

  const message = lines.join("\n");

  // 4. Envia — prefere webhook DEDICADO de notificação; senão usa o geral
  const dedicatedUrl = getNotifyWebhookUrl();
  if (dedicatedUrl) {
    const phone = pickWhatsapp({ phone: techPhone });
    try {
      const res = await fetch(dedicatedUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: opts.companyId,
          phone,
          text: message,
          os_id: opts.osId,
          sent_by_user_id: opts.userId || null,
        }),
      });
      if (res.ok) return { ok: true };
      const txt = await res.text();
      return { ok: false, reason: `dedicated_webhook_${res.status}: ${txt.slice(0, 120)}` };
    } catch (e: any) {
      return { ok: false, reason: `dedicated_webhook_network: ${e?.message}` };
    }
  }

  // Fallback: webhook geral via sendWhatsApp
  const res = await sendWhatsApp(techPhone, message, {
    companyId: opts.companyId,
    userId: opts.userId,
    noFallback: true,
  });

  return { ok: res.ok, reason: res.error };
}
