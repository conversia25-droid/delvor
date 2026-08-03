import { supabase } from "@/integrations/supabase/client";
import { getProxyUrl } from "./ycloudCompany";

export type TemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

/**
 * Componente de template (header / body / footer / buttons).
 * O shape segue o esperado pela API do WhatsApp Cloud / Meta.
 */
export type TemplateComponent =
  | {
      type: "HEADER";
      format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
      text?: string;
      example?: { header_text?: string[]; header_handle?: string[] };
    }
  | {
      type: "BODY";
      text: string;
      example?: { body_text?: string[][] };
    }
  | {
      type: "FOOTER";
      text: string;
    }
  | {
      type: "BUTTONS";
      buttons: TemplateButton[];
    };

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string[] }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export interface YCloudTemplate {
  id: string;
  company_id: string;
  ycloud_template_id: string | null;
  waba_id: string | null;
  name: string;
  category: TemplateCategory;
  language: string;
  components: TemplateComponent[];
  status: TemplateStatus;
  rejection_reason: string | null;
  quality_score: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────── Supabase (cache local) ───────────────────

export async function listLocalTemplates(companyId: string): Promise<YCloudTemplate[]> {
  const { data, error } = await supabase
    .from("ycloud_templates" as any)
    .select("*")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("listLocalTemplates error:", error);
    return [];
  }
  return (data || []) as any as YCloudTemplate[];
}

export async function saveLocalTemplate(
  companyId: string,
  payload: Partial<YCloudTemplate> & { name: string; category: TemplateCategory; language: string; components: TemplateComponent[] },
  userId?: string
): Promise<YCloudTemplate | null> {
  const insertPayload = {
    company_id: companyId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    components: payload.components,
    status: payload.status || "DRAFT",
    waba_id: payload.waba_id || null,
    ycloud_template_id: payload.ycloud_template_id || null,
    submitted_at: payload.submitted_at || null,
    rejection_reason: payload.rejection_reason || null,
    created_by: userId || null,
  };
  const { data, error } = await supabase
    .from("ycloud_templates" as any)
    .upsert(insertPayload as any, { onConflict: "company_id,name,language" })
    .select()
    .single();
  if (error) {
    console.error("saveLocalTemplate error:", error);
    throw error;
  }
  return (data as any) as YCloudTemplate;
}

export async function deleteLocalTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("ycloud_templates" as any).delete().eq("id", id);
  if (error) throw error;
}

// ─────────────────── n8n Proxy (YCloud) ───────────────────

async function callProxy(payload: any): Promise<any> {
  const proxyUrl = await getProxyUrl();
  if (!proxyUrl) return { ok: false, error: "proxy_url_not_configured" };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { ok: false, error: "no_session" };

  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error || `http_${res.status}`, message: body?.message };
    }
    return body;
  } catch (e: any) {
    return { ok: false, error: "network", message: e?.message };
  }
}

/**
 * Lista templates direto do YCloud (não do cache local).
 * Útil pra sincronizar status pendentes/aprovados.
 */
export async function listYCloudTemplates(wabaId: string): Promise<{
  ok: boolean;
  templates?: any[];
  error?: string;
  message?: string;
}> {
  return callProxy({ action: "list_templates", waba_id: wabaId });
}

/**
 * Cria um template no YCloud (que encaminha pro Meta pra aprovação).
 */
export async function createYCloudTemplate(
  wabaId: string,
  template: {
    name: string;
    category: TemplateCategory;
    language: string;
    components: TemplateComponent[];
  }
): Promise<{ ok: boolean; template?: any; error?: string; message?: string }> {
  return callProxy({ action: "create_template", waba_id: wabaId, template });
}

/**
 * Apaga um template no YCloud (e portanto na Meta).
 */
export async function deleteYCloudTemplate(
  wabaId: string,
  name: string
): Promise<{ ok: boolean; error?: string; message?: string }> {
  return callProxy({ action: "delete_template", waba_id: wabaId, name });
}

/**
 * Sincroniza templates do YCloud → Supabase local.
 * Atualiza status, rejection_reason, quality_score etc.
 */
export async function syncTemplatesFromYCloud(companyId: string, wabaId: string): Promise<{
  synced: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const r = await listYCloudTemplates(wabaId);
  if (!r.ok || !r.templates) {
    errors.push(r.message || r.error || "Falha ao buscar templates do YCloud");
    return { synced: 0, errors };
  }

  let synced = 0;
  for (const tpl of r.templates) {
    try {
      const status = (tpl.status || "PENDING").toUpperCase();
      const safeStatus: TemplateStatus = ["DRAFT","PENDING","APPROVED","REJECTED","PAUSED","DISABLED"].includes(status)
        ? (status as TemplateStatus)
        : "PENDING";

      const payload = {
        company_id: companyId,
        name: tpl.name,
        category: (tpl.category || "MARKETING") as TemplateCategory,
        language: tpl.language || "pt_BR",
        components: tpl.components || [],
        status: safeStatus,
        waba_id: wabaId,
        ycloud_template_id: tpl.id || tpl.templateId || null,
        rejection_reason: tpl.rejectedReason || tpl.rejection_reason || null,
        last_synced_at: new Date().toISOString(),
        approved_at: safeStatus === "APPROVED" && !tpl.approved_at ? new Date().toISOString() : (tpl.approved_at || null),
      };
      const { error } = await supabase
        .from("ycloud_templates" as any)
        .upsert(payload as any, { onConflict: "company_id,name,language" });
      if (error) {
        errors.push(`${tpl.name}: ${error.message}`);
      } else {
        synced++;
      }
    } catch (e: any) {
      errors.push(`${tpl.name}: ${e?.message}`);
    }
  }
  return { synced, errors };
}
