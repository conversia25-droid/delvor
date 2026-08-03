/**
 * Tipos do inbox de WhatsApp do Delvor.
 */

export interface ChatMessage {
  id: number | string;
  company_id: string | null;
  instance_id: string | null;
  remote_jid: string;
  message_id: string | null;
  message_type: string | null;
  message: string | null;
  media_url: string | null;
  from_me: boolean;
  status: string | null;
  created_at: string;
  read_at?: string | null;
  context_quoted_message_id?: string | null;
  raw_payload?: any;
}

export interface ChatConversation {
  /** Identidade composta: `${instance_id}::${remote_jid}` */
  key: string;
  remote_jid: string;
  instance_id: string | null;
  /** Apelido da instância (se conhecido) */
  instance_label: string | null;
  /** Nome — vem do `customers.name` (match por whatsapp) ou `leads.lead_name` */
  display_name: string | null;
  /** Match opcional pra um customer cadastrado */
  customer_id: string | null;
  /** Última mensagem (pra preview) */
  last_message: string | null;
  last_message_type: string | null;
  last_message_at: string;
  last_from_me: boolean;
  /** Quantas mensagens não lidas (vindo do cliente, ainda sem read_at) */
  unread_count: number;
}
