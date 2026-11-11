/* Pendências financeiras de um cliente (pagamentos de venda em aberto)
   + achar o cliente pelo WhatsApp + recado pro chat. Idêntico nos dois repos. */
import { supabase } from "@/integrations/supabase/client";
import { formatBoletoLine } from "@/lib/finance";
import { METHOD_LABELS } from "@/lib/receivables";

export type PendingItem = {
  id: string;
  sale_id: string;
  sale_number: number;
  method: string;
  amount: number;
  due_date: string | null;
  boleto_line: string | null;
  overdue: boolean;
};
export type CustomerPending = { items: PendingItem[]; total: number; overdueTotal: number; overdueCount: number };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function fetchCustomerPending(customerId: string): Promise<CustomerPending> {
  const { data, error } = await supabase
    .from("sale_payments" as any)
    .select("id, sale_id, method, status, amount, due_date, received_amount, boleto_line, sales!inner(number, customer_id, status)")
    .eq("sales.customer_id", customerId)
    .not("sales.status", "in", "(orcamento,cancelado,perdido)")
    .in("status", ["pendente", "parcial"])
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error || !data) return { items: [], total: 0, overdueTotal: 0, overdueCount: 0 };
  const today = todayISO();
  const items: PendingItem[] = (data as any[]).map((r) => {
    const amount = Math.max(0, Number(r.amount || 0) - (r.status === "parcial" ? Number(r.received_amount || 0) : 0));
    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
    return {
      id: r.id, sale_id: r.sale_id, sale_number: Number(r.sales?.number || 0), method: r.method,
      amount, due_date: due, boleto_line: r.boleto_line ?? null, overdue: !!due && due < today,
    };
  }).filter((i) => i.amount > 0.004);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const overdue = items.filter((i) => i.overdue);
  return { items, total, overdueTotal: overdue.reduce((s, i) => s + i.amount, 0), overdueCount: overdue.length };
}

/** Variações do número (com/sem 55, com/sem o 9) — o WhatsApp às vezes tira o 9. */
function phoneVariants(digits: string): string[] {
  const d = digits.replace(/\D/g, "");
  const set = new Set<string>([d]);
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  set.add(local);
  set.add(`55${local}`);
  if (local.length === 11 && local[2] === "9") { const s = local.slice(0, 2) + local.slice(3); set.add(s); set.add(`55${s}`); }
  if (local.length === 10) { const s = local.slice(0, 2) + "9" + local.slice(2); set.add(s); set.add(`55${s}`); }
  return [...set].filter((x) => x.length >= 10);
}

export async function findCustomerByJid(companyId: string, jid: string): Promise<{ id: string; name: string; remote_jid: string | null } | null> {
  const digits = jid.split("@")[0].replace(/\D/g, "");
  if (!digits) return null;
  const v = phoneVariants(digits);
  const jids = v.map((x) => `${x}@s.whatsapp.net`);
  const { data } = await supabase
    .from("customers" as any)
    .select("id, name, remote_jid")
    .eq("company_id", companyId)
    .or(`remote_jid.in.(${jids.join(",")}),whatsapp.in.(${v.join(",")}),phone.in.(${v.join(",")})`)
    .limit(1);
  return ((data as any[]) || [])[0] ?? null;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function pendingMessage(o: { customer?: string | null; company?: string | null; items: PendingItem[] }) {
  const total = o.items.reduce((s, i) => s + i.amount, 0);
  const lines = o.items.map((i) => {
    const venc = i.due_date ? (i.overdue ? `venceu em ${br(i.due_date)}` : `vence em ${br(i.due_date)}`) : "sem vencimento";
    const forma = METHOD_LABELS[i.method] || i.method;
    const linha = i.boleto_line ? `\n   Linha digitável: ${formatBoletoLine(i.boleto_line)}` : "";
    return `• ${forma} ${brl(i.amount)} — ${venc} (venda nº ${String(i.sale_number).padStart(6, "0")})${linha}`;
  });
  return [
    `Olá${o.customer ? `, ${o.customer.split(" ")[0]}` : ""}! Tudo bem?`,
    `Passando para lembrar ${o.items.length > 1 ? "dos valores em aberto" : "do valor em aberto"}${o.company ? ` com a ${o.company}` : ""}:`,
    ...lines,
    o.items.length > 1 ? `Total: ${brl(total)}` : "",
    "Se já pagou, pode desconsiderar. Qualquer dúvida, é só responder esta mensagem.",
  ].filter(Boolean).join("\n");
}

/* Recado deixado pela ficha do cliente para o chat preencher a caixa de texto
   (sessionStorage: não vai na URL). */
const DRAFT_KEY = (jid: string) => `chat-draft:${jid}`;
export function setChatDraft(jid: string, text: string) {
  try { sessionStorage.setItem(DRAFT_KEY(jid), text); } catch { /* sem storage: segue sem rascunho */ }
}
export function takeChatDraft(jid: string): string | null {
  try {
    const v = sessionStorage.getItem(DRAFT_KEY(jid));
    if (v != null) sessionStorage.removeItem(DRAFT_KEY(jid));
    return v;
  } catch { return null; }
}
