import { supabase } from "@/integrations/supabase/client";
import { getProxyUrl } from "./ycloudCompany";

export type YCloudMessageType = "text" | "image" | "video" | "audio" | "document";

export interface SendYCloudMessageParams {
  /**
   * Número da empresa que envia (com DDI, sem +).
   * Pode ser passado como `from` direto ou inferido pelo `phone_number_id`.
   */
  from?: string;
  phone_number_id?: string;
  /** Número do cliente que recebe (com DDI, sem +). */
  to: string;
  type: YCloudMessageType;
  /** Texto da mensagem (pra `type='text'`) ou caption (pra mídia). */
  text?: string;
  caption?: string;
  /** URL pública da mídia (pra image/video/audio/document). */
  media_url?: string;
  /** Nome do arquivo (pra `type='document'`). */
  filename?: string;
  /** ID local da mensagem no frontend, usado pra dedup quando o realtime entregar. */
  client_id: string;
}

export interface SendYCloudMessageResult {
  ok: boolean;
  wamid?: string;
  sent_at?: string;
  error?: string;
  message?: string;
  warning?: string;
}

/**
 * Faz upload de um File pro bucket público `whatsapp-media` no Supabase Storage
 * (mesmo bucket usado pela integração Evolution) e retorna a URL pública.
 * YCloud (Meta) precisa de URL pública pra baixar a mídia e enviar.
 */
export async function uploadMediaToStorage(
  file: File,
  companyId: string,
  prefix: string = "media"
): Promise<string> {
  if (!companyId) throw new Error("companyId obrigatório");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 8);
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  const path = `${companyId}/${prefix}/${Date.now()}-${random}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("whatsapp-media")
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
      cacheControl: "31536000",
    });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Falha ao obter URL pública");
  return data.publicUrl;
}

/**
 * Envia uma mensagem WhatsApp via YCloud (atravessa o proxy n8n).
 *
 * Fluxo:
 *  1. CRM já criou uma mensagem 'pending' otimista (com `client_id`)
 *  2. Esta função chama o proxy n8n
 *  3. n8n chama YCloud → recebe wamid → INSERT em wpp_conversations
 *  4. Realtime entrega o INSERT pro CRM, que dedup pelo `client_id`
 *     e substitui a 'pending' pela mensagem real
 */
export async function sendYCloudMessage(params: SendYCloudMessageParams): Promise<SendYCloudMessageResult> {
  if (!params.to) return { ok: false, error: "missing_to" };
  if (!params.client_id) return { ok: false, error: "missing_client_id" };

  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) {
    return { ok: false, error: "proxy_url_not_configured", message: "Webhook do n8n (proxy) não configurado." };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { ok: false, error: "no_session", message: "Sessão expirada." };

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: "send_message",
        from: params.from,
        phone_number_id: params.phone_number_id,
        to: params.to,
        type: params.type,
        text: params.text,
        caption: params.caption,
        media_url: params.media_url,
        filename: params.filename,
        client_id: params.client_id,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body?.error || `http_${res.status}`,
        message: body?.message || `Proxy retornou HTTP ${res.status}`,
      };
    }
    return body as SendYCloudMessageResult;
  } catch (e: any) {
    return { ok: false, error: "network", message: e?.message || "Falha ao chamar o proxy n8n." };
  }
}

// ─────────────────────── TEMPLATES ───────────────────────

export interface TemplateSendComponent {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url"; // só pra type='button'
  index?: number; // só pra type='button'
  parameters: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: { link: string } }
    | { type: "video"; video: { link: string } }
    | { type: "document"; document: { link: string; filename?: string } }
    | { type: "payload"; payload: string }
  >;
}

export interface SendYCloudTemplateParams {
  from?: string;
  phone_number_id?: string;
  to: string;
  template_name: string;
  language: string; // ex: "pt_BR"
  components: TemplateSendComponent[];
  /** Texto do body já com variáveis substituídas, pra UI mostrar bonito. */
  rendered_body?: string;
  client_id: string;
}

export async function sendYCloudTemplate(
  params: SendYCloudTemplateParams
): Promise<SendYCloudMessageResult> {
  if (!params.to) return { ok: false, error: "missing_to" };
  if (!params.template_name) return { ok: false, error: "missing_template_name" };
  if (!params.client_id) return { ok: false, error: "missing_client_id" };

  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) return { ok: false, error: "proxy_url_not_configured" };

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { ok: false, error: "no_session" };

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: "send_template",
        from: params.from,
        phone_number_id: params.phone_number_id,
        to: params.to,
        template_name: params.template_name,
        language: params.language,
        components: params.components,
        rendered_body: params.rendered_body,
        client_id: params.client_id,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body?.error || `http_${res.status}`,
        message: body?.message || `Proxy retornou HTTP ${res.status}`,
      };
    }
    return body as SendYCloudMessageResult;
  } catch (e: any) {
    return { ok: false, error: "network", message: e?.message };
  }
}
