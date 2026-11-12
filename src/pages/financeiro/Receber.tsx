/* =====================================================================
   Contas a receber
   Boleto: A EMITIR → (registra emissão + PDF) → EMITIDO → (baixa + comprovante) → PAGO
   Demais formas pendentes (crediário, transferência, cartão crédito): baixa direta.
   Idêntico no Delvor e no InfnityServices.
===================================================================== */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  HandCoins, Loader2, AlertTriangle, CalendarClock, CheckCircle2, Undo2, Search, Zap, Wallet,
  MoreHorizontal, Paperclip, FileText, Copy, Send, MessageCircle, Receipt, History, Download,
} from "lucide-react";
import {
  ActiveFilterChips, FilterField, FilterSelect, FilterSummary, MoreFiltersButton, type ActiveFilter, type SummaryItem,
} from "@/components/filters/FilterBits";
import { downloadCSV } from "@/lib/reportExport";
import { HistoryDialog, ReasonDialog, type ReasonRequest } from "@/components/finance/Dialogs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MoneyInput from "@/components/MoneyInput";
import { AttachFileField, AttachmentsDialog } from "@/components/finance/Attachments";
import { formatBRL } from "@/lib/formatters";
import { getOpenSession, type CashSession } from "@/lib/cashRegister";
import { useReceivablesOverview } from "@/hooks/useReceivablesOverview";
import {
  METHOD_LABELS, addDaysISO, daysUntil, listReceivables, localISODate,
  registerReceipts, revertReceipt, type Receivable,
} from "@/lib/receivables";
import {
  boletoMessage, fetchAccountBalances, formatBoletoLine, markBoletoSent, registerBoletoIssue,
  registerPartialReceipt, revertBoletoIssue, uploadAttachment, type AccountBalance,
} from "@/lib/finance";

/* ---------- helpers ---------- */
function fmtDate(iso: string | null | undefined): string {
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
function daysSince(ts: string | null | undefined): number {
  if (!ts) return 0;
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - d.getTime()) / 86_400_000);
}
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
const isToIssue = (r: Receivable) => r.method === "boleto" && r.issue_status === "a_emitir" && r.status !== "pago";

type Tab = "emitir" | "aberto" | "recebidos" | "inadimplencia";
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

function DuePill({ due }: { due: string | null }) {
  if (!due) return <span className="text-xs text-muted-foreground">sem vencimento</span>;
  const d = daysUntil(due);
  if (d < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" /> venceu há {-d} dia{d === -1 ? "" : "s"}
      </span>
    );
  }
  if (d === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-400">
        <CalendarClock className="h-3 w-3" /> vence hoje
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">em {d} dia{d === 1 ? "" : "s"}</span>;
}

/** Estado do boleto na coluna Forma. */
function BoletoChips({ r }: { r: Receivable }) {
  if (r.method !== "boleto" || !r.issue_status) return null;
  if (r.issue_status === "a_emitir") {
    return <span className="ml-1.5 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-orange-700 dark:text-orange-400">a emitir</span>;
  }
  return (
    <>
      <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-foreground">emitido</span>
      {r.status !== "pago" && (
        r.sent_at
          ? <span className="ml-1 text-[10.5px] text-muted-foreground">enviado {fmtDateTime(r.sent_at)}</span>
          : <span className="ml-1 text-[10.5px] text-amber-800 dark:text-amber-400">não enviado</span>
      )}
    </>
  );
}

