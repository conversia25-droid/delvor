/* =====================================================================
   Contas a pagar (add-on Financeiro)
   Lançamento manual (com parcelas), despesas fixas do mês geradas sozinhas
   e despesas variáveis já pagas. Pagamento com conta de saída e comprovante.
   Idêntico no Delvor e no InfnityServices.
===================================================================== */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Copy, History, Landmark, Loader2, MoreHorizontal, Paperclip, Pencil,
  Plus, Receipt, Search, Undo2, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MoneyInput from "@/components/MoneyInput";
import AddonUpsell from "@/components/addons/AddonUpsell";
import { AttachFileField, AttachmentsDialog } from "@/components/finance/Attachments";
import { HistoryDialog, ReasonDialog, type ReasonRequest } from "@/components/finance/Dialogs";
import { LoanDialog, LoansPanel } from "@/components/finance/Loans";
import { formatBRL } from "@/lib/formatters";
import { addDaysISO, daysUntil, localISODate, METHOD_LABELS } from "@/lib/receivables";
import {
  cancelPayable, createPayables, fetchAccountBalances, fetchExpenseCategories, fetchPayablesOverview, fetchSuppliersLite,
  formatBoletoLine, listPayables, MISSING_DB_MSG, payPayablePartial, payPayables, revertPayable, updatePayable, uploadAttachment,
  type AccountBalance, type Payable, type PayablesOverview,
} from "@/lib/finance";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function DuePill({ due }: { due: string }) {
  const d = daysUntil(due);
  if (d < 0) return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"><AlertTriangle className="h-3 w-3" /> venceu há {-d} dia{d === -1 ? "" : "s"}</span>;
  if (d === 0) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-400"><CalendarClock className="h-3 w-3" /> vence hoje</span>;
  return <span className="text-xs text-muted-foreground">em {d} dia{d === 1 ? "" : "s"}</span>;
}
function Tile({ label, value, sub, dot, active, onClick }: { label: string; value: string; sub?: string; dot?: string; active?: boolean; onClick?: () => void }) {
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={`rounded-[10px] border bg-card p-4 text-left transition-colors ${onClick ? "hover:border-primary/40 hover:bg-accent/40" : ""} ${active ? "border-primary ring-1 ring-primary" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />}{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Comp>
  );
}
const PAY_METHODS = ["pix", "boleto", "transferencia", "dinheiro", "cartao_credito", "cartao_debito", "outro"];
const SOURCE_LABEL: Record<string, string> = { fixa: "fixa", compra: "compra", variavel: "avulsa", emprestimo: "empréstimo" };

type Tab = "aberto" | "pagas" | "emprestimos";
type OpenFilter = "todas" | "vencidas" | "hoje" | "semana";
type Period = "mes" | "mes_passado" | "90d";
function periodRange(p: Period) {
  const now = new Date();
  if (p === "mes_passado") return { from: localISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localISODate(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === "90d") return { from: addDaysISO(-90), to: localISODate() };
  return { from: localISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localISODate() };
}

export default function Pagar() {
  const addon = useAddon("financeiro");
  if (addon.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  if (!addon.active) return <AddonUpsell code="financeiro" />;
  return <PagarInner />;
}

function PagarInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.company_id || "";

  const [tab, setTab] = useState<Tab>("aberto");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("todas");
  const [period, setPeriod] = useState<Period>("mes");
  const [catFilter, setCatFilter] = useState("todas");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<Payable[]>([]);
  const [ov, setOv] = useState<PayablesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // nova / editar
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Payable | null>(null);
  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState(0);
  const [fDue, setFDue] = useState(localISODate());
  const [fInst, setFInst] = useState(1);
  const [fSupplier, setFSupplier] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fDoc, setFDoc] = useState("");
  const [fLine, setFLine] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fFile, setFFile] = useState<File | null>(null);

  // pagar
  const [payIds, setPayIds] = useState<string[] | null>(null);
  const [payOn, setPayOn] = useState(localISODate());
  const [payValue, setPayValue] = useState(0);
  const [payAccount, setPayAccount] = useState("");
  const [payMethod, setPayMethod] = useState("pix");
  const [payNote, setPayNote] = useState("");
  const [payProof, setPayProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [payMode, setPayMode] = useState<"desconto" | "parcial">("parcial");

  const [attachRow, setAttachRow] = useState<Payable | null>(null);
  const [historyRow, setHistoryRow] = useState<Payable | null>(null);
  const [reasonReq, setReasonReq] = useState<ReasonRequest | null>(null);
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanKey, setLoanKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const r = periodRange(period);
    const [list, o] = await Promise.all([listPayables(r.from, r.to), fetchPayablesOverview()]);
    setMissing(!!list.missing);
    setError(list.missing ? null : list.error);
    setRows(list.data);
    setOv(o.data);
    setLoading(false);
    setSelected((prev) => new Set([...prev].filter((id) => list.data.some((x) => x.id === id && x.status === "aberta"))));
  }, [period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!companyId) return;
    fetchAccountBalances().then((r) => setAccounts(r.data.filter((a) => a.active)));
    fetchSuppliersLite(companyId).then(setSuppliers);
    fetchExpenseCategories(companyId).then(setCategories);
  }, [companyId]);

  const match = useCallback((p: Payable) => {
    if (catFilter !== "todas" && p.category_id !== catFilter) return false;
    const t = q.trim().toLowerCase();
    if (t && !`${p.description} ${p.supplier_name || ""} ${p.document_number || ""}`.toLowerCase().includes(t)) return false;
    return true;
  }, [catFilter, q]);

  const openRows = useMemo(() => rows.filter((p) => {
    if (p.status !== "aberta" || !match(p)) return false;
    const d = daysUntil(p.due_date);
    if (openFilter === "vencidas") return d < 0;
    if (openFilter === "hoje") return d === 0;
    if (openFilter === "semana") return d > 0 && d <= 7;
    return true;
  }).sort((a, b) => a.due_date.localeCompare(b.due_date)), [rows, match, openFilter]);

  const paidRows = useMemo(() => rows.filter((p) => p.status === "paga" && match(p))
    .sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || "")), [rows, match]);
  const paidTotal = paidRows.reduce((s, p) => s + (p.paid_amount ?? p.amount), 0);
  const openCount = rows.filter((p) => p.status === "aberta").length;

  const selRows = rows.filter((p) => selected.has(p.id));
  const selTotal = selRows.reduce((s, p) => s + p.amount, 0);
  const allSel = openRows.length > 0 && openRows.every((p) => selected.has(p.id));

  /* ---------- nova / editar ---------- */
  function openNew() {
    setEditing(null); setFDesc(""); setFAmount(0); setFDue(localISODate()); setFInst(1);
    setFSupplier(""); setFCategory(""); setFDoc(""); setFLine(""); setFNotes(""); setFFile(null);
    setFormOpen(true);
  }
  function openEdit(p: Payable) {
    setEditing(p); setFDesc(p.description); setFAmount(p.amount); setFDue(p.due_date); setFInst(1);
    setFSupplier(p.supplier_id || ""); setFCategory(p.category_id || ""); setFDoc(p.document_number || "");
    setFLine(p.boleto_line || ""); setFNotes(p.notes || ""); setFFile(null);
    setFormOpen(true);
  }
  async function saveForm() {
    if (!fDesc.trim()) { toast({ title: "Informe a descrição", variant: "destructive" }); return; }
    if (fAmount <= 0) { toast({ title: "Informe o valor", variant: "destructive" }); return; }
    if (!fDue) { toast({ title: "Informe o vencimento", variant: "destructive" }); return; }
    setSaving(true);
    if (editing) {
      const { error } = await updatePayable(editing.id, {
        description: fDesc.trim(), amount: fAmount, due_date: fDue, supplier_id: fSupplier || null,
        category_id: fCategory || null, document_number: fDoc || null, notes: fNotes || null,
      });
      setSaving(false);
      if (error) { toast({ title: "Não foi possível salvar", description: error, variant: "destructive" }); return; }
      toast({ title: "Conta atualizada" });
    } else {
      const { ids, error } = await createPayables({
        companyId, description: fDesc, amount: fAmount, firstDue: fDue, installments: fInst,
        supplierId: fSupplier || null, categoryId: fCategory || null, documentNumber: fDoc || null,
        boletoLine: fLine || null, notes: fNotes || null,
      });
      if (error) { setSaving(false); toast({ title: "Não foi possível lançar", description: error, variant: "destructive" }); return; }
      if (fFile && ids[0]) {
        const up = await uploadAttachment({ companyId, entity: "payable", entityId: ids[0], kind: fLine ? "boleto" : "nota", file: fFile });
        if (up.error) toast({ title: "Conta lançada, mas o anexo falhou", description: up.error, variant: "destructive" });
      }
      setSaving(false);
      toast({ title: ids.length > 1 ? `${ids.length} parcelas lançadas` : "Conta lançada", description: `${formatBRL(fAmount)} · 1º vencimento ${fmtDate(fDue)}` });
    }
    setFormOpen(false);
    load();
  }

  /* ---------- pagar ---------- */
  function openPay(ids: string[]) {
    const list = rows.filter((p) => ids.includes(p.id));
    setPayIds(ids); setPayOn(localISODate()); setPayValue(list.reduce((s, p) => s + p.amount, 0));
    setPayMethod("pix"); setPayNote(""); setPayProof(null); setPayMode("parcial");
    setPayAccount(accounts.find((a) => a.default_methods.includes("pix"))?.id || accounts.find((a) => a.kind === "banco")?.id || "");
  }
  const payRows = payIds ? rows.filter((p) => payIds.includes(p.id)) : [];
  const payGross = payRows.reduce((s, p) => s + p.amount, 0);
  const payDiff = Math.round((payValue - payGross) * 100) / 100;
  // parcial: uma conta só, valor menor, e não é despesa fixa (essa se ajusta na tela de fixas)
  const canPartialPay = payRows.length === 1 && payDiff < -0.004 && payValue > 0 && payRows[0].source !== "fixa";
  const isPartialPay = canPartialPay && payMode === "parcial";

  async function confirmPay() {
    if (!payIds) return;
    if (payValue <= 0) { toast({ title: "Informe o valor pago", variant: "destructive" }); return; }
    setSaving(true);
    if (isPartialPay) {
      const r = await payPayablePartial({ id: payIds[0], amount: payValue, paidOn: payOn, accountId: payAccount || null, method: payMethod, notes: payNote });
      if (r.error) { setSaving(false); toast({ title: "Não foi possível registrar o parcial", description: r.error, variant: "destructive" }); return; }
      if (payProof) {
        const up = await uploadAttachment({ companyId, entity: "payable", entityId: payIds[0], kind: "comprovante", file: payProof });
        if (up.error) toast({ title: "Pago, mas o comprovante não foi anexado", description: up.error, variant: "destructive" });
      }
      setSaving(false);
      toast({ title: "Pagamento parcial registrado", description: `${formatBRL(payGross - payValue)} continua em aberto.` });
      setPayIds(null); setSelected(new Set()); load();
      return;
    }
    const r = await payPayables({
      ids: payIds, paidOn: payOn, paidTotal: Math.abs(payDiff) < 0.005 ? null : payValue,
      accountId: payAccount || null, method: payMethod, notes: payNote,
    });
    if (r.error) { setSaving(false); toast({ title: "Não foi possível pagar", description: r.error, variant: "destructive" }); return; }
    if (payProof && payIds.length === 1) {
      const up = await uploadAttachment({ companyId, entity: "payable", entityId: payIds[0], kind: "comprovante", file: payProof });
      if (up.error) toast({ title: "Pago, mas o comprovante não foi anexado", description: up.error, variant: "destructive" });
    }
    setSaving(false);
    toast({ title: payIds.length > 1 ? `${payIds.length} contas pagas` : "Conta paga", description: formatBRL(r.paidTotal ?? payValue) });
    setPayIds(null); setSelected(new Set()); load();
  }

  function undoPay(p: Payable) {
    setReasonReq({
      title: "Desfazer pagamento",
      description: `"${p.description}" · ${formatBRL(p.paid_amount ?? p.amount)}. A conta volta para Em aberto.`,
      confirmLabel: "Desfazer pagamento",
      destructive: true,
      onConfirm: async (reason) => {
        const { error } = await revertPayable(p.id, reason);
        if (error) return error;
        load();
        return null;
      },
    });
  }
  function cancel(p: Payable) {
    setReasonReq({
      title: p.source === "fixa" ? "Pular esta despesa fixa neste mês" : "Cancelar conta",
      description: `"${p.description}" · ${formatBRL(p.amount)}. Ela sai das contas em aberto e do fluxo de caixa.`,
      confirmLabel: p.source === "fixa" ? "Pular este mês" : "Cancelar conta",
      destructive: true,
      placeholder: "Ex.: lançada em duplicidade; fornecedor deu baixa",
      onConfirm: async (reason) => {
        const { error } = await cancelPayable(p.id, reason);
        if (error) return error;
        load();
        return null;
      },
    });
  }

  if (missing) {
    return (
      <div className="space-y-4">
        <Header onNew={openNew} onNewLoan={() => setLoanOpen(true)} disabled />
        <div className="rounded-[10px] border bg-card px-6 py-14 text-center text-sm text-muted-foreground">{MISSING_DB_MSG}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header onNew={openNew} onNewLoan={() => setLoanOpen(true)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Vencidas" dot={ov && ov.overdue_count > 0 ? "bg-red-500" : undefined} value={ov ? formatBRL(ov.overdue_total) : "—"}
          sub={ov ? `${ov.overdue_count} conta${ov.overdue_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "vencidas"} onClick={() => { setTab("aberto"); setOpenFilter("vencidas"); }} />
        <Tile label="Vencem hoje" dot={ov && ov.due_today_count > 0 ? "bg-amber-500" : undefined} value={ov ? formatBRL(ov.due_today_total) : "—"}
          sub={ov ? `${ov.due_today_count} conta${ov.due_today_count === 1 ? "" : "s"}` : undefined}
          active={tab === "aberto" && openFilter === "hoje"} onClick={() => { setTab("aberto"); setOpenFilter("hoje"); }} />
        <Tile label="Próximos 7 dias" value={ov ? formatBRL(ov.next7_total) : "—"}
          active={tab === "aberto" && openFilter === "semana"} onClick={() => { setTab("aberto"); setOpenFilter("semana"); }} />
        <Tile label="A pagar neste mês" value={ov ? formatBRL(ov.month_open) : "—"} sub={ov ? `em aberto no total: ${formatBRL(ov.open_total)}` : undefined}
          active={tab === "aberto" && openFilter === "todas"} onClick={() => { setTab("aberto"); setOpenFilter("todas"); }} />
        <Tile label="Pago no mês" dot="bg-emerald-500" value={ov ? formatBRL(ov.paid_month) : "—"} sub="inclui despesas avulsas"
          onClick={() => { setTab("pagas"); setPeriod("mes"); }} />
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b">
        {([["aberto", `Em aberto${openCount ? ` (${openCount})` : ""}`], ["pagas", "Pagas"], ["emprestimos", "Empréstimos"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab !== "emprestimos" && <div className="flex flex-wrap items-center gap-2">
        {tab === "aberto"
          ? ([["todas", "Todas"], ["vencidas", "Vencidas"], ["hoje", "Vencem hoje"], ["semana", "Próximos 7 dias"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setOpenFilter(k)} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${openFilter === k ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:text-foreground"}`}>{label}</button>
          ))
          : ([["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90d", "Últimos 90 dias"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setPeriod(k)} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${period === k ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:text-foreground"}`}>{label}</button>
          ))}
        <select id="pay-cat-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Categoria">
          <option value="todas">Todas as categorias</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input id="pay-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Descrição, fornecedor ou documento" className="h-8 pl-8 text-sm" />
        </div>
      </div>}

      {tab === "aberto" && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-primary/40 bg-accent/40 px-4 py-2.5 text-sm">
          <span><strong>{selected.size}</strong> selecionada{selected.size > 1 ? "s" : ""} · <strong className="num">{formatBRL(selTotal)}</strong></span>
          <Button size="sm" className="ml-auto" onClick={() => openPay([...selected])}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Pagar selecionadas</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-[10px] border bg-card">
        {tab === "emprestimos" ? (
          <LoansPanel reloadKey={loanKey} onChanged={load} onNew={() => setLoanOpen(true)} />
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>
        ) : error ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">Não foi possível carregar: {error}</div>
        ) : tab === "aberto" ? (
          openRows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground">
              {openFilter === "vencidas" ? "Nenhuma conta vencida." : "Nenhuma conta em aberto com esses filtros."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={allSel} onCheckedChange={() => setSelected((prev) => { const n = new Set(prev); if (allSel) openRows.forEach((p) => n.delete(p.id)); else openRows.forEach((p) => n.add(p.id)); return n; })} aria-label="Selecionar todas" /></TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openRows.map((p) => (
                  <TableRow key={p.id} className={daysUntil(p.due_date) < 0 ? "bg-red-500/[0.04]" : ""}>
                    <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} aria-label="Selecionar" /></TableCell>
                    <TableCell><div className="num">{fmtDate(p.due_date)}</div><DuePill due={p.due_date} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        {p.description}
                        {SOURCE_LABEL[p.source] && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">{SOURCE_LABEL[p.source]}</span>}
                        {!!p.attachments_count && <Paperclip className="h-3 w-3 text-muted-foreground" aria-label={`${p.attachments_count} anexo(s)`} />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[p.supplier_name, p.document_number && `doc. ${p.document_number}`].filter(Boolean).join(" · ") || " "}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.category_name || "—"}</TableCell>
                    <TableCell className="num text-right font-medium">{formatBRL(p.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => openPay([p.id])}>Pagar</Button>
                        <PayableMenu p={p} onAttach={() => setAttachRow(p)} onHistory={() => setHistoryRow(p)} onEdit={() => openEdit(p)} onCancel={() => cancel(p)} toast={toast} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : paidRows.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">Nenhum pagamento nesse período.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pago em</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Saiu de</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paidRows.map((p) => {
                const d = Math.round(((p.paid_amount ?? p.amount) - p.amount) * 100) / 100;
                return (
                  <TableRow key={`${p.kind}-${p.id}`}>
                    <TableCell className="num">{p.paid_at ? new Date(p.paid_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        {p.description}
                        {SOURCE_LABEL[p.source] && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">{SOURCE_LABEL[p.source]}</span>}
                        {!!p.attachments_count && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      {p.payment_method && <div className="text-xs text-muted-foreground">{METHOD_LABELS[p.payment_method] || p.payment_method}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.category_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.account_name || (p.kind === "variavel" ? "—" : "não informado")}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{formatBRL(p.amount)}</TableCell>
                    <TableCell className="num text-right font-medium">
                      {formatBRL(p.paid_amount ?? p.amount)}
                      {Math.abs(d) >= 0.01 && <div className={`text-[11px] ${d > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{d > 0 ? `juros +${formatBRL(d)}` : `desconto ${formatBRL(-d)}`}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.kind === "variavel" ? (
                        <Link to="/financeiro/variaveis" className="text-xs text-primary hover:underline">ver em Despesas variáveis</Link>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => undoPay(p)}><Undo2 className="mr-1 h-3.5 w-3.5" /> Desfazer</Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setAttachRow(p)} aria-label="Anexos"><Paperclip className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setHistoryRow(p)} aria-label="Histórico"><History className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={5}>Total pago ({paidRows.length})</TableCell>
                <TableCell className="num text-right">{formatBRL(paidTotal)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      {/* nova / editar */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar conta" : "Nova conta a pagar"}</DialogTitle>
            <DialogDescription>{editing ? "Mudanças valem só para esta conta." : "Boleto de fornecedor, conta de luz, imposto, parcela de equipamento…"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-desc" className="text-xs">Descrição *</Label>
              <Input id="pf-desc" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Ex.: Toner Brother — Distribuidora Alfa" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{fInst > 1 ? "Valor total *" : "Valor *"}</Label>
                <MoneyInput value={fAmount} onChange={setFAmount} className="text-right" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-due" className="text-xs">{fInst > 1 ? "1º vencimento *" : "Vencimento *"}</Label>
                <Input id="pf-due" type="date" value={fDue} onChange={(e) => setFDue(e.target.value)} />
              </div>
              {!editing && (
                <div className="space-y-1.5">
                  <Label htmlFor="pf-inst" className="text-xs">Parcelas</Label>
                  <Input id="pf-inst" type="number" min={1} max={60} value={fInst} onChange={(e) => setFInst(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
                </div>
              )}
            </div>
            {!editing && fInst > 1 && fAmount > 0 && (
              <p className="text-xs text-muted-foreground">{fInst} parcelas mensais de {formatBRL(Math.floor((fAmount * 100) / fInst) / 100)} (ajuste de centavos na última).</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pf-sup" className="text-xs">Fornecedor</Label>
                <select id="pf-sup" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-cat" className="text-xs">Categoria</Label>
                <select id="pf-cat" value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pf-doc" className="text-xs">Nº do documento</Label>
                <Input id="pf-doc" value={fDoc} onChange={(e) => setFDoc(e.target.value)} placeholder="NF, fatura…" />
              </div>
              {!editing && (
                <div className="space-y-1.5">
                  <Label htmlFor="pf-line" className="text-xs">Linha digitável</Label>
                  <Input id="pf-line" value={fLine} onChange={(e) => setFLine(e.target.value)} className="font-mono text-xs" placeholder="se for boleto" />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-notes" className="text-xs">Observação</Label>
              <Input id="pf-notes" value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
            </div>
            {!editing && <AttachFileField id="pf-file" file={fFile} onChange={setFFile} label="Anexar boleto ou nota" hint={fInst > 1 ? "O anexo fica na 1ª parcela." : undefined} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={saveForm} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Salvar" : fInst > 1 ? `Lançar ${fInst} parcelas` : "Lançar conta"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* pagar */}
      <Dialog open={!!payIds} onOpenChange={(o) => { if (!o) setPayIds(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{payRows.length > 1 ? `Pagar ${payRows.length} contas` : "Pagar conta"}</DialogTitle>
            <DialogDescription>{payRows.length === 1 ? payRows[0].description : `${formatBRL(payGross)} no total`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pp-date" className="text-xs">Data do pagamento</Label>
                <Input id="pp-date" type="date" value={payOn} max={localISODate()} onChange={(e) => setPayOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor pago</Label>
                <MoneyInput value={payValue} onChange={setPayValue} className="text-right" />
              </div>
            </div>
            {payDiff > 0.004 && <p className="text-xs text-red-700 dark:text-red-400">Juros / multa: +{formatBRL(payDiff)}</p>}
            {canPartialPay && (
              <div className="space-y-1.5 rounded-md border px-3 py-2.5 text-sm">
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="pay-mode" className="mt-1" checked={payMode === "parcial"} onChange={() => setPayMode("parcial")} />
                  <span>Pagamento parcial: <strong className="num">{formatBRL(payGross - payValue)}</strong> continua em aberto, mesmo vencimento</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="pay-mode" className="mt-1" checked={payMode === "desconto"} onChange={() => setPayMode("desconto")} />
                  <span>A diferença é desconto (quita a conta)</span>
                </label>
              </div>
            )}
            {payDiff < -0.004 && !isPartialPay && <p className="text-xs text-emerald-700 dark:text-emerald-400">Desconto: {formatBRL(-payDiff)}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pp-acc" className="text-xs">Saiu de</Label>
                <select id="pp-acc" value={payAccount} onChange={(e) => setPayAccount(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="">Não informar</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-method" className="text-xs">Forma</Label>
                <select id="pp-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m] || m}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-note" className="text-xs">Observação</Label>
              <Input id="pp-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
            {payRows.length === 1 && <AttachFileField id="pp-proof" file={payProof} onChange={setPayProof} label="Anexar comprovante" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayIds(null)}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Confirmar pagamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AttachmentsDialog
        open={!!attachRow}
        onOpenChange={(o) => { if (!o) setAttachRow(null); }}
        title="Anexos da conta"
        subtitle={attachRow ? `${attachRow.description} · ${formatBRL(attachRow.amount)}` : undefined}
        entity="payable"
        entityId={attachRow?.id || null}
        defaultKind={attachRow?.status === "paga" ? "comprovante" : "boleto"}
        onChanged={load}
      />

      <LoanDialog open={loanOpen} onOpenChange={setLoanOpen} accounts={accounts} categories={categories}
        onCreated={() => { setLoanKey((k) => k + 1); setTab("emprestimos"); load(); }} />
      <ReasonDialog request={reasonReq} onClose={() => setReasonReq(null)} />
      <HistoryDialog
        target={historyRow ? { entity: "payable", id: historyRow.id, title: `${historyRow.description} · ${formatBRL(historyRow.amount)}` } : null}
        onClose={() => setHistoryRow(null)}
      />
    </div>
  );
}

function Header({ onNew, onNewLoan, disabled }: { onNew: () => void; onNewLoan: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"><Receipt className="h-5 w-5 text-primary" /> Contas a pagar</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Fornecedores, impostos e contas do mês. As despesas fixas entram aqui sozinhas a cada mês; pagar aqui ou na tela de fixas dá no mesmo.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onNewLoan} disabled={disabled}><Landmark className="mr-2 h-4 w-4" /> Novo empréstimo</Button>
        <Button onClick={onNew} disabled={disabled}><Plus className="mr-2 h-4 w-4" /> Nova conta</Button>
      </div>
    </div>
  );
}

function PayableMenu({ p, onAttach, onHistory, onEdit, onCancel, toast }: { p: Payable; onAttach: () => void; onHistory: () => void; onEdit: () => void; onCancel: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onAttach}><Paperclip className="mr-2 h-4 w-4" /> Anexos{p.attachments_count ? ` (${p.attachments_count})` : ""}</DropdownMenuItem>
        <DropdownMenuItem onClick={onHistory}><History className="mr-2 h-4 w-4" /> Histórico</DropdownMenuItem>
        {p.boleto_line && (
          <DropdownMenuItem onClick={async () => {
            try { await navigator.clipboard.writeText(formatBoletoLine(p.boleto_line)); toast({ title: "Linha digitável copiada" }); }
            catch { toast({ title: "Não consegui copiar", variant: "destructive" }); }
          }}><Copy className="mr-2 h-4 w-4" /> Copiar linha digitável</DropdownMenuItem>
        )}
        {p.source === "manual" && <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>}
        {p.source === "fixa" && (
          <DropdownMenuItem asChild><Link to="/financeiro/fixas"><Pencil className="mr-2 h-4 w-4" /> Editar despesa fixa</Link></DropdownMenuItem>
        )}
        {p.source === "emprestimo" ? (
          <DropdownMenuItem disabled className="text-xs">Parcela de empréstimo: ajuste na aba Empréstimos</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCancel} className="text-red-700 dark:text-red-400">
              <XCircle className="mr-2 h-4 w-4" /> {p.source === "fixa" ? "Pular este mês" : "Cancelar conta"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
