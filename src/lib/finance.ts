/* =====================================================================
   Financeiro completo — camada de dados (migrations 58–61)
   Boleto em duas etapas, anexos, contas a pagar, contas/saldos, fluxo, DRE.
   Toda chamada devolve { data, error } e nunca lança: se o banco ainda não
   tem a migration, a tela mostra um aviso em vez de quebrar.
   Idêntico no Delvor e no InfnityServices.
===================================================================== */
import { db } from "@/integrations/supabase/untyped";
import { notifyReceivablesChanged } from "@/lib/receivables";

export type Res<T> = { data: T; error: string | null; missing?: boolean };

/** Função/tabela inexistente = migration ainda não aplicada no banco. */
export function isMissingDbObject(err: any): boolean {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  return code === "PGRST202" || code === "42P01" || code === "42883" || code === "PGRST205"
    || /could not find the function|does not exist|schema cache/i.test(msg);
}
function fail<T>(data: T, err: any): Res<T> {
  return { data, error: String(err?.message || err || "Erro desconhecido"), missing: isMissingDbObject(err) };
}
const num = (v: unknown) => (v == null ? 0 : Number(v));
export const MISSING_DB_MSG =
  "O banco de dados ainda não foi atualizado para esta tela. Peça ao suporte para aplicar as atualizações do financeiro.";

/* ---------- Boleto: emissão ---------- */
export async function registerBoletoIssue(o: {
  id: string; dueDate?: string | null; line?: string | null; bank?: string | null; number?: string | null; notes?: string | null;
}): Promise<{ error: string | null }> {
  const { error } = await db.rpc("register_boleto_issue", {
    p_id: o.id, p_due_date: o.dueDate || null, p_line: o.line || null,
    p_bank: o.bank || null, p_number: o.number || null, p_notes: o.notes || null,
  });
  if (!error) notifyReceivablesChanged();
  return { error: error?.message ?? null };
}
/** Chama a RPC com o motivo; se o banco ainda não tem a versão com motivo (62), repete sem. */
async function rpcWithReason(fn: string, args: Record<string, unknown>, reason?: string | null) {
  const full = reason ? { ...args, p_reason: reason } : args;
  let { data, error } = await db.rpc(fn, full);
  if (error && reason && /p_reason|could not find the function/i.test(error.message)) {
    ({ data, error } = await db.rpc(fn, args));
  }
  return { data, error };
}

export async function revertBoletoIssue(id: string, reason?: string | null) {
  const { error } = await rpcWithReason("revert_boleto_issue", { p_id: id }, reason);
  if (!error) notifyReceivablesChanged();
  return { error: error?.message ?? null };
}
export async function markBoletoSent(id: string) {
  const { error } = await db.rpc("mark_boleto_sent", { p_id: id });
  return { error: error?.message ?? null };
}
/** "34191.79001 01043.510047 …" a partir dos 47/48 dígitos. */
export function formatBoletoLine(digits: string | null | undefined): string {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length === 47) return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
  if (d.length === 48) return `${d.slice(0, 12)} ${d.slice(12, 24)} ${d.slice(24, 36)} ${d.slice(36)}`;
  return d;
}

/* ---------- Anexos ---------- */
export type AttachmentEntity = "sale_payment" | "payable";
export type AttachmentKind = "boleto" | "comprovante" | "nota" | "outro";
export type Attachment = {
  id: string; entity: AttachmentEntity; entity_id: string; kind: AttachmentKind;
  storage_path: string; file_name: string; mime_type: string | null; size_bytes: number | null; created_at: string;
};
export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  boleto: "Boleto", comprovante: "Comprovante", nota: "Nota fiscal", outro: "Outro",
};
export const ATTACHMENT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

export async function listAttachments(entity: AttachmentEntity, entityId: string): Promise<Res<Attachment[]>> {
  const { data, error } = await db
    .from("finance_attachments")
    .select("id, entity, entity_id, kind, storage_path, file_name, mime_type, size_bytes, created_at")
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (error) return fail([], error);
  return { data: (data as Attachment[]) || [], error: null };
}

