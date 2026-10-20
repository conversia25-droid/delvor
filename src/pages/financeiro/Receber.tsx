import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  HandCoins, Loader2, AlertTriangle, CalendarClock, CheckCircle2, Undo2, Search, Zap, Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import MoneyInput from "@/components/MoneyInput";
import { formatBRL } from "@/lib/formatters";
import { getOpenSession, type CashSession } from "@/lib/cashRegister";
import { useReceivablesOverview } from "@/hooks/useReceivablesOverview";
import {
  METHOD_LABELS, addDaysISO, daysUntil, listReceivables, localISODate,
  registerReceipts, revertReceipt, type Receivable,
} from "@/lib/receivables";

/* ---------- helpers ---------- */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function fmtDateTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("pt-BR");
}
function saleNo(n: number) {
  return `#${String(n).padStart(6, "0")}`;
}

type OpenFilter = "todos" | "vencidos" | "hoje" | "semana";
type PaidPeriod = "mes" | "mes_passado" | "90d";

function paidRange(p: PaidPeriod): { from: string; to: string } {
  const now = new Date();
  const today = localISODate(now);
  if (p === "mes_passado") {
    return {
      from: localISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: localISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  if (p === "90d") return { from: addDaysISO(-90), to: today };
  return { from: localISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

/** Pílula de vencimento: estado em forma (cor) além do número. */
function DuePill({ due }: { due: string | null }) {
  if (!due) return <span className="text-xs text-muted-foreground">sem vencimento</span>;
  const d = daysUntil(due);
  if (d < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-400">
        <AlertTriangle className="h-3 w-3" /> venceu há {-d} dia{d === -1 ? "" : "s"}
      </span>
    );
  }
  if (d === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
        <CalendarClock className="h-3 w-3" /> vence hoje
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">em {d} dia{d === 1 ? "" : "s"}</span>;
}

function Tile({
  label, value, sub, tone, active, onClick,
}: {
  label: string; value: string; sub?: string;
  tone: "rose" | "amber" | "sky" | "default" | "emerald";
  active?: boolean; onClick?: () => void;
}) {
  const tones = {
    rose: "text-rose-400", amber: "text-amber-400", sky: "text-sky-400",
    emerald: "text-emerald-400", default: "text-foreground",
  } as const;
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-lg border bg-card p-4 text-left transition ${
        onClick ? "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" : ""
      } ${active ? "ring-2 ring-primary" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Comp>
  );
}

const METHOD_FILTERS = [
  { key: "todas", label: "Todas as formas" },
  { key: "boleto", label: "Boleto" },
  { key: "crediario", label: "Crediário" },
  { key: "transferencia", label: "Transferência" },
  { key: "cartao_credito", label: "Cartão crédito" },
  { key: "outras", label: "Outras" },
];
const MAIN_METHODS = ["boleto", "crediario", "transferencia", "cartao_credito"];

export default function Receber() {
  const { user } = useAuth();
  const { toast } = useToast();
  const overview = useReceivablesOverview(true);

  const [tab, setTab] = useState<"aberto" | "recebidos">("aberto");
  const [period, setPeriod] = useState<PaidPeriod>("mes");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("todos");
  const [method, setMethod] = useState("todas");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // diálogo de baixa
  const [baixaIds, setBaixaIds] = useState<string[] | null>(null);
  const [paidOn, setPaidOn] = useState(localISODate());
  const [received, setReceived] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [cash, setCash] = useState<CashSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = paidRange(period);
    const { data, error } = await listReceivables(r.from, r.to);
    setRows(data);
    setLoadError(error);
    setLoading(false);
    setSelected((prev) => new Set([...prev].filter((id) => data.some((x) => x.id === id && x.status !== "pago"))));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  /* ---------- filtros ---------- */
  const matchesCommon = useCallback((r: Receivable) => {
    if (method === "outras" && MAIN_METHODS.includes(r.method)) return false;
    if (method !== "todas" && method !== "outras" && r.method !== method) return false;
    const term = q.trim().toLowerCase();
    if (term) {
      const hay = `${r.customer_name || ""} ${r.sale_number} ${saleNo(r.sale_number)}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }, [method, q]);

  const openRows = useMemo(() => rows.filter((r) => {
    if (r.status === "pago" || !matchesCommon(r)) return false;
    if (openFilter === "todos") return true;
    if (!r.due_date) return false;
    const d = daysUntil(r.due_date);
    if (openFilter === "vencidos") return d < 0;
    if (openFilter === "hoje") return d === 0;
    return d > 0 && d <= 7;
  }), [rows, matchesCommon, openFilter]);

  const paidRows = useMemo(
    () => rows.filter((r) => r.status === "pago" && matchesCommon(r))
      .sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || "")),
    [rows, matchesCommon],
  );

  const openCount = useMemo(() => rows.filter((r) => r.status !== "pago").length, [rows]);
  const paidTotals = useMemo(() => paidRows.reduce(
    (t, r) => ({
      gross: t.gross + r.amount,
      net: t.net + (r.received_amount ?? r.amount),
      fee: t.fee + r.fee_amount,
    }),
    { gross: 0, net: 0, fee: 0 },
  ), [paidRows]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const selectedGross = selectedRows.reduce((s, r) => s + r.amount, 0);
  const allVisibleSelected = openRows.length > 0 && openRows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) openRows.forEach((r) => next.delete(r.id));
      else openRows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  /* ---------- baixa ---------- */
  const baixaRows = useMemo(
    () => (baixaIds ? rows.filter((r) => baixaIds.includes(r.id)) : []),
    [baixaIds, rows],
  );
  const baixaGross = baixaRows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((received - baixaGross) * 100) / 100;

  async function openBaixa(ids: string[]) {
    const gross = rows.filter((r) => ids.includes(r.id)).reduce((s, r) => s + r.amount, 0);
    setBaixaIds(ids);
    setPaidOn(localISODate());
    setReceived(gross);
    setNote("");
    setCash(user?.id ? await getOpenSession(user.id) : null);
  }

  async function confirmBaixa() {
    if (!baixaIds) return;
    if (received <= 0) {
      toast({ title: "Informe o valor recebido", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { result, error } = await registerReceipts({
      ids: baixaIds,
      paidOn,
      receivedTotal: Math.abs(diff) < 0.005 ? null : received,
      notes: note,
    });
    setSaving(false);
    if (error || !result) {
      toast({ title: "Não foi possível dar baixa", description: error || undefined, variant: "destructive" });
      return;
    }
    toast({
      title: "Baixa registrada",
      description:
        `${result.updated_count} pagamento${result.updated_count > 1 ? "s" : ""}, ${formatBRL(result.received_total)} recebido` +
        (result.fee_total > 0 ? ` (taxa ${formatBRL(result.fee_total)})` : "") +
        (result.cash_session_id ? ". Entrou no seu caixa aberto." : ". Sem caixa aberto: conta no recebido, fora do caixa."),
    });
    setBaixaIds(null);
    setSelected(new Set());
    load();
  }

  async function undo(r: Receivable) {
    const ok = window.confirm(
      `Desfazer a baixa de ${formatBRL(r.received_amount ?? r.amount)} (${r.customer_name || "cliente"}, venda ${saleNo(r.sale_number)})?\n\nO pagamento volta para Em aberto.`,
    );
    if (!ok) return;
    const { error } = await revertReceipt(r.id);
    if (error) {
      toast({ title: "Não foi possível desfazer", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Baixa desfeita", description: "O pagamento voltou para Em aberto." });
    load();
  }

  const antecipadoPct = overview && overview.anticipated_month_gross > 0
    ? (overview.fees_month / overview.anticipated_month_gross) * 100
    : 0;

  /* ---------- render ---------- */
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <HandCoins className="h-6 w-6 text-primary" /> Contas a receber
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Boleto, crediário, transferência e cartão de crédito ficam aqui até alguém dar baixa.
          Só depois da baixa o valor conta como recebido e entra no caixa de quem deu baixa.
        </p>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile
          label="Vencidos"
          tone={overview && overview.overdue_count > 0 ? "rose" : "default"}
          value={overview ? formatBRL(overview.overdue_total) : "—"}
          sub={overview ? `${overview.overdue_count} pagamento${overview.overdue_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "vencidos"}
          onClick={() => { setTab("aberto"); setOpenFilter("vencidos"); }}
        />
        <Tile
          label="Vencem hoje"
          tone={overview && overview.due_today_count > 0 ? "amber" : "default"}
          value={overview ? formatBRL(overview.due_today_total) : "—"}
          sub={overview ? `${overview.due_today_count} pagamento${overview.due_today_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "hoje"}
          onClick={() => { setTab("aberto"); setOpenFilter("hoje"); }}
        />
        <Tile
          label="Próximos 7 dias"
          tone="sky"
          value={overview ? formatBRL(overview.next7_total) : "—"}
          active={tab === "aberto" && openFilter === "semana"}
          onClick={() => { setTab("aberto"); setOpenFilter("semana"); }}
        />
        <Tile
          label="Total em aberto"
          tone="default"
          value={overview ? formatBRL(overview.open_total) : "—"}
          sub={overview ? `${overview.open_count} pagamento${overview.open_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "todos"}
          onClick={() => { setTab("aberto"); setOpenFilter("todos"); }}
        />
        <Tile
          label="Recebido no mês"
          tone="emerald"
          value={overview ? formatBRL(overview.received_month) : "—"}
          sub={overview && overview.anticipated_month_count > 0
            ? `Cartão antecipado: ${formatBRL(overview.anticipated_month_gross)} · taxa ${formatBRL(overview.fees_month)} (${antecipadoPct.toFixed(1).replace(".", ",")}%)`
            : overview && overview.fees_month > 0
              ? `Taxas no mês: ${formatBRL(overview.fees_month)}`
              : undefined}
          onClick={() => { setTab("recebidos"); setPeriod("mes"); }}
        />
      </div>

      {/* Abas */}
      <div className="flex flex-wrap items-center gap-2 border-b">
        {([
          ["aberto", `Em aberto${openCount ? ` (${openCount})` : ""}`],
          ["recebidos", "Recebidos"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {tab === "aberto" ? (
          ([
            ["todos", "Todos"], ["vencidos", "Vencidos"], ["hoje", "Vencem hoje"], ["semana", "Próximos 7 dias"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setOpenFilter(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                openFilter === k ? "bg-primary text-primary-foreground ring-primary" : "ring-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))
        ) : (
          ([
            ["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90d", "Últimos 90 dias"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                period === k ? "bg-primary text-primary-foreground ring-primary" : "ring-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))
        )}
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
          aria-label="Forma de pagamento"
        >
          {METHOD_FILTERS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cliente ou nº da venda"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Barra de seleção */}
      {tab === "aberto" && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
          <span>
            <strong>{selected.size}</strong> selecionado{selected.size > 1 ? "s" : ""} ·{" "}
            <strong className="tabular-nums">{formatBRL(selectedGross)}</strong>
          </span>
          <Button size="sm" className="ml-auto" onClick={() => openBaixa([...selected])}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Dar baixa nos selecionados
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…
          </div>
        ) : loadError ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            {loadError.includes("permissão")
              ? "Você não tem acesso ao financeiro. Peça a um administrador o papel Financeiro, Gerente ou Admin."
              : `Não foi possível carregar: ${loadError}`}
          </div>
        ) : tab === "aberto" ? (
          openRows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">
              {openFilter === "vencidos" ? "Nada vencido." : "Nenhum pagamento em aberto com esses filtros."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Selecionar todos" />
                  </TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Venda</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openRows.map((r) => {
                  const overdue = !!r.due_date && daysUntil(r.due_date) < 0;
                  return (
                    <TableRow key={r.id} className={overdue ? "bg-rose-500/[0.04]" : ""}>
                      <TableCell>
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="Selecionar" />
                      </TableCell>
                      <TableCell>
                        <div className="tabular-nums">{fmtDate(r.due_date)}</div>
                        <DuePill due={r.due_date} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.customer_name || "—"}</div>
                        {r.seller_name && <div className="text-xs text-muted-foreground">vendedor: {r.seller_name}</div>}
                      </TableCell>
                      <TableCell>
                        <Link to={`/sales/${r.sale_id}`} className="tabular-nums text-primary hover:underline">
                          {saleNo(r.sale_number)}
                        </Link>
                      </TableCell>
                      <TableCell>{METHOD_LABELS[r.method] || r.method}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatBRL(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openBaixa([r.id])}>Dar baixa</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : paidRows.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">Nenhuma baixa nesse período.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recebido em</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Venda</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead>Caixa</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidRows.map((r) => {
                const closed = r.cash_session_id && r.cash_session_open === false;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="tabular-nums">{fmtDateTime(r.paid_at)}</div>
                      {r.paid_by_name && <div className="text-xs text-muted-foreground">por {r.paid_by_name}</div>}
                    </TableCell>
                    <TableCell className="font-medium">{r.customer_name || "—"}</TableCell>
                    <TableCell>
                      <Link to={`/sales/${r.sale_id}`} className="tabular-nums text-primary hover:underline">
                        {saleNo(r.sale_number)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span>{METHOD_LABELS[r.method] || r.method}</span>
                      {r.anticipated && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                          <Zap className="h-2.5 w-2.5" /> antecipado
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatBRL(r.amount)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatBRL(r.received_amount ?? r.amount)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${r.fee_amount > 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                      {r.fee_amount > 0 ? `−${formatBRL(r.fee_amount)}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {!r.cash_session_id ? (
                        <span className="text-muted-foreground">fora do caixa</span>
                      ) : r.cash_session_open ? (
                        <span className="text-emerald-400">caixa aberto</span>
                      ) : (
                        <span className="text-muted-foreground">caixa fechado</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!closed}
                        title={closed ? "Entrou num caixa já fechado; não dá para desfazer." : "Volta para Em aberto"}
                        onClick={() => undo(r)}
                      >
                        <Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/30 font-medium">
                <TableCell colSpan={4}>Total ({paidRows.length})</TableCell>
                <TableCell className="text-right tabular-nums">{formatBRL(paidTotals.gross)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBRL(paidTotals.net)}</TableCell>
                <TableCell className="text-right tabular-nums text-rose-400">
                  {paidTotals.fee > 0 ? `−${formatBRL(paidTotals.fee)}` : "—"}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      {/* Diálogo de baixa */}
      <Dialog open={!!baixaIds} onOpenChange={(o) => { if (!o) setBaixaIds(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {baixaRows.length > 1 ? `Dar baixa em ${baixaRows.length} pagamentos` : "Dar baixa"}
            </DialogTitle>
            <DialogDescription>
              {baixaRows.length === 1
                ? `${baixaRows[0].customer_name || "Cliente"} · venda ${saleNo(baixaRows[0].sale_number)} · ${METHOD_LABELS[baixaRows[0].method] || baixaRows[0].method}`
                : `${new Set(baixaRows.map((r) => r.customer_name)).size} cliente(s)`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-baseline justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Valor bruto</span>
              <span className="font-mono font-semibold">{formatBRL(baixaGross)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data do recebimento</Label>
                <Input type="date" value={paidOn} max={localISODate()} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor que caiu</Label>
                <MoneyInput value={received} onChange={setReceived} className="text-right" />
              </div>
            </div>

            {diff < -0.004 && (
              <p className="text-xs text-rose-400">
                Taxa / desconto: {formatBRL(-diff)} ({((-diff / baixaGross) * 100).toFixed(2).replace(".", ",")}%)
                {baixaRows.some((r) => r.method === "cartao_credito") ? ". Se for antecipação, fica marcado como antecipado." : ""}
              </p>
            )}
            {diff > 0.004 && (
              <p className="text-xs text-emerald-400">Juros / multa: +{formatBRL(diff)}</p>
            )}
            {Math.abs(diff) <= 0.004 && (
              <p className="text-xs text-muted-foreground">
                Cartão antecipado ou com taxa? Informe o valor líquido que caiu; a diferença fica registrada como taxa.
              </p>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Observação <span className="text-muted-foreground">(opcional)</span></Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: antecipação Cielo, comprovante 123" />
            </div>

            <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {cash ? (
                <span>
                  Entra no seu caixa aberto desde{" "}
                  {new Date(cash.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
                  No fechamento aparece em cartão/outros, sem mexer no dinheiro contado.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Você não tem caixa aberto. A baixa conta como recebido, mas não entra em nenhum caixa.
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBaixaIds(null)}>Cancelar</Button>
            <Button onClick={confirmBaixa} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Confirmar baixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
