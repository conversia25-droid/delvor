import { supabase } from "@/integrations/supabase/client";

/** Chama a Edge Function asaas-proxy */
async function asaasCall(method: string, path: string, body?: object) {
  const { data, error } = await supabase.functions.invoke("asaas-proxy", {
    body: { method, path, body },
  });

  if (error) {
    // A mensagem real vem no corpo da resposta da função — o error.message
    // só traz o genérico "non-2xx status code". Extrai o motivo de verdade.
    let msg = error.message || "Erro na comunicação com Asaas";
    try {
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx.json === "function") {
        const parsed = await ctx.json();
        if (parsed?.error) msg = parsed.error;
      }
    } catch {
      /* mantém a mensagem genérica */
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/* ─────────────── CUSTOMERS ─────────────── */

export interface AsaasCustomerInput {
  name: string;
  email?: string;
  cpfCnpj?: string;
  phone?: string;
  mobilePhone?: string;
  externalReference?: string;
}

export async function createAsaasCustomer(input: AsaasCustomerInput) {
  return asaasCall("POST", "/customers", input);
}

export async function getAsaasCustomer(customerId: string) {
  return asaasCall("GET", `/customers/${customerId}`);
}

export async function listAsaasCustomers(query?: string) {
  const qs = query ? `?name=${encodeURIComponent(query)}` : "";
  return asaasCall("GET", `/customers${qs}`);
}

/* ─────────────── PAYMENTS ─────────────── */

export type AsaasBillingType = "BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED";

export interface AsaasChargeInput {
  customer: string;       // Asaas customer ID
  billingType: AsaasBillingType;
  value: number;
  dueDate: string;        // YYYY-MM-DD
  description?: string;
  externalReference?: string;
  installmentCount?: number;
  installmentValue?: number;
  discount?: { value: number; dueDateLimitDays: number; type: "FIXED" | "PERCENTAGE" };
  interest?: { value: number };
  fine?: { value: number };
}

export async function createAsaasCharge(input: AsaasChargeInput) {
  return asaasCall("POST", "/payments", input);
}

export async function getAsaasCharge(paymentId: string) {
  return asaasCall("GET", `/payments/${paymentId}`);
}

export async function listAsaasCharges(customerId: string) {
  return asaasCall("GET", `/payments?customer=${customerId}&limit=50`);
}

export async function cancelAsaasCharge(paymentId: string) {
  return asaasCall("DELETE", `/payments/${paymentId}`);
}

export async function getAsaasPixQrCode(paymentId: string) {
  return asaasCall("GET", `/payments/${paymentId}/pixQrCode`);
}

/* ─────────────── SETTINGS ─────────────── */

export async function getAsaasSettings(): Promise<{ apiKey: string | null; env: string }> {
  const { data, error } = await supabase
    .from("master_settings" as any)
    .select("key,value")
    .in("key", ["asaas_api_key", "asaas_env"]);

  if (error) return { apiKey: null, env: "sandbox" };

  const rows = (data || []) as Array<{ key: string; value: string }>;
  const apiKey = rows.find((r) => r.key === "asaas_api_key")?.value || null;
  const env = rows.find((r) => r.key === "asaas_env")?.value || "sandbox";
  return { apiKey, env };
}

export async function saveAsaasSetting(key: string, value: string) {
  const { error } = await supabase
    .from("master_settings" as any)
    .upsert({ key, value, updated_at: new Date().toISOString() } as any, { onConflict: "key" });
  if (error) throw error;
}

export async function testAsaasConnection() {
  return asaasCall("GET", "/customers?limit=1");
}
