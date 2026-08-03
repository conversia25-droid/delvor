import { supabase } from "@/integrations/supabase/client";

/**
 * Entrada do "último preview" por conversa, usada na lista de leads
 * pra mostrar a última mensagem mesmo de leads cuja mensagem não está
 * carregada em memória (ex: muito antiga).
 *
 * Vem da RPC public.get_last_message_per_jid(p_company_id).
 */
export interface LastMsgEntry {
  remote_jid: string;
  message: string | null;
  message_type: string | null;
  from_me: boolean;
  created_at: string;
}

/**
 * Busca a ÚLTIMA mensagem de cada conversa da empresa em uma só query.
 * Retorna um Record indexado pelo remote_jid pra lookup O(1).
 *
 * A query usa DISTINCT ON com índice composto (company_id, remote_jid, created_at desc),
 * então o custo escala com o número de CONVERSAS da empresa, não com o total
 * de mensagens. Pra uma empresa com 5k conversas, ~150ms.
 */
export async function fetchLastMessagePerJid(
  companyId: string
): Promise<Record<string, LastMsgEntry>> {
  if (!companyId) return {};

  const { data, error } = await supabase.rpc("get_last_message_per_jid" as any, {
    p_company_id: companyId,
  });

  if (error) {
    console.warn("fetchLastMessagePerJid error:", error);
    return {};
  }

  const map: Record<string, LastMsgEntry> = {};
  for (const r of (data as any[]) || []) {
    if (!r?.remote_jid) continue;
    map[r.remote_jid] = {
      remote_jid: r.remote_jid,
      message: r.message ?? null,
      message_type: r.message_type ?? null,
      from_me: !!r.from_me,
      created_at: r.created_at,
    };
  }
  return map;
}
