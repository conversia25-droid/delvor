import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  ShoppingCart,
  RefreshCw,
  TrendingUp,
  FileText,
  CheckCircle2,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Sale, SaleStatus } from "@/types/delvor";
import { SALE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import MiniBars, { shortBRL, type MiniBar } from "@/components/charts/MiniBars";

type PendingPayment = {
  status: string;
  amount: number;
  due_date: string | null;
  method: string;
};

type SaleWithCustomer = Sale & {
  customers?: { name: string; trade_name: string | null } | null;
  sale_payments?: PendingPayment[] | null;
};

const METHOD_LABELS: Record<string, string> = {
  dinheiro:          "Dinheiro",
  pix:               "PIX",
  boleto:            "Boleto",
  cartao_credito:    "Cartão crédito",
  cartao_debito:     "Cartão débito",
  credito_avista:    "Crédito à vista",
  credito_parcelado: "Crédito parcelado",
  transferencia:     "Transferência",
  crediario:         "Crediário",
  outro:             "Outro",
};

/** Extrai info de pendência de uma venda: total em aberto + vencimento mais próximo. */
function computePending(sale: SaleWithCustomer) {
  const items = (sale.sale_payments || []).filter(
    (p) => p.status === "pendente" || p.status === "parcial"
  );
  if (items.length === 0) return null;
  const amount = items.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (amount <= 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const withDue = items.filter((p) => p.due_date);
  const overdue = withDue.some((p) => (p.due_date as string) < today);
  const nextDue = withDue
    .map((p) => p.due_date as string)
    .sort()[0] || null;
  // Métodos únicos pra mostrar como legenda ("PIX", "Boleto"...)
  const methods = Array.from(new Set(items.map((p) => METHOD_LABELS[p.method] || p.method)));
  return { amount, overdue, nextDue, methods };
}

type Period = "today" | "week" | "month" | "90d" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Hoje",
  week:  "Semana",
  month: "Mês",
  "90d": "90 dias",
  all:   "Tudo",
};

/** Data inicial do período (00:00 do dia X). Pra "all" retorna null = sem filtro. */
function periodStartDate(p: Period): Date | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "today") return d;
  if (p === "week") {
    // Domingo = 0; ajustar pra começar na segunda-feira da semana corrente
    const dow = d.getDay();
    const offset = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - offset);
    return d;
  }
  if (p === "month") {
    d.setDate(1);
    return d;
  }
  if (p === "90d") {
    d.setDate(d.getDate() - 90);
    return d;
  }
  return null;
}

interface SalesProps {
  embedded?: boolean;
  /** "vendas" (default) mostra vendas aprovadas/faturadas/entregues; "orcamentos"
   *  mostra só orcamento. É a mesma tela reaproveitada em duas rotas. */
  mode?: "vendas" | "orcamentos";
}

