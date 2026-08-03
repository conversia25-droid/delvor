import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Wallet, Lock, Unlock, TrendingDown, TrendingUp, Loader2,
  Banknote, CreditCard, Smartphone, ArrowDownCircle, ArrowUpCircle,
  Calculator, AlertTriangle, CheckCircle2, X, ShoppingCart, Zap, FileText, Users,
  Printer, ChevronDown, ChevronUp, Receipt,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

import { formatBRL } from "@/lib/formatters";
import {
  getOpenSession, openSession, addMovement, getSummary, closeSession, listMovements,
  getSessionSales,
  type CashSession, type CashSummary, type CashMovement, type SessionSale,
} from "@/lib/cashRegister";
import { generateCashSessionPdf } from "@/lib/cashSessionPdf";
import { loadCompanyHeader, imageToDataUrl } from "@/lib/companyInfo";
import Sales from "@/pages/Sales";
import QuickSaleTab from "@/components/pdv/QuickSaleTab";
import CashAdminTab from "@/components/pdv/CashAdminTab";
import { usePermissions } from "@/hooks/usePermissions";

function moneyInput(v: string): number {
  const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

type PdvTab = "caixa" | "vender" | "vendas" | "caixas";

/* ====================================================================
   SHELL COM ABAS
==================================================================== */
export default function PDV() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const perms = usePermissions();
  const tab = (searchParams.get("tab") as PdvTab) || "vender";

  function setTab(t: PdvTab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    setSearchParams(next, { replace: true });
  }

  /* Atalhos globais do PDV: F4 = venda rápida · F6 = venda completa */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F4") {
        e.preventDefault();
        setTab("vender");
      } else if (e.key === "F6") {
        e.preventDefault();
        navigate("/sales/new");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="h-7 w-7" /> PDV
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Controle de caixa e vendas no mesmo lugar.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/sales/new")}>
          <FileText className="h-4 w-4 mr-2" /> Venda completa
          <kbd className="ml-2 text-[10px] font-mono bg-muted rounded px-1.5 py-0.5">F6</kbd>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as PdvTab)}>
        <TabsList>
          <TabsTrigger value="caixa">
            <Wallet className="h-3.5 w-3.5 mr-1" /> Caixa
          </TabsTrigger>
          <TabsTrigger value="vender">
            <Zap className="h-3.5 w-3.5 mr-1" /> Vender
            <kbd className="ml-1.5 text-[9px] font-mono opacity-60">F4</kbd>
          </TabsTrigger>
          <TabsTrigger value="vendas">
            <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Vendas
          </TabsTrigger>
          {perms.isManager && (
            <TabsTrigger value="caixas">
              <Users className="h-3.5 w-3.5 mr-1" /> Caixas da equipe
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="caixa" className="mt-6">
          <CashTab onOpened={() => setTab("vender")} />
        </TabsContent>
        <TabsContent value="vender" className="mt-6">
          {/* onSold: fica na aba pra agilizar a próxima venda — carrinho já limpa sozinho */}
          <QuickSaleTab onSold={() => { /* noop — pronto pra próxima venda */ }} />
        </TabsContent>
        <TabsContent value="vendas" className="mt-6">
          <Sales embedded />
        </TabsContent>
        {perms.isManager && (
          <TabsContent value="caixas" className="mt-6">
            <CashAdminTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/* ====================================================================
   ABA CAIXA
==================================================================== */
function CashTab({ onOpened }: { onOpened?: () => void }) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<CashSession | null>(null);
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);

  // Abrir caixa
  const [openAmount, setOpenAmount] = useState("");
  const [opening, setOpening] = useState(false);

  // Sangria / Suprimento
  const [movOpen, setMovOpen] = useState<"sangria" | "suprimento" | null>(null);
  const [movAmount, setMovAmount] = useState("");
  const [movReason, setMovReason] = useState("");
  const [movBusy, setMovBusy] = useState(false);

  // Fechar caixa
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeAmount, setCloseAmount] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  // Resultado do fechamento — usado pra renderizar o relatório completo
  // (vendas, quebra por método, movimentos, diferença) e oferecer impressão.
  const [closeResult, setCloseResult] = useState<{
    sessionId: string;
    sessionSnapshot: CashSession;
    summary: CashSummary;
    expected: number;
    counted: number;
    diff: number;
  } | null>(null);

  /* ─────── LOAD ─────── */
  async function load() {
    if (!user?.id) return;
    setLoading(true);
    const s = await getOpenSession(user.id);
    setSession(s);
    if (s) {
      const [sum, movs] = await Promise.all([getSummary(s.id), listMovements(s.id)]);
      setSummary(sum);
      setMovements(movs);
    } else {
      setSummary(null);
      setMovements([]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  /* ─────── ABRIR ─────── */
  async function handleOpen() {
    if (!companyId || !user?.id) return;
    const amount = moneyInput(openAmount);
    setOpening(true);
    const r = await openSession({ companyId, userId: user.id, openingAmount: amount });
    setOpening(false);
    if (!r.ok) {
      toast({ title: "Erro ao abrir caixa", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Caixa aberto", description: `Fundo de troco: ${formatBRL(amount)}` });
    setOpenAmount("");
    await load();
    // Caixa aberto → leva direto pra tela de venda
    onOpened?.();
  }

  /* ─────── SANGRIA / SUPRIMENTO ─────── */
  async function handleMovement() {
    if (!session || !companyId || !movOpen) return;
    const amount = moneyInput(movAmount);
    if (amount <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    setMovBusy(true);
    const r = await addMovement({
      sessionId: session.id,
      companyId,
      type: movOpen,
      amount,
      reason: movReason.trim() || undefined,
      userId: user?.id,
    });
    setMovBusy(false);
    if (!r.ok) {
      toast({ title: "Erro", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: movOpen === "sangria" ? "Sangria registrada" : "Suprimento registrado" });
    setMovOpen(null);
    setMovAmount("");
    setMovReason("");
    load();
  }

  /* ─────── FECHAR ─────── */
  async function handleClose() {
    if (!session) return;
    const counted = moneyInput(closeAmount);
    setCloseBusy(true);
    const r = await closeSession({ sessionId: session.id, closingAmount: counted });
    setCloseBusy(false);
    if (!r.ok) {
      toast({ title: "Erro ao fechar", description: r.error, variant: "destructive" });
      return;
    }
    const expected = r.summary?.expected_cash ?? 0;
    // Snapshot da sessão pré-fechamento + closing_amount fresco — usado no
    // relatório (mostra horários, fundo, vendedor mesmo depois de session=null)
    const snapshot: CashSession = {
      ...session,
      status: "fechado",
      closed_at: new Date().toISOString(),
      closing_amount: counted,
      expected_cash: expected,
      difference: counted - expected,
    };
    setCloseResult({
      sessionId: session.id,
      sessionSnapshot: snapshot,
      summary: r.summary || {
        total_sales: 0, sales_count: 0,
        cash_in: 0, card_in: 0, pix_in: 0, other_in: 0,
        suprimentos: 0, sangrias: 0, expected_cash: 0,
      },
      expected,
      counted,
      diff: counted - expected,
    });
    setCloseOpen(false);
    setCloseAmount("");
    // Limpa o estado local: a sessão agora está fechada no banco.
    // Sem isso, a tela continuaria mostrando "Caixa aberto" até dar refresh
    // (porque a condição `if (!session)` em RENDER só responde a esse state).
    setSession(null);
    setSummary(null);
    setMovements([]);
  }

  /* ─────── RENDER ─────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando caixa...
      </div>
    );
  }

  /* ════════ SEM CAIXA ABERTO — tela de abertura ════════ */
  if (!session) {
    return (
      <div className="space-y-6">
        <div className="max-w-md mx-auto mt-4 rounded-xl border bg-card p-6 text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center mx-auto">
            <Lock className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Caixa fechado</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Informe o valor do fundo de troco pra abrir o caixa.
            </p>
          </div>
          <div className="space-y-1.5 text-left">
            <Label htmlFor="open-amount" className="text-xs">Fundo de troco (R$)</Label>
            <Input
              id="open-amount"
              inputMode="decimal"
              placeholder="0,00"
              value={openAmount}
              onChange={(e) => setOpenAmount(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleOpen(); }}
            />
          </div>
          <Button className="w-full" onClick={handleOpen} disabled={opening}>
            {opening ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlock className="h-4 w-4 mr-2" />}
            Abrir caixa
          </Button>
        </div>

        {/* Resultado de fechamento recente */}
        {closeResult && (
          <CloseResultCard
            result={closeResult}
            onDismiss={() => setCloseResult(null)}
            vendorName={user?.nome || user?.email || "Vendedor"}
            companyId={user?.company_id || null}
          />
        )}
      </div>
    );
  }

  /* ════════ CAIXA ABERTO ════════ */
  const expectedCash = summary?.expected_cash ?? session.opening_amount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Caixa do dia</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Aberto desde {new Date(session.opened_at).toLocaleString("pt-BR")} ·
            fundo {formatBRL(session.opening_amount)}
          </p>
        </div>
        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
          <CheckCircle2 className="h-3 w-3" /> Caixa aberto
        </Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Calculator} label="Vendas" value={formatBRL(summary?.total_sales ?? 0)}
          sub={`${summary?.sales_count ?? 0} venda(s)`} />
        <KpiCard icon={Banknote} label="Dinheiro" value={formatBRL(summary?.cash_in ?? 0)} tone="emerald" />
        <KpiCard icon={CreditCard} label="Cartão" value={formatBRL(summary?.card_in ?? 0)} tone="sky" />
        <KpiCard icon={Smartphone} label="Pix" value={formatBRL(summary?.pix_in ?? 0)} tone="violet" />
      </div>

      {/* Saldo esperado em dinheiro */}
      <div className="rounded-lg border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Esperado em dinheiro no caixa</div>
          <div className="text-2xl font-bold mt-1">{formatBRL(expectedCash)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Fundo {formatBRL(session.opening_amount)} + Dinheiro {formatBRL(summary?.cash_in ?? 0)}
            {" "}+ Suprimentos {formatBRL(summary?.suprimentos ?? 0)}
            {" "}− Sangrias {formatBRL(summary?.sangrias ?? 0)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setMovOpen("suprimento"); setMovAmount(""); setMovReason(""); }}>
            <ArrowUpCircle className="h-4 w-4 mr-1 text-emerald-500" /> Suprimento
          </Button>
          <Button variant="outline" onClick={() => { setMovOpen("sangria"); setMovAmount(""); setMovReason(""); }}>
            <ArrowDownCircle className="h-4 w-4 mr-1 text-rose-500" /> Sangria
          </Button>
          <Button onClick={() => { setCloseAmount(""); setCloseOpen(true); }}>
            <Lock className="h-4 w-4 mr-1" /> Fechar caixa
          </Button>
        </div>
      </div>

      {/* Movimentos */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b text-sm font-semibold">Sangrias e Suprimentos</div>
        {movements.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma movimentação registrada.
          </div>
        ) : (
          <div className="divide-y">
            {movements.map((m) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  {m.type === "suprimento"
                    ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                    : <TrendingDown className="h-4 w-4 text-rose-500" />}
                  <span className="font-medium capitalize">{m.type}</span>
                  {m.reason && <span className="text-muted-foreground">— {m.reason}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono font-semibold ${m.type === "suprimento" ? "text-emerald-400" : "text-rose-400"}`}>
                    {m.type === "suprimento" ? "+" : "−"}{formatBRL(m.amount)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DIALOG: Sangria/Suprimento */}
      <Dialog open={!!movOpen} onOpenChange={(o) => { if (!o) setMovOpen(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {movOpen === "suprimento"
                ? <><ArrowUpCircle className="h-5 w-5 text-emerald-500" /> Suprimento</>
                : <><ArrowDownCircle className="h-5 w-5 text-rose-500" /> Sangria</>}
            </DialogTitle>
            <DialogDescription>
              {movOpen === "suprimento"
                ? "Entrada de dinheiro no caixa (ex: troco trazido)."
                : "Retirada de dinheiro do caixa (ex: depósito, pagamento)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Valor (R$)</Label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={movAmount}
                onChange={(e) => setMovAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo (opcional)</Label>
              <Input
                placeholder="Ex: depósito bancário"
                value={movReason}
                onChange={(e) => setMovReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovOpen(null)}>Cancelar</Button>
            <Button onClick={handleMovement} disabled={movBusy}>
              {movBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Fechar caixa */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" /> Fechar caixa
            </DialogTitle>
            <DialogDescription>
              Conte o dinheiro físico na gaveta e informe o total.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Esperado em dinheiro</span>
                <span className="font-mono font-semibold">{formatBRL(expectedCash)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total de vendas</span>
                <span>{formatBRL(summary?.total_sales ?? 0)}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Dinheiro contado na gaveta (R$)</Label>
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
                Math.abs(moneyInput(closeAmount) - expectedCash) < 0.01
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "bg-amber-500/10 text-amber-300"
              }`}>
                Diferença: {formatBRL(moneyInput(closeAmount) - expectedCash)}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Cancelar</Button>
            <Button onClick={handleClose} disabled={closeBusy || !closeAmount}>
              {closeBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
              Confirmar fechamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ──────────── COMPONENTES ──────────── */
function KpiCard({ icon: Icon, label, value, sub, tone }: {
  icon: any; label: string; value: string; sub?: string; tone?: string;
}) {
  const toneClass: Record<string, string> = {
    emerald: "text-emerald-400",
    sky: "text-sky-400",
    violet: "text-blue-400",
  };
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${tone ? toneClass[tone] : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Relatório de fechamento — mostra logo após o fechamento do caixa.
 * Inclui:
 *  - Resumo de vendas (qtd + total)
 *  - Quebra por forma de pagamento (PIX, cartão, dinheiro, outros)
 *  - Movimentos (fundo, sangrias, suprimentos)
 *  - Conferência: esperado vs contado vs diferença
 *  - Lista expandível de vendas individuais
 *  - Botão pra gerar PDF do relatório
 */
function CloseResultCard({ result, onDismiss, vendorName, companyId }: {
  result: {
    sessionId: string;
    sessionSnapshot: CashSession;
    summary: CashSummary;
    expected: number;
    counted: number;
    diff: number;
  };
  onDismiss: () => void;
  vendorName: string;
  companyId: string | null;
}) {
  const ok = Math.abs(result.diff) < 0.01;
  const { summary, sessionSnapshot } = result;
  const [salesOpen, setSalesOpen] = useState(false);
  const [sales, setSales] = useState<SessionSale[] | null>(null);
  const [printing, setPrinting] = useState(false);

  async function loadSalesIfNeeded() {
    if (sales) return sales;
    const s = await getSessionSales(result.sessionId);
    setSales(s);
    return s;
  }

  async function handlePrint(mode: "download" | "print") {
    setPrinting(true);
    try {
      // Carrega vendas (pra incluir no PDF) + cabeçalho da empresa em paralelo
      const [allSales, company] = await Promise.all([
        loadSalesIfNeeded(),
        companyId ? loadCompanyHeader(companyId) : Promise.resolve(null),
      ]);
      const logoData = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;
      generateCashSessionPdf({
        sessionId: result.sessionId,
        vendor: vendorName,
        openedAt: sessionSnapshot.opened_at,
        closedAt: sessionSnapshot.closed_at || new Date().toISOString(),
        openingAmount: sessionSnapshot.opening_amount,
        closingAmount: result.counted,
        expectedCash: result.expected,
        difference: result.diff,
        summary,
        sales: allSales || undefined,
        company,
        companyLogoDataUrl: logoData,
        output: mode,
      });
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* HEADER — status do fechamento */}
      <div className={`rounded-xl border p-4 ${
        ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {ok
              ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              : <AlertTriangle className="h-5 w-5 text-amber-400" />}
            <h3 className="font-semibold text-lg">
              {ok ? "Caixa fechado — conferido!" : "Caixa fechado com diferença"}
            </h3>
          </div>
          <button onClick={onDismiss} className="opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* RESUMO DE VENDAS */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Vendas do dia
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Quantidade</div>
            <div className="text-2xl font-bold">{summary.sales_count}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total vendido</div>
            <div className="text-2xl font-bold font-mono">{formatBRL(summary.total_sales)}</div>
          </div>
        </div>
      </div>

      {/* QUEBRA POR MÉTODO */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          Por forma de pagamento
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PaymentBox icon={Banknote} color="text-emerald-400" label="Dinheiro" value={summary.cash_in} />
          <PaymentBox icon={Smartphone} color="text-sky-400" label="PIX" value={summary.pix_in} />
          <PaymentBox icon={CreditCard} color="text-blue-400" label="Cartão" value={summary.card_in} />
          <PaymentBox icon={FileText} color="text-zinc-400" label="Outros" value={summary.other_in} />
        </div>
      </div>

      {/* MOVIMENTOS */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          Movimentações
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fundo de troco (abertura)</span>
            <span className="font-mono">{formatBRL(sessionSnapshot.opening_amount)}</span>
          </div>
          <div className="flex justify-between text-emerald-300">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Suprimentos
            </span>
            <span className="font-mono">+ {formatBRL(summary.suprimentos)}</span>
          </div>
          <div className="flex justify-between text-rose-300">
            <span className="flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5" /> Sangrias
            </span>
            <span className="font-mono">− {formatBRL(summary.sangrias)}</span>
          </div>
        </div>
      </div>

      {/* CONFERÊNCIA */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          Conferência de dinheiro
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Esperado em caixa</span>
            <span className="font-mono">{formatBRL(result.expected)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Contado físico</span>
            <span className="font-mono">{formatBRL(result.counted)}</span>
          </div>
          <div className="border-t border-border/40 pt-1.5 flex justify-between font-semibold">
            <span>Diferença</span>
            <span className={`font-mono ${
              ok ? "text-emerald-400" : result.diff < 0 ? "text-rose-400" : "text-amber-400"
            }`}>
              {result.diff >= 0 ? "+" : "−"} {formatBRL(Math.abs(result.diff))}
            </span>
          </div>
        </div>
      </div>

      {/* VENDAS (expansível) */}
      <div className="rounded-xl border bg-card">
        <button
          onClick={async () => { if (!salesOpen) await loadSalesIfNeeded(); setSalesOpen((o) => !o); }}
          className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition rounded-xl"
        >
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Ver {summary.sales_count} venda{summary.sales_count !== 1 ? "s" : ""}</span>
          </div>
          {salesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {salesOpen && (
          <div className="border-t border-border/40 p-3 space-y-1">
            {sales === null ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Nenhuma venda nesta sessão.
              </div>
            ) : (
              sales.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/30 text-sm">
                  <span className="text-xs font-mono text-muted-foreground w-12">
                    {new Date(s.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-xs font-mono w-16">#{String(s.number).padStart(6, "0")}</span>
                  <span className="flex-1 truncate">{s.customer_name || "—"}</span>
                  <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                  <span className="font-mono font-semibold w-24 text-right">{formatBRL(s.total)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* AÇÕES */}
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" onClick={() => handlePrint("download")} disabled={printing}>
          {printing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
          Baixar PDF
        </Button>
        <Button onClick={() => handlePrint("print")} disabled={printing}>
          {printing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
          Imprimir
        </Button>
        <Button variant="ghost" onClick={onDismiss}>Fechar</Button>
      </div>
    </div>
  );
}

/** Card compacto pra um método de pagamento. */
function PaymentBox({ icon: Icon, color, label, value }: {
  icon: any; color: string; label: string; value: number;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className={`flex items-center gap-2 ${color}`}>
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1 font-mono font-bold text-lg">{formatBRL(value)}</div>
    </div>
  );
}
