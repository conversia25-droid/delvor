/**
 * Helpers pra garantir que um lead existe no inbox antes de abrir
 * a conversa — usado quando o user clica em "WhatsApp" numa OS,
 * detalhe de cliente, venda etc.
 *
 * A ideia: o cliente pode nunca ter mandado mensagem pelo WhatsApp,
 * mas a empresa quer começar a conversa pelo sistema. Pra isso:
 *  1. Verifica se existe lead pelo número do cliente
 *  2. Se NÃO existir, cria com o nome real do cliente
 *  3. Retorna o `remote_jid` pra usar na URL `/chat?jid=...`
 */

import { supabase } from "@/integrations/supabase/client";
import { pickWhatsapp } from "./whatsapp";

export interface EnsureLeadOpts {
  companyId: string;
  /** ID do customer (preferido — pega nome/phone/whatsapp/remote_jid direto da ficha) */
  customerId?: string;
  /** Alternativa: passar nome e número direto */
  name?: string;
  whatsapp?: string | null;
  phone?: string | null;
  remoteJid?: string | null;
}

export interface EnsureLeadResult {
  ok: boolean;
  /** JID resolvido (E.164 limpo, sem sufixo @s.whatsapp.net) — usa direto no `/chat?jid=` */
  jid?: string;
  /** ID do lead (se já era conhecido ou foi criado) */
  leadId?: string;
  reason?: string;
}

/**
 * Garante a existência do lead correspondente ao cliente e devolve o JID
 * normalizado pra navegação.
 *
 * - Não falha se o lead já existir (atualiza o nome se estava vazio)
 * - Não falha se a empresa não tiver coluna X — degrada gracefully
 */
export async function ensureLeadFromCustomer(
  opts: EnsureLeadOpts
): Promise<EnsureLeadResult> {
  if (!opts.companyId) return { ok: false, reason: "missing_company_id" };

  // 1. Resolve dados do cliente
  let name = opts.name?.trim() || "";
  let whatsapp: string | null = opts.whatsapp ?? null;
  let phone: string | null = opts.phone ?? null;
  let remoteJid: string | null = opts.remoteJid ?? null;

  if (opts.customerId) {
    const { data } = await supabase
      .from("customers")
      .select("name, whatsapp, phone, remote_jid")
      .eq("id", opts.customerId)
      .maybeSingle();
    if (data) {
      const c: any = data;
      if (!name) name = (c.name || "").trim();
      whatsapp = whatsapp ?? c.whatsapp;
      phone = phone ?? c.phone;
      remoteJid = remoteJid ?? c.remote_jid;
    }
  }

  // 2. Normaliza o número
  const jid = pickWhatsapp({ whatsapp, phone, remote_jid: remoteJid });
  if (!jid) return { ok: false, reason: "no_phone" };

  // 3. Busca lead pelo número — tenta as duas formas (com e sem sufixo @s.whatsapp.net).
  //    O webhook do WhatsApp salva com sufixo; o cadastro manual via customer salva sem.
  //    Sem essa checagem cruzada, criávamos um lead duplicado quando o cliente já tinha
  //    conversa pelo Inbox.
  const { data: existing } = await supabase
    .from("leads")
    .select("id, lead_name")
    .eq("company_id", opts.companyId)
    .in("remote_jid", [jid, `${jid}@s.whatsapp.net`])
    .limit(1)
    .maybeSingle();

  if (existing) {
    const ex: any = existing;
    // Se já existe mas está sem nome bom (só "+telefone"), atualiza
    const isPlaceholderName = !ex.lead_name || ex.lead_name.startsWith("+");
    if (isPlaceholderName && name) {
      await supabase.from("leads").update({ lead_name: name }).eq("id", ex.id);
    }
    return { ok: true, jid, leadId: ex.id };
  }

  // 4. Não existe — cria
  const finalName = name || `+${jid}`;
  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      company_id: opts.companyId,
      remote_jid: jid,
      number_lead: jid,
      lead_name: finalName,
      last_message_at: new Date().toISOString(),
    } as any)
    .select("id")
    .single();

  if (error) {
    console.warn("ensureLeadFromCustomer insert error:", error.message);
    // Mesmo falhando o insert, retorna o jid pra abrir o inbox (vazio)
    return { ok: true, jid, reason: "insert_failed_but_jid_resolved" };
  }

  return { ok: true, jid, leadId: (created as any).id };
}
