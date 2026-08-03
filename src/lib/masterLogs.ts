import { supabase } from "@/integrations/supabase/client";

type MasterLogLevel = "info" | "warning" | "error" | "critical";
type MasterLogCategory = "audit" | "system" | "billing" | "support" | "auth" | "integration" | "admin";

export type MasterLogInput = {
  level: MasterLogLevel;
  category: MasterLogCategory;
  source: string;
  eventType: string;
  message: string;
  companyId?: string | null;
  userId?: string | null;
  adminUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
};

export async function addMasterLog(input: MasterLogInput) {
  const { error } = await supabase.rpc("add_master_log", {
    p_level: input.level,
    p_category: input.category,
    p_source: input.source,
    p_event_type: input.eventType,
    p_message: input.message,
    p_company_id: input.companyId ?? null,
    p_user_id: input.userId ?? null,
    p_admin_user_id: input.adminUserId ?? null,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_status: input.status ?? null,
    p_metadata: input.metadata ?? {},
    p_ip_address: input.ipAddress ?? null,
    p_user_agent: input.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : null),
    p_request_id: input.requestId ?? null,
    p_session_id: input.sessionId ?? null,
  });

  if (error) {
    console.error("Erro ao gravar master log:", error.message);
  }
}

export async function logMasterAuthEvent(params: {
  eventType: "admin_login" | "admin_login_failed" | "admin_access_denied" | "admin_logout";
  message: string;
  adminUserId?: string | null;
  status: "success" | "failed";
  metadata?: Record<string, unknown>;
}) {
  return addMasterLog({
    level: params.status === "failed" ? "warning" : "info",
    category: "auth",
    source: "master",
    eventType: params.eventType,
    message: params.message,
    adminUserId: params.adminUserId ?? null,
    status: params.status,
    metadata: params.metadata,
  });
}