function Tile({
  label, value, sub, tone, active, onClick,
}: {
  label: string; value: string; sub?: string;
  tone: "crit" | "warn" | "serious" | "default" | "good";
  active?: boolean; onClick?: () => void;
}) {
  const dot = { crit: "bg-red-500", warn: "bg-amber-500", serious: "bg-orange-500", good: "bg-emerald-500", default: "" }[tone];
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-[10px] border bg-card p-4 text-left transition-colors ${
        onClick ? "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""
      } ${active ? "border-primary ring-1 ring-primary" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
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

/* ---------- filtros extras (lembrados por tela) ---------- */
const BOLETO_OPTIONS = [
  { value: "a_emitir", label: "A emitir" },
  { value: "emitido", label: "Emitido (todos)" },
  { value: "nao_enviado", label: "Emitido, não enviado" },
  { value: "enviado", label: "Enviado ao cliente" },
];
const ATTACH_OPTIONS = [{ value: "com", label: "Com anexo" }, { value: "sem", label: "Sem anexo" }];
type Extra = {
  method: string; customer: string; seller: string; dueFrom: string; dueTo: string;
  minV: string; maxV: string; boleto: string; attach: string;
};
const EMPTY_EXTRA: Extra = { method: "todas", customer: "", seller: "", dueFrom: "", dueTo: "", minV: "", maxV: "", boleto: "", attach: "" };
const STORE_KEY = "filtros:contas-receber";
function readStored(): Extra {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY_EXTRA;
    const o = JSON.parse(raw) || {};
    const extra = { ...EMPTY_EXTRA };
    for (const k of Object.keys(EMPTY_EXTRA) as (keyof Extra)[]) if (typeof o[k] === "string") extra[k] = o[k];
    if (!METHOD_FILTERS.some((m) => m.key === extra.method)) extra.method = "todas";
    return extra;
  } catch { return EMPTY_EXTRA; }
}
/** "1.234,56" / "1234.56" / "50" → número; vazio ou inválido → null. */
function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
function monthRange(offset: number) {
  const now = new Date();
  return {
    from: localISODate(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    to: localISODate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
  };
}
const customerKey = (r: Receivable) => r.customer_id || (r.customer_name ? `nome:${r.customer_name}` : "__none");
const csvMoney = (v: number) => v.toFixed(2).replace(".", ",");
const boletoSituation = (r: Receivable) =>
  r.method !== "boleto" || !r.issue_status ? ""
    : r.issue_status === "a_emitir" ? "a emitir"
    : r.sent_at ? "emitido, enviado" : "emitido, não enviado";

export default function Receber() {
  const { user } = useAuth();
  const { toast } = useToast();
  const overview = useReceivablesOverview(true);

  const [tab, setTab] = useState<Tab>("aberto");
  const [period, setPeriod] = useState<PaidPeriod>("mes");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("todos");
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState<Extra>(readStored);
  const setX = (patch: Partial<Extra>) => setExtra((prev) => ({ ...prev, ...patch }));
  const method = extra.method;
  const setMethod = (v: string) => setX({ method: v });
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(extra)); } catch { /* sem storage */ }
  }, [extra]);

  const [rows, setRows] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);

  // baixa
  const [baixaIds, setBaixaIds] = useState<string[] | null>(null);
  const [paidOn, setPaidOn] = useState(localISODate());
  const [received, setReceived] = useState(0);
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [cash, setCash] = useState<CashSession | null>(null);

  // emissão
  const [issueRow, setIssueRow] = useState<Receivable | null>(null);
  const [issueDue, setIssueDue] = useState("");
  const [issueLine, setIssueLine] = useState("");
  const [issueBank, setIssueBank] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [issueFile, setIssueFile] = useState<File | null>(null);
  const [issueDone, setIssueDone] = useState<{ row: Receivable; message: string } | null>(null);

  // anexos, motivo, histórico
  const [attachRow, setAttachRow] = useState<Receivable | null>(null);
  const [reasonReq, setReasonReq] = useState<ReasonRequest | null>(null);
  const [historyRow, setHistoryRow] = useState<Receivable | null>(null);
  // baixa com valor menor: taxa/desconto ou pagamento parcial
  const [shortMode, setShortMode] = useState<"taxa" | "parcial">("parcial");

  // emissão em lote (carnê)
  const [issueSel, setIssueSel] = useState<Set<string>>(new Set());
  const [batchRows, setBatchRows] = useState<{ row: Receivable; due: string; line: string }[] | null>(null);
  const [batchBank, setBatchBank] = useState("");
  const [batchFile, setBatchFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = paidRange(period);
    const { data, error } = await listReceivables(r.from, r.to);
    setRows(data);
    setLoadError(error);
    setLoading(false);
    setSelected((prev) => new Set([...prev].filter((id) => data.some((x) => x.id === id && x.status !== "pago" && !isToIssue(x)))));
  }, [period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchAccountBalances().then((r) => setAccounts(r.data.filter((a) => a.active)));
  }, []);

  /* ---------- filtros ---------- */
  const minV = parseMoney(extra.minV);
  const maxV = parseMoney(extra.maxV);
  /** toIssue = aba A emitir: lá tudo é boleto a emitir, então forma e situação do boleto não se aplicam. */
  const matchesCommon = useCallback((r: Receivable, toIssue = false) => {
    if (!toIssue) {
      if (method === "outras" && MAIN_METHODS.includes(r.method)) return false;
      if (method !== "todas" && method !== "outras" && r.method !== method) return false;
      if (extra.boleto) {
        if (r.method !== "boleto") return false;
        if (extra.boleto === "a_emitir" && r.issue_status !== "a_emitir") return false;
        if (extra.boleto !== "a_emitir" && r.issue_status !== "emitido") return false;
        if (extra.boleto === "enviado" && !r.sent_at) return false;
        if (extra.boleto === "nao_enviado" && !!r.sent_at) return false;
      }
    }
    if (extra.customer && customerKey(r) !== extra.customer) return false;
    if (extra.seller && (extra.seller === "__none" ? !!r.seller_name : r.seller_name !== extra.seller)) return false;
    if ((extra.dueFrom || extra.dueTo) && !r.due_date) return false;
    if (extra.dueFrom && r.due_date! < extra.dueFrom) return false;
    if (extra.dueTo && r.due_date! > extra.dueTo) return false;
    if (minV != null && r.amount < minV - 0.004) return false;
    if (maxV != null && r.amount > maxV + 0.004) return false;
    if (extra.attach === "com" && !r.attachments_count) return false;
    if (extra.attach === "sem" && !!r.attachments_count) return false;
    const term = q.trim().toLowerCase();
    if (term) {
      const hay = `${r.customer_name || ""} ${r.sale_number} ${saleNo(r.sale_number)} ${r.boleto_line || ""}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }, [method, q, extra, minV, maxV]);

  const toIssueRows = useMemo(
    () => rows.filter((r) => isToIssue(r) && matchesCommon(r, true))
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
    [rows, matchesCommon],
  );

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

  /** Inadimplência: vencidos agrupados por cliente. */
  const debtors = useMemo(() => {
    const map = new Map<string, { key: string; name: string; phone: string | null; jid: string | null; items: Receivable[]; total: number; maxDays: number }>();
    for (const r of rows) {
      if (r.status === "pago" || !r.due_date || daysUntil(r.due_date) >= 0) continue;
      if (!matchesCommon(r)) continue;
      const k = r.customer_id || r.customer_name || "—";
      const cur = map.get(k) || { key: k, name: r.customer_name || "Sem cliente", phone: r.customer_whatsapp || null, jid: r.customer_remote_jid || null, items: [], total: 0, maxDays: 0 };
      cur.items.push(r);
      cur.total += r.amount;
      cur.maxDays = Math.max(cur.maxDays, -daysUntil(r.due_date));
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows, matchesCommon]);

  const openCount = useMemo(() => rows.filter((r) => r.status !== "pago").length, [rows]);
  const toIssueCount = useMemo(() => rows.filter(isToIssue).length, [rows]);
  const paidTotals = useMemo(() => paidRows.reduce(
    (t, r) => ({ gross: t.gross + r.amount, net: t.net + (r.received_amount ?? r.amount), fee: t.fee + r.fee_amount }),
    { gross: 0, net: 0, fee: 0 },
  ), [paidRows]);

  const selectable = useMemo(() => openRows.filter((r) => !isToIssue(r)), [openRows]);
  // seleção em lote (baixa e carnê) só vale para o que está na tela
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const vis = new Set(selectable.map((r) => r.id));
      const next = new Set([...prev].filter((id) => vis.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectable]);
  useEffect(() => {
    setIssueSel((prev) => {
      if (!prev.size) return prev;
      const vis = new Set(toIssueRows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => vis.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [toIssueRows]);
  const selectedRows = useMemo(() => selectable.filter((r) => selected.has(r.id)), [selectable, selected]);
  const selectedGross = selectedRows.reduce((s, r) => s + r.amount, 0);
  const allVisibleSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const issueSelRows = useMemo(() => toIssueRows.filter((r) => issueSel.has(r.id)), [toIssueRows, issueSel]);

  /* ---------- opções, etiquetas e resumo dos filtros ---------- */
  const customerOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => { const k = customerKey(r); if (!m.has(k)) m.set(k, r.customer_name || "Sem cliente"); });
    if (extra.customer && !m.has(extra.customer)) m.set(extra.customer, extra.customer.startsWith("nome:") ? extra.customer.slice(5) : "Cliente selecionado");
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [rows, extra.customer]);
  const sellerOptions = useMemo(() => {
    const s = new Set<string>();
    let none = false;
    rows.forEach((r) => { if (r.seller_name) s.add(r.seller_name); else none = true; });
    if (extra.seller && extra.seller !== "__none") s.add(extra.seller);
    const opts = [...s].sort((a, b) => a.localeCompare(b, "pt-BR")).map((v) => ({ value: v, label: v }));
    if (none || extra.seller === "__none") opts.push({ value: "__none", label: "Sem vendedor" });
    return opts;
  }, [rows, extra.seller]);
  const labelOf = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label || v;

  const methodApplies = tab !== "emitir";
  const activeFilters: ActiveFilter[] = [];
  if (q.trim()) activeFilters.push({ key: "q", label: `Busca: "${q.trim()}"`, onRemove: () => setQ("") });
  if (methodApplies && method !== "todas") activeFilters.push({ key: "met", label: `Forma: ${METHOD_FILTERS.find((m) => m.key === method)?.label || method}`, onRemove: () => setMethod("todas") });
  if (extra.customer) activeFilters.push({ key: "cli", label: `Cliente: ${labelOf(customerOptions, extra.customer)}`, onRemove: () => setX({ customer: "" }) });
  if (extra.seller) activeFilters.push({ key: "vend", label: `Vendedor: ${labelOf(sellerOptions, extra.seller)}`, onRemove: () => setX({ seller: "" }) });
  if (extra.dueFrom || extra.dueTo) {
    activeFilters.push({
      key: "due",
      label: `Vencimento: ${extra.dueFrom ? fmtDate(extra.dueFrom) : "…"} a ${extra.dueTo ? fmtDate(extra.dueTo) : "…"}`,
      onRemove: () => setX({ dueFrom: "", dueTo: "" }),
    });
  }
  if (minV != null || maxV != null) {
    activeFilters.push({
      key: "val",
      label: minV != null && maxV != null ? `Valor: ${formatBRL(minV)} a ${formatBRL(maxV)}` : minV != null ? `Valor a partir de ${formatBRL(minV)}` : `Valor até ${formatBRL(maxV!)}`,
      onRemove: () => setX({ minV: "", maxV: "" }),
    });
  }
  if (methodApplies && extra.boleto) activeFilters.push({ key: "bol", label: `Boleto: ${labelOf(BOLETO_OPTIONS, extra.boleto).toLowerCase()}`, onRemove: () => setX({ boleto: "" }) });
  if (extra.attach) activeFilters.push({ key: "att", label: extra.attach === "com" ? "Com anexo" : "Sem anexo", onRemove: () => setX({ attach: "" }) });
  const panelCount = [extra.customer, extra.seller, extra.dueFrom || extra.dueTo, minV != null || maxV != null,
    methodApplies && extra.boleto, extra.attach].filter(Boolean).length;
  function clearFilters() {
    setQ(""); setExtra(EMPTY_EXTRA); setOpenFilter("todos");
  }

  const summary = useMemo<SummaryItem[]>(() => {
    if (tab === "emitir") {
      const total = toIssueRows.reduce((s, r) => s + r.amount, 0);
      const stuck = toIssueRows.filter((r) => daysSince(r.created_at) >= 1).length;
      return [
        { label: "Boletos", value: String(toIssueRows.length) },
        { label: "Total", value: formatBRL(total) },
        { label: "Parados há mais de 1 dia", value: String(stuck), tone: stuck > 0 ? "red" : "muted" },
      ];
    }
    if (tab === "aberto") {
      let total = 0, overdue = 0, upcoming = 0, noDue = 0;
      openRows.forEach((r) => {
        total += r.amount;
        if (!r.due_date) noDue += r.amount;
        else if (daysUntil(r.due_date) < 0) overdue += r.amount;
        else upcoming += r.amount;
      });
      const items: SummaryItem[] = [
        { label: "Pagamentos", value: String(openRows.length) },
        { label: "Total", value: formatBRL(total) },
        { label: "Vencido", value: formatBRL(overdue), tone: overdue > 0 ? "red" : "muted" },
        { label: "A vencer", value: formatBRL(upcoming) },
      ];
      if (noDue > 0) items.push({ label: "Sem vencimento", value: formatBRL(noDue), tone: "muted" });
      return items;
    }
    if (tab === "recebidos") {
      return [
        { label: "Baixas", value: String(paidRows.length) },
        { label: "Bruto", value: formatBRL(paidTotals.gross) },
        { label: "Recebido", value: formatBRL(paidTotals.net), tone: "emerald" },
        { label: "Taxas", value: paidTotals.fee > 0 ? `−${formatBRL(paidTotals.fee)}` : formatBRL(0), tone: paidTotals.fee > 0 ? "red" : "muted" },
      ];
    }
    const total = debtors.reduce((s, d) => s + d.total, 0);
    const count = debtors.reduce((s, d) => s + d.items.length, 0);
    return [
      { label: "Clientes", value: String(debtors.length) },
      { label: "Pagamentos vencidos", value: String(count) },
      { label: "Total vencido", value: formatBRL(total), tone: total > 0 ? "red" : "muted" },
    ];
  }, [tab, toIssueRows, openRows, paidRows, paidTotals, debtors]);

  function exportCSV() {
    const today = localISODate();
    const base = (r: Receivable) => ({
      sale: saleNo(r.sale_number), customer: r.customer_name || "", seller: r.seller_name || "",
      method: METHOD_LABELS[r.method] || r.method, boleto: boletoSituation(r), due: fmtDate(r.due_date),
      amount: csvMoney(r.amount), att: r.attachments_count || 0,
    });
    if (tab === "emitir") {
      downloadCSV(`boletos-a-emitir_${today}`, [
        { key: "sold", label: "Vendido em" }, { key: "customer", label: "Cliente" }, { key: "seller", label: "Vendedor" },
        { key: "sale", label: "Venda" }, { key: "due", label: "Vencimento previsto" }, { key: "amount", label: "Valor" },
        { key: "att", label: "Anexos" },
      ], toIssueRows.map((r) => ({ ...base(r), sold: fmtDateTime(r.created_at || null) })));
      return;
    }
    if (tab === "aberto") {
      downloadCSV(`contas-a-receber_em-aberto_${today}`, [
        { key: "due", label: "Vencimento" }, { key: "situation", label: "Situação" }, { key: "customer", label: "Cliente" },
        { key: "seller", label: "Vendedor" }, { key: "sale", label: "Venda" }, { key: "method", label: "Forma" },
        { key: "boleto", label: "Boleto" }, { key: "amount", label: "Valor" }, { key: "att", label: "Anexos" },
      ], openRows.map((r) => {
        const d = r.due_date ? daysUntil(r.due_date) : null;
        return {
          ...base(r),
          situation: d == null ? "sem vencimento" : d < 0 ? `vencido há ${-d} dia(s)` : d === 0 ? "vence hoje" : `vence em ${d} dia(s)`,
        };
      }));
      return;
    }
    if (tab === "recebidos") {
      downloadCSV(`recebidos_${today}`, [
        { key: "paid", label: "Recebido em" }, { key: "by", label: "Baixa por" }, { key: "customer", label: "Cliente" },
        { key: "seller", label: "Vendedor" }, { key: "sale", label: "Venda" }, { key: "method", label: "Forma" },
        { key: "due", label: "Vencimento" }, { key: "amount", label: "Bruto" }, { key: "net", label: "Líquido" },
        { key: "fee", label: "Taxa" }, { key: "anticipated", label: "Antecipado" }, { key: "att", label: "Anexos" },
      ], paidRows.map((r) => ({
        ...base(r), paid: fmtDateTime(r.paid_at), by: r.paid_by_name || "",
        net: csvMoney(r.received_amount ?? r.amount), fee: csvMoney(r.fee_amount), anticipated: r.anticipated ? "sim" : "",
      })));
      return;
    }
    downloadCSV(`inadimplencia_${today}`, [
      { key: "customer", label: "Cliente" }, { key: "phone", label: "Contato" }, { key: "sale", label: "Venda" },
      { key: "due", label: "Vencimento" }, { key: "late", label: "Dias de atraso" }, { key: "method", label: "Forma" },
      { key: "amount", label: "Valor" },
    ], debtors.flatMap((d) => d.items.map((r) => ({
      ...base(r), customer: d.name, phone: d.phone || "", late: r.due_date ? -daysUntil(r.due_date) : "",
    }))));
  }
  const listLen = tab === "emitir" ? toIssueRows.length : tab === "aberto" ? openRows.length : tab === "recebidos" ? paidRows.length : debtors.length;

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allVisibleSelected) selectable.forEach((r) => n.delete(r.id)); else selectable.forEach((r) => n.add(r.id));
      return n;
    });
  }

  /* ---------- baixa ---------- */
  const baixaRows = useMemo(() => (baixaIds ? rows.filter((r) => baixaIds.includes(r.id)) : []), [baixaIds, rows]);
  const baixaGross = baixaRows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((received - baixaGross) * 100) / 100;
  const canPartial = baixaRows.length === 1 && diff < -0.004 && received > 0;
  const isPartial = canPartial && shortMode === "parcial";

  async function openBaixa(ids: string[]) {
    const list = rows.filter((r) => ids.includes(r.id));
    setBaixaIds(ids);
    setPaidOn(localISODate());
    setReceived(list.reduce((s, r) => s + r.amount, 0));
    setNote("");
    setProof(null);
    // valor menor que o bruto: cartão costuma ser taxa; o resto, pagamento parcial
    setShortMode(list.every((r) => r.method === "cartao_credito") ? "taxa" : "parcial");
    // sugere a conta padrão da forma (ex.: pix → banco do pix)
    const m = list[0]?.method;
    setAccountId(accounts.find((a) => m && a.default_methods.includes(m))?.id || "");
    setCash(user?.id ? await getOpenSession(user.id) : null);
  }

  async function confirmBaixa() {
    if (!baixaIds) return;
    if (received <= 0) { toast({ title: "Informe o valor recebido", variant: "destructive" }); return; }
    setSaving(true);

    // pagamento parcial: baixa o que entrou e o resto continua em aberto
    if (isPartial) {
      const r = await registerPartialReceipt({ id: baixaIds[0], amount: received, paidOn, accountId: accountId || null, notes: note });
      if (r.error) { setSaving(false); toast({ title: "Não foi possível registrar o parcial", description: r.error, variant: "destructive" }); return; }
      if (proof && user?.company_id) {
        const up = await uploadAttachment({ companyId: user.company_id, entity: "sale_payment", entityId: baixaIds[0], kind: "comprovante", file: proof });
        if (up.error) toast({ title: "Comprovante não anexado", description: up.error, variant: "destructive" });
      }
      setSaving(false);
      toast({ title: "Pagamento parcial registrado", description: `${formatBRL(received)} recebido; ${formatBRL(baixaGross - received)} continua em aberto.` });
      setBaixaIds(null); setSelected(new Set()); load();
      return;
    }

    const { result, error } = await registerReceipts({
      ids: baixaIds, paidOn,
      receivedTotal: Math.abs(diff) < 0.005 ? null : received,
      notes: note, accountId: accountId || null,
    });
    if (error || !result) {
      setSaving(false);
      toast({ title: "Não foi possível dar baixa", description: error || undefined, variant: "destructive" });
      return;
    }
    let proofMsg = "";
    if (proof && baixaIds.length === 1 && user?.company_id) {
      const up = await uploadAttachment({ companyId: user.company_id, entity: "sale_payment", entityId: baixaIds[0], kind: "comprovante", file: proof });
      proofMsg = up.error ? ` O comprovante não foi anexado: ${up.error}` : " Comprovante anexado.";
    }
    setSaving(false);
    toast({
      title: "Baixa registrada",
      description:
        `${result.updated_count} pagamento${result.updated_count > 1 ? "s" : ""}, ${formatBRL(result.received_total)} recebido` +
        (result.fee_total > 0 ? ` (taxa ${formatBRL(result.fee_total)})` : "") +
        (result.cash_session_id ? ". Entrou no seu caixa aberto." : ".") + proofMsg,
    });
    setBaixaIds(null);
    setSelected(new Set());
    load();
  }

  function undo(r: Receivable) {
    setReasonReq({
      title: "Desfazer baixa",
      description: `${formatBRL(r.received_amount ?? r.amount)} · ${r.customer_name || "cliente"} · venda ${saleNo(r.sale_number)}. O pagamento volta para Em aberto e sai do recebido.`,
      confirmLabel: "Desfazer baixa",
      destructive: true,
      onConfirm: async (reason) => {
        const { error } = await revertReceipt(r.id, reason);
        if (error) return error;
        toast({ title: "Baixa desfeita", description: "O pagamento voltou para Em aberto." });
        load();
        return null;
      },
    });
  }

  /* ---------- emissão do boleto ---------- */
  function openIssue(r: Receivable) {
    setIssueRow(r);
    setIssueDue(r.due_date || addDaysISO(7));
    setIssueLine("");
    setIssueBank("");
    setIssueNumber("");
    setIssueNote("");
    setIssueFile(null);
    setIssueDone(null);
  }
  const issueDigits = issueLine.replace(/\D/g, "").length;

  async function confirmIssue() {
    if (!issueRow) return;
    if (!issueDue) { toast({ title: "Informe o vencimento", variant: "destructive" }); return; }
    if (issueDigits > 0 && issueDigits !== 47 && issueDigits !== 48) {
      toast({ title: "Linha digitável incompleta", description: `Tem ${issueDigits} dígitos; o boleto tem 47 (ou 48 em convênio).`, variant: "destructive" });
      return;
    }
    if (issueDigits === 0 && !issueFile) {
      toast({ title: "Informe a linha digitável ou anexe o PDF do boleto", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await registerBoletoIssue({
      id: issueRow.id, dueDate: issueDue, line: issueLine, bank: issueBank, number: issueNumber, notes: issueNote,
    });
    if (error) {
      setSaving(false);
      toast({ title: "Não foi possível registrar a emissão", description: error, variant: "destructive" });
      return;
    }
    if (issueFile && user?.company_id) {
      const up = await uploadAttachment({ companyId: user.company_id, entity: "sale_payment", entityId: issueRow.id, kind: "boleto", file: issueFile });
      if (up.error) toast({ title: "Emissão registrada, mas o PDF não foi anexado", description: up.error, variant: "destructive" });
    }
    setSaving(false);
    setIssueDone({
      row: { ...issueRow, due_date: issueDue, boleto_line: issueLine.replace(/\D/g, "") || null },
      message: boletoMessage({
        customer: issueRow.customer_name, amount: issueRow.amount, due: issueDue,
        line: issueLine.replace(/\D/g, "") || null, company: user?.company_name,
      }),
    });
    load();
  }

  async function sendMessage(r: Receivable, message: string) {
    const ok = await copyText(message);
    toast(ok
      ? { title: "Mensagem copiada", description: "Cole na conversa do cliente." }
      : { title: "Não consegui copiar automaticamente", description: "Selecione o texto e copie com Ctrl+C.", variant: "destructive" });
  }
  async function markSent(r: Receivable) {
    const { error } = await markBoletoSent(r.id);
    if (error) { toast({ title: "Não foi possível marcar", description: error, variant: "destructive" }); return; }
    toast({ title: "Marcado como enviado ao cliente" });
    load();
  }
  function undoIssue(r: Receivable) {
    setReasonReq({
      title: "Desfazer emissão do boleto",
      description: "O boleto volta para 'A emitir' e a linha digitável é apagada. Os anexos continuam.",
      confirmLabel: "Desfazer emissão",
      required: false,
      placeholder: "Ex.: boleto gerado com valor errado",
      onConfirm: async (reason) => {
        const { error } = await revertBoletoIssue(r.id, reason || null);
        if (error) return error;
        load();
        return null;
      },
    });
  }

  /* ---------- emissão em lote (carnê) ---------- */
  function openBatchIssue() {
    const list = toIssueRows.filter((r) => issueSel.has(r.id)).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    setBatchRows(list.map((r) => ({ row: r, due: r.due_date || addDaysISO(7), line: "" })));
    setBatchBank("");
    setBatchFile(null);
  }
  async function confirmBatchIssue() {
    if (!batchRows) return;
    const bad = batchRows.find((b) => { const d = b.line.replace(/\D/g, "").length; return d > 0 && d !== 47 && d !== 48; });
    if (bad) { toast({ title: "Linha digitável incompleta", description: `Parcela de ${fmtDate(bad.due)}: confira os 47 dígitos.`, variant: "destructive" }); return; }
    if (!batchFile && batchRows.some((b) => !b.line.replace(/\D/g, ""))) {
      toast({ title: "Informe a linha de cada boleto ou anexe o PDF do carnê", variant: "destructive" });
      return;
    }
    setSaving(true);
    let okCount = 0;
    const errors: string[] = [];
    for (const b of batchRows) {
      const { error } = await registerBoletoIssue({ id: b.row.id, dueDate: b.due, line: b.line, bank: batchBank });
      if (error) { errors.push(`${fmtDate(b.due)}: ${error}`); continue; }
      okCount++;
      if (batchFile && user?.company_id) {
        const up = await uploadAttachment({ companyId: user.company_id, entity: "sale_payment", entityId: b.row.id, kind: "boleto", file: batchFile });
        if (up.error) errors.push(`${fmtDate(b.due)}: PDF não anexado (${up.error})`);
      }
    }
    setSaving(false);
    toast(errors.length
      ? { title: `${okCount} de ${batchRows.length} registrados`, description: errors.join(" · "), variant: "destructive" }
      : { title: `${okCount} boletos emitidos`, description: "Carnê registrado. Mande pro cliente pelo menu de cada parcela." });
    setBatchRows(null);
    setIssueSel(new Set());
    load();
  }

  const antecipadoPct = overview && overview.anticipated_month_gross > 0
    ? (overview.fees_month / overview.anticipated_month_gross) * 100
    : 0;
  const chatLink = (r: Receivable) => (r.customer_remote_jid ? `/chat?jid=${encodeURIComponent(r.customer_remote_jid)}` : null);

  /* ---------- menu de ações da linha ---------- */
  function RowMenu({ r }: { r: Receivable }) {
    const isBoleto = r.method === "boleto";
    const emitted = isBoleto && r.issue_status === "emitido";
    const msg = boletoMessage({ customer: r.customer_name, amount: r.amount, due: r.due_date, line: r.boleto_line, company: user?.company_name });
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mais ações">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setAttachRow(r)}>
            <Paperclip className="mr-2 h-4 w-4" /> Anexos{r.attachments_count ? ` (${r.attachments_count})` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHistoryRow(r)}>
            <History className="mr-2 h-4 w-4" /> Histórico
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/sales/${r.sale_id}`}><Receipt className="mr-2 h-4 w-4" /> Abrir venda</Link>
          </DropdownMenuItem>
          {emitted && r.status !== "pago" && (
            <>
              <DropdownMenuSeparator />
              {r.boleto_line && (
                <DropdownMenuItem onClick={async () => {
                  const ok = await copyText(formatBoletoLine(r.boleto_line));
                  toast({ title: ok ? "Linha digitável copiada" : "Não consegui copiar" });
                }}>
                  <Copy className="mr-2 h-4 w-4" /> Copiar linha digitável
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => sendMessage(r, msg)}>
                <MessageCircle className="mr-2 h-4 w-4" /> Copiar mensagem pro cliente
              </DropdownMenuItem>
              {chatLink(r) && (
                <DropdownMenuItem asChild>
                  <Link to={chatLink(r)!}><Send className="mr-2 h-4 w-4" /> Abrir conversa no WhatsApp</Link>
                </DropdownMenuItem>
              )}
              {!r.sent_at && (
                <DropdownMenuItem onClick={() => markSent(r)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Marcar como enviado
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => undoIssue(r)} className="text-red-700 dark:text-red-400">
                <Undo2 className="mr-2 h-4 w-4" /> Desfazer emissão
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  /* ---------- render ---------- */
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <HandCoins className="h-5 w-5 text-primary" /> Contas a receber
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Boleto vendido entra em "A emitir" até alguém gerar no banco e registrar a emissão. Depois, a baixa do
          pagamento coloca o valor no recebido e na conta onde ele caiu.
        </p>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile
          label="Boletos a emitir"
          tone={overview && overview.to_issue_late_count > 0 ? "crit" : overview && overview.to_issue_count > 0 ? "warn" : "default"}
          value={overview ? String(overview.to_issue_count ?? 0) : "—"}
          sub={overview
            ? overview.to_issue_late_count > 0
              ? `${overview.to_issue_late_count} parado${overview.to_issue_late_count > 1 ? "s" : ""} há mais de 1 dia`
              : formatBRL(overview.to_issue_total || 0)
            : undefined}
          active={tab === "emitir"}
          onClick={() => setTab("emitir")}
        />
        <Tile
          label="Vencidos"
          tone={overview && overview.overdue_count > 0 ? "crit" : "default"}
          value={overview ? formatBRL(overview.overdue_total) : "—"}
          sub={overview ? `${overview.overdue_count} pagamento${overview.overdue_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "vencidos"}
          onClick={() => { setTab("aberto"); setOpenFilter("vencidos"); }}
        />
        <Tile
          label="Vencem hoje"
          tone={overview && overview.due_today_count > 0 ? "warn" : "default"}
          value={overview ? formatBRL(overview.due_today_total) : "—"}
          sub={overview ? `${overview.due_today_count} pagamento${overview.due_today_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "hoje"}
          onClick={() => { setTab("aberto"); setOpenFilter("hoje"); }}
        />
        <Tile
          label="Em aberto"
          tone="default"
          value={overview ? formatBRL(overview.open_total) : "—"}
          sub={overview ? `próximos 7 dias: ${formatBRL(overview.next7_total)}` : undefined}
          active={tab === "aberto" && openFilter === "todos"}
          onClick={() => { setTab("aberto"); setOpenFilter("todos"); }}
        />
        <Tile
          label="Recebido no mês"
          tone="good"
          value={overview ? formatBRL(overview.received_month) : "—"}
          sub={overview && overview.anticipated_month_count > 0
            ? `cartão antecipado ${formatBRL(overview.anticipated_month_gross)} · taxa ${antecipadoPct.toFixed(1).replace(".", ",")}%`
            : overview && overview.fees_month > 0 ? `taxas ${formatBRL(overview.fees_month)}` : undefined}
          onClick={() => { setTab("recebidos"); setPeriod("mes"); }}
        />
      </div>

      {/* Abas */}
      <div className="flex flex-wrap items-center gap-1 border-b">
        {([
          ["emitir", `A emitir${toIssueCount ? ` (${toIssueCount})` : ""}`],
          ["aberto", `Em aberto${openCount ? ` (${openCount})` : ""}`],
          ["recebidos", "Recebidos"],
          ["inadimplencia", `Inadimplência${debtors.length ? ` (${debtors.length})` : ""}`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {tab === "aberto" && ([
          ["todos", "Todos"], ["vencidos", "Vencidos"], ["hoje", "Vencem hoje"], ["semana", "Próximos 7 dias"],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setOpenFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
              openFilter === k ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:text-foreground"
            }`}>{label}</button>
        ))}
        {tab === "recebidos" && ([
          ["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90d", "Últimos 90 dias"],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
              period === k ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:text-foreground"
            }`}>{label}</button>
        ))}
        {tab !== "emitir" && (
          <select id="recv-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Forma de pagamento">
            {METHOD_FILTERS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        )}
        <MoreFiltersButton count={panelCount}>
          <FilterField label="Cliente">
            <FilterSelect value={extra.customer} onChange={(v) => setX({ customer: v })} options={customerOptions} />
          </FilterField>
          <FilterField label="Vendedor">
            <FilterSelect value={extra.seller} onChange={(v) => setX({ seller: v })} options={sellerOptions} />
          </FilterField>
          <FilterField label="Vencimento">
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={extra.dueFrom} onChange={(e) => setX({ dueFrom: e.target.value })} className="h-8 text-xs" aria-label="Vencimento de" />
              <Input type="date" value={extra.dueTo} onChange={(e) => setX({ dueTo: e.target.value })} className="h-8 text-xs" aria-label="Vencimento até" />
            </div>
            <div className="flex gap-3 pt-0.5 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => { const r = monthRange(0); setX({ dueFrom: r.from, dueTo: r.to }); }}>Este mês</button>
              <button type="button" className="text-primary hover:underline" onClick={() => { const r = monthRange(1); setX({ dueFrom: r.from, dueTo: r.to }); }}>Próximo mês</button>
              {(extra.dueFrom || extra.dueTo) && <button type="button" className="text-muted-foreground hover:underline" onClick={() => setX({ dueFrom: "", dueTo: "" })}>Qualquer data</button>}
            </div>
          </FilterField>
          <FilterField label="Valor (R$)">
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="decimal" value={extra.minV} onChange={(e) => setX({ minV: e.target.value })} placeholder="Mínimo" className="h-8 text-xs" aria-label="Valor mínimo" />
              <Input inputMode="decimal" value={extra.maxV} onChange={(e) => setX({ maxV: e.target.value })} placeholder="Máximo" className="h-8 text-xs" aria-label="Valor máximo" />
            </div>
          </FilterField>
          <div className="grid grid-cols-2 gap-2">
            {methodApplies && (
              <FilterField label="Boleto">
                <FilterSelect value={extra.boleto} onChange={(v) => setX({ boleto: v })} options={BOLETO_OPTIONS} />
              </FilterField>
            )}
            <FilterField label="Anexo">
              <FilterSelect value={extra.attach} onChange={(v) => setX({ attach: v })} options={ATTACH_OPTIONS} />
            </FilterField>
          </div>
        </MoreFiltersButton>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={exportCSV} disabled={loading || !!loadError || listLen === 0}>
          <Download className="h-3.5 w-3.5" /> Exportar CSV
        </Button>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input id="recv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, nº da venda ou linha" className="h-8 pl-8 text-sm" />
        </div>
      </div>

      {(activeFilters.length > 0 || (!loading && !loadError)) && (
        <div className="space-y-2">
          <ActiveFilterChips filters={activeFilters} onClearAll={clearFilters} />
          {!loading && !loadError && <FilterSummary items={summary} />}
        </div>
      )}

      {tab === "aberto" && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-primary/40 bg-accent/40 px-4 py-2.5 text-sm">
          <span><strong>{selectedRows.length}</strong> selecionado{selectedRows.length > 1 ? "s" : ""} · <strong className="num">{formatBRL(selectedGross)}</strong></span>
          <Button size="sm" className="ml-auto" onClick={() => openBaixa(selectedRows.map((r) => r.id))}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Dar baixa nos selecionados
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
        </div>
      )}

      {tab === "emitir" && issueSelRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-primary/40 bg-accent/40 px-4 py-2.5 text-sm">
          <span><strong>{issueSelRows.length}</strong> boleto{issueSelRows.length > 1 ? "s" : ""} · <strong className="num">{formatBRL(issueSelRows.reduce((s, r) => s + r.amount, 0))}</strong></span>
          <Button size="sm" className="ml-auto" onClick={openBatchIssue}>
            <FileText className="mr-1.5 h-4 w-4" /> Registrar emissão em lote
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIssueSel(new Set())}>Limpar</Button>
        </div>
      )}

      {/* Tabelas */}
      <div className="overflow-x-auto rounded-[10px] border bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>
        ) : loadError ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            {loadError.includes("permissão")
              ? "Você não tem acesso ao financeiro. Peça a um administrador o papel Financeiro, Gerente ou Admin."
              : `Não foi possível carregar: ${loadError}`}
          </div>
        ) : tab === "emitir" ? (
          toIssueRows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              {activeFilters.length ? "Nenhum boleto a emitir com esses filtros." : "Nenhum boleto esperando emissão."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={toIssueRows.length > 0 && toIssueRows.every((r) => issueSel.has(r.id))}
                      onCheckedChange={(v) => setIssueSel(v ? new Set(toIssueRows.map((r) => r.id)) : new Set())}
                      aria-label="Selecionar todos"
                    />
                  </TableHead>
                  <TableHead>Vendido em</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Venda</TableHead>
                  <TableHead>Vencimento previsto</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {toIssueRows.map((r) => {
                  const age = daysSince(r.created_at);
                  return (
                    <TableRow key={r.id} className={age >= 1 ? "bg-red-500/[0.04]" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={issueSel.has(r.id)}
                          onCheckedChange={(v) => setIssueSel((prev) => { const n = new Set(prev); if (v) n.add(r.id); else n.delete(r.id); return n; })}
                          aria-label="Selecionar"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="num">{fmtDateTime(r.created_at || null)}</div>
                        {age >= 1
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"><AlertTriangle className="h-3 w-3" /> parado há {age} dia{age > 1 ? "s" : ""}</span>
                          : <span className="text-xs text-muted-foreground">vendido hoje</span>}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.customer_name || "—"}</div>
                        {r.seller_name && <div className="text-xs text-muted-foreground">vendedor: {r.seller_name}</div>}
                      </TableCell>
                      <TableCell><Link to={`/sales/${r.sale_id}`} className="font-mono text-primary hover:underline">{saleNo(r.sale_number)}</Link></TableCell>
                      <TableCell className="num">{fmtDate(r.due_date)}</TableCell>
                      <TableCell className="num text-right font-medium">{formatBRL(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => openIssue(r)}><FileText className="mr-1.5 h-4 w-4" /> Registrar emissão</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : tab === "aberto" ? (
          openRows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">{openFilter === "vencidos" ? "Nada vencido." : "Nenhum pagamento em aberto com esses filtros."}</div>
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
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openRows.map((r) => {
                  const overdue = !!r.due_date && daysUntil(r.due_date) < 0;
                  const pending = isToIssue(r);
                  return (
                    <TableRow key={r.id} className={overdue ? "bg-red-500/[0.04]" : ""}>
                      <TableCell>
                        <Checkbox checked={selected.has(r.id)} disabled={pending} onCheckedChange={() => toggle(r.id)} aria-label="Selecionar" />
                      </TableCell>
                      <TableCell><div className="num">{fmtDate(r.due_date)}</div><DuePill due={r.due_date} /></TableCell>
                      <TableCell>
                        <div className="font-medium">{r.customer_name || "—"}</div>
                        {r.seller_name && <div className="text-xs text-muted-foreground">vendedor: {r.seller_name}</div>}
                      </TableCell>
                      <TableCell><Link to={`/sales/${r.sale_id}`} className="font-mono text-primary hover:underline">{saleNo(r.sale_number)}</Link></TableCell>
                      <TableCell className="whitespace-nowrap">
                        {METHOD_LABELS[r.method] || r.method}<BoletoChips r={r} />
                        {!!r.attachments_count && <Paperclip className="ml-1 inline h-3 w-3 text-muted-foreground" aria-label={`${r.attachments_count} anexo(s)`} />}
                      </TableCell>
                      <TableCell className="num text-right font-medium">{formatBRL(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {pending
                            ? <Button size="sm" onClick={() => openIssue(r)}>Emitir</Button>
                            : <Button size="sm" variant="outline" onClick={() => openBaixa([r.id])}>Dar baixa</Button>}
                          <RowMenu r={r} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : tab === "recebidos" ? (
          paidRows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">{activeFilters.length ? "Nenhuma baixa com esses filtros." : "Nenhuma baixa nesse período."}</div>
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
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paidRows.map((r) => {
                  const closed = r.cash_session_id && r.cash_session_open === false;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="num">{fmtDateTime(r.paid_at)}</div>
                        {r.paid_by_name && <div className="text-xs text-muted-foreground">por {r.paid_by_name}</div>}
                      </TableCell>
                      <TableCell className="font-medium">{r.customer_name || "—"}</TableCell>
                      <TableCell><Link to={`/sales/${r.sale_id}`} className="font-mono text-primary hover:underline">{saleNo(r.sale_number)}</Link></TableCell>
                      <TableCell className="whitespace-nowrap">
                        {METHOD_LABELS[r.method] || r.method}
                        {r.anticipated && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400">
                            <Zap className="h-2.5 w-2.5" /> antecipado
                          </span>
                        )}
                        {!!r.attachments_count && <Paperclip className="ml-1 inline h-3 w-3 text-muted-foreground" aria-label={`${r.attachments_count} anexo(s)`} />}
                      </TableCell>
                      <TableCell className="num text-right text-muted-foreground">{formatBRL(r.amount)}</TableCell>
                      <TableCell className="num text-right font-medium">{formatBRL(r.received_amount ?? r.amount)}</TableCell>
                      <TableCell className={`num text-right ${r.fee_amount > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                        {r.fee_amount > 0 ? `−${formatBRL(r.fee_amount)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {!r.cash_session_id ? <span className="text-muted-foreground">fora do caixa</span>
                          : r.cash_session_open ? <span className="text-emerald-700 dark:text-emerald-400">caixa aberto</span>
                          : <span className="text-muted-foreground">caixa fechado</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={!!closed}
                            title={closed ? "Entrou num caixa já fechado; não dá para desfazer." : "Volta para Em aberto"}
                            onClick={() => undo(r)}>
                            <Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer
                          </Button>
                          <RowMenu r={r} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell colSpan={4}>Total ({paidRows.length})</TableCell>
                  <TableCell className="num text-right">{formatBRL(paidTotals.gross)}</TableCell>
                  <TableCell className="num text-right">{formatBRL(paidTotals.net)}</TableCell>
                  <TableCell className="num text-right text-red-700 dark:text-red-400">{paidTotals.fee > 0 ? `−${formatBRL(paidTotals.fee)}` : "—"}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          )
        ) : debtors.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {activeFilters.length ? "Nenhum cliente com pagamento vencido nesses filtros." : "Nenhum cliente com pagamento vencido."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead className="text-right">Pagamentos</TableHead>
                <TableHead className="text-right">Total vencido</TableHead>
                <TableHead>Mais antigo</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {debtors.map((d) => {
                const msg = [
                  `Olá${d.name ? `, ${d.name.split(" ")[0]}` : ""}! Consta em aberto${user?.company_name ? ` na ${user.company_name}` : ""}:`,
                  ...d.items.map((r) => `• ${fmtDate(r.due_date)} · ${formatBRL(r.amount)} (${METHOD_LABELS[r.method] || r.method}${r.boleto_line ? `, linha ${formatBoletoLine(r.boleto_line)}` : ""})`),
                  `Total: ${formatBRL(d.total)}. Se já pagou, pode nos enviar o comprovante por aqui.`,
                ].join("\n");
                return (
                  <TableRow key={d.key}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="num text-muted-foreground">{d.phone || "sem contato"}</TableCell>
                    <TableCell className="num text-right">{d.items.length}</TableCell>
                    <TableCell className="num text-right font-semibold text-red-700 dark:text-red-400">{formatBRL(d.total)}</TableCell>
                    <TableCell><span className="text-xs">vencido há {d.maxDays} dia{d.maxDays > 1 ? "s" : ""}</span></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => sendMessage(d.items[0], msg)}><Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar cobrança</Button>
                        {d.jid && (
                          <Button size="icon" variant="ghost" asChild className="h-8 w-8" title="Abrir conversa">
                            <Link to={`/chat?jid=${encodeURIComponent(d.jid)}`} aria-label="Abrir conversa no WhatsApp"><MessageCircle className="h-4 w-4" /></Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Diálogo: emissão do boleto */}
      <Dialog open={!!issueRow} onOpenChange={(o) => { if (!o) { setIssueRow(null); setIssueDone(null); } }}>
        <DialogContent className="max-w-lg">
          {issueDone ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> Emissão registrada</DialogTitle>
                <DialogDescription>Agora mande o boleto pro cliente. A mensagem já está pronta.</DialogDescription>
              </DialogHeader>
              <Textarea id="issue-msg" readOnly value={issueDone.message} rows={6} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => sendMessage(issueDone.row, issueDone.message)}><Copy className="mr-1.5 h-4 w-4" /> Copiar</Button>
                  {chatLink(issueDone.row) && (
                    <Button variant="outline" asChild><Link to={chatLink(issueDone.row)!}><Send className="mr-1.5 h-4 w-4" /> Abrir conversa</Link></Button>
                  )}
                </div>
                <Button onClick={async () => { await markSent(issueDone.row); setIssueRow(null); setIssueDone(null); }}>
                  Marcar como enviado
                </Button>
              </DialogFooter>
            </>
          ) : issueRow && (
            <>
              <DialogHeader>
                <DialogTitle>Registrar emissão do boleto</DialogTitle>
                <DialogDescription>
                  {issueRow.customer_name || "Cliente"} · venda {saleNo(issueRow.sale_number)} · {formatBRL(issueRow.amount)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="issue-due" className="text-xs">Vencimento</Label>
                    <Input id="issue-due" type="date" value={issueDue} onChange={(e) => setIssueDue(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="issue-bank" className="text-xs">Banco</Label>
                    <Input id="issue-bank" value={issueBank} onChange={(e) => setIssueBank(e.target.value)} placeholder="Ex.: Itaú, Sicoob, Inter" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="issue-line" className="text-xs">Linha digitável</Label>
                  <Input id="issue-line" value={issueLine} onChange={(e) => setIssueLine(e.target.value)} className="font-mono text-sm"
                    placeholder="34191.79001 01043.510047 91020.150008 1 96700000060000" inputMode="numeric" />
                  <p className={`text-xs ${issueDigits && issueDigits !== 47 && issueDigits !== 48 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                    {issueDigits ? `${issueDigits} de 47 dígitos` : "Cole do internet banking; pontos e espaços são ignorados."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="issue-number" className="text-xs">Nosso número <span className="text-muted-foreground">(opcional)</span></Label>
                    <Input id="issue-number" value={issueNumber} onChange={(e) => setIssueNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="issue-note" className="text-xs">Observação <span className="text-muted-foreground">(opcional)</span></Label>
                    <Input id="issue-note" value={issueNote} onChange={(e) => setIssueNote(e.target.value)} />
                  </div>
                </div>
                <AttachFileField id="issue-file" file={issueFile} onChange={setIssueFile} label="Anexar PDF do boleto" hint="Fica guardado na venda e dá pra baixar depois." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIssueRow(null)}>Cancelar</Button>
                <Button onClick={confirmIssue} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Registrar emissão
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Diálogo: baixa */}
      <Dialog open={!!baixaIds} onOpenChange={(o) => { if (!o) setBaixaIds(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{baixaRows.length > 1 ? `Dar baixa em ${baixaRows.length} pagamentos` : "Dar baixa"}</DialogTitle>
            <DialogDescription>
              {baixaRows.length === 1
                ? `${baixaRows[0].customer_name || "Cliente"} · venda ${saleNo(baixaRows[0].sale_number)} · ${METHOD_LABELS[baixaRows[0].method] || baixaRows[0].method}`
                : `${new Set(baixaRows.map((r) => r.customer_name)).size} cliente(s)`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Valor bruto</span>
              <span className="font-mono font-semibold">{formatBRL(baixaGross)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="baixa-date" className="text-xs">Data do recebimento</Label>
                <Input id="baixa-date" type="date" value={paidOn} max={localISODate()} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor que caiu</Label>
                <MoneyInput value={received} onChange={setReceived} className="text-right" />
              </div>
            </div>
            {canPartial && (
              <div className="space-y-1.5 rounded-md border px-3 py-2.5 text-sm">
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="short-mode" className="mt-1" checked={shortMode === "parcial"} onChange={() => setShortMode("parcial")} />
                  <span>Pagamento parcial: <strong className="num">{formatBRL(baixaGross - received)}</strong> continua em aberto, mesmo vencimento</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="short-mode" className="mt-1" checked={shortMode === "taxa"} onChange={() => setShortMode("taxa")} />
                  <span>A diferença é taxa ou desconto (quita o pagamento)</span>
                </label>
              </div>
            )}
            {diff < -0.004 && !isPartial && (
              <p className="text-xs text-red-700 dark:text-red-400">
                Taxa / desconto: {formatBRL(-diff)} ({((-diff / baixaGross) * 100).toFixed(2).replace(".", ",")}%)
                {baixaRows.some((r) => r.method === "cartao_credito") ? ". Se for antecipação, fica marcado como antecipado." : ""}
              </p>
            )}
            {diff > 0.004 && <p className="text-xs text-emerald-700 dark:text-emerald-400">Juros / multa: +{formatBRL(diff)}</p>}
            {Math.abs(diff) <= 0.004 && (
              <p className="text-xs text-muted-foreground">Cartão antecipado ou com taxa? Informe o valor líquido; a diferença vira taxa.</p>
            )}

            {accounts.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="baixa-account" className="text-xs">Onde o dinheiro caiu</Label>
                <select id="baixa-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Não informar agora</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="baixa-note" className="text-xs">Observação <span className="text-muted-foreground">(opcional)</span></Label>
              <Input id="baixa-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: antecipação Cielo, comprovante 123" />
            </div>
            {baixaRows.length === 1 && (
              <AttachFileField id="baixa-proof" file={proof} onChange={setProof} label="Anexar comprovante" />
            )}

            <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {cash ? (
                <span>Entra também no seu caixa aberto desde {new Date(cash.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}, em cartão/outros, sem mexer no dinheiro contado.</span>
              ) : (
                <span className="text-muted-foreground">Você não tem caixa aberto: conta como recebido, fora do fechamento de caixa.</span>
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

      <AttachmentsDialog
        open={!!attachRow}
        onOpenChange={(o) => { if (!o) setAttachRow(null); }}
        title="Anexos do pagamento"
        subtitle={attachRow ? `${attachRow.customer_name || "Cliente"} · venda ${saleNo(attachRow.sale_number)} · ${formatBRL(attachRow.amount)}` : undefined}
        entity="sale_payment"
        entityId={attachRow?.id || null}
        defaultKind={attachRow?.status === "pago" ? "comprovante" : attachRow?.method === "boleto" ? "boleto" : "outro"}
        onChanged={load}
      />

      {/* Diálogo: emissão em lote (carnê) */}
      <Dialog open={!!batchRows} onOpenChange={(o) => { if (!o) setBatchRows(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar emissão de {batchRows?.length} boletos</DialogTitle>
            <DialogDescription>
              Confira o vencimento e cole a linha de cada parcela. Se o banco gerou um PDF único do carnê, anexe aqui: ele vai em todas.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {batchRows?.map((b, i) => (
              <div key={b.row.id} className="grid grid-cols-[auto_8.5rem_1fr] items-center gap-2 rounded-md border px-2.5 py-2">
                <div className="w-28 text-xs">
                  <div className="font-medium">{b.row.customer_name || "—"}</div>
                  <div className="num text-muted-foreground">{saleNo(b.row.sale_number)} · {formatBRL(b.row.amount)}</div>
                </div>
                <Input type="date" value={b.due} className="h-8 text-sm" aria-label="Vencimento"
                  onChange={(e) => setBatchRows((prev) => prev && prev.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
                <Input value={b.line} className="h-8 font-mono text-xs" placeholder="Linha digitável (opcional com PDF)" aria-label="Linha digitável"
                  onChange={(e) => setBatchRows((prev) => prev && prev.map((x, j) => (j === i ? { ...x, line: formatBoletoLine(e.target.value) } : x)))} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="batch-bank" className="text-xs">Banco <span className="text-muted-foreground">(opcional)</span></Label>
              <Input id="batch-bank" value={batchBank} onChange={(e) => setBatchBank(e.target.value)} placeholder="Ex.: Sicoob" />
            </div>
            <AttachFileField id="batch-pdf" file={batchFile} onChange={setBatchFile} label="PDF do carnê" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchRows(null)}>Cancelar</Button>
            <Button onClick={confirmBatchIssue} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Registrar {batchRows?.length} emissões
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog request={reasonReq} onClose={() => setReasonReq(null)} />
      <HistoryDialog
        target={historyRow ? { entity: "sale_payment", id: historyRow.id, title: `${historyRow.customer_name || "Cliente"} · venda ${saleNo(historyRow.sale_number)} · ${formatBRL(historyRow.amount)}` } : null}
        onClose={() => setHistoryRow(null)}
      />
    </div>
  );
}
