/**
 * Helpers do Caixa PDV.
 *
 *  • Cada vendedor tem 1 caixa aberto por vez (constraint no banco)
 *  • Abrir   → cria cash_session com fundo de troco
 *  • Sangria → retirada de dinheiro do caixa
 *  • Suprimento → entrada de dinheiro no caixa
 *  • Fechar  → conta o dinheiro físico, registra diferença
 */

import { supabase } from "@/integrations/supabase/client";

export interface CashSession {
  id: string;
  company_id: string;
  user_id: string;
  opened_at: string;
  opening_amount: number;
  closed_at: string | null;
  closing_amount: number | null;
  expected_cash: number | null;
  difference: number | null;
  status: "aberto" | "fechado";
  notes: string | null;
}

export interface CashMovement {
  id: string;
  cash_session_id: string;
  type: "sangria" | "suprimento";
  amount: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CashSummary {
  total_sales: number;
  sales_count: number;
  cash_in: number;
  card_in: number;
  pix_in: number;
  other_in: number;
  suprimentos: number;
  sangrias: number;
  expected_cash: number;
}

/* ====================================================================
   SESSÃO ATUAL
==================================================================== */
/** Devolve a sessão de caixa ABERTA do usuário, ou null. */
export async function getOpenSession(userId: string): Promise<CashSession | null> {
  const { data, error } = await supabase
    .from("cash_sessions" as any)
    .select("*")
    .eq("user_id", userId)
    .eq("status", "aberto")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("getOpenSession error:", error.message);
    return null;
  }
  return (data as any) || null;
}

/* ====================================================================
   ABRIR CAIXA
==================================================================== */
export async function openSession(opts: {
  companyId: string;
  userId: string;
  openingAmount: number;
  notes?: string;
}): Promise<{ ok: boolean; session?: CashSession; error?: string }> {
  // Já tem um aberto?
  const existing = await getOpenSession(opts.userId);
  if (existing) {
    return { ok: false, error: "Você já tem um caixa aberto." };
  }

  const { data, error } = await supabase
    .from("cash_sessions" as any)
    .insert({
      company_id: opts.companyId,
      user_id: opts.userId,
      opening_amount: opts.openingAmount,
      notes: opts.notes || null,
      status: "aberto",
    } as any)
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, session: data as any };
}

/* ====================================================================
   SANGRIA / SUPRIMENTO
==================================================================== */
export async function addMovement(opts: {
  sessionId: string;
  companyId: string;
  type: "sangria" | "suprimento";
  amount: number;
  reason?: string;
  userId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (opts.amount <= 0) return { ok: false, error: "Valor deve ser maior que zero." };

  const { error } = await supabase
    .from("cash_movements" as any)
    .insert({
      cash_session_id: opts.sessionId,
      company_id: opts.companyId,
      type: opts.type,
      amount: opts.amount,
      reason: opts.reason || null,
      created_by: opts.userId || null,
    } as any);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ====================================================================
   RESUMO DO CAIXA (totais por forma de pagamento)
==================================================================== */
export async function getSummary(sessionId: string): Promise<CashSummary | null> {
  const { data, error } = await supabase.rpc("cash_session_summary" as any, {
    p_session_id: sessionId,
  });
  if (error) {
    console.warn("getSummary error:", error.message);
    return null;
  }
  // RPC retorna array com 1 linha
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    total_sales: Number(row.total_sales || 0),
    sales_count: Number(row.sales_count || 0),
    cash_in: Number(row.cash_in || 0),
    card_in: Number(row.card_in || 0),
    pix_in: Number(row.pix_in || 0),
    other_in: Number(row.other_in || 0),
    suprimentos: Number(row.suprimentos || 0),
    sangrias: Number(row.sangrias || 0),
    expected_cash: Number(row.expected_cash || 0),
  };
}

/* ====================================================================
   FECHAR CAIXA
==================================================================== */
export async function closeSession(opts: {
  sessionId: string;
  closingAmount: number;   // dinheiro físico contado
  notes?: string;
}): Promise<{ ok: boolean; error?: string; summary?: CashSummary }> {
  const summary = await getSummary(opts.sessionId);
  const expected = summary?.expected_cash ?? 0;
  const difference = opts.closingAmount - expected;

  const { error } = await supabase
    .from("cash_sessions" as any)
    .update({
      status: "fechado",
      closed_at: new Date().toISOString(),
      closing_amount: opts.closingAmount,
      expected_cash: expected,
      difference,
      notes: opts.notes || null,
    } as any)
    .eq("id", opts.sessionId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, summary: summary || undefined };
}

/* ====================================================================
   LISTAR MOVIMENTOS DA SESSÃO
==================================================================== */
export async function listMovements(sessionId: string): Promise<CashMovement[]> {
  const { data } = await supabase
    .from("cash_movements" as any)
    .select("*")
    .eq("cash_session_id", sessionId)
    .order("created_at", { ascending: false });
  return ((data as any[]) || []) as CashMovement[];
}

/* ====================================================================
   ADMIN — todos os caixas da empresa
==================================================================== */
export interface CashSessionWithUser extends CashSession {
  user_name?: string;
}

/** Lista todas as sessões de caixa da empresa (RLS: só admin/gerente vê todas). */
export async function listCompanySessions(
  companyId: string,
  limit = 60
): Promise<CashSessionWithUser[]> {
  const { data, error } = await supabase
    .from("cash_sessions" as any)
    .select("*")
    .eq("company_id", companyId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("listCompanySessions error:", error.message);
    return [];
  }
  const rows = ((data as any[]) || []) as CashSessionWithUser[];

  // resolve nomes dos donos dos caixas
  const userIds = Array.from(new Set(rows.map((r) => r.user_id))).filter(Boolean);
  if (userIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", userIds);
    const nameMap: Record<string, string> = {};
    for (const p of (profs as any[]) || []) nameMap[p.id] = p.nome || "—";
    for (const r of rows) r.user_name = nameMap[r.user_id] || "—";
  }
  return rows;
}

/** Vendas vinculadas a uma sessão de caixa. */
export interface SessionSale {
  id: string;
  number: number;
  total: number;
  status: string;
  created_at: string;
  customer_name: string | null;
}
export async function getSessionSales(sessionId: string): Promise<SessionSale[]> {
  const { data } = await supabase
    .from("sales" as any)
    .select("id, number, total, status, created_at, customers ( name )")
    .eq("cash_session_id", sessionId)
    .order("created_at", { ascending: false });
  return ((data as any[]) || []).map((s) => ({
    id: s.id,
    number: s.number,
    total: Number(s.total || 0),
    status: s.status,
    created_at: s.created_at,
    customer_name: s.customers?.name || null,
  }));
}
