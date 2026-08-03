/**
 * Notificação automática pro CLIENTE via WhatsApp quando a OS muda
 * de status (ex: "pronto pra retirar", "aguardando peça", etc).
 *
 * Fluxo:
 *  1. Lê dados da OS + cliente
 *  2. Confirma que cliente tem WhatsApp/phone cadastrado
 *  3. Monta mensagem por status (com nome do cliente, número da OS, etc)
 *  4. Envia via webhook dedicado (mesma URL do técnico)
 */

import { supabase } from "@/integrations/supabase/client";
import { pickWhatsapp } from "./whatsapp";
import { generateOsPdf } from "./osPdf";
import { loadCompanyHeader, imageToDataUrl } from "./companyInfo";
import { formatBRL } from "./formatters";

export type OsStatusKey =
  | "aberta"
  | "diagnostico"
  | "aguardando_aprovacao"
  | "aguardando_peca"
  | "em_execucao"
  | "concluida"
  | "entregue"
  | "faturada"
  | "cancelada";

/**
 * Status que disparam notificação AUTOMÁTICA pro cliente
 * (independente do checkbox "Notificar cliente" no dialog).
 *
 * São os status que o cliente MAIS quer saber:
 *  - "concluida": serviço finalizado, equipamento pronto
 *  - "entregue":  liberado pra retirada/já entregue
 *
 * Os outros status continuam manuais (depende do checkbox).
 */
export const AUTO_NOTIFY_STATUSES = new Set<OsStatusKey>([
  "concluida",
  "entregue",
]);

export function isAutoNotifyStatus(status: string): boolean {
  return AUTO_NOTIFY_STATUSES.has(status as OsStatusKey);
}

interface NotifyOpts {
  osId: string;
  companyId: string;
  newStatus: OsStatusKey;
  /** Mensagem custom (vinda do dialog "Notificar cliente"). Se vazia, usa template. */
  customMessage?: string;
  userId?: string | null;
}

/* ─────── Templates padrão por status ───────
   Variáveis: {nome}, {os}, {empresa}, {tecnico}
*/
const STATUS_MESSAGES: Record<OsStatusKey, string> = {
  aberta:
    "Olá {nome}! 👋\n\nRecebemos sua OS *#{os}* e ela está aberta no nosso sistema. Em breve um técnico vai dar uma olhada.\n\nQualquer dúvida, é só responder por aqui.",

  diagnostico:
    "Oi {nome}, tudo bem? 🔍\n\nSua OS *#{os}* está em fase de *diagnóstico*. Vamos avaliar o equipamento e em breve voltamos com o parecer.",

  aguardando_aprovacao:
    "Olá {nome}! 📋\n\nDiagnóstico concluído na sua OS *#{os}*. Estamos aguardando sua aprovação do orçamento pra dar continuidade.\n\nAvise por aqui quando puder revisar.",

  aguardando_peca:
    "Oi {nome}! ⏳\n\nSua OS *#{os}* está *aguardando peça*. Assim que chegar, retomamos o serviço e te avisamos.\n\nObrigado pela paciência!",

  em_execucao:
    "Olá {nome}! 🔧\n\nIniciamos o reparo da sua OS *#{os}*. Em breve teremos novidades — assim que estiver pronta, te avisamos pra retirada.",

  concluida:
    "Olá {nome}! ✅\n\nÓtima notícia: o serviço da sua OS *#{os}* foi *concluído*!\n\nEm breve te chamamos pra retirada/entrega.",

  entregue:
    "Olá {nome}! 📦\n\nSua OS *#{os}* está *pronta pra retirada*! 🎉\n\nPode passar pra buscar o equipamento. Se preferir agendar entrega, é só nos avisar.",

  faturada:
    "Olá {nome}! 💼\n\nA fatura da sua OS *#{os}* já foi emitida. Se ainda não recebeu, é só pedir por aqui.\n\nObrigado pela confiança!",

  cancelada:
    "Oi {nome}, sua OS *#{os}* foi *cancelada*.\n\nSe foi engano ou quiser abrir novamente, é só nos avisar.",
};

