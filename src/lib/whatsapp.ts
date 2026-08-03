/**
 * Helpers para envio de WhatsApp.
 *
 * ORDEM DE PRIORIDADE PARA ENVIO:
 *   1. **Webhook n8n** (se `VITE_WHATSAPP_WEBHOOK_URL` setado)
 *      → posta no n8n, que faz upload de mídia + chama Evolution + grava
 *      em `wpp_conversations`. Suporta texto + áudio + imagem + vídeo + doc.
 *
 *   2. **Evolution direto** (se `VITE_EVOLUTION_*` setado e webhook não)
 *      → chama `/message/sendText` direto. Só texto.
 *
 *   3. **wa.me fallback** (se nada configurado ou tudo falhar)
 *      → abre WhatsApp Web/Desktop com texto pré-preenchido.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  isEvolutionConfigured,
  sendText as evoSendText,
  companyIdToInstanceName,
} from "@/lib/evolution";

/* ====================================================================
   ENV
==================================================================== */
function resolveEnv(name: string): string | undefined {
  if (typeof window !== "undefined") {
    const w = (window as any).__OSM_ENV__;
    const v = w?.[name];
    if (typeof v === "string" && v && !v.startsWith("${") && !v.includes("VITE_")) {
      return v;
    }
  }
  return (import.meta.env as any)?.[name];
}

export function getWebhookUrl(): string | null {
  const u = resolveEnv("VITE_WHATSAPP_WEBHOOK_URL");
  return u && u.startsWith("http") ? u : null;
}

export function isWebhookConfigured(): boolean {
  return getWebhookUrl() !== null;
}

/* ====================================================================
   PHONE HELPERS
==================================================================== */
function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D+/g, "");
}

/** Extrai apenas dígitos do JID (5511999999999@s.whatsapp.net → 5511999999999) */
export function jidToPhone(jid: string | null | undefined): string {
  if (!jid) return "";
  return digits(jid.split("@")[0] || jid);
}

