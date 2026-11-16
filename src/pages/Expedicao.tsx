/* =====================================================================
   Expedição e entregas
   Entrega de venda: A SEPARAR → (separado) → PRONTO → (atribuir) → COM O
   MOTOQUEIRO → (saiu) → SAIU → ENTREGUE | NÃO DEU.
   Coleta de OS já nasce pronta. O motoqueiro dá baixa pelo link dele; o
   escritório também pode dar baixa por aqui. No fim, o acerto soma as
   taxas e gera uma conta a pagar (migration 72).
===================================================================== */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Truck, Loader2, Plus, Search, RefreshCw, MapPin, Copy, MoreHorizontal, Undo2, Send, UserMinus,
  Store, Ban, HandCoins, Pencil, Link2, AlertTriangle, CheckCircle2, XCircle, PackageCheck, Bike,
  Receipt, Wrench, MessageCircle,
} from "lucide-react";
import {
  ActiveFilterChips, FilterField, FilterSelect, FilterSummary, MoreFiltersButton, type ActiveFilter, type SummaryItem,
} from "@/components/filters/FilterBits";
import { ReasonDialog, type ReasonRequest } from "@/components/finance/Dialogs";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MoneyInput from "@/components/MoneyInput";
import { formatBRL, formatPhone } from "@/lib/formatters";
import { daysUntil, localISODate } from "@/lib/receivables";
import { sendWhatsApp } from "@/lib/whatsapp";
import {
  COLLECT_METHODS, KIND_LABEL, MISSING_DELIVERY_MSG, STAGE_LABEL,
  assignTasks, courierLink, courierMessage, createTaskFrom, customerAddress, isMissingDelivery,
  listCouriers, listTasks, listUnsettled, mapsLink, saveCourier, settleCourier, updateTask,
  type Courier, type DeliveryTask, type TaskKind, type TaskStage,
} from "@/lib/delivery";

const db = supabase as any;

/* ---------- helpers ---------- */
type Tab = "separar" | "prontos" | "rua" | "concluidas" | "motoqueiros";
type DoneRange = "hoje" | "7d" | "30d";
type DoneStage = "" | "concluida" | "falhou" | "retirada" | "cancelada";

const OPEN_STAGES: TaskStage[] = ["separar", "pronto", "atribuida", "em_rota"];
const FINAL_STAGES: TaskStage[] = ["concluida", "falhou", "retirada", "cancelada"];
const METHOD_LABEL: Record<string, string> = Object.fromEntries(COLLECT_METHODS.map((m) => [m.value, m.label]));

