import { supabase } from "@/integrations/supabase/client";

export type YCloudEnv = "sandbox" | "production";

export interface YCloudSettings {
  apiKey: string;
  n8nWebhookUrl: string;
  n8nProxyUrl: string;
  sharedSecret: string;
  env: YCloudEnv;
  updatedAt: string | null;
}

const DEFAULTS: YCloudSettings = {
  apiKey: "",
  n8nWebhookUrl: "",
  n8nProxyUrl: "",
  sharedSecret: "",
  env: "production",
  updatedAt: null,
};

export async function getYCloudSettings(): Promise<YCloudSettings> {
  const { data, error } = await supabase
    .from("ycloud_settings" as any)
    .select("api_key,n8n_webhook_url,n8n_proxy_url,shared_secret,env,updated_at")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) return { ...DEFAULTS };

  const row = data as any;
  return {
    apiKey: row.api_key || "",
    n8nWebhookUrl: row.n8n_webhook_url || "",
    n8nProxyUrl: row.n8n_proxy_url || "",
    sharedSecret: row.shared_secret || "",
    env: (row.env as YCloudEnv) || "production",
    updatedAt: row.updated_at || null,
  };
}

export async function saveYCloudSettings(input: Partial<YCloudSettings>): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.apiKey !== undefined) payload.api_key = input.apiKey;
  if (input.n8nWebhookUrl !== undefined) payload.n8n_webhook_url = input.n8nWebhookUrl;
  if (input.n8nProxyUrl !== undefined) payload.n8n_proxy_url = input.n8nProxyUrl;
  if (input.sharedSecret !== undefined) payload.shared_secret = input.sharedSecret;
  if (input.env !== undefined) payload.env = input.env;

  const { error } = await supabase
    .from("ycloud_settings" as any)
    .update(payload as any)
    .eq("id", true);

  if (error) throw error;
}

/**
 * Dispara um ping no webhook n8n configurado.
 * Espera que o fluxo n8n responda 200 com { ok: true } quando autenticado.
 */
export async function testYCloudConnection(): Promise<{ ok: boolean; message: string }> {
  const s = await getYCloudSettings();
  if (!s.n8nWebhookUrl) return { ok: false, message: "Webhook n8n não configurado." };
  if (!s.sharedSecret) return { ok: false, message: "Shared secret não configurado." };

  try {
    const res = await fetch(s.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.sharedSecret}`,
      },
      body: JSON.stringify({ action: "ping", env: s.env }),
    });

    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status} — ${res.statusText}` };
    }

    const body = await res.json().catch(() => ({}));
    if (body?.ok) return { ok: true, message: "Conectado com sucesso." };
    return { ok: true, message: "Webhook respondeu (sem payload esperado, verifique o fluxo n8n)." };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Falha ao chamar o webhook n8n." };
  }
}
