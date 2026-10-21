import { supabase } from "@/integrations/supabase/client";

/* ====================================================================
   CONTAS A RECEBER
   Pagamento nessas formas nasce PENDENTE: não entra no caixa nem no
   "Recebido" até alguém dar baixa (tela Contas a receber).
   A regra de caixa/taxa/antecipação mora no banco (migration 56).
==================================================================== */

export const PENDING_METHODS = ["boleto", "crediario", "transferencia", "cartao_credito"] as const;
export type PendingMethod = (typeof PENDING_METHODS)[number];

export function isPendingMethod(method: string): method is PendingMethod {
  return (PENDING_METHODS as readonly string[]).includes(method);
}

/** Vencimento sugerido (dias a partir de hoje) quando a forma é escolhida no PDV. */
export const DEFAULT_DUE_DAYS: Record<PendingMethod, number> = {
  boleto: 7,
  crediario: 30,
  transferencia: 0,
  cartao_credito: 30,
};

export const METHOD_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  boleto: "Boleto",
  cartao_credito: "Cartão crédito",
  cartao_debito: "Cartão débito",
  transferencia: "Transferência",
  crediario: "Crediário",
  outro: "Outro",
};

/** yyyy-mm-dd no fuso do navegador (não UTC — evita virar o dia às 21h). */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localISODate(d);
}

/** Dias entre hoje e o vencimento (negativo = vencido). */
export function daysUntil(dueISO: string): number {
  const [y, m, d] = dueISO.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/* ---------- Visão geral (menu, Dashboard, topo da tela) ---------- */
export type ReceivablesOverview = {
  open_count: number;
  open_total: number;
  overdue_count: number;
  overdue_total: number;
  due_today_count: number;
  due_today_total: number;
  next7_total: number;
  received_today: number;
  received_month: number;
  anticipated_month_count: number;
  anticipated_month_gross: number;
  fees_month: number;
};

export async function fetchReceivablesOverview(): Promise<ReceivablesOverview | null> {
  const { data, error } = await supabase.rpc("receivables_overview" as any);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const n = (v: unknown) => Number(v || 0);
  return {
    open_count: n(row.open_count),
    open_total: n(row.open_total),
    overdue_count: n(row.overdue_count),
    overdue_total: n(row.overdue_total),
    due_today_count: n(row.due_today_count),
    due_today_total: n(row.due_today_total),
    next7_total: n(row.next7_total),
    received_today: n(row.received_today),
    received_month: n(row.received_month),
    anticipated_month_count: n(row.anticipated_month_count),
    anticipated_month_gross: n(row.anticipated_month_gross),
    fees_month: n(row.fees_month),
  };
}

/* ---------- Lista ---------- */
export type Receivable = {
  id: string;
  sale_id: string;
  sale_number: number;
  customer_name: string | null;
  seller_name: string | null;
  method: string;
  status: "pendente" | "parcial" | "pago" | string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  received_amount: number | null;
  fee_amount: number;
  anticipated: boolean;
  cash_session_id: string | null;
  cash_session_open: boolean | null;
  paid_by_name: string | null;
  notes: string | null;
};

export async function listReceivables(
  paidFrom: string,
  paidTo: string,
): Promise<{ data: Receivable[]; error: string | null }> {
  const { data, error } = await supabase.rpc("list_receivables" as any, {
    p_paid_from: paidFrom,
    p_paid_to: paidTo,
  });
  if (error) return { data: [], error: error.message };
  const rows = ((data as any[]) || []).map((r) => ({
    ...r,
    sale_number: Number(r.sale_number),
    amount: Number(r.amount || 0),
    received_amount: r.received_amount == null ? null : Number(r.received_amount),
    fee_amount: Number(r.fee_amount || 0),
  })) as Receivable[];
  return { data: rows, error: null };
}

/* ---------- Baixa ---------- */
export type ReceiptResult = {
  updated_count: number;
  cash_session_id: string | null;
  gross_total: number;
  received_total: number;
  fee_total: number;
};

export async function registerReceipts(opts: {
  ids: string[];
  paidOn?: string | null;
  receivedTotal?: number | null;
  notes?: string | null;
}): Promise<{ result: ReceiptResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("register_payment_receipts" as any, {
    p_ids: opts.ids,
    p_paid_on: opts.paidOn ?? null,
    p_received_total: opts.receivedTotal ?? null,
    p_notes: opts.notes ?? null,
  });
  if (error) return { result: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  notifyReceivablesChanged();
  return {
    result: row
      ? {
          updated_count: Number(row.updated_count || 0),
          cash_session_id: row.cash_session_id ?? null,
          gross_total: Number(row.gross_total || 0),
          received_total: Number(row.received_total || 0),
          fee_total: Number(row.fee_total || 0),
        }
      : null,
    error: null,
  };
}

export async function revertReceipt(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("revert_payment_receipt" as any, { p_id: id });
  if (error) return { error: error.message };
  notifyReceivablesChanged();
  return { error: null };
}

/* ---------- Recebido no período (Relatórios) ---------- */
export async function fetchReceivedSummary(
  from: string,
  to: string,
  sellerId?: string | null,
): Promise<{ received_total: number; received_count: number; fee_total: number } | null> {
  const { data, error } = await supabase.rpc("received_summary" as any, {
    p_from: from,
    p_to: to,
    p_seller: sellerId || null,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    received_total: Number(row.received_total || 0),
    received_count: Number(row.received_count || 0),
    fee_total: Number(row.fee_total || 0),
  };
}

/* ---------- Recebido por dia (gráfico Vendido × Recebido) ---------- */
export async function fetchReceivedDaily(
  from: string,
  to: string,
): Promise<{ day: string; total: number }[] | null> {
  const { data, error } = await supabase.rpc("received_daily" as any, { p_from: from, p_to: to });
  if (error) return null;
  return ((data as any[]) || []).map((r) => ({ day: String(r.day).slice(0, 10), total: Number(r.total || 0) }));
}

/* ---------- Aviso entre telas (menu/Dashboard recarregam após baixa) ---------- */
export const RECEIVABLES_CHANGED = "receivables-changed";
export function notifyReceivablesChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECEIVABLES_CHANGED));
}