function startOfToday(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function sinceISO(r: DoneRange): string {
  const d = startOfToday();
  if (r === "7d") d.setDate(d.getDate() - 6);
  if (r === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString();
}
function isToday(ts: string | null | undefined): boolean {
  return !!ts && new Date(ts) >= startOfToday();
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
/** "14:32" se for hoje; "12/11 14:32" se não. */
function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return isToday(ts) ? hm : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}
/** Quando a tarefa terminou (retirada/cancelada não têm done_at: usa a última alteração). */
function endedAt(t: DeliveryTask): string {
  return t.done_at || (t as any).updated_at || t.created_at;
}
/** Data usada no filtro de período: dia previsto (abertas) ou dia em que terminou. */
function refDate(t: DeliveryTask): string {
  if (FINAL_STAGES.includes(t.stage)) return localISODate(new Date(endedAt(t)));
  return t.due_date || localISODate(new Date(t.created_at));
}
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
const pad6 = (n: number | string) => String(n).padStart(6, "0");
const sum = (list: DeliveryTask[], f: (t: DeliveryTask) => number) => list.reduce((s, t) => s + f(t), 0);
const byDue = (a: DeliveryTask, b: DeliveryTask) =>
  (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.created_at.localeCompare(b.created_at);

/* ---------- peças visuais ---------- */
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

const STAGE_TONE: Record<TaskStage, string> = {
  separar: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  pronto: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  atribuida: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  em_rota: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  concluida: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  falhou: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelada: "bg-muted text-muted-foreground",
  retirada: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};
function StageBadge({ stage }: { stage: TaskStage }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage]}</span>;
}
function KindChip({ kind }: { kind: TaskKind }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
      kind === "coleta" ? "bg-orange-500/10 text-orange-700 dark:text-orange-400" : "bg-primary/10 text-primary"
    }`}>{KIND_LABEL[kind]}</span>
  );
}
function DueCell({ due }: { due: string | null }) {
  if (!due) return <span className="text-xs text-muted-foreground">sem dia</span>;
  const d = daysUntil(due);
  if (d < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" /> {fmtDate(due).slice(0, 5)} · atrasada
      </span>
    );
  }
  if (d === 0) return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-400">hoje</span>;
  if (d === 1) return <span className="text-xs">amanhã</span>;
  return <span className="num text-xs">{fmtDate(due)}</span>;
}
function RefLink({ t }: { t: DeliveryTask }) {
  if (!t.ref) return <span className="text-xs text-muted-foreground">avulsa</span>;
  const to = t.sale_id ? `/sales/${t.sale_id}` : t.service_order_id ? `/service-orders/${t.service_order_id}` : null;
  return to
    ? <Link to={to} className="font-mono text-xs text-primary hover:underline">{t.ref}</Link>
    : <span className="font-mono text-xs">{t.ref}</span>;
}
function CustomerCell({ t, showKind = true }: { t: DeliveryTask; showKind?: boolean }) {
  return (
    <div className="min-w-[10rem]">
      <div className="flex items-center gap-1.5">
        {showKind && <KindChip kind={t.kind} />}
        <span className="font-medium">{t.customer_name || "Sem cliente"}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <RefLink t={t} />
        {t.phone && <span className="num">{formatPhone(t.phone)}</span>}
      </div>
      {t.notes && <div className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground" title={t.notes}>obs.: {t.notes}</div>}
    </div>
  );
}
function AddressCell({ t }: { t: DeliveryTask }) {
  if (!t.address) return <span className="text-xs text-amber-800 dark:text-amber-400">sem endereço</span>;
  return (
    <div className="max-w-xs">
      <a href={mapsLink(t.address)} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-sm hover:text-primary hover:underline">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span>{t.address}</span>
      </a>
      {t.address_notes && <div className="pl-[18px] text-xs text-muted-foreground">{t.address_notes}</div>}
    </div>
  );
}
function MoneyCell({ t }: { t: DeliveryTask }) {
  if (t.kind === "coleta" || t.collect_amount <= 0) return <span className="text-xs text-muted-foreground">nada a cobrar</span>;
  return <span className="num font-medium">{formatBRL(t.collect_amount)}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-14 text-center text-sm text-muted-foreground">{children}</div>;
}

const KIND_OPTIONS = [{ value: "entrega", label: "Entregas" }, { value: "coleta", label: "Coletas" }];

/* =====================================================================
   Tela
===================================================================== */
export default function Expedicao() {
  const { user } = useAuth();
  const perms = usePermissions();
  const { toast } = useToast();
  const companyId = user?.company_id || null;
  const canEditCouriers = perms.isManager;
  const canSettle = perms.isManager || perms.hasFinancialAccess;

  const [tab, setTab] = useState<Tab>("separar");
  const [range, setRange] = useState<DoneRange>("hoje");
  const [doneStage, setDoneStage] = useState<DoneStage>("");

  const [tasks, setTasks] = useState<DeliveryTask[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsettled, setUnsettled] = useState<Record<string, DeliveryTask[]>>({});

  // filtros
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [courierF, setCourierF] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // seleção (Prontos)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // diálogos
  const [newOpen, setNewOpen] = useState(false);
  const [newInit, setNewInit] = useState<NewTaskInit | null>(null);
  const [assignList, setAssignList] = useState<DeliveryTask[] | null>(null);
  const [finishTask, setFinishTask] = useState<DeliveryTask | null>(null);
  const [reasonReq, setReasonReq] = useState<ReasonRequest | null>(null);
  const [courierEdit, setCourierEdit] = useState<Courier | "new" | null>(null);
  const [settleFor, setSettleFor] = useState<Courier | null>(null);

  /* ---------- carga ---------- */
  const load = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    const [t, c] = await Promise.all([listTasks(companyId, sinceISO(range)), listCouriers(companyId)]);
    if (t.error) {
      if (isMissingDelivery(t.error)) setMissing(true);
      else setLoadError(t.error.message || String(t.error));
    } else {
      setMissing(false);
      setLoadError(null);
      setTasks(t.data);
    }
    if (!c.error) setCouriers(c.data);
    else if (isMissingDelivery(c.error)) setMissing(true);
    setLoading(false);
  }, [companyId, range]);

  useEffect(() => { load(); }, [load]);
  // o motoqueiro mexe pelo link dele: atualiza sozinho a cada minuto
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === "visible") load(true); }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const loadUnsettled = useCallback(async () => {
    if (!couriers.length) { setUnsettled({}); return; }
    const entries = await Promise.all(couriers.map(async (c) => [c.id, await listUnsettled(c.id)] as const));
    setUnsettled(Object.fromEntries(entries));
  }, [couriers]);
  useEffect(() => { if (tab === "motoqueiros") loadUnsettled(); }, [tab, loadUnsettled]);

  /* ---------- ?nova=venda&id=… / ?nova=os&id=…&tipo=coleta ---------- */
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const nova = params.get("nova");
    const id = params.get("id");
    if ((nova === "venda" || nova === "os") && id) {
      setNewInit({ origin: nova, id, kind: nova === "os" && params.get("tipo") === "coleta" ? "coleta" : "entrega" });
      setNewOpen(true);
      const p = new URLSearchParams(params);
      p.delete("nova"); p.delete("id"); p.delete("tipo");
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  /* ---------- filtros ---------- */
  const courierById = useMemo(() => Object.fromEntries(couriers.map((c) => [c.id, c])) as Record<string, Courier>, [couriers]);
  const activeCouriers = useMemo(() => couriers.filter((c) => c.active), [couriers]);

  const match = useCallback((t: DeliveryTask) => {
    if (kind && t.kind !== kind) return false;
    if (courierF && (courierF === "__none" ? !!t.courier_id : t.courier_id !== courierF)) return false;
    if (dateFrom || dateTo) {
      const d = refDate(t);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }
    const term = q.trim().toLowerCase();
    if (term) {
      const hay = `${t.customer_name || ""} ${t.address || ""} ${t.address_notes || ""} ${t.ref || ""} ${t.phone || ""} ${t.notes || ""}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }, [kind, courierF, dateFrom, dateTo, q]);

  const separarRows = useMemo(() => tasks.filter((t) => t.stage === "separar" && match(t)).sort(byDue), [tasks, match]);
  const prontoRows = useMemo(() => tasks.filter((t) => t.stage === "pronto" && match(t)).sort(byDue), [tasks, match]);
  const ruaRows = useMemo(() => tasks.filter((t) => (t.stage === "atribuida" || t.stage === "em_rota") && match(t)), [tasks, match]);
  const ruaGroups = useMemo(() => {
    const m = new Map<string, DeliveryTask[]>();
    for (const t of ruaRows) {
      const k = t.courier_id || "__none";
      m.set(k, [...(m.get(k) || []), t]);
    }
    return [...m].map(([key, list]) => ({
      key, courier: courierById[key] || null,
      list: list.sort((a, b) => (a.assigned_at || "").localeCompare(b.assigned_at || "")),
    })).sort((a, b) => (a.courier?.name || "~").localeCompare(b.courier?.name || "~", "pt-BR"));
  }, [ruaRows, courierById]);
  const doneRows = useMemo(() => tasks.filter((t) =>
    FINAL_STAGES.includes(t.stage) && (!doneStage || t.stage === doneStage) && match(t),
  ).sort((a, b) => endedAt(b).localeCompare(endedAt(a))), [tasks, doneStage, match]);

  // seleção só vale para o que está na tela
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const vis = new Set(prontoRows.map((t) => t.id));
      const next = new Set([...prev].filter((id) => vis.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [prontoRows]);
  const selectedRows = useMemo(() => prontoRows.filter((t) => selected.has(t.id)), [prontoRows, selected]);
  const allSelected = prontoRows.length > 0 && prontoRows.every((t) => selected.has(t.id));

  /* ---------- números do topo (sem filtro) ---------- */
  const counts = useMemo(() => {
    const separar = tasks.filter((t) => t.stage === "separar");
    const pronto = tasks.filter((t) => t.stage === "pronto");
    const rua = tasks.filter((t) => t.stage === "atribuida" || t.stage === "em_rota");
    const doneToday = tasks.filter((t) => t.stage === "concluida" && isToday(t.done_at));
    const failToday = tasks.filter((t) => t.stage === "falhou" && isToday(t.done_at));
    const lateSeparar = separar.filter((t) => t.due_date && daysUntil(t.due_date) < 0).length;
    return {
      separar: separar.length, lateSeparar,
      pronto: pronto.length, prontoColetas: pronto.filter((t) => t.kind === "coleta").length,
      rua: rua.length, saiu: rua.filter((t) => t.stage === "em_rota").length,
      ruaCobrar: sum(rua.filter((t) => t.kind === "entrega"), (t) => t.collect_amount),
      doneToday: doneToday.length, doneTodayCash: sum(doneToday, (t) => t.collected_amount || 0),
      failToday: failToday.length,
    };
  }, [tasks]);

  /* ---------- etiquetas e resumo ---------- */
  const courierOptions = useMemo(() => [
    ...couriers.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (inativo)` })),
    { value: "__none", label: "Sem motoqueiro" },
  ], [couriers]);
  const activeFilters: ActiveFilter[] = [];
  if (q.trim()) activeFilters.push({ key: "q", label: `Busca: "${q.trim()}"`, onRemove: () => setQ("") });
  if (kind) activeFilters.push({ key: "kind", label: kind === "coleta" ? "Só coletas" : "Só entregas", onRemove: () => setKind("") });
  if (courierF) activeFilters.push({ key: "cour", label: `Motoqueiro: ${courierOptions.find((o) => o.value === courierF)?.label || "—"}`, onRemove: () => setCourierF("") });
  if (dateFrom || dateTo) {
    activeFilters.push({
      key: "date", label: `Dia: ${dateFrom ? fmtDate(dateFrom) : "…"} a ${dateTo ? fmtDate(dateTo) : "…"}`,
      onRemove: () => { setDateFrom(""); setDateTo(""); },
    });
  }
  const panelCount = [courierF, dateFrom || dateTo].filter(Boolean).length;
  function clearFilters() {
    setQ(""); setKind(""); setCourierF(""); setDateFrom(""); setDateTo(""); setDoneStage("");
  }

  const summary = useMemo<SummaryItem[]>(() => {
    if (tab === "separar") {
      return [
        { label: "Entregas", value: String(separarRows.length) },
        { label: "A cobrar", value: formatBRL(sum(separarRows, (t) => t.collect_amount)) },
      ];
    }
    if (tab === "prontos") {
      return [
        { label: "Prontos", value: String(prontoRows.length) },
        { label: "Entregas", value: String(prontoRows.filter((t) => t.kind === "entrega").length) },
        { label: "Coletas", value: String(prontoRows.filter((t) => t.kind === "coleta").length) },
        { label: "A cobrar", value: formatBRL(sum(prontoRows.filter((t) => t.kind === "entrega"), (t) => t.collect_amount)) },
      ];
    }
    if (tab === "rua") {
      return [
        { label: "Motoqueiros", value: String(ruaGroups.length) },
        { label: "Tarefas", value: String(ruaRows.length) },
        { label: "Já saíram", value: String(ruaRows.filter((t) => t.stage === "em_rota").length) },
        { label: "A cobrar", value: formatBRL(sum(ruaRows.filter((t) => t.kind === "entrega"), (t) => t.collect_amount)), tone: "amber" },
      ];
    }
    const ok = doneRows.filter((t) => t.stage === "concluida");
    const fail = doneRows.filter((t) => t.stage === "falhou").length;
    return [
      { label: "Concluídas", value: String(ok.length), tone: "emerald" },
      { label: "Não deu", value: String(fail), tone: fail ? "red" : "muted" },
      { label: "Recebido em mãos", value: formatBRL(sum(ok, (t) => t.collected_amount || 0)) },
      { label: "Taxas", value: formatBRL(sum(doneRows.filter((t) => t.stage === "concluida" || t.stage === "falhou"), (t) => t.fee)), tone: "muted" },
    ];
  }, [tab, separarRows, prontoRows, ruaRows, ruaGroups, doneRows]);

  /* ---------- ações ---------- */
  async function patchTask(t: DeliveryTask, patch: Partial<DeliveryTask>, okTitle: string, okDesc?: string): Promise<string | null> {
    const { error } = await updateTask(t.id, patch);
    if (error) {
      toast({ title: "Não foi possível salvar", description: error, variant: "destructive" });
      return error;
    }
    toast({ title: okTitle, description: okDesc });
    load(true);
    return null;
  }

  const markSeparated = (t: DeliveryTask) => patchTask(t, { stage: "pronto" }, "Separado", "Foi para Prontos.");
  const backToSeparate = (t: DeliveryTask) => patchTask(t, { stage: "separar" }, "Voltou para A separar");
  const pickupAtCounter = (t: DeliveryTask) => patchTask(
    t, { stage: "retirada" }, "Cliente vai retirar", "Saiu da expedição e ficou em Concluídas como retirado no balcão.",
  );
  const takeFromCourier = (t: DeliveryTask) => patchTask(
    t, { stage: "pronto", courier_id: null, assigned_at: null, started_at: null, fee: 0 },
    "Tirado do motoqueiro", "Voltou para Prontos.",
  );
  const backToQueue = (t: DeliveryTask) => patchTask(t, {
    stage: "pronto", courier_id: null, assigned_at: null, started_at: null, done_at: null, fail_reason: null, fee: 0,
    collected_amount: null, collected_method: null, received_by: null,
  }, "Voltou para a fila", "Está em Prontos para atribuir de novo.");
  const reopen = (t: DeliveryTask) => patchTask(
    t, { stage: t.kind === "coleta" ? "pronto" : "separar", done_at: null },
    "Reaberta", t.kind === "coleta" ? "Está em Prontos." : "Está em A separar.",
  );

  function cancelTask(t: DeliveryTask) {
    setReasonReq({
      title: `Cancelar ${KIND_LABEL[t.kind].toLowerCase()}`,
      description: `${t.customer_name || "Cliente"}${t.ref ? ` · ${t.ref}` : ""}. Sai da expedição; a venda/OS não muda.`,
      confirmLabel: "Cancelar tarefa",
      destructive: true,
      required: false,
      placeholder: "Ex.: cliente desistiu da entrega",
      onConfirm: async (reason) => {
        const notes = reason ? `${t.notes ? `${t.notes} · ` : ""}Cancelada: ${reason}` : t.notes;
        return patchTask(t, { stage: "cancelada", notes }, "Tarefa cancelada");
      },
    });
  }

  function failTask(t: DeliveryTask) {
    setReasonReq({
      title: "Não deu",
      description: `${KIND_LABEL[t.kind]} · ${t.customer_name || "cliente"}${t.ref ? ` · ${t.ref}` : ""}. A taxa do motoqueiro continua valendo no acerto.`,
      confirmLabel: "Marcar como não deu",
      destructive: true,
      placeholder: "Ex.: ninguém em casa; endereço não encontrado",
      onConfirm: (reason) => patchTask(
        t, { stage: "falhou", done_at: new Date().toISOString(), fail_reason: reason },
        "Marcado como não deu", "Em Concluídas dá para voltar a tarefa para a fila.",
      ),
    });
  }

  async function resendAlert(t: DeliveryTask) {
    const c = t.courier_id ? courierById[t.courier_id] : null;
    if (!c) { toast({ title: "Tarefa sem motoqueiro", variant: "destructive" }); return; }
    if (!c.whatsapp) {
      toast({ title: `${c.name} não tem WhatsApp cadastrado`, description: "Copie o link dele e mande por outro meio.", variant: "destructive" });
      return;
    }
    const r = await sendWhatsApp(c.whatsapp, courierMessage(c, [t], user?.company_name), { companyId, userId: user?.id });
    toast(r.ok
      ? { title: "Alerta reenviado", description: r.mode === "wame" ? "Abrimos o WhatsApp com a mensagem pronta." : `Mensagem enviada para ${c.name}.` }
      : { title: "O WhatsApp não saiu", description: r.error || "Copie o link do motoqueiro e mande por outro meio.", variant: "destructive" });
  }

  async function copyCourierLink(c: Courier) {
    const ok = await copyText(courierLink(c.access_token));
    toast(ok
      ? { title: "Link copiado", description: `Mande para ${c.name}. Por ele, ele vê as tarefas e marca entregue.` }
      : { title: "Não consegui copiar", description: courierLink(c.access_token), variant: "destructive" });
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  /* ---------- menus das linhas ---------- */
  function OpenMenu({ t }: { t: DeliveryTask }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {t.stage === "pronto" && (
            <DropdownMenuItem onClick={() => setAssignList([t])}><Bike className="mr-2 h-4 w-4" /> Atribuir só esta</DropdownMenuItem>
          )}
          {t.stage === "pronto" && t.kind === "entrega" && (
            <DropdownMenuItem onClick={() => backToSeparate(t)}><Undo2 className="mr-2 h-4 w-4" /> Voltar para A separar</DropdownMenuItem>
          )}
          {t.kind === "entrega" && (
            <DropdownMenuItem onClick={() => pickupAtCounter(t)}><Store className="mr-2 h-4 w-4" /> Cliente vai retirar</DropdownMenuItem>
          )}
          {t.sale_id && (
            <DropdownMenuItem asChild><Link to={`/sales/${t.sale_id}`}><Receipt className="mr-2 h-4 w-4" /> Abrir venda</Link></DropdownMenuItem>
          )}
          {t.service_order_id && (
            <DropdownMenuItem asChild><Link to={`/service-orders/${t.service_order_id}`}><Wrench className="mr-2 h-4 w-4" /> Abrir OS</Link></DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => cancelTask(t)} className="text-red-700 dark:text-red-400"><Ban className="mr-2 h-4 w-4" /> Cancelar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function RuaMenu({ t }: { t: DeliveryTask }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => failTask(t)}><XCircle className="mr-2 h-4 w-4" /> Não deu</DropdownMenuItem>
          <DropdownMenuItem onClick={() => resendAlert(t)}><Send className="mr-2 h-4 w-4" /> Reenviar alerta</DropdownMenuItem>
          <DropdownMenuItem onClick={() => takeFromCourier(t)}><UserMinus className="mr-2 h-4 w-4" /> Tirar do motoqueiro</DropdownMenuItem>
          {(t.sale_id || t.service_order_id) && <DropdownMenuSeparator />}
          {t.sale_id && (
            <DropdownMenuItem asChild><Link to={`/sales/${t.sale_id}`}><Receipt className="mr-2 h-4 w-4" /> Abrir venda</Link></DropdownMenuItem>
          )}
          {t.service_order_id && (
            <DropdownMenuItem asChild><Link to={`/service-orders/${t.service_order_id}`}><Wrench className="mr-2 h-4 w-4" /> Abrir OS</Link></DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  /* ---------- render ---------- */
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <Truck className="h-5 w-5 text-primary" /> Expedição e entregas
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Separe o pedido, passe para o motoqueiro e acompanhe até a entrega. Ele recebe o endereço e o valor a cobrar no
          WhatsApp e marca entregue pelo link dele.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="icon" onClick={() => load()} disabled={loading || missing} aria-label="Atualizar" title="Atualizar">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button onClick={() => { setNewInit(null); setNewOpen(true); }} disabled={missing || !companyId}>
          <Plus className="mr-2 h-4 w-4" /> Nova entrega / coleta
        </Button>
      </div>
    </div>
  );

  if (missing) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex items-start gap-2 rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {MISSING_DELIVERY_MSG}
        </div>
      </div>
    );
  }

  const showFilters = tab !== "motoqueiros";
  const tabs: [Tab, string][] = [
    ["separar", `A separar${counts.separar ? ` (${counts.separar})` : ""}`],
    ["prontos", `Prontos${counts.pronto ? ` (${counts.pronto})` : ""}`],
    ["rua", `Na rua${counts.rua ? ` (${counts.rua})` : ""}`],
    ["concluidas", "Concluídas"],
    ["motoqueiros", "Motoqueiros"],
  ];

  return (
    <div className="space-y-6">
      {header}

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile
          label="A separar"
          tone={counts.lateSeparar ? "crit" : counts.separar ? "warn" : "default"}
          value={loading ? "—" : String(counts.separar)}
          sub={counts.lateSeparar ? `${counts.lateSeparar} atrasada${counts.lateSeparar > 1 ? "s" : ""}` : "entregas de venda"}
          active={tab === "separar"}
          onClick={() => setTab("separar")}
        />
        <Tile
          label="Prontos"
          tone={counts.pronto ? "serious" : "default"}
          value={loading ? "—" : String(counts.pronto)}
          sub={counts.prontoColetas ? `${counts.prontoColetas} coleta${counts.prontoColetas > 1 ? "s" : ""}` : "esperando motoqueiro"}
          active={tab === "prontos"}
          onClick={() => setTab("prontos")}
        />
        <Tile
          label="Na rua"
          tone="default"
          value={loading ? "—" : String(counts.rua)}
          sub={counts.rua ? `${counts.saiu} já saíram · cobrar ${formatBRL(counts.ruaCobrar)}` : undefined}
          active={tab === "rua"}
          onClick={() => setTab("rua")}
        />
        <Tile
          label="Concluídas hoje"
          tone="good"
          value={loading ? "—" : String(counts.doneToday)}
          sub={counts.doneTodayCash > 0 ? `recebido em mãos ${formatBRL(counts.doneTodayCash)}` : undefined}
          active={tab === "concluidas" && range === "hoje" && doneStage === "concluida"}
          onClick={() => { setTab("concluidas"); setRange("hoje"); setDoneStage("concluida"); }}
        />
        <Tile
          label="Não deu (hoje)"
          tone={counts.failToday ? "crit" : "default"}
          value={loading ? "—" : String(counts.failToday)}
          sub={counts.failToday ? "volte para a fila em Concluídas" : undefined}
          active={tab === "concluidas" && range === "hoje" && doneStage === "falhou"}
          onClick={() => { setTab("concluidas"); setRange("hoje"); setDoneStage("falhou"); }}
        />
      </div>

      {/* Abas */}
      <div className="flex flex-wrap items-center gap-1 border-b">
        {tabs.map(([k, label]) => (
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
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {tab === "concluidas" && ([["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                range === k ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:text-foreground"
              }`}>{label}</button>
          ))}
          {tab === "concluidas" && (
            <select value={doneStage} onChange={(e) => setDoneStage(e.target.value as DoneStage)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Situação">
              <option value="">Todas as situações</option>
              <option value="concluida">Concluídas</option>
              <option value="falhou">Não deu</option>
              <option value="retirada">Retirado no balcão</option>
              <option value="cancelada">Canceladas</option>
            </select>
          )}
          {tab !== "separar" && (
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Tipo">
              <option value="">Entregas e coletas</option>
              {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <MoreFiltersButton count={panelCount}>
            <FilterField label="Motoqueiro">
              <FilterSelect value={courierF} onChange={setCourierF} options={courierOptions} />
            </FilterField>
            <FilterField label={tab === "concluidas" ? "Dia em que terminou" : "Dia previsto"}>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" aria-label="De" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" aria-label="Até" />
              </div>
              <div className="flex gap-3 pt-0.5 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => { const d = localISODate(); setDateFrom(d); setDateTo(d); }}>Hoje</button>
                {(dateFrom || dateTo) && <button type="button" className="text-muted-foreground hover:underline" onClick={() => { setDateFrom(""); setDateTo(""); }}>Qualquer dia</button>}
              </div>
            </FilterField>
          </MoreFiltersButton>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, endereço ou nº da venda/OS" className="h-8 pl-8 text-sm" />
          </div>
        </div>
      )}

      {showFilters && (activeFilters.length > 0 || (!loading && !loadError)) && (
        <div className="space-y-2">
          <ActiveFilterChips filters={activeFilters} onClearAll={clearFilters} />
          {!loading && !loadError && <FilterSummary items={summary} />}
        </div>
      )}

      {/* Barra da seleção (Prontos) */}
      {tab === "prontos" && (
        <div className={`flex flex-wrap items-center gap-2 rounded-[10px] border px-4 py-2.5 text-sm ${selectedRows.length ? "border-primary/40 bg-accent/40" : "bg-card"}`}>
          {selectedRows.length ? (
            <span>
              <strong>{selectedRows.length}</strong> selecionada{selectedRows.length > 1 ? "s" : ""}
              {sum(selectedRows.filter((t) => t.kind === "entrega"), (t) => t.collect_amount) > 0 && (
                <> · cobrar <strong className="num">{formatBRL(sum(selectedRows.filter((t) => t.kind === "entrega"), (t) => t.collect_amount))}</strong></>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Marque as tarefas que vão juntas e atribua ao motoqueiro.</span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!activeCouriers.length}><Link2 className="mr-1.5 h-4 w-4" /> Copiar link do motoqueiro</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Link de quem?</DropdownMenuLabel>
                {activeCouriers.map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => copyCourierLink(c)}><Copy className="mr-2 h-4 w-4" /> {c.name}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {selectedRows.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>}
            <Button size="sm" disabled={!selectedRows.length} onClick={() => setAssignList(selectedRows)}>
              <Bike className="mr-1.5 h-4 w-4" /> Atribuir ao motoqueiro
            </Button>
          </div>
        </div>
      )}

      {/* Conteúdo */}
      {loading ? (
        <div className="flex items-center justify-center rounded-[10px] border bg-card py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…
        </div>
      ) : loadError ? (
        <div className="rounded-[10px] border bg-card"><Empty>Não foi possível carregar: {loadError}</Empty></div>
      ) : tab === "separar" ? (
        <div className="overflow-x-auto rounded-[10px] border bg-card">
          {separarRows.length === 0 ? (
            <Empty>
              <CheckCircle2 className="mx-auto mb-2 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              {activeFilters.length ? "Nada a separar com esses filtros." : "Nada esperando separação."}
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead className="text-right">A cobrar</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {separarRows.map((t) => (
                  <TableRow key={t.id} className={t.due_date && daysUntil(t.due_date) < 0 ? "bg-red-500/[0.04]" : ""}>
                    <TableCell><DueCell due={t.due_date} /></TableCell>
                    <TableCell><CustomerCell t={t} showKind={false} /></TableCell>
                    <TableCell><AddressCell t={t} /></TableCell>
                    <TableCell className="text-right"><MoneyCell t={t} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" onClick={() => markSeparated(t)}><PackageCheck className="mr-1.5 h-4 w-4" /> Separado</Button>
                        <OpenMenu t={t} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : tab === "prontos" ? (
        <div className="overflow-x-auto rounded-[10px] border bg-card">
          {prontoRows.length === 0 ? (
            <Empty>{activeFilters.length ? "Nada pronto com esses filtros." : "Nada pronto para sair."}</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(v) => setSelected(v ? new Set(prontoRows.map((t) => t.id)) : new Set())}
                      aria-label="Selecionar todas"
                    />
                  </TableHead>
                  <TableHead>Dia</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead className="text-right">A cobrar</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {prontoRows.map((t) => (
                  <TableRow key={t.id} data-state={selected.has(t.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} aria-label="Selecionar" />
                    </TableCell>
                    <TableCell><DueCell due={t.due_date} /></TableCell>
                    <TableCell><CustomerCell t={t} /></TableCell>
                    <TableCell><AddressCell t={t} /></TableCell>
                    <TableCell className="text-right"><MoneyCell t={t} /></TableCell>
                    <TableCell className="text-right"><OpenMenu t={t} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : tab === "rua" ? (
        ruaGroups.length === 0 ? (
          <div className="rounded-[10px] border bg-card">
            <Empty>{activeFilters.length ? "Nada na rua com esses filtros." : "Nenhum motoqueiro com tarefa agora."}</Empty>
          </div>
        ) : (
          <div className="space-y-4">
            {ruaGroups.map((g) => {
              const cobrar = sum(g.list.filter((t) => t.kind === "entrega"), (t) => t.collect_amount);
              return (
                <div key={g.key} className="overflow-hidden rounded-[10px] border bg-card">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      <Bike className="h-4 w-4 text-primary" /> {g.courier?.name || "Sem motoqueiro"}
                    </div>
                    {g.courier?.whatsapp && <span className="num text-xs text-muted-foreground">{formatPhone(g.courier.whatsapp)}</span>}
                    <span className="text-xs text-muted-foreground">
                      {g.list.length} tarefa{g.list.length > 1 ? "s" : ""}
                      {cobrar > 0 && <> · cobrar <strong className="num text-foreground">{formatBRL(cobrar)}</strong></>}
                    </span>
                    {g.courier && (
                      <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => copyCourierLink(g.courier!)}>
                        <Link2 className="mr-1.5 h-3.5 w-3.5" /> Copiar link
                      </Button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Saída</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Endereço</TableHead>
                          <TableHead className="text-right">A cobrar</TableHead>
                          <TableHead className="w-56" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.list.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="whitespace-nowrap">
                              {t.stage === "em_rota" ? (
                                <div className="num font-medium">saiu {fmtTime(t.started_at)}</div>
                              ) : (
                                <StageBadge stage={t.stage} />
                              )}
                              <div className="text-xs text-muted-foreground">atribuída {fmtTime(t.assigned_at)}</div>
                            </TableCell>
                            <TableCell><CustomerCell t={t} /></TableCell>
                            <TableCell><AddressCell t={t} /></TableCell>
                            <TableCell className="text-right"><MoneyCell t={t} /></TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => setFinishTask(t)}>
                                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> {t.kind === "coleta" ? "Coletado" : "Entregue"}
                                </Button>
                                <RuaMenu t={t} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === "concluidas" ? (
        <div className="overflow-x-auto rounded-[10px] border bg-card">
          {doneRows.length === 0 ? (
            <Empty>{activeFilters.length || doneStage ? "Nada com esses filtros." : range === "hoje" ? "Nada finalizado hoje ainda." : "Nada finalizado nesse período."}</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Motoqueiro</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead>Quem recebeu / motivo</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {doneRows.map((t) => {
                  const c = t.courier_id ? courierById[t.courier_id] : null;
                  const settled = !!t.settlement_id;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="num whitespace-nowrap">{fmtTime(endedAt(t))}</TableCell>
                      <TableCell><CustomerCell t={t} /></TableCell>
                      <TableCell>
                        {c ? <div className="text-sm">{c.name}</div> : <span className="text-xs text-muted-foreground">—</span>}
                        {c && t.fee > 0 && <div className="num text-xs text-muted-foreground">taxa {formatBRL(t.fee)}{settled ? " · acertada" : ""}</div>}
                      </TableCell>
                      <TableCell><StageBadge stage={t.stage} /></TableCell>
                      <TableCell className="text-right">
                        {t.stage === "concluida" && (t.collected_amount || 0) > 0 ? (
                          <>
                            <div className="num font-medium">{formatBRL(t.collected_amount || 0)}</div>
                            <div className="text-xs text-muted-foreground">{t.collected_method ? METHOD_LABEL[t.collected_method] || t.collected_method : "forma não informada"}</div>
                          </>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm">
                        {t.stage === "falhou"
                          ? <span className="text-red-700 dark:text-red-400">{t.fail_reason || "sem motivo"}</span>
                          : t.stage === "concluida"
                            ? (t.received_by || <span className="text-xs text-muted-foreground">não informado</span>)
                            : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.stage === "falhou" && (
                          <Button size="sm" variant="outline" disabled={settled}
                            title={settled ? "Já entrou num acerto do motoqueiro." : "Volta para Prontos"}
                            onClick={() => backToQueue(t)}>
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Voltar para a fila
                          </Button>
                        )}
                        {(t.stage === "retirada" || t.stage === "cancelada") && (
                          <Button size="sm" variant="ghost" onClick={() => reopen(t)}>
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reabrir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      ) : (
        <CouriersPanel
          couriers={couriers}
          unsettled={unsettled}
          canEdit={canEditCouriers}
          canSettle={canSettle}
          onNew={() => setCourierEdit("new")}
          onEdit={(c) => setCourierEdit(c)}
          onCopy={copyCourierLink}
          onSettle={(c) => setSettleFor(c)}
        />
      )}

      {/* Diálogos */}
      {companyId && (
        <NewTaskDialog
          open={newOpen}
          init={newInit}
          companyId={companyId}
          openTasks={tasks.filter((t) => OPEN_STAGES.includes(t.stage))}
          onClose={() => { setNewOpen(false); setNewInit(null); }}
          onCreated={(stage) => { setNewOpen(false); setNewInit(null); setTab(stage === "pronto" ? "prontos" : "separar"); load(true); }}
        />
      )}
      {companyId && (
        <AssignDialog
          list={assignList}
          couriers={activeCouriers}
          companyId={companyId}
          companyName={user?.company_name || null}
          userId={user?.id || null}
          onClose={() => setAssignList(null)}
          onAssigned={() => { setSelected(new Set()); load(true); }}
          onGoCouriers={() => { setAssignList(null); setTab("motoqueiros"); }}
        />
      )}
      <FinishDialog task={finishTask} onClose={() => setFinishTask(null)} onDone={() => { setFinishTask(null); load(true); }} />
      {companyId && (
        <CourierDialog
          value={courierEdit}
          companyId={companyId}
          onClose={() => setCourierEdit(null)}
          onSaved={() => { setCourierEdit(null); load(true); }}
        />
      )}
      <SettleDialog
        courier={settleFor}
        tasks={settleFor ? unsettled[settleFor.id] || [] : []}
        onClose={() => setSettleFor(null)}
        onDone={() => { setSettleFor(null); load(true); loadUnsettled(); }}
      />
      <ReasonDialog request={reasonReq} onClose={() => setReasonReq(null)} />
    </div>
  );
}

/* =====================================================================
   Aba Motoqueiros: cadastro + acerto
===================================================================== */
function CouriersPanel({
  couriers, unsettled, canEdit, canSettle, onNew, onEdit, onCopy, onSettle,
}: {
  couriers: Courier[]; unsettled: Record<string, DeliveryTask[]>; canEdit: boolean; canSettle: boolean;
  onNew: () => void; onEdit: (c: Courier) => void; onCopy: (c: Courier) => void; onSettle: (c: Courier) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex max-w-3xl flex-1 items-start gap-2 rounded-[10px] border bg-muted/30 px-4 py-3 text-sm">
          <HandCoins className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="text-muted-foreground">
            No <strong className="text-foreground">acerto</strong>, as taxas das tarefas feitas viram uma conta a pagar para o motoqueiro.
            O dinheiro que ele recebeu do cliente serve para conferir o que ele trouxe; a baixa desse valor é dada em{" "}
            <Link to="/financeiro/receber" className="font-medium text-primary hover:underline">Contas a receber</Link>.
          </div>
        </div>
        {canEdit && <Button onClick={onNew} className="ml-auto"><Plus className="mr-2 h-4 w-4" /> Novo motoqueiro</Button>}
      </div>

      <div className="overflow-x-auto rounded-[10px] border bg-card">
        {couriers.length === 0 ? (
          <Empty>
            Nenhum motoqueiro cadastrado.
            {canEdit ? " Cadastre o primeiro para começar a atribuir entregas." : " Peça a um admin ou gerente para cadastrar."}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Motoqueiro</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead className="text-right">Por entrega</TableHead>
                <TableHead className="text-right">Por coleta</TableHead>
                <TableHead>Falta acertar</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((c) => {
                const pend = unsettled[c.id];
                const fees = pend ? sum(pend, (t) => t.fee) : 0;
                const cash = pend ? sum(pend, (t) => t.collected_amount || 0) : 0;
                return (
                  <TableRow key={c.id} className={c.active ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        {c.name}
                        {!c.active && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">inativo</span>}
                      </div>
                      {c.notes && <div className="max-w-xs truncate text-xs text-muted-foreground" title={c.notes}>{c.notes}</div>}
                    </TableCell>
                    <TableCell className="num text-sm">
                      {c.whatsapp ? formatPhone(c.whatsapp) : <span className="text-xs text-amber-800 dark:text-amber-400">sem WhatsApp</span>}
                    </TableCell>
                    <TableCell className="num text-right">{formatBRL(c.fee_delivery)}</TableCell>
                    <TableCell className="num text-right">{formatBRL(c.fee_pickup)}</TableCell>
                    <TableCell className="text-sm">
                      {!pend ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        : pend.length === 0 ? <span className="text-xs text-muted-foreground">nada pendente</span>
                        : (
                          <div>
                            <div><strong>{pend.length}</strong> tarefa{pend.length > 1 ? "s" : ""} · taxas <strong className="num">{formatBRL(fees)}</strong></div>
                            <div className="text-xs text-muted-foreground">recebeu em mãos <span className="num">{formatBRL(cash)}</span></div>
                          </div>
                        )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canSettle && pend && pend.length > 0 && (
                          <Button size="sm" onClick={() => onSettle(c)}><HandCoins className="mr-1.5 h-4 w-4" /> Fazer acerto</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => onCopy(c)} title="Copiar o link do motoqueiro"><Link2 className="mr-1 h-3.5 w-3.5" /> Link</Button>
                        {canEdit && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(c)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
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
    </div>
  );
}

/* ---------- cadastro do motoqueiro ---------- */
function CourierDialog({
  value, companyId, onClose, onSaved,
}: { value: Courier | "new" | null; companyId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const editing = value && value !== "new" ? value : null;
  const [name, setName] = useState("");
  const [whats, setWhats] = useState("");
  const [feeD, setFeeD] = useState(0);
  const [feeP, setFeeP] = useState(0);
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    const c = value === "new" ? null : value;
    setName(c?.name || "");
    setWhats(c?.whatsapp ? formatPhone(c.whatsapp) : "");
    setFeeD(c?.fee_delivery ?? 0);
    setFeeP(c?.fee_pickup ?? 0);
    setActive(c?.active ?? true);
    setNotes(c?.notes || "");
    setSaving(false);
  }, [value]);

  async function save() {
    if (!name.trim()) { toast({ title: "Informe o nome", variant: "destructive" }); return; }
    const digits = whats.replace(/\D/g, "");
    if (digits && digits.length < 10) { toast({ title: "WhatsApp incompleto", description: "Coloque com DDD.", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await saveCourier({
      id: editing?.id, company_id: companyId, name, whatsapp: digits || null,
      fee_delivery: feeD, fee_pickup: feeP, active, notes,
    });
    setSaving(false);
    if (error) { toast({ title: "Não foi possível salvar", description: error, variant: "destructive" }); return; }
    toast({ title: editing ? "Motoqueiro atualizado" : "Motoqueiro cadastrado" });
    onSaved();
  }

  return (
    <Dialog open={!!value} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar motoqueiro" : "Novo motoqueiro"}</DialogTitle>
          <DialogDescription>O alerta de cada entrega vai para o WhatsApp dele, com o link para marcar entregue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cr-name" className="text-xs">Nome *</Label>
            <Input id="cr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João da moto" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-whats" className="text-xs">WhatsApp</Label>
            <Input id="cr-whats" value={whats} onChange={(e) => setWhats(formatPhone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Valor por entrega</Label>
              <MoneyInput value={feeD} onChange={setFeeD} className="text-right" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Valor por coleta</Label>
              <MoneyInput value={feeP} onChange={setFeeP} className="text-right" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-notes" className="text-xs">Observação <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="cr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: só atende à tarde; placa ABC1D23" />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm">
            <span>
              Ativo
              <span className="block text-xs text-muted-foreground">Inativo some da lista de atribuição e o link dele para de abrir.</span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- acerto ---------- */
function SettleDialog({
  courier, tasks, onClose, onDone,
}: { courier: Courier | null; tasks: DeliveryTask[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // só ao abrir: a lista se atualiza sozinha a cada minuto e não pode desmarcar o que o usuário escolheu
  useEffect(() => {
    if (!courier) return;
    setChecked(new Set(tasks.map((t) => t.id)));
    setNotes("");
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courier]);

  const picked = tasks.filter((t) => checked.has(t.id));
  const fees = sum(picked, (t) => t.fee);
  const cash = sum(picked, (t) => t.collected_amount || 0);
  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of picked) {
      const v = t.collected_amount || 0;
      if (v <= 0) continue;
      const k = t.collected_method ? METHOD_LABEL[t.collected_method] || t.collected_method : "Forma não informada";
      m.set(k, (m.get(k) || 0) + v);
    }
    return [...m];
  }, [picked]);

  async function confirm() {
    if (!courier || !picked.length) return;
    setSaving(true);
    const { error } = await settleCourier(courier.id, picked.map((t) => t.id), notes);
    setSaving(false);
    if (error) { toast({ title: "Não foi possível fazer o acerto", description: error, variant: "destructive" }); return; }
    toast({
      title: "Acerto feito",
      description: fees > 0 ? `${formatBRL(fees)} entrou em Contas a pagar para ${courier.name}.` : "Sem taxa a pagar nessas tarefas.",
    });
    onDone();
  }

  return (
    <Dialog open={!!courier} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Acerto · {courier?.name}</DialogTitle>
          <DialogDescription>
            Confira as tarefas. As taxas viram uma conta a pagar; o dinheiro recebido é para conferir o que ele trouxe.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[42vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={tasks.length > 0 && picked.length === tasks.length}
                    onCheckedChange={(v) => setChecked(v ? new Set(tasks.map((t) => t.id)) : new Set())}
                    aria-label="Marcar todas"
                  />
                </TableHead>
                <TableHead>Quando</TableHead>
                <TableHead>Tarefa</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">Recebeu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Checkbox
                      checked={checked.has(t.id)}
                      onCheckedChange={(v) => setChecked((prev) => { const n = new Set(prev); if (v) n.add(t.id); else n.delete(t.id); return n; })}
                      aria-label="Marcar"
                    />
                  </TableCell>
                  <TableCell className="num whitespace-nowrap text-xs">{fmtTime(t.done_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm"><KindChip kind={t.kind} /> {t.customer_name || "Sem cliente"}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t.ref && <span className="font-mono">{t.ref}</span>}
                      {t.stage === "falhou" && <span className="text-red-700 dark:text-red-400">não deu: {t.fail_reason || "sem motivo"}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="num text-right">{formatBRL(t.fee)}</TableCell>
                  <TableCell className="text-right">
                    {(t.collected_amount || 0) > 0 ? (
                      <>
                        <div className="num">{formatBRL(t.collected_amount || 0)}</div>
                        <div className="text-[11px] text-muted-foreground">{t.collected_method ? METHOD_LABEL[t.collected_method] || t.collected_method : "forma não informada"}</div>
                      </>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-muted/60 px-3 py-2.5 text-sm">
            <div className="text-xs text-muted-foreground">Taxas ({picked.length} tarefa{picked.length === 1 ? "" : "s"})</div>
            <div className="num text-lg font-semibold">{formatBRL(fees)}</div>
            <div className="text-[11px] text-muted-foreground">vai para Contas a pagar</div>
          </div>
          <div className="rounded-md bg-muted/60 px-3 py-2.5 text-sm">
            <div className="text-xs text-muted-foreground">Recebido em mãos</div>
            <div className="num text-lg font-semibold">{formatBRL(cash)}</div>
            {byMethod.length > 0 ? (
              <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
                {byMethod.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><span>{k}</span><span className="num">{formatBRL(v)}</span></div>)}
              </div>
            ) : <div className="text-[11px] text-muted-foreground">nada recebido do cliente</div>}
          </div>
        </div>
        {cash > 0 && (
          <p className="text-xs text-muted-foreground">
            Depois de conferir, dê a baixa desses valores em{" "}
            <Link to="/financeiro/receber" className="text-primary hover:underline">Contas a receber</Link>.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="settle-notes" className="text-xs">Observação <span className="text-muted-foreground">(opcional)</span></Label>
          <Input id="settle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: acerto da semana; trouxe R$ 50 a menos" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={saving || !picked.length}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
            Fazer acerto · {formatBRL(fees)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- atribuir ao motoqueiro ---------- */
function AssignDialog({
  list, couriers, companyId, companyName, userId, onClose, onAssigned, onGoCouriers,
}: {
  list: DeliveryTask[] | null; couriers: Courier[]; companyId: string; companyName: string | null; userId: string | null;
  onClose: () => void; onAssigned: () => void; onGoCouriers: () => void;
}) {
  const { toast } = useToast();
  const [courierId, setCourierId] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ courier: Courier; tasks: DeliveryTask[]; sent: boolean; channel?: string } | null>(null);

  // só ao abrir (a lista de motoqueiros é recarregada depois de atribuir e não pode apagar o resultado)
  useEffect(() => {
    if (!list) return;
    setCourierId(couriers.length === 1 ? couriers[0].id : "");
    setSaving(false);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const courier = couriers.find((c) => c.id === courierId) || null;
  const tasks = list || [];
  const feeOf = (t: DeliveryTask) => (courier ? (t.kind === "coleta" ? courier.fee_pickup : courier.fee_delivery) : 0);
  const totalFee = sum(tasks, feeOf);
  const cobrar = sum(tasks.filter((t) => t.kind === "entrega"), (t) => t.collect_amount);

  async function confirm() {
    if (!courier || !tasks.length) return;
    setSaving(true);
    const r = await assignTasks({ companyId, companyName, userId, courier, tasks });
    setSaving(false);
    if (r.error) { toast({ title: "Não foi possível atribuir", description: r.error, variant: "destructive" }); return; }
    onAssigned();
    if (!courier.whatsapp) {
      toast({ title: `Atribuído a ${courier.name}`, description: "Ele não tem WhatsApp cadastrado: copie o link e mande por outro meio." });
    } else if (r.sent) {
      toast({ title: `Atribuído a ${courier.name}`, description: r.channel === "wame" ? "Abrimos o WhatsApp com a mensagem pronta." : "Alerta enviado no WhatsApp dele." });
    } else {
      toast({ title: `Atribuído a ${courier.name}, mas o WhatsApp não saiu`, description: "Copie a mensagem e mande por outro meio.", variant: "destructive" });
    }
    setResult({ courier, tasks, sent: r.sent, channel: r.channel });
  }

  async function copy(text: string, what: string) {
    const ok = await copyText(text);
    toast({ title: ok ? `${what} copiado` : "Não consegui copiar", variant: ok ? "default" : "destructive" });
  }

  return (
    <Dialog open={!!list} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Com {result.courier.name}</DialogTitle>
              <DialogDescription>
                {result.tasks.length} tarefa{result.tasks.length > 1 ? "s" : ""} atribuída{result.tasks.length > 1 ? "s" : ""}.
              </DialogDescription>
            </DialogHeader>
            <div className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${
              result.sent ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/10 text-amber-900 dark:text-amber-300"
            }`}>
              {result.sent ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {!result.courier.whatsapp
                  ? "Ele não tem WhatsApp cadastrado. Mande o link ou a mensagem por outro meio."
                  : result.sent
                    ? result.channel === "wame" ? "Abrimos o WhatsApp com a mensagem pronta; é só enviar." : "Alerta enviado no WhatsApp dele, com endereço e link."
                    : "O WhatsApp não saiu. Copie a mensagem e mande por outro meio."}
              </span>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => copy(courierMessage(result.courier, result.tasks, companyName), "Mensagem")}>
                <MessageCircle className="mr-2 h-4 w-4" /> Copiar mensagem
              </Button>
              <Button variant="outline" onClick={() => copy(courierLink(result.courier.access_token), "Link")}>
                <Link2 className="mr-2 h-4 w-4" /> Copiar link do motoqueiro
              </Button>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Atribuir ao motoqueiro</DialogTitle>
              <DialogDescription>
                {tasks.length} tarefa{tasks.length > 1 ? "s" : ""}
                {cobrar > 0 ? ` · cobrar ${formatBRL(cobrar)} na entrega` : ""}. Ele recebe tudo numa mensagem no WhatsApp.
              </DialogDescription>
            </DialogHeader>

            {couriers.length === 0 ? (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">Nenhum motoqueiro ativo cadastrado.</p>
                <Button variant="outline" onClick={onGoCouriers}>Ir para Motoqueiros</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="as-courier" className="text-xs">Motoqueiro</Label>
                  <select id="as-courier" value={courierId} onChange={(e) => setCourierId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    <option value="">Escolha…</option>
                    {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.whatsapp ? "" : " (sem WhatsApp)"}</option>)}
                  </select>
                  {courier && !courier.whatsapp && (
                    <p className="text-xs text-amber-800 dark:text-amber-400">Sem WhatsApp cadastrado: o alerta não sai, mas dá para copiar o link depois.</p>
                  )}
                </div>

                <div className="max-h-[36vh] space-y-1.5 overflow-y-auto pr-1">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><KindChip kind={t.kind} /> <span className="truncate font-medium">{t.customer_name || "Sem cliente"}</span></div>
                        <div className="truncate text-xs text-muted-foreground">{t.address || "sem endereço"}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        {t.kind === "entrega" && t.collect_amount > 0 && <div className="num">cobrar {formatBRL(t.collect_amount)}</div>}
                        {courier && <div className="num text-muted-foreground">taxa {formatBRL(feeOf(t))}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {courier && (
                  <div className="flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      Taxa do motoqueiro ({formatBRL(courier.fee_delivery)} por entrega · {formatBRL(courier.fee_pickup)} por coleta)
                    </span>
                    <span className="num font-semibold">{formatBRL(totalFee)}</span>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              {couriers.length > 0 && (
                <Button onClick={confirm} disabled={saving || !courier}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Atribuir e avisar
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- entregue / coletado (pelo escritório) ---------- */
function FinishDialog({ task, onClose, onDone }: { task: DeliveryTask | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("dinheiro");
  const [receivedBy, setReceivedBy] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setAmount(task.kind === "entrega" ? task.collect_amount : 0);
    setMethod("dinheiro");
    setReceivedBy("");
    setSaving(false);
  }, [task]);

  async function confirm() {
    if (!task) return;
    setSaving(true);
    const now = new Date().toISOString();
    const { error } = await updateTask(task.id, {
      stage: "concluida", done_at: now, started_at: task.started_at || now,
      collected_amount: amount, collected_method: amount > 0 ? method : null,
      received_by: receivedBy.trim() || null, fail_reason: null,
    });
    if (error) { setSaving(false); toast({ title: "Não foi possível salvar", description: error, variant: "destructive" }); return; }
    // mesmo efeito do link do motoqueiro: venda faturada / OS concluída viram "entregue"
    if (task.kind === "entrega" && task.sale_id) {
      const { data: s } = await db.from("sales").select("status, delivery_date").eq("id", task.sale_id).maybeSingle();
      if (s?.status === "faturado") {
        await db.from("sales").update({ status: "entregue", delivery_date: s.delivery_date || localISODate() }).eq("id", task.sale_id).eq("status", "faturado");
      }
    } else if (task.kind === "entrega" && task.service_order_id) {
      await db.from("service_orders").update({ status: "entregue" }).eq("id", task.service_order_id).eq("status", "concluida");
    }
    setSaving(false);
    toast({
      title: task.kind === "coleta" ? "Coleta registrada" : "Entrega registrada",
      description: amount > 0 ? `Recebido ${formatBRL(amount)} (${METHOD_LABEL[method] || method}). Dê a baixa em Contas a receber.` : undefined,
    });
    onDone();
  }

  const diff = task && task.kind === "entrega" ? Math.round((amount - task.collect_amount) * 100) / 100 : 0;

  return (
    <Dialog open={!!task} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{task?.kind === "coleta" ? "Marcar como coletado" : "Marcar como entregue"}</DialogTitle>
          <DialogDescription>
            {task?.customer_name || "Cliente"}{task?.ref ? ` · ${task.ref}` : ""}
            {task?.kind === "entrega" && task.collect_amount > 0 ? ` · cobrar ${formatBRL(task.collect_amount)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Valor recebido</Label>
              <MoneyInput value={amount} onChange={setAmount} className="text-right" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fin-method" className="text-xs">Forma</Label>
              <select id="fin-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={amount <= 0}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50">
                {COLLECT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          {diff < -0.004 && <p className="text-xs text-amber-800 dark:text-amber-400">Recebeu {formatBRL(-diff)} a menos do que era para cobrar.</p>}
          {diff > 0.004 && <p className="text-xs text-amber-800 dark:text-amber-400">Recebeu {formatBRL(diff)} a mais do que era para cobrar.</p>}
          <div className="space-y-1.5">
            <Label htmlFor="fin-who" className="text-xs">Quem recebeu <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="fin-who" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Ex.: o próprio cliente; porteiro Carlos" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- nova entrega / coleta ---------- */
type NewTaskInit = { origin: "venda" | "os"; id: string; kind: TaskKind };
type Source = {
  origin: "venda" | "os"; id: string; label: string; customerName: string | null; phone: string | null;
  customerAddr: string; deliveryAddr: string | null; pickupAddr: string | null; pending: number; status: string | null;
};

async function fetchSource(companyId: string, origin: "venda" | "os", by: { id?: string; number?: number }): Promise<Source | null> {
  const customer = async (id: string | null) => {
    if (!id) return null;
    const { data } = await db.from("customers")
      .select("name, whatsapp, phone, street, number, complement, district, city, state")
      .eq("id", id).maybeSingle();
    return data as any;
  };
  if (origin === "venda") {
    let q = db.from("sales").select("id, number, customer_id, status").eq("company_id", companyId);
    q = by.id ? q.eq("id", by.id) : q.eq("number", by.number);
    const { data: s } = await q.limit(1).maybeSingle();
    if (!s) return null;
    const [c, pays] = await Promise.all([
      customer(s.customer_id),
      db.from("sale_payments").select("amount").eq("sale_id", s.id).in("status", ["pendente", "parcial"]),
    ]);
    const pending = ((pays?.data as any[]) || []).reduce((t, p) => t + Number(p.amount || 0), 0);
    return {
      origin, id: s.id, label: `Venda ${pad6(s.number)}`, customerName: c?.name ?? null, phone: c?.whatsapp || c?.phone || null,
      customerAddr: customerAddress(c), deliveryAddr: null, pickupAddr: null, pending, status: s.status ?? null,
    };
  }
  let q = db.from("service_orders").select("id, number, customer_id, status, delivery_address, pickup_address").eq("company_id", companyId);
  q = by.id ? q.eq("id", by.id) : q.eq("number", by.number);
  const { data: o } = await q.limit(1).maybeSingle();
  if (!o) return null;
  const c = await customer(o.customer_id);
  return {
    origin, id: o.id, label: `OS ${pad6(o.number)}`, customerName: c?.name ?? null, phone: c?.whatsapp || c?.phone || null,
    customerAddr: customerAddress(c), deliveryAddr: o.delivery_address || null, pickupAddr: o.pickup_address || null,
    pending: 0, status: o.status ?? null,
  };
}
function sourceAddress(s: Source, kind: TaskKind): string {
  if (s.origin === "os") return (kind === "coleta" ? s.pickupAddr : s.deliveryAddr) || s.customerAddr;
  return s.customerAddr;
}

function NewTaskDialog({
  open, init, companyId, openTasks, onClose, onCreated,
}: {
  open: boolean; init: NewTaskInit | null; companyId: string; openTasks: DeliveryTask[];
  onClose: () => void; onCreated: (stage: TaskStage) => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<TaskKind>("entrega");
  const [origin, setOrigin] = useState<"venda" | "os">("venda");
  const [number, setNumber] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [address, setAddress] = useState("");
  const [addrEdited, setAddrEdited] = useState(false);
  const [due, setDue] = useState(localISODate());
  const [collect, setCollect] = useState(0);
  const [notes, setNotes] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  function applySource(s: Source, k: TaskKind) {
    setSource(s);
    setNumber(s.label.replace(/\D/g, "").replace(/^0+/, ""));
    setAddress(sourceAddress(s, k));
    setAddrEdited(false);
    setCollect(s.origin === "venda" ? s.pending : 0);
  }

  // abre limpo ou já preenchido pela URL
  useEffect(() => {
    if (!open) return;
    setKind(init?.kind || "entrega");
    setOrigin(init?.origin || "venda");
    setNumber(""); setSource(null); setNotFound(false);
    setAddress(""); setAddrEdited(false);
    setDue(localISODate()); setCollect(0); setNotes(""); setReady(false); setSaving(false);
    if (init) {
      let alive = true;
      setSearching(true);
      fetchSource(companyId, init.origin, { id: init.id }).then((s) => {
        if (!alive) return;
        setSearching(false);
        if (s) applySource(s, init.kind); else setNotFound(true);
      });
      return () => { alive = false; };
    }
    setSearching(false);
  }, [open, init, companyId]);

  async function search() {
    const n = Number(number.replace(/\D/g, ""));
    if (!n) { toast({ title: `Digite o número da ${origin === "venda" ? "venda" : "OS"}`, variant: "destructive" }); return; }
    setSearching(true); setNotFound(false);
    const s = await fetchSource(companyId, origin, { number: n });
    setSearching(false);
    if (s) applySource(s, kind); else { setSource(null); setNotFound(true); }
  }

  function changeKind(k: TaskKind) {
    setKind(k);
    if (k === "coleta" && origin === "venda") { setOrigin("os"); setSource(null); setNumber(""); setAddress(""); setNotFound(false); return; }
    if (source && !addrEdited) setAddress(sourceAddress(source, k));
  }
  function changeOrigin(o: "venda" | "os") {
    if (o === origin) return;
    setOrigin(o); setSource(null); setNumber(""); setAddress(""); setAddrEdited(false); setNotFound(false); setCollect(0);
  }

  const duplicate = source && openTasks.find((t) => t.kind === kind && (t.sale_id === source.id || t.service_order_id === source.id));

  async function save() {
    if (!source) { toast({ title: `Busque a ${origin === "venda" ? "venda" : "OS"} primeiro`, variant: "destructive" }); return; }
    setSaving(true);
    const stage: TaskStage | undefined = kind === "entrega" && ready ? "pronto" : undefined;
    const r = await createTaskFrom({
      companyId, kind,
      saleId: source.origin === "venda" ? source.id : null,
      serviceOrderId: source.origin === "os" ? source.id : null,
      stage, dueDate: due || null,
      collectAmount: kind === "entrega" ? collect : 0,
      address: address.trim() || null, notes: notes.trim() || null,
    });
    setSaving(false);
    if (r.error) { toast({ title: "Não foi possível criar", description: r.error, variant: "destructive" }); return; }
    const finalStage: TaskStage = stage || (kind === "coleta" ? "pronto" : "separar");
    toast({ title: `${KIND_LABEL[kind]} criada`, description: finalStage === "pronto" ? "Está em Prontos." : "Está em A separar." });
    onCreated(finalStage);
  }

  const seg = (on: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"} disabled:cursor-not-allowed disabled:opacity-40`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova entrega / coleta</DialogTitle>
          <DialogDescription>Puxa cliente, telefone e endereço do cadastro. Confira antes de salvar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                <button type="button" className={seg(kind === "entrega")} onClick={() => changeKind("entrega")}>Entrega</button>
                <button type="button" className={seg(kind === "coleta")} onClick={() => changeKind("coleta")}>Coleta</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Origem</Label>
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                <button type="button" className={seg(origin === "venda")} onClick={() => changeOrigin("venda")} disabled={kind === "coleta"}
                  title={kind === "coleta" ? "Coleta é só de OS" : undefined}>Venda</button>
                <button type="button" className={seg(origin === "os")} onClick={() => changeOrigin("os")}>OS</button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nt-number" className="text-xs">Número da {origin === "venda" ? "venda" : "OS"}</Label>
            <div className="flex gap-2">
              <Input id="nt-number" value={number} inputMode="numeric" placeholder="Ex.: 123"
                onChange={(e) => { setNumber(e.target.value); setNotFound(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
              <Button type="button" variant="outline" onClick={search} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1.5">Buscar</span>
              </Button>
            </div>
            {notFound && <p className="text-xs text-red-700 dark:text-red-400">Não achei essa {origin === "venda" ? "venda" : "OS"}.</p>}
            {source && (
              <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                <div className="font-medium">{source.label} · {source.customerName || "sem cliente"}</div>
                <div className="text-xs text-muted-foreground">
                  {source.phone ? formatPhone(source.phone) : "sem telefone"}
                  {source.status ? ` · ${source.status}` : ""}
                </div>
              </div>
            )}
            {duplicate && (
              <p className="flex items-start gap-1 text-xs text-amber-800 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Já existe {KIND_LABEL[kind].toLowerCase()} aberta para essa {origin === "venda" ? "venda" : "OS"} ({STAGE_LABEL[duplicate.stage].toLowerCase()}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nt-addr" className="text-xs">Endereço</Label>
            <Textarea id="nt-addr" rows={2} value={address} onChange={(e) => { setAddress(e.target.value); setAddrEdited(true); }}
              placeholder={source ? "Cliente sem endereço no cadastro: digite aqui" : "Busque a venda/OS para puxar do cadastro"} />
            {source && address.trim() && (
              <a href={mapsLink(address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <MapPin className="h-3 w-3" /> Conferir no mapa
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nt-due" className="text-xs">Dia</Label>
              <Input id="nt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            {kind === "entrega" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Cobrar na entrega</Label>
                <MoneyInput value={collect} onChange={setCollect} className="text-right" />
              </div>
            )}
          </div>
          {kind === "entrega" && source?.origin === "venda" && (
            <p className="-mt-2 text-xs text-muted-foreground">
              {source.pending > 0 ? `Pendente na venda: ${formatBRL(source.pending)}.` : "A venda não tem nada pendente."} Zere se já está pago.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nt-notes" className="text-xs">Observação <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="nt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: entregar depois das 14h; casa de esquina" />
          </div>

          {kind === "entrega" && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={ready} onCheckedChange={(v) => setReady(!!v)} />
              Já está separado (vai direto para Prontos)
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !source}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Criar {KIND_LABEL[kind].toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
