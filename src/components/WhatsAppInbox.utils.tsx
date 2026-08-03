/* Auto-split from WhatsAppInbox.tsx (step 1) */

import type { Message } from "./WhatsAppInbox.types";
import { __INBOX_TYPES } from "./WhatsAppInbox.types";
void __INBOX_TYPES;

export function getFonteVisual(
  currentMessages: any[],
  leadMeta: any
) {
  // 1) A fonte mais confiável é a instância da última mensagem da conversa
  const lastMsg = currentMessages[currentMessages.length - 1];
  if (lastMsg?.instance_id) return lastMsg.instance_id;

  // 2) Se o lead tiver uma instância fixa (ex.: criado na página Leads), use ela
  if (leadMeta?.send_instance_key) return leadMeta.send_instance_key;

  // 3) Fallback (caso exista alguma coluna antiga)
  if (leadMeta?.instance_id) return leadMeta.instance_id;

  return null;
}

export function formatFonte(v?: string | null) {
  if (!v) return "—";
  return v.includes(":") ? v.split(":")[1] : v;
}

export function getInstanceStatusColor(status?: string | null) {
  switch (status) {
    case "CONNECTED":
      return "bg-green-500";
    case "DISCONNECTED":
      return "bg-red-500";
    case "CONNECTING":
      return "bg-yellow-500";
    default:
      return "bg-gray-400";
  }
}

export function formatListDate(dateString?: string) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  
  const isToday = date.getDate() === now.getDate() &&
                  date.getMonth() === now.getMonth() &&
                  date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString("pt-BR", { day: '2-digit', month: '2-digit' });
}

export function getMessageDedupKey(m: any) {
  const mid =
    m?.message_id ||
    m?.raw_payload?.key?.id ||
    (typeof m?.raw_payload?.key?.id === "string" ? m.raw_payload.key.id : undefined);

  // 🔥 CORREÇÃO: Agora a chave junta Empresa + Instância + ID da Mensagem
  if (mid) {
    return `mid:${String(m?.company_id || "")}:${String(m?.instance_id || "")}:${mid}`;
  }

  // O fallback para mensagens locais / sem ID continua perfeito
  const text = String(m?.message || "");
  const t = m?.created_at ? new Date(m.created_at).getTime() : 0;
  const bucket = Math.floor(t / 5000); 

  return `fb:${String(m?.remote_jid || "")}:${String(m?.instance_id || "")}:${
    m?.from_me ? "1" : "0"
  }:${bucket}:${text.slice(0, 50)}`;
}

export function mergePreferNonNull<T extends Record<string, any>>(oldRow: T, newRow: T): T {
  const merged: any = { ...oldRow, ...newRow };

  // Mantém valores antigos quando o "new" vier nulo/undefined/vazio (muito comum em upserts parciais)
  const keysToKeepNonNull = [
    "message",
    "message_type",
    "media_url",
    "raw_payload",
    "read_at",
    "wa_sent_at",
    "wa_delivered_at",
    "wa_read_at",
    "ack",
    "transcription",
    "transcription_status",
    "from_me",
    "remote_jid",
    "instance_id",
    "company_id",
    "message_id",
  ];

  for (const k of keysToKeepNonNull) {
    const nv = (newRow as any)[k];
    const ov = (oldRow as any)[k];
    if (nv === null || nv === undefined || nv === "") merged[k] = ov;
  }

  // ✅ raw_payload: merge preservando chaves antigas (ex.: sent_by_name) quando o novo vier incompleto
  try {
    const orp = (oldRow as any).raw_payload;
    const nrp = (newRow as any).raw_payload;

    if (orp && typeof orp === "object" && nrp && typeof nrp === "object") {
      merged.raw_payload = { ...orp, ...nrp };
    } else if ((!nrp || typeof nrp !== "object") && orp) {
      merged.raw_payload = orp;
    }
  } catch {
    // ignore
  }

  return merged as T;
}

export function dedupMessages(list: Message[]): Message[] {
  const idxByKey = new Map<string, number>();
  const out: Message[] = [];

  for (const m of list) {
    const key = getMessageDedupKey(m);
    const idx = idxByKey.get(key);

    if (idx === undefined) {
      idxByKey.set(key, out.length);
      out.push(m);
    } else {
      out[idx] = mergePreferNonNull(out[idx] as any, m as any);
    }
  }

  return out;
}