export default function Sales({ embedded = false, mode = "vendas" }: SalesProps = {}) {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const navigate = useNavigate();
  const isOrcamentos = mode === "orcamentos";

  const [items, setItems] = useState<SaleWithCustomer[]>([]);
  // KPIs ficam separados dos `items` porque a lista é paginada (500 mais recentes)
  // mas os indicadores precisam considerar TODAS as vendas da empresa.
  const [allSalesForStats, setAllSalesForStats] = useState<
    Pick<Sale, "status" | "total" | "issue_date">[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | SaleStatus>("all");
  const [filterPending, setFilterPending] = useState<"all" | "with" | "overdue">("all");
  // Default = "today" — Charles abre a tela e vê primeiro o que vendeu hoje.
  // Pode trocar pra Semana / Mês / 90 dias / Tudo no Tabs no topo.
  const [period, setPeriod] = useState<Period>("today");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    // Modo "vendas" exclui orçamentos (aparecem só na tela /orcamentos).
    // Modo "orcamentos" traz só orcamento.
    let listQ = supabase
      .from("sales" as any)
      .select("*, customers ( name, trade_name ), sale_payments ( status, amount, due_date, method )")
      .eq("company_id", companyId)
      .is("hidden_at", null);
    let statsQ = supabase
      .from("sales" as any)
      .select("status, total, issue_date")
      .eq("company_id", companyId)
      .is("hidden_at", null);
    if (isOrcamentos) {
      listQ = listQ.eq("status", "orcamento");
      statsQ = statsQ.eq("status", "orcamento");
    } else {
      listQ = listQ.neq("status", "orcamento");
      statsQ = statsQ.neq("status", "orcamento");
    }
    const [listResp, statsResp] = await Promise.all([
      listQ.order("issue_date", { ascending: false }).limit(500),
      statsQ.limit(50_000),  // sem isso o Supabase para em 1000 (default)
    ]);
    setLoading(false);
    if (listResp.error) {
      toast({ title: "Erro ao carregar", description: listResp.error.message, variant: "destructive" });
      return;
    }
    setItems((listResp.data as any[]) ?? []);
    setAllSalesForStats((statsResp.data as any[]) ?? []);
  }
  useEffect(() => { load(); }, [companyId]);

  /** ISO da data de início do período selecionado (pra comparar com issue_date). */
  const periodStartISO = useMemo(() => {
    const d = periodStartDate(period);
    return d ? d.toISOString().slice(0, 10) : null;
  }, [period]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      // 1. Período
      if (periodStartISO && s.issue_date < periodStartISO) return false;
      // 2. Status
      if (filterStatus !== "all" && s.status !== filterStatus) return false;
      // 3. Pendência (só com/só vencidas). Ignora canceladas/perdidas.
      if (filterPending !== "all") {
        if (s.status === "cancelado" || s.status === "perdido") return false;
        const pend = computePending(s);
        if (!pend) return false;
        if (filterPending === "overdue" && !pend.overdue) return false;
      }
      // 4. Busca textual
      if (!q) return true;
      const blob = [
        String(s.number),
        s.customers?.name,
        s.customers?.trade_name,
        s.notes,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterStatus, filterPending, periodStartISO]);

  /** KPIs do período selecionado (não mais sempre "do mês"). */
  const stats = useMemo(() => {
    const salesInPeriod = periodStartISO
      ? allSalesForStats.filter((s) => s.issue_date >= periodStartISO)
      : allSalesForStats;

    if (isOrcamentos) {
      // Em orçamentos: total do período, valor total, ticket médio.
      const total = salesInPeriod.length;
      const totalValue = salesInPeriod.reduce((sum, s) => sum + Number(s.total ?? 0), 0);
      const avgTicket = total ? totalValue / total : 0;
      return { open: total, invoiced: 0, periodRevenue: totalValue, avgTicket };
    }

    const open = salesInPeriod.filter((s) => s.status === "aprovado").length;
    const invoiced = salesInPeriod.filter((s) => s.status === "faturado" || s.status === "entregue");
    const periodRevenue = invoiced.reduce((sum, s) => sum + Number(s.total ?? 0), 0);
    const avgTicket = invoiced.length
      ? periodRevenue / invoiced.length
      : 0;
    return { open, invoiced: invoiced.length, periodRevenue, avgTicket };
  }, [allSalesForStats, periodStartISO, isOrcamentos]);

  /* Vendido ao longo do período: por dia até ~3 meses, por mês acima disso. */
  const soldSeries = useMemo<{ data: MiniBar[]; byMonth: boolean }>(() => {
    const inv = allSalesForStats.filter(
      (s) => (s.status === "faturado" || s.status === "entregue") && (!periodStartISO || s.issue_date >= periodStartISO),
    );
    const dates = inv.map((s) => s.issue_date.slice(0, 10)).sort();
    if (!dates.length) return { data: [], byMonth: false };
    const first = periodStartISO || dates[0];
    const spanDays = (Date.now() - new Date(first + "T12:00:00").getTime()) / 86_400_000;
    const byMonth = spanDays > 95;
    const sums = new Map<string, number>();
    for (const s of inv) {
      const k = byMonth ? s.issue_date.slice(0, 7) : s.issue_date.slice(0, 10);
      sums.set(k, (sums.get(k) || 0) + Number(s.total ?? 0));
    }
    // preenche os buracos pra não esconder dia/mês sem venda
    const keys: string[] = [];
    const cur = new Date(first + "T12:00:00");
    const end = new Date();
    if (byMonth) cur.setDate(1);
    while (cur <= end) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      keys.push(byMonth ? iso.slice(0, 7) : iso);
      if (byMonth) cur.setMonth(cur.getMonth() + 1); else cur.setDate(cur.getDate() + 1);
    }
    const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return {
      byMonth,
      data: keys.map((k) => ({
        key: k,
        label: byMonth ? `${MES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}`,
        detail: byMonth ? `${MES[Number(k.slice(5, 7)) - 1]} de ${k.slice(0, 4)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`,
        value: sums.get(k) || 0,
      })),
    };
  }, [allSalesForStats, periodStartISO]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {!embedded && (
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
              {isOrcamentos ? <FileText className="h-7 w-7" /> : <ShoppingCart className="h-7 w-7" />}
              {isOrcamentos ? "Orçamentos" : "Vendas"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isOrcamentos
                ? "Propostas em aberto. Quando aprovadas, viram vendas automaticamente."
                : "Pedidos aprovados, faturamento e entregas. Faturamento dá baixa automática no estoque."}
            </p>
          </div>
        )}
        <div className={`flex gap-2 ${embedded ? "ml-auto" : ""}`}>
          <Tabs value={period} onValueChange={(v: any) => setPeriod(v)}>
            <TabsList>
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <TabsTrigger key={p} value={p}>{PERIOD_LABELS[p]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => navigate(isOrcamentos ? "/orcamentos/new" : "/sales/new")}>
            <Plus className="h-4 w-4 mr-2" /> {isOrcamentos ? "Novo orçamento" : "Nova venda"}
          </Button>
        </div>
      </div>

      <div className={`grid gap-3 ${isOrcamentos ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" /> {isOrcamentos ? `Orçamentos (${PERIOD_LABELS[period].toLowerCase()})` : "Em aberto"}
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-1">{stats.open}</div>
        </div>
        {!isOrcamentos && (
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Faturadas</div>
            <div className="text-2xl font-semibold tracking-tight mt-1">{stats.invoiced}</div>
          </div>
        )}
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> {isOrcamentos ? `Valor total` : `Vendido (${PERIOD_LABELS[period].toLowerCase()})`}
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-1 text-emerald-700 dark:text-emerald-400">{formatBRL(stats.periodRevenue)}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Ticket médio</div>
          <div className="text-2xl font-semibold tracking-tight mt-1">{formatBRL(stats.avgTicket)}</div>
        </div>
      </div>

      {!isOrcamentos && (
        <MiniBars
          title={soldSeries.byMonth ? "Vendido por mês" : "Vendido por dia"}
          sub={PERIOD_LABELS[period].toLowerCase()}
          data={soldSeries.data}
          format={shortBRL}
          height={160}
          empty="Nenhuma venda faturada no período."
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número, cliente..." className="pl-9" />
        </div>
        {!isOrcamentos && (
          <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {(Object.keys(SALE_STATUS_LABELS) as SaleStatus[])
                .filter((s) => s !== "orcamento")
                .map((s) => (
                  <SelectItem key={s} value={s}>{SALE_STATUS_LABELS[s].label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filterPending} onValueChange={(v: any) => setFilterPending(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas (com/sem pend.)</SelectItem>
            <SelectItem value="with">Só com pendência</SelectItem>
            <SelectItem value="overdue">Só vencidas</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} de {items.length}</Badge>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Número</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-32">Emissão</TableHead>
              <TableHead className="w-36">Status</TableHead>
              <TableHead className="w-40 text-right">Pendências</TableHead>
              <TableHead className="w-32 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Nenhuma venda. <Link to="/sales/new" className="underline ml-1">Criar a primeira</Link>
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map((s) => {
              const meta = SALE_STATUS_LABELS[s.status];
              const pending = s.status === "cancelado" || s.status === "perdido"
                ? null
                : computePending(s);
              return (
                <TableRow
                  key={s.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => navigate(`/sales/${s.id}`)}
                >
                  <TableCell className="font-mono text-sm">#{String(s.number).padStart(6, "0")}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{s.customers?.name || "—"}</span>
                      {s.customers?.trade_name && (
                        <span className="text-xs text-muted-foreground">{s.customers.trade_name}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateBR(s.issue_date)}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {pending ? (
                      <div className="flex flex-col items-end">
                        <span className={`font-mono font-semibold ${pending.overdue ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}>
                          {formatBRL(pending.amount)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {pending.methods.join(" • ")}
                          {pending.nextDue && (
                            <>
                              {" · "}
                              {pending.overdue
                                ? `vencido ${formatDateBR(pending.nextDue)}`
                                : `vence ${formatDateBR(pending.nextDue)}`}
                            </>
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatBRL(s.total)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