export async function uploadAttachment(o: {
  companyId: string; entity: AttachmentEntity; entityId: string; kind: AttachmentKind; file: File;
}): Promise<{ error: string | null }> {
  if (o.file.size > ATTACHMENT_MAX_BYTES) return { error: "Arquivo maior que 15 MB." };
  if (!ATTACHMENT_ACCEPT.split(",").includes(o.file.type)) return { error: "Envie PDF ou imagem (PNG, JPG, WEBP, HEIC)." };
  const safe = o.file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${o.companyId}/${o.entity}/${o.entityId}/${crypto.randomUUID()}-${safe}`;
  const up = await db.storage.from("finance-files").upload(path, o.file, { contentType: o.file.type, upsert: false });
  if (up.error) return { error: up.error.message };
  const { error } = await db.from("finance_attachments").insert({
    company_id: o.companyId, entity: o.entity, entity_id: o.entityId, kind: o.kind,
    storage_path: path, file_name: o.file.name, mime_type: o.file.type, size_bytes: o.file.size,
  });
  if (error) {
    await db.storage.from("finance-files").remove([path]); // não deixa arquivo órfão
    return { error: error.message };
  }
  return { error: null };
}

export async function openAttachment(a: Attachment): Promise<{ error: string | null }> {
  const { data, error } = await db.storage.from("finance-files").createSignedUrl(a.storage_path, 120);
  if (error || !data?.signedUrl) return { error: error?.message || "Não foi possível abrir o arquivo." };
  window.open(data.signedUrl, "_blank", "noopener");
  return { error: null };
}

export async function deleteAttachment(a: Attachment): Promise<{ error: string | null }> {
  const { error } = await db.from("finance_attachments").delete().eq("id", a.id);
  if (error) return { error: error.message };
  await db.storage.from("finance-files").remove([a.storage_path]);
  return { error: null };
}

/* ---------- Contas / carteiras ---------- */
export type AccountKind = "caixa" | "banco" | "digital" | "outro";
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  caixa: "Caixa físico", banco: "Banco", digital: "Carteira digital", outro: "Outro",
};
export type AccountBalance = {
  id: string; name: string; kind: AccountKind; bank_name: string | null; default_methods: string[];
  opening_balance: number; opening_date: string; inflow: number; outflow: number;
  transfers_in: number; transfers_out: number; balance: number; active: boolean;
};
export async function fetchAccountBalances(): Promise<Res<AccountBalance[]>> {
  const { data, error } = await db.rpc("account_balances");
  if (error) return fail([], error);
  return {
    data: ((data as any[]) || []).map((r) => ({
      ...r, default_methods: r.default_methods || [],
      opening_balance: num(r.opening_balance), inflow: num(r.inflow), outflow: num(r.outflow),
      transfers_in: num(r.transfers_in), transfers_out: num(r.transfers_out), balance: num(r.balance),
    })),
    error: null,
  };
}
export async function saveAccount(o: {
  id?: string; companyId: string; name: string; kind: AccountKind; bankName?: string | null;
  openingBalance: number; openingDate: string; defaultMethods: string[]; active?: boolean;
}) {
  const row = {
    company_id: o.companyId, name: o.name.trim(), kind: o.kind, bank_name: o.bankName || null,
    opening_balance: o.openingBalance, opening_date: o.openingDate, default_methods: o.defaultMethods,
    active: o.active ?? true,
  };
  const { error } = o.id
    ? await db.from("finance_accounts").update(row).eq("id", o.id)
    : await db.from("finance_accounts").insert(row);
  if (error?.code === "23505") return { error: "Já existe uma conta com esse nome." };
  return { error: error?.message ?? null };
}
export async function createTransfer(o: {
  companyId: string; fromId: string; toId: string; amount: number; date: string; notes?: string | null;
}) {
  const { error } = await db.from("finance_transfers").insert({
    company_id: o.companyId, from_account_id: o.fromId, to_account_id: o.toId,
    amount: o.amount, transfer_date: o.date, notes: o.notes || null,
  });
  return { error: error?.message ?? null };
}
export type StatementLine = { moved_on: string; kind: "recebimento" | "pagamento" | "transferencia" | "movimento"; description: string; amount: number; ref_id: string };
export async function fetchAccountStatement(accountId: string, from: string, to: string): Promise<Res<StatementLine[]>> {
  const { data, error } = await db.rpc("account_statement", { p_account_id: accountId, p_from: from, p_to: to });
  if (error) return fail([], error);
  return { data: ((data as any[]) || []).map((r) => ({ ...r, moved_on: String(r.moved_on).slice(0, 10), amount: num(r.amount) })), error: null };
}

/* ---------- Contas a pagar ---------- */
export type Payable = {
  id: string; kind: "payable" | "variavel"; description: string;
  supplier_id: string | null; supplier_name: string | null; category_id: string | null; category_name: string | null;
  amount: number; due_date: string; status: "aberta" | "paga" | "cancelada";
  paid_at: string | null; paid_amount: number | null; account_id: string | null; account_name: string | null;
  payment_method: string | null; document_number: string | null; boleto_line: string | null;
  source: "manual" | "fixa" | "compra" | "variavel" | "emprestimo"; month_ref: string | null;
  installment_no: number | null; installment_total: number | null; notes: string | null;
  attachments_count: number; created_at: string;
};
export async function listPayables(paidFrom: string, paidTo: string): Promise<Res<Payable[]>> {
  const { data, error } = await db.rpc("list_payables", { p_paid_from: paidFrom, p_paid_to: paidTo });
  if (error) return fail([], error);
  return {
    data: ((data as any[]) || []).map((r) => ({
      ...r, due_date: String(r.due_date).slice(0, 10), amount: num(r.amount),
      paid_amount: r.paid_amount == null ? null : num(r.paid_amount), attachments_count: num(r.attachments_count),
    })),
    error: null,
  };
}
export type PayablesOverview = {
  open_count: number; open_total: number; overdue_count: number; overdue_total: number;
  due_today_count: number; due_today_total: number; next7_total: number; month_open: number; paid_month: number;
};
export async function fetchPayablesOverview(): Promise<Res<PayablesOverview | null>> {
  const { data, error } = await db.rpc("payables_overview");
  if (error) return fail(null, error);
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { data: null, error: null };
  return {
    data: {
      open_count: num(r.open_count), open_total: num(r.open_total), overdue_count: num(r.overdue_count),
      overdue_total: num(r.overdue_total), due_today_count: num(r.due_today_count), due_today_total: num(r.due_today_total),
      next7_total: num(r.next7_total), month_open: num(r.month_open), paid_month: num(r.paid_month),
    },
    error: null,
  };
}
/** Cria a conta (ou N parcelas mensais). Devolve os ids criados. */
export async function createPayables(o: {
  companyId: string; description: string; amount: number; firstDue: string; installments: number;
  supplierId?: string | null; categoryId?: string | null; documentNumber?: string | null;
  boletoLine?: string | null; notes?: string | null;
}): Promise<{ ids: string[]; error: string | null }> {
  const n = Math.max(1, Math.min(60, Math.floor(o.installments || 1)));
  const cents = Math.round(o.amount * 100);
  const base = Math.floor(cents / n);
  const group = n > 1 ? crypto.randomUUID() : null;
  const [y, m, d] = o.firstDue.split("-").map(Number);
  const rows = Array.from({ length: n }, (_, i) => {
    const last = new Date(y, m - 1 + i + 1, 0).getDate();
    const due = new Date(y, m - 1 + i, Math.min(d, last));
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
    const value = (i === n - 1 ? cents - base * (n - 1) : base) / 100;
    return {
      company_id: o.companyId,
      description: n > 1 ? `${o.description.trim()} (${i + 1}/${n})` : o.description.trim(),
      amount: value, due_date: iso,
      supplier_id: o.supplierId || null, category_id: o.categoryId || null,
      document_number: o.documentNumber || null,
      boleto_line: o.boletoLine ? o.boletoLine.replace(/\D/g, "") : null,
      notes: o.notes || null, source: "manual",
      installment_no: n > 1 ? i + 1 : null, installment_total: n > 1 ? n : null, group_id: group,
    };
  });
  const { data, error } = await db.from("payables").insert(rows).select("id");
  if (error) return { ids: [], error: error.message };
  return { ids: ((data as any[]) || []).map((r) => r.id), error: null };
}
export async function updatePayable(id: string, patch: Partial<{
  description: string; amount: number; due_date: string; supplier_id: string | null; category_id: string | null;
  document_number: string | null; notes: string | null; status: "aberta" | "cancelada";
}>) {
  const { error } = await db.from("payables").update(patch).eq("id", id);
  return { error: error?.message ?? null };
}
export async function payPayables(o: {
  ids: string[]; paidOn?: string | null; paidTotal?: number | null; accountId?: string | null; method?: string | null; notes?: string | null;
}): Promise<{ error: string | null; paidTotal?: number }> {
  const { data, error } = await db.rpc("pay_payables", {
    p_ids: o.ids, p_paid_on: o.paidOn || null, p_paid_total: o.paidTotal ?? null,
    p_account_id: o.accountId || null, p_method: o.method || null, p_notes: o.notes || null,
  });
  if (error) return { error: error.message };
  const r = Array.isArray(data) ? data[0] : data;
  window.dispatchEvent(new Event(PAYABLES_CHANGED));
  return { error: null, paidTotal: num(r?.paid_total) };
}
export async function revertPayable(id: string, reason?: string | null) {
  const { error } = await rpcWithReason("revert_payable", { p_id: id }, reason);
  if (!error) window.dispatchEvent(new Event(PAYABLES_CHANGED));
  return { error: error?.message ?? null };
}
/** Cancela com motivo (62). Banco sem a 62: cai no update direto antigo. */
export async function cancelPayable(id: string, reason: string) {
  const { error } = await db.rpc("cancel_payable", { p_id: id, p_reason: reason });
  if (error && isMissingDbObject(error)) return updatePayable(id, { status: "cancelada" });
  if (!error) window.dispatchEvent(new Event(PAYABLES_CHANGED));
  return { error: error?.message ?? null };
}
export const PAYABLES_CHANGED = "payables-changed";

/* ---------- Pagamento parcial (62) ---------- */
export async function registerPartialReceipt(o: {
  id: string; amount: number; paidOn?: string | null; accountId?: string | null; notes?: string | null;
}): Promise<{ restId: string | null; error: string | null }> {
  const { data, error } = await db.rpc("register_partial_receipt", {
    p_id: o.id, p_amount: o.amount, p_paid_on: o.paidOn || null, p_account_id: o.accountId || null, p_notes: o.notes || null,
  });
  if (error) return { restId: null, error: isMissingDbObject(error) ? MISSING_DB_MSG : error.message };
  notifyReceivablesChanged();
  return { restId: (data as any) ?? null, error: null };
}
export async function payPayablePartial(o: {
  id: string; amount: number; paidOn?: string | null; accountId?: string | null; method?: string | null; notes?: string | null;
}): Promise<{ restId: string | null; error: string | null }> {
  const { data, error } = await db.rpc("pay_payable_partial", {
    p_id: o.id, p_amount: o.amount, p_paid_on: o.paidOn || null, p_account_id: o.accountId || null,
    p_method: o.method || null, p_notes: o.notes || null,
  });
  if (error) return { restId: null, error: isMissingDbObject(error) ? MISSING_DB_MSG : error.message };
  window.dispatchEvent(new Event(PAYABLES_CHANGED));
  return { restId: (data as any) ?? null, error: null };
}

/* ---------- Histórico (62) ---------- */
export type HistoryEntry = {
  created_at: string; action: string; user_name: string;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; reason: string | null;
};
export async function fetchFinanceHistory(entity: "sale_payment" | "payable", id: string): Promise<Res<HistoryEntry[]>> {
  const { data, error } = await db.rpc("finance_history", { p_entity: entity, p_entity_id: id });
  if (error) return fail([], error);
  return { data: (data as HistoryEntry[]) || [], error: null };
}

/* ---------- Fechamento de mês (62) ---------- */
export type FinanceMonth = {
  month: string; closed: boolean; closed_at: string | null; closed_by_name: string | null;
  reopened_at: string | null; reopened_by_name: string | null; reopen_reason: string | null;
  receivables_open: number; payables_open: number; boletos_to_issue: number;
  payments_no_account: number; cash_sessions_open: number;
};
export async function fetchFinanceMonths(n = 12): Promise<Res<FinanceMonth[]>> {
  const { data, error } = await db.rpc("finance_months", { p_months: n });
  if (error) return fail([], error);
  return {
    data: ((data as any[]) || []).map((r) => ({
      ...r, month: String(r.month).slice(0, 10),
      receivables_open: num(r.receivables_open), payables_open: num(r.payables_open), boletos_to_issue: num(r.boletos_to_issue),
      payments_no_account: num(r.payments_no_account), cash_sessions_open: num(r.cash_sessions_open),
    })),
    error: null,
  };
}
export async function closeFinanceMonth(month: string) {
  const { error } = await db.rpc("close_finance_month", { p_month: month });
  return { error: error?.message ?? null };
}
export async function reopenFinanceMonth(month: string, reason: string) {
  const { error } = await db.rpc("reopen_finance_month", { p_month: month, p_reason: reason });
  return { error: error?.message ?? null };
}

/* ---------- Empréstimos (63) ---------- */
export type LoanSchedule = { n: number; due: string; amount: number; interest: number; principal: number; balance: number }[];
/**
 * Mesma conta da RPC create_loan (Tabela Price): com taxa → parcela fixa;
 * com parcela → acha a taxa por bisseção; sem nenhum → sem juros.
 */
export function simulateLoan(o: { principal: number; n: number; firstDue: string; ratePct?: number | null; installment?: number | null }):
  { rate: number; installment: number; totalInterest: number; schedule: LoanSchedule; error: string | null } {
  const P = Math.round(o.principal * 100) / 100;
  const n = Math.floor(o.n);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (!(P > 0) || !(n >= 1)) return { rate: 0, installment: 0, totalInterest: 0, schedule: [], error: null };
  let i = 0, pmt = 0;
  if (o.installment != null && o.installment > 0) {
    pmt = r2(o.installment);
    if (pmt * n < P - 0.01) return { rate: 0, installment: pmt, totalInterest: 0, schedule: [], error: `As parcelas somam ${(pmt * n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, abaixo do valor recebido.` };
    if (pmt * n > P + 0.005) {
      let lo = 1e-7, hi = 1;
      for (let k = 0; k < 120; k++) { const mid = (lo + hi) / 2; const f = pmt * (1 - Math.pow(1 + mid, -n)) / mid - P; if (f > 0) lo = mid; else hi = mid; }
      i = Math.round(((lo + hi) / 2) * 1e8) / 1e8;
    }
  } else if (o.ratePct != null && o.ratePct > 0) {
    i = o.ratePct / 100;
    pmt = r2(P * i / (1 - Math.pow(1 + i, -n)));
  } else {
    pmt = r2(P / n);
  }
  const [y, m, d] = o.firstDue.split("-").map(Number);
  let bal = P, tot = 0;
  const schedule: LoanSchedule = [];
  for (let k = 1; k <= n; k++) {
    const int = r2(bal * i);
    const princ = k < n ? r2(pmt - int) : bal;
    const amount = k < n ? pmt : r2(princ + int);
    bal = r2(bal - princ);
    tot = r2(tot + int);
    const last = new Date(y, m - 1 + k, 0).getDate();
    const due = new Date(y, m - 1 + (k - 1), Math.min(d, last));
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
    schedule.push({ n: k, due: iso, amount, interest: int, principal: princ, balance: bal });
  }
  return { rate: i, installment: pmt, totalInterest: tot, schedule, error: null };
}
export async function createLoan(o: {
  description: string; principal: number; receivedOn: string; accountId: string; installments: number; firstDue: string;
  ratePct?: number | null; installment?: number | null; lender?: string | null; categoryId?: string | null; notes?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await db.rpc("create_loan", {
    p_description: o.description, p_principal: o.principal, p_received_on: o.receivedOn, p_account_id: o.accountId,
    p_installments: o.installments, p_first_due: o.firstDue,
    p_monthly_rate_pct: o.ratePct ?? null, p_installment_amount: o.installment ?? null,
    p_lender: o.lender || null, p_category_id: o.categoryId || null, p_notes: o.notes || null,
  });
  if (error) return { id: null, error: isMissingDbObject(error) ? MISSING_DB_MSG : error.message };
  window.dispatchEvent(new Event(PAYABLES_CHANGED));
  return { id: (data as any) ?? null, error: null };
}
export type Loan = {
  id: string; description: string; lender: string | null; principal: number; received_on: string; account_name: string | null;
  installments: number; installment_amount: number; monthly_rate: number; total_interest: number; first_due: string;
  paid_count: number; open_count: number; overdue_count: number; balance_principal: number; open_total: number;
  interest_paid: number; next_due: string | null; next_amount: number | null;
};
export async function listLoans(): Promise<Res<Loan[]>> {
  const { data, error } = await db.rpc("list_loans");
  if (error) return fail([], error);
  return {
    data: ((data as any[]) || []).map((r) => ({
      ...r, principal: num(r.principal), installment_amount: num(r.installment_amount), monthly_rate: num(r.monthly_rate),
      total_interest: num(r.total_interest), paid_count: num(r.paid_count), open_count: num(r.open_count),
      overdue_count: num(r.overdue_count), balance_principal: num(r.balance_principal), open_total: num(r.open_total),
      interest_paid: num(r.interest_paid), next_amount: r.next_amount == null ? null : num(r.next_amount),
      received_on: String(r.received_on).slice(0, 10), first_due: String(r.first_due).slice(0, 10),
      next_due: r.next_due ? String(r.next_due).slice(0, 10) : null,
    })),
    error: null,
  };
}
export async function fetchLoanInstallments(loanId: string) {
  const { data, error } = await db.from("payables")
    .select("id, installment_no, due_date, amount, principal_part, interest_part, status, paid_at, paid_amount")
    .eq("loan_id", loanId).order("installment_no");
  if (error) return fail([] as any[], error);
  return { data: ((data as any[]) || []).map((r) => ({ ...r, amount: num(r.amount), principal_part: num(r.principal_part), interest_part: num(r.interest_part) })), error: null };
}
export async function deleteLoan(id: string) {
  const { error } = await db.rpc("delete_loan", { p_id: id });
  if (!error) window.dispatchEvent(new Event(PAYABLES_CHANGED));
  return { error: error?.message ?? null };
}

/* ---------- Fluxo de caixa ---------- */
export type CashFlowDay = { day: string; in_realized: number; out_realized: number; in_expected: number; out_expected: number };
export async function fetchCashFlow(from: string, to: string): Promise<Res<CashFlowDay[]>> {
  const { data, error } = await db.rpc("cash_flow", { p_from: from, p_to: to });
  if (error) return fail([], error);
  return {
    data: ((data as any[]) || []).map((r) => ({
      day: String(r.day).slice(0, 10), in_realized: num(r.in_realized), out_realized: num(r.out_realized),
      in_expected: num(r.in_expected), out_expected: num(r.out_expected),
    })),
    error: null,
  };
}

/* ---------- DRE ---------- */
export type DreLine = {
  month: string;
  line: "receita" | "cmv" | "comissao" | "taxa" | "despesa" | "juros_emprestimo" | "encargos" | "descontos" | "receita_financeira";
  label: string; amount: number;
};
export async function fetchDre(from: string, to: string): Promise<Res<DreLine[]>> {
  const { data, error } = await db.rpc("dre_monthly", { p_from: from, p_to: to });
  if (error) return fail([], error);
  return { data: ((data as any[]) || []).map((r) => ({ ...r, month: String(r.month).slice(0, 7), amount: num(r.amount) })), error: null };
}

/* ---------- apoio ---------- */
export async function fetchSuppliersLite(companyId: string) {
  const { data } = await db.from("suppliers").select("id, name").eq("company_id", companyId).order("name");
  return ((data as any[]) || []) as { id: string; name: string }[];
}
export async function fetchExpenseCategories(companyId: string) {
  const { data } = await db.from("expense_categories").select("id, name, kind").eq("company_id", companyId).order("name");
  return ((data as any[]) || []).filter((c) => c.kind !== "receita") as { id: string; name: string }[];
}

/** Mensagem pronta pro cliente (WhatsApp/e-mail) com os dados do boleto. */
export function boletoMessage(o: { customer?: string | null; amount: number; due?: string | null; line?: string | null; company?: string | null }) {
  const brl = o.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const due = o.due ? `${o.due.slice(8, 10)}/${o.due.slice(5, 7)}/${o.due.slice(0, 4)}` : "";
  return [
    `Olá${o.customer ? `, ${o.customer.split(" ")[0]}` : ""}! Segue o boleto${o.company ? ` da ${o.company}` : ""}.`,
    `Valor: ${brl}${due ? ` · vencimento ${due}` : ""}`,
    o.line ? `Linha digitável: ${formatBoletoLine(o.line)}` : "",
    "Qualquer dúvida, é só responder esta mensagem.",
  ].filter(Boolean).join("\n");
}