export async function notifyCustomerAboutOSStatus(
  opts: NotifyOpts
): Promise<{ ok: boolean; reason?: string }> {
  // 0. Confirma que a empresa quer notificar
  try {
    const { data: company } = await supabase
      .from("companies")
      .select("notify_customer_os_status")
      .eq("id", opts.companyId)
      .maybeSingle();
    if (company && (company as any).notify_customer_os_status === false) {
      return { ok: false, reason: "disabled_by_company" };
    }
  } catch {
    /* coluna pode não existir ainda — segue */
  }

  // 1. Carrega OS
  const { data: os, error } = await supabase
    .from("service_orders" as any)
    .select(
      "id, number, status, customer_id, technician_id, public_token, total"
    )
    .eq("id", opts.osId)
    .maybeSingle();
  if (error || !os) return { ok: false, reason: "os_not_found" };
  const osAny = os as any;
  if (!osAny.customer_id) return { ok: false, reason: "no_customer" };

  // 2. Cliente
  const { data: customer } = await supabase
    .from("customers")
    .select("name, phone, whatsapp")
    .eq("id", osAny.customer_id)
    .maybeSingle();
  if (!customer) return { ok: false, reason: "customer_not_found" };

  const c: any = customer;
  const phoneRaw = c.whatsapp || c.phone;
  if (!phoneRaw) return { ok: false, reason: "customer_no_whatsapp" };

  const phone = pickWhatsapp({ phone: phoneRaw });
  if (!phone) return { ok: false, reason: "invalid_phone" };

  // 3. Técnico (opcional, pra variável {tecnico})
  let techName = "";
  if (osAny.technician_id) {
    const { data: tech } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", osAny.technician_id)
      .maybeSingle();
    techName = (tech as any)?.nome || "";
  }

  // 4. Empresa
  let companyName = "";
  try {
    const { data: comp } = await supabase
      .from("companies")
      .select("name")
      .eq("id", opts.companyId)
      .maybeSingle();
    companyName = (comp as any)?.name || "";
  } catch { /* ignora */ }

  // 5. Monta mensagem
  const num = String(osAny.number ?? "").padStart(6, "0");
  const firstName = (c.name || "").split(" ")[0] || c.name || "cliente";
  const template = opts.customMessage?.trim() || STATUS_MESSAGES[opts.newStatus] || "";

  const baseText = template
    .replace(/\{nome\}/g, firstName)
    .replace(/\{os\}/g, num)
    .replace(/\{empresa\}/g, companyName || "nossa equipe")
    .replace(/\{tecnico\}/g, techName || "nosso técnico");

  if (!baseText.trim()) return { ok: false, reason: "empty_template" };

  let text = baseText;

  // Em "aguardando aprovação": anexa o orçamento (itens + valor) pro cliente decidir.
  if (opts.newStatus === "aguardando_aprovacao") {
    const quote = await buildQuoteBlock(opts.osId, Number(osAny.total || 0));
    if (quote) text += `\n\n${quote}`;
  }

  // Anexa o link público — abre a OS direto pelo token, sem precisar digitar nada.
  const trackUrl = buildTrackUrl(osAny.public_token);
  if (trackUrl) text += `\n\n📍 Acompanhe sua OS por aqui:\n${trackUrl}`;

  // 6. Envia via webhook dedicado (texto)
  const dedicatedUrl = readEnv("VITE_OS_NOTIFICATION_WEBHOOK_URL");
  if (!dedicatedUrl) return { ok: false, reason: "no_webhook_configured" };

  try {
    const res = await fetch(dedicatedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: opts.companyId,
        phone,
        text,
        os_id: opts.osId,
        sent_by_user_id: opts.userId || null,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, reason: `webhook_${res.status}: ${txt.slice(0, 120)}` };
    }
  } catch (e: any) {
    return { ok: false, reason: `network: ${e?.message}` };
  }

  // 7. Se status = concluida OU entregue, envia PDF da OS junto (não bloqueia)
  if (opts.newStatus === "concluida" || opts.newStatus === "entregue") {
    console.log("[notifyCustomer] Disparando envio de PDF da OS", opts.osId);
    sendOSReportPdf({
      osId: opts.osId,
      osNumber: num,
      companyId: opts.companyId,
      phone,
      userId: opts.userId,
    })
      .then((r) => console.log("[notifyCustomer] PDF enviado:", r))
      .catch((e) => console.error("[notifyCustomer] PDF error:", e));
  }

  return { ok: true };
}

