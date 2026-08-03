/* Auto-split from WhatsAppInbox.tsx (step 1) */

// Runtime marker to force module mode in SWC when other files use type-only imports.
export const __INBOX_TYPES = 1;

export type UUID = string;

export interface Message {
  id: string;
  remote_jid: string;
  instance_id: string;
  message_id?: string | null;
  company_id?: string | null;
  from_me: boolean;
  message: string | null;
  message_type: string;
  created_at: string;
  media_url?: string | null;
  raw_payload?: any;

  // ✅ flags locais (UI otimista)
  _local_status?: "pending" | "failed" | null;
  _local_client_id?: string | null;
  _local_preview_url?: string | null;

  // 👁️ leitura interna (CRM)
  read_at?: string | null;

  // ✅ status WhatsApp (vindos do n8n)
  wa_sent_at?: string | null;
  wa_delivered_at?: string | null;
  wa_read_at?: string | null;

  // (se você ainda quiser manter ack antigo, deixe, senão pode remover)
  ack?: number;
    // ✅ TRANSCRIÇÃO (NOVO)
  transcription?: string | null;
  transcription_status?: "idle" | "pending" | "done" | "error";
}

export interface Lead {
  id: UUID;
  remote_jid: string;
  lead_code: string;
  current_funnel_id: UUID | null;
  current_stage_id: UUID | null;
  // chave da instância (Evolution) fixada no lead (especialmente quando criado na página Leads)
  send_instance_key?: string | null;
}

export interface Funnel {
  id: UUID;
  name: string;
  active: boolean | null;
}

export interface FunnelStage {
  id: UUID;
  funnel_id: UUID;
  name: string;
  stage_order: number;
  color: string | null;
  stage_type: string | null; // manual | automatic | human
}

export interface Tag {
  id: UUID;
  name: string;
  color: string | null;
}

export interface Instancia {
  id?: string;
  default_funnel_id?: UUID | null;
  instance_name: string | null;
  instance_key: string | null;
  token_id: string | null;
  phone_number: number | null;
  status: string | null;
  company_id: string | null;
  user_id: string | null;
}

