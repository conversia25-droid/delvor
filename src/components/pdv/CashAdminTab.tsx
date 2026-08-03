import { useEffect, useMemo, useState } from "react";
import {
  Loader2, Lock, RefreshCw, Wallet, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronRight, Receipt, User, Eye, Printer, FileText,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";
import SaleViewDialog from "@/components/sales/SaleViewDialog";
import { generateCashSessionPdf } from "@/lib/cashSessionPdf";
import { loadCompanyHeader, imageToDataUrl } from "@/lib/companyInfo";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { formatBRL } from "@/lib/formatters";
import {
  listCompanySessions, getSummary, closeSession, getSessionSales,
  type CashSessionWithUser, type CashSummary, type SessionSale,
} from "@/lib/cashRegister";

type Period = "today" | "week" | "month" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Hoje",
  week:  "Semana",
  month: "Mês",
  all:   "Tudo",
};

function periodStartDate(p: Period): Date | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "today") return d;
  if (p === "week") {
    // Semana = segunda da semana corrente
    const dow = d.getDay();
    const offset = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - offset);
    return d;
  }
  if (p === "month") {
    d.setDate(1);
    return d;
  }
  return null;
}

function moneyInput(v: string): number {
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function CashAdminTab() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<CashSessionWithUser[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CashSummary>>({});

  // Filtros
  const [period, setPeriod] = useState<Period>("today");
  const [userFilter, setUserFilter] = useState<string>("all");

  // expandir caixa → ver vendas
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sales, setSales] = useState<Record<string, SessionSale[]>>({});

  // fechar caixa
  const [closeTarget, setCloseTarget] = useState<CashSessionWithUser | null>(null);
  const [closeAmount, setCloseAmount] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);

  // PDF de relatório por caixa (id da sessão sendo processada)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  /**
   * Gera o PDF do relatório de fechamento desse caixa específico.
   * Carrega summary + vendas + dados da empresa em paralelo.
   */
  async function downloadOrPrintPdf(session: CashSessionWithUser, mode: "download" | "print") {
    if (!companyId) return;
    setPdfBusy(session.id);
    try {
      const [summary, sessionSales, company] = await Promise.all([
        getSummary(session.id),
        sales[session.id] ? Promise.resolve(sales[session.id]) : getSessionSales(session.id),
        loadCompanyHeader(companyId),
      ]);
      if (!summary) {
        toast({ title: "Não foi possível carregar o resumo", variant: "destructive" });
        return;
      }
      const logoData = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;
      generateCashSessionPdf({
        sessionId: session.id,
        vendor: session.user_name || "Vendedor",
        openedAt: session.opened_at,
        closedAt: session.closed_at || new Date().toISOString(),
        openingAmount: Number(session.opening_amount || 0),
        closingAmount: Number(session.closing_amount || 0),
        expectedCash: Number(session.expected_cash || summary.expected_cash || 0),
        difference: Number(session.difference || 0),
        summary,
        sales: sessionSales,
        company,
        companyLogoDataUrl: logoData,
        output: mode,
      });
    } catch (err: any) {
      toast({ title: "Erro ao gerar PDF", description: err.message, variant: "destructive" });
    } finally {
      setPdfBusy(null);
    }
  }

  /* ─────── LOAD ─────── */
  async function load() {
    if (!companyId) return;
    setLoading(true);
    // Limite alto pra cobrir histórico amplo — filtros são client-side
    const rows = await listCompanySessions(companyId, 500);
    setSessions(rows);
    // carrega resumo dos caixas ABERTOS
    const abertos = rows.filter((r) => r.status === "aberto");
    const sumMap: Record<string, CashSummary> = {};
    await Promise.all(
      abertos.map(async (s) => {
        const sum = await getSummary(s.id);
        if (sum) sumMap[s.id] = sum;
      })
    );
    setSummaries(sumMap);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId]);

  /* ─────── expandir vendas ─────── */
  async function toggleExpand(sessionId: string) {
    if (expanded === sessionId) { setExpanded(null); return; }
    setExpanded(sessionId);
    if (!sales[sessionId]) {
      const s = await getSessionSales(sessionId);
      setSales((prev) => ({ ...prev, [sessionId]: s }));
    }
  }

  /* ─────── fechar ─────── */
  async function handleClose() {
    if (!closeTarget) return;
    setCloseBusy(true);
    const r = await closeSession({
      sessionId: closeTarget.id,
      closingAmount: moneyInput(closeAmount),
    });
    setCloseBusy(false);
    if (!r.ok) {
      toast({ title: "Erro ao fechar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Caixa fechado", description: `Caixa de ${closeTarget.user_name} foi encerrado.` });
    setCloseTarget(null);
    setCloseAmount("");
    load();
  }

  // Hooks SEMPRE antes de qualquer early return — React Rules of Hooks
  // Lista de usuários disponíveis nas sessões (pra alimentar o dropdown)
  const usersInSessions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.user_id && !map.has(s.user_id)) map.set(s.user_id, s.user_name || "—");
    }
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [sessions]);

  // Aplicação dos filtros: período é por opened_at, usuário por user_id
  const periodStart = useMemo(() => periodStartDate(period), [period]);

  /* ─────── RENDER ─────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando caixas...
      </div>
    );
  }

  const passesUserFilter = (s: CashSessionWithUser) =>
    userFilter === "all" || s.user_id === userFilter;

  // Abertos: SEM filtro de período (sessões em curso são sempre relevantes),
  // só passa o filtro de usuário.
  const abertos = sessions.filter((s) => s.status === "aberto" && passesUserFilter(s));

  // Fechados: filtra por período (closed_at — caixa fechado naquele dia)
  // E por usuário.
  const fechados = sessions.filter((s) => {
    if (s.status !== "fechado") return false;
    if (!passesUserFilter(s)) return false;
    if (periodStart && s.closed_at) {
      return new Date(s.closed_at) >= periodStart;
    }
    return !periodStart;  // se period="all", passa tudo
  });

  const totalAbertoVendas = abertos.reduce((s, x) => s + (summaries[x.id]?.total_sales || 0), 0);
  const totalFechadoVendas = fechados.reduce((s, x) => s + Number((x as any).total_sales ?? x.expected_cash ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Caixas da equipe</h2>
          <p className="text-sm text-muted-foreground">
            {abertos.length} aberto(s) · {formatBRL(totalAbertoVendas)} em vendas
            {fechados.length > 0 && (
              <> · {fechados.length} fechado(s) no período · {formatBRL(totalFechadoVendas)}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro de usuário */}
          {usersInSessions.length > 1 && (
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-44 h-9 text-sm">
                <User className="h-3.5 w-3.5 mr-1 opacity-60" />
                <SelectValue placeholder="Todos os usuários" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usuários</SelectItem>
                {usersInSessions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Filtro de período */}
          <Tabs value={period} onValueChange={(v: any) => setPeriod(v)}>
            <TabsList>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <TabsTrigger key={p} value={p} className="text-xs">{PERIOD_LABELS[p]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ─────── CAIXAS ABERTOS ─────── */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Abertos ({abertos.length})
        </h3>
        {abertos.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Nenhum caixa aberto no momento.
          </div>
        ) : (
          <div className="space-y-2">
            {abertos.map((s) => {
              const sum = summaries[s.id];
              const isExpanded = expanded === s.id;
              return (
                <div key={s.id} className="rounded-lg border bg-card overflow-hidden">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpand(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(s.id); }
                    }}
                    className="p-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="h-10 w-10 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0">
                        <Wallet className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {s.user_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Aberto {new Date(s.opened_at).toLocaleString("pt-BR")} ·
                          fundo {formatBRL(s.opening_amount)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">Vendas</div>
                        <div className="font-mono font-semibold">{formatBRL(sum?.total_sales || 0)}</div>
                        <div className="text-[10px] text-muted-foreground">{sum?.sales_count || 0} venda(s)</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground">Esperado $</div>
                        <div className="font-mono font-semibold">{formatBRL(sum?.expected_cash || 0)}</div>
                      </div>
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setCloseTarget(s); setCloseAmount(""); }}
                      >
                        <Lock className="h-3.5 w-3.5 mr-1" /> Fechar
                      </Button>
                    </div>
                  </div>

                  {/* breakdown formas de pagamento */}
                  {sum && (
                    <div className="px-3 pb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>💵 Dinheiro {formatBRL(sum.cash_in)}</span>
                      <span>💳 Cartão {formatBRL(sum.card_in)}</span>
                      <span>📱 Pix {formatBRL(sum.pix_in)}</span>
                      {sum.other_in > 0 && <span>Outros {formatBRL(sum.other_in)}</span>}
                      {sum.suprimentos > 0 && <span className="text-emerald-400">+ Supr. {formatBRL(sum.suprimentos)}</span>}
                      {sum.sangrias > 0 && <span className="text-rose-400">− Sangr. {formatBRL(sum.sangrias)}</span>}
                    </div>
                  )}

                  {/* vendas expandidas */}
                  {isExpanded && (
                    <div className="border-t bg-muted/20">
                      <SalesPanel sales={sales[s.id]} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─────── CAIXAS FECHADOS ─────── */}
      {fechados.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Fechados — {PERIOD_LABELS[period].toLowerCase()} ({fechados.length})
          </h3>
          <div className="rounded-lg border bg-card divide-y overflow-hidden">
            {fechados.map((s) => {
              const diff = s.difference ?? 0;
              const ok = Math.abs(diff) < 0.01;
              const isExpanded = expanded === s.id;
              return (
                <div key={s.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(s.id)}
                    className="w-full px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm text-left transition hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{s.user_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.opened_at).toLocaleDateString("pt-BR")}
                        {" "}{new Date(s.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {" → "}
                        {s.closed_at && new Date(s.closed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        Contado {formatBRL(s.closing_amount || 0)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] gap-1 ${ok ? "text-emerald-400" : "text-amber-400"}`}
                      >
                        {ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                        {ok ? "Conferido" : `Dif. ${formatBRL(diff)}`}
                      </Badge>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t bg-muted/20">
                      <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <span>Fundo {formatBRL(s.opening_amount)}</span>
                          <span>Esperado {formatBRL(s.expected_cash || 0)}</span>
                          <span>Contado {formatBRL(s.closing_amount || 0)}</span>
                          <span className={ok ? "text-emerald-400" : "text-amber-400"}>
                            Diferença {formatBRL(diff)}
                          </span>
                        </div>
                        {/* Botões de relatório/PDF — só pra caixas fechados (faz sentido
                            só imprimir o relatório fechado com diferença/contado). */}
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); void downloadOrPrintPdf(s, "download"); }}
                            disabled={pdfBusy === s.id}
                            className="h-7 text-[11px]"
                            title="Baixar PDF do relatório"
                          >
                            {pdfBusy === s.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <FileText className="h-3 w-3 mr-1" />}
                            PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); void downloadOrPrintPdf(s, "print"); }}
                            disabled={pdfBusy === s.id}
                            className="h-7 text-[11px]"
                            title="Abrir janela de impressão"
                          >
                            <Printer className="h-3 w-3 mr-1" /> Imprimir
                          </Button>
                        </div>
                      </div>
                      <div className="border-t">
                        <SalesPanel sales={sales[s.id]} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─────── DIALOG FECHAR ─────── */}
      <Dialog open={!!closeTarget} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" /> Fechar caixa — {closeTarget?.user_name}
            </DialogTitle>
            <DialogDescription>
              Conte o dinheiro físico da gaveta deste caixa e informe o total.
            </DialogDescription>
          </DialogHeader>

          {closeTarget && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Esperado em dinheiro</span>
                  <span className="font-mono font-semibold">
                    {formatBRL(summaries[closeTarget.id]?.expected_cash || 0)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Total vendido</span>
                  <span>{formatBRL(summaries[closeTarget.id]?.total_sales || 0)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Dinheiro contado (R$)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={closeAmount}
                  onChange={(e) => setCloseAmount(e.target.value)}
                  autoFocus
                />
              </div>
              {closeAmount && (
                <div className={`text-sm rounded-md p-2 ${
                  Math.abs(moneyInput(closeAmount) - (summaries[closeTarget.id]?.expected_cash || 0)) < 0.01
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-amber-500/10 text-amber-300"
                }`}>
                  Diferença: {formatBRL(moneyInput(closeAmount) - (summaries[closeTarget.id]?.expected_cash || 0))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>Cancelar</Button>
            <Button onClick={handleClose} disabled={closeBusy || !closeAmount}>
              {closeBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
              Fechar caixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────── lista de vendas de um caixa (compartilhada: abertos + fechados) ─────── */
function SalesPanel({ sales }: { sales?: SessionSale[] }) {
  const [viewSaleId, setViewSaleId] = useState<string | null>(null);

  if (!sales) {
    return (
      <div className="p-3 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Carregando vendas...
      </div>
    );
  }
  if (sales.length === 0) {
    return (
      <div className="p-3 text-center text-sm text-muted-foreground">
        Nenhuma venda neste caixa.
      </div>
    );
  }
  const total = sales.reduce((s, v) => s + Number(v.total || 0), 0);
  return (
    <div className="divide-y">
      {sales.map((v) => (
        <div
          key={v.id}
          role="button"
          tabIndex={0}
          onClick={() => setViewSaleId(v.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setViewSaleId(v.id);
            }
          }}
          className="px-3 py-2 flex items-center justify-between text-sm cursor-pointer transition hover:bg-muted/40 group"
          title="Visualizar esta venda"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Receipt className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-mono">#{String(v.number).padStart(6, "0")}</span>
            <span className="text-muted-foreground truncate">{v.customer_name || "Consumidor Final"}</span>
            <Eye className="h-3 w-3 opacity-0 group-hover:opacity-60 transition shrink-0" />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] text-muted-foreground">
              {new Date(v.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="font-mono font-semibold">{formatBRL(v.total)}</span>
          </div>
        </div>
      ))}
      <div className="px-3 py-2 flex items-center justify-between text-sm bg-muted/30">
        <span className="font-medium">{sales.length} venda(s)</span>
        <span className="font-mono font-bold">{formatBRL(total)}</span>
      </div>

      <SaleViewDialog
        saleId={viewSaleId}
        open={!!viewSaleId}
        onOpenChange={(o) => { if (!o) setViewSaleId(null); }}
      />
    </div>
  );
}