/* ====================================================================
   ENVIO DO PDF DA OS — usado quando conclui/entrega
==================================================================== */
async function sendOSReportPdf(opts: {
  osId: string;
  osNumber: string;
  companyId: string;
  phone: string;
  userId?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  // Webhook de envio de mídia (mesmo do chat, suporta type=document com base64)
  const mediaUrl = readEnv("VITE_WHATSAPP_WEBHOOK_URL");
  if (!mediaUrl) {
    console.warn("Sem VITE_WHATSAPP_WEBHOOK_URL — pulando envio de PDF");
    return { ok: false, reason: "no_media_webhook" };
  }
  console.log("[sendOSReportPdf] Webhook:", mediaUrl);

  // 1. Carrega dados completos pra o PDF
  const { data: os } = await supabase
    .from("service_orders" as any)
    .select("*")
    .eq("id", opts.osId)
    .maybeSingle();
  if (!os) { console.warn("[sendOSReportPdf] OS não encontrada"); return { ok: false, reason: "os_not_found" }; }
  const osAny = os as any;

  const [customerRes, equipmentRes, itemsRes, techRes] = await Promise.all([
    osAny.customer_id
      ? supabase.from("customers").select("*").eq("id", osAny.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    osAny.equipment_id
      ? supabase.from("customer_equipments" as any).select("*").eq("id", osAny.equipment_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("service_order_items" as any).select("*").eq("service_order_id", opts.osId).order("position"),
    osAny.technician_id
      ? supabase.from("profiles").select("nome").eq("id", osAny.technician_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // 2. Carrega header da empresa (com cache de 1min)
  const company = await loadCompanyHeader(opts.companyId);
  const companyLogoDataUrl = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;

  // 3. Gera PDF em base64
  let pdfBase64: string;
  try {
    const result = generateOsPdf({
      os: osAny,
      customer: (customerRes.data as any) || null,
      equipment: (equipmentRes.data as any) || null,
      items: ((itemsRes.data as any[]) || []),
      company,
      companyLogoDataUrl,
      technicianName: (techRes.data as any)?.nome,
      output: "base64",
    });
    if (typeof result !== "string") {
      console.warn("[sendOSReportPdf] generateOsPdf não retornou string");
      return { ok: false, reason: "pdf_not_string" };
    }
    pdfBase64 = result;
    console.log("[sendOSReportPdf] PDF gerado, tamanho base64:", pdfBase64.length);
  } catch (e: any) {
    console.error("[sendOSReportPdf] Erro ao gerar PDF:", e);
    return { ok: false, reason: `gen_pdf: ${e?.message}` };
  }

  // 4. Envia via webhook de mídia (type: "document" — n8n espera esse nome)
  const fileName = `OS_${opts.osNumber}.pdf`;
  try {
    const res = await fetch(mediaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: opts.companyId,
        phone: opts.phone,
        number: opts.phone,                  // alguns workflows leem "number" em vez de "phone"
        type: "document",                    // ⚠️ era "doc" — workflow espera "document"
        text: fileName,
        data: pdfBase64,
        file_name: fileName,
        fileName: fileName,                  // alguns workflows leem camelCase
        mime_type: "application/pdf",
        user_id: opts.userId || null,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[sendOSReportPdf] Webhook respondeu", res.status, txt.slice(0, 200));
      return { ok: false, reason: `webhook_${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[sendOSReportPdf] Falha rede:", e);
    return { ok: false, reason: `network: ${e?.message}` };
  }
}

/**
 * Monta o link público de acompanhamento da OS — usa o token (abre direto).
 * Usa VITE_PUBLIC_APP_URL se configurada; senão, a origem atual do navegador.
 */
function buildTrackUrl(token: unknown): string | null {
  const base =
    readEnv("VITE_PUBLIC_APP_URL") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return null;
  const cleanBase = base.replace(/\/+$/, "");
  const t = String(token ?? "").trim();
  return t ? `${cleanBase}/acompanhar?t=${encodeURIComponent(t)}` : `${cleanBase}/acompanhar`;
}

/**
 * Bloco de orçamento (itens + total) anexado à mensagem de "aguardando aprovação",
 * pra o cliente ver o que será feito e o valor antes de aprovar.
 */
async function buildQuoteBlock(osId: string, total: number): Promise<string | null> {
  const { data } = await supabase
    .from("service_order_items" as any)
    .select("description, qty, total, position")
    .eq("service_order_id", osId)
    .order("position");
  const items = (data as any[]) || [];
  if (items.length === 0 && !total) return null;

  let block = "📋 *Confira o orçamento da sua OS:*";
  if (items.length) {
    const lines = items.map((it) => {
      const qty = Number(it.qty || 0);
      const qtyTxt = qty > 1 ? ` (${qty}x)` : "";
      return `• ${it.description}${qtyTxt} — ${formatBRL(Number(it.total || 0))}`;
    });
    block += "\n\n" + lines.join("\n");
  }
  block += `\n\n💰 *Total: ${formatBRL(total)}*`;
  block += "\n\nResponda esta mensagem para *aprovar* o serviço ou tirar dúvidas. ✅";
  return block;
}

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
