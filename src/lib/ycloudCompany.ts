import { supabase } from "@/integrations/supabase/client";

export interface CompanyYCloudCredentials {
  companyId: string;
  apiKey: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  updatedAt: string;
}

export interface YCloudPhoneFromApi {
  phone_number_id: string;
  waba_id: string | null;
  display_phone: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  status: string | null;
}

export interface ProxyListResponse {
  ok: boolean;
  count?: number;
  phones?: YCloudPhoneFromApi[];
  error?: string;
  message?: string;
  details?: any;
}

export interface CoexistenceQrResponse {
  ok: boolean;
  qr_code?: string | null;       // base64 ou string raw
  qr_image_url?: string | null;  // URL pública pro QR
  expires_at?: string | null;
  raw?: any;
  error?: string;
  message?: string;
}

export interface PhoneStatusResponse {
  ok: boolean;
  linked?: boolean;
  raw?: any;
  error?: string;
  message?: string;
}

export async function getCompanyCredentials(companyId: string): Promise<CompanyYCloudCredentials | null> {
  const { data, error } = await supabase
    .from("company_ycloud_credentials" as any)
    .select("company_id,api_key,last_test_at,last_test_ok,last_test_error,updated_at")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as any;
  return {
    companyId: row.company_id,
    apiKey: row.api_key || "",
    lastTestAt: row.last_test_at || null,
    lastTestOk: row.last_test_ok,
    lastTestError: row.last_test_error || null,
    updatedAt: row.updated_at,
  };
}

export async function saveCompanyCredentials(
  companyId: string,
  apiKey: string,
  testResult?: { ok: boolean; error?: string }
): Promise<void> {
  const payload: Record<string, unknown> = {
    company_id: companyId,
    api_key: apiKey,
  };
  if (testResult) {
    payload.last_test_at = new Date().toISOString();
    payload.last_test_ok = testResult.ok;
    payload.last_test_error = testResult.ok ? null : testResult.error || null;
  }

  const { error } = await supabase
    .from("company_ycloud_credentials" as any)
    .upsert(payload as any, { onConflict: "company_id" });

  if (error) throw error;
}

export async function deleteCompanyCredentials(companyId: string): Promise<void> {
  const { error } = await supabase
    .from("company_ycloud_credentials" as any)
    .delete()
    .eq("company_id", companyId);
  if (error) throw error;
}

export async function getProxyUrl(): Promise<string> {
  const { data, error } = await supabase.rpc("get_ycloud_proxy_url" as any);
  if (error) throw new Error(error.message);
  return (data as string) || "";
}

/**
 * Chama o proxy n8n.
 * Se `apiKey` for passada (modo teste antes de salvar), ela e enviada no body.
 * Caso contrario, o n8n pega a key salva em company_ycloud_credentials.
 */
export async function listPhoneNumbers(apiKey?: string): Promise<ProxyListResponse> {
  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) {
    return { ok: false, error: "proxy_url_not_configured", message: "Peça ao administrador master configurar o webhook de proxy do n8n." };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "no_session", message: "Sessão expirada, faça login novamente." };
  }

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: "list_phones",
        ...(apiKey ? { api_key: apiKey } : {}),
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body?.error || `http_${res.status}`,
        message: body?.message || `Proxy retornou HTTP ${res.status}`,
        details: body,
      };
    }
    return body as ProxyListResponse;
  } catch (e: any) {
    return { ok: false, error: "network", message: e?.message || "Falha ao chamar proxy n8n." };
  }
}

/**
 * Pede ao YCloud um QR Code de Coexistence Mode pro numero.
 * O cliente escaneia o QR no app WhatsApp Business → numero pareia
 * com a API mantendo o uso normal no celular.
 */
export async function requestCoexistenceQr(phoneNumberId: string): Promise<CoexistenceQrResponse> {
  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) return { ok: false, error: "proxy_url_not_configured", message: "Peça ao administrador master configurar o webhook de proxy do n8n." };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { ok: false, error: "no_session", message: "Sessão expirada, faça login novamente." };

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: "coexistence_qr", phone_number_id: phoneNumberId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error || `http_${res.status}`, message: body?.message || `Proxy retornou HTTP ${res.status}` };
    }
    return body as CoexistenceQrResponse;
  } catch (e: any) {
    return { ok: false, error: "network", message: e?.message || "Falha ao chamar proxy n8n." };
  }
}

/**
 * Consulta status atual de um numero no YCloud (pra polling depois do QR).
 * Quando o cliente escanear, isso passa a retornar { linked: true } e o n8n
 * já atualiza o coexistence_status no Supabase.
 */
export async function getPhoneStatus(phoneNumberId: string): Promise<PhoneStatusResponse> {
  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) return { ok: false, error: "proxy_url_not_configured" };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { ok: false, error: "no_session" };

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: "phone_status", phone_number_id: phoneNumberId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error || `http_${res.status}`, message: body?.message };
    }
    return body as PhoneStatusResponse;
  } catch (e: any) {
    return { ok: false, error: "network", message: e?.message };
  }
}

// ─────────────────── Uso / Billing ───────────────────

export interface YCloudUsage {
  msgs_received: number;
  msgs_sent: number;
  templates_sent: number;
  unique_contacts: number;
  service_conversations: number;
  service_quota_free: number;
  service_quota_used_pct: number;
  period_from: string;
  period_to: string;
}

/**
 * Conta uso da YCloud por empresa num período.
 * Por default pega o mês corrente.
 */
export async function getYCloudUsage(
  companyId: string,
  from?: Date,
  to?: Date
): Promise<YCloudUsage | null> {
  if (!companyId) return null;
  const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate = to || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);

  const { data, error } = await supabase.rpc("get_ycloud_usage" as any, {
    p_company_id: companyId,
    p_from: fromDate.toISOString(),
    p_to: toDate.toISOString(),
  });

  if (error) {
    console.warn("getYCloudUsage error:", error);
    return null;
  }
  return data as YCloudUsage;
}

/**
 * Insere/atualiza numeros WhatsApp oficiais da empresa a partir da lista do YCloud.
 * Faz upsert por (company_id, phone_number_id).
 */
export async function importPhoneNumbers(
  companyId: string,
  phones: YCloudPhoneFromApi[]
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  for (const p of phones) {
    if (!p.phone_number_id) {
      errors.push("phone sem phone_number_id ignorado");
      continue;
    }
    const payload = {
      company_id: companyId,
      phone_number_id: p.phone_number_id,
      waba_id: p.waba_id || null,
      display_phone: p.display_phone || null,
      verified_name: p.verified_name || null,
      quality_rating: p.quality_rating || null,
      active: true,
    };
    const { error } = await supabase
      .from("ycloud_phone_numbers" as any)
      .upsert(payload as any, { onConflict: "phone_number_id" });
    if (error) {
      errors.push(`${p.phone_number_id}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return { inserted, errors };
}