/** Devolve o melhor telefone possível: whatsapp/phone/jid, normalizado com DDI 55. */
export function pickWhatsapp(opts: {
  whatsapp?: string | null;
  phone?: string | null;
  remote_jid?: string | null;
}): string {
  let d =
    digits(opts.whatsapp) ||
    digits(opts.phone) ||
    jidToPhone(opts.remote_jid);
  if (!d) return "";
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

/* ====================================================================
   wa.me (fallback)
==================================================================== */
export function buildWhatsAppUrl(phone: string, message?: string): string {
  const p = digits(phone);
  if (!p) return "";
  const q = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${p}${q}`;
}

export function openWhatsApp(phone: string, message?: string): boolean {
  const url = buildWhatsAppUrl(phone, message);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/* ====================================================================
   Resolver: qual instância usar p/ a empresa?
==================================================================== */
async function resolveInstance(opts: {
  companyId: string;
  instanceId?: string;
}): Promise<{ instance_name: string; status: string; id: string } | null> {
  if (opts.instanceId) {
    const { data } = await supabase
      .from("wpp_instances" as any)
      .select("id, instance_name, status")
      .eq("id", opts.instanceId)
      .eq("company_id", opts.companyId)
      .maybeSingle();
    return (data as any) || null;
  }

  const { data: def } = await supabase
    .from("wpp_instances" as any)
    .select("id, instance_name, status")
    .eq("company_id", opts.companyId)
    .eq("is_default", true)
    .maybeSingle();
  if (def) return def as any;

  const { data: any1 } = await supabase
    .from("wpp_instances" as any)
    .select("id, instance_name, status")
    .eq("company_id", opts.companyId)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  return (any1 as any) || null;
}

/* ====================================================================
   Webhook n8n
==================================================================== */
export type MediaType = "text" | "audio" | "image" | "video" | "doc";

interface WebhookPayload {
  company_id: string;
  instance_id: string;        // instance_name no schema (n8n usa o nome do CRM)
  instance_name: string;      // explícito também
  number: string;             // E.164 sem +
  type: MediaType;
  text?: string;              // texto da mensagem (ou caption)
  data?: string;              // base64 da mídia (sem prefix data:...;base64,)
  file_name?: string;         // nome do arquivo (pra documento)
  mime_type?: string;         // mime type (pra mídia)
  user_id?: string | null;    // quem enviou
  instance_phone_number?: number | null;
  quoted?: {                  // citar mensagem (reply)
    key: {
      id: string;
      remoteJid?: string;
      fromMe?: boolean;
    };
    message?: any;
  } | null;
}

async function postWebhook(payload: WebhookPayload): Promise<{ ok: boolean; error?: string }> {
  const url = getWebhookUrl();
  if (!url) return { ok: false, error: "Webhook não configurado" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Webhook respondeu ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha de rede" };
  }
}

/* ====================================================================
   Envio inteligente — escolhe o melhor caminho disponível
==================================================================== */
export type SendMode = "webhook" | "evolution" | "wame" | "none";

export interface SendResult {
  mode: SendMode;
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Envia mensagem de texto pelo melhor caminho disponível.
 *
 * @param phone     telefone (com ou sem DDI)
 * @param message   texto
 * @param opts.companyId   necessário pra resolver instância
 * @param opts.instanceId  força essa instância (ignora default)
 * @param opts.userId      quem está enviando (vai no histórico)
 * @param opts.noFallback  se true, não cai pro wa.me
 * @param opts.quotedMessageId  ID da mensagem que está sendo citada (reply)
 */
export async function sendWhatsApp(
  phone: string,
  message: string,
  opts: {
    companyId?: string | null;
    instanceId?: string;
    userId?: string | null;
    noFallback?: boolean;
    quotedMessageId?: string;
  } = {}
): Promise<SendResult> {
  const normalized = pickWhatsapp({ phone });
  if (!normalized) return { mode: "none", ok: false, error: "Telefone inválido" };

  // Sem company → só wa.me consegue
  if (!opts.companyId) {
    return { mode: "wame", ok: openWhatsApp(normalized, message) };
  }

  // 1) Resolve a instância (precisa pra webhook E pra evolution direto)
  const inst = await resolveInstance({
    companyId: opts.companyId,
    instanceId: opts.instanceId,
  });

  // 2) Webhook n8n é prioridade — manda mesmo se status local não estiver "connected"
  //    porque o workflow tem sua própria lógica de fallback de instância
  if (isWebhookConfigured() && inst) {
    const r = await postWebhook({
      company_id: opts.companyId,
      instance_id: inst.instance_name,
      instance_name: inst.instance_name,
      number: normalized,
      type: "text",
      text: message,
      user_id: opts.userId || null,
      quoted: opts.quotedMessageId ? { key: { id: opts.quotedMessageId } } : null,
    });
    if (r.ok) return { mode: "webhook", ok: true };
    if (opts.noFallback) return { mode: "webhook", ok: false, error: r.error };
    // se webhook falhou, tenta Evolution direto, depois wa.me
  }

  // 3) Evolution direto (sem n8n) — só se status connected
  if (isEvolutionConfigured() && inst && inst.status === "connected") {
    try {
      const r = await evoSendText(inst.instance_name, normalized, message);
      return { mode: "evolution", ok: true, messageId: r.id };
    } catch (e: any) {
      if (opts.noFallback) return { mode: "evolution", ok: false, error: e?.message };
    }
  }

  // 4) Fallback final
  if (opts.noFallback) {
    return { mode: "none", ok: false, error: "Nenhum canal disponível" };
  }
  return { mode: "wame", ok: openWhatsApp(normalized, message) };
}

/**
 * Envia mídia pelo webhook do n8n.
 *
 * `data` deve ser base64 sem prefixo (apenas o conteúdo após "base64,").
 * Pra converter um File:
 *
 *     const base64 = await fileToBase64(file);
 *     await sendWhatsAppMedia({ phone, type: 'image', data: base64, ... });
 */
export async function sendWhatsAppMedia(opts: {
  phone: string;
  type: "audio" | "image" | "video" | "doc";
  data: string;       // base64 (sem prefix)
  caption?: string;   // texto que acompanha a mídia
  fileName?: string;  // nome do arquivo (importante pra doc)
  mimeType?: string;
  companyId: string;
  instanceId?: string;
  userId?: string | null;
  quotedMessageId?: string;
}): Promise<SendResult> {
  const normalized = pickWhatsapp({ phone: opts.phone });
  if (!normalized) return { mode: "none", ok: false, error: "Telefone inválido" };
  if (!isWebhookConfigured()) {
    return { mode: "none", ok: false, error: "Webhook não configurado — envio de mídia indisponível" };
  }

  const inst = await resolveInstance({
    companyId: opts.companyId,
    instanceId: opts.instanceId,
  });
  if (!inst) {
    return { mode: "webhook", ok: false, error: "Nenhuma instância disponível" };
  }

  const r = await postWebhook({
    company_id: opts.companyId,
    instance_id: inst.instance_name,
    instance_name: inst.instance_name,
    number: normalized,
    type: opts.type,
    text: opts.caption || "",
    data: opts.data,
    file_name: opts.fileName,
    mime_type: opts.mimeType,
    user_id: opts.userId || null,
    quoted: opts.quotedMessageId ? { key: { id: opts.quotedMessageId } } : null,
  });

  return r.ok
    ? { mode: "webhook", ok: true }
    : { mode: "webhook", ok: false, error: r.error };
}

/* ====================================================================
   Marcar conversa como lida (zera unread badge)
==================================================================== */
export async function markConversationAsRead(opts: {
  companyId: string;
  instanceId: string | null;
  remoteJid: string;
}): Promise<void> {
  let q = supabase
    .from("wpp_conversations" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("company_id", opts.companyId)
    .eq("from_me", false)
    .is("read_at", null);

  // remote_jid pode estar com ou sem sufixo @s.whatsapp.net
  q = q.or(`remote_jid.eq.${opts.remoteJid},remote_jid.eq.${opts.remoteJid}@s.whatsapp.net`);

  if (opts.instanceId) {
    q = q.eq("instance_id", opts.instanceId);
  }
  await q;
}

/* ====================================================================
   Util: converter File em base64 (sem o prefix data:...)
==================================================================== */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf("base64,");
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Mapeia o MIME type pro `type` que o webhook espera. */
export function mimeToMediaType(mime: string): "image" | "audio" | "video" | "doc" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "doc";
}

/** Devolve o `instance_name` da padrão (ou gera o sugerido se não houver). */
export async function instanceNameForCompany(companyId: string): Promise<string> {
  const { data } = await supabase
    .from("wpp_instances" as any)
    .select("instance_name")
    .eq("company_id", companyId)
    .eq("is_default", true)
    .maybeSingle();
  return (data as any)?.instance_name || companyIdToInstanceName(companyId);
}
