/* =====================================================================
   Contas e saldos (add-on Financeiro)
   Caixa físico, bancos e carteiras digitais. Saldo = saldo inicial
   + recebimentos − pagamentos ± transferências (a partir da data do saldo).
   Idêntico nos dois repos.
===================================================================== */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Landmark, Loader2, Pencil, Plus, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { useToast } from "@/hooks/use-toast";
import AddonUpsell from "@/components/addons/AddonUpsell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MoneyInput from "@/components/MoneyInput";
import { formatBRL } from "@/lib/formatters";
import { addDaysISO, localISODate, METHOD_LABELS } from "@/lib/receivables";
import {
  ACCOUNT_KIND_LABEL, createTransfer, fetchAccountBalances, fetchAccountStatement, MISSING_DB_MSG, saveAccount,
  type AccountBalance, type AccountKind, type StatementLine,
} from "@/lib/finance";

const METHODS = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "boleto", "transferencia", "crediario", "outro"];
function fmtDate(iso: string) { const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; }

export default function Contas() {
  const addon = useAddon("financeiro");
  if (addon.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  if (!addon.active) return <AddonUpsell code="financeiro" />;
  return <ContasInner />;
}

function ContasInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.company_id || "";

  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [lines, setLines] = useState<StatementLine[] | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountBalance | null>(null);
  const [fName, setFName] = useState("");
  const [fKind, setFKind] = useState<AccountKind>("banco");
  const [fBank, setFBank] = useState("");
  const [fOpening, setFOpening] = useState(0);
  const [fOpeningDate, setFOpeningDate] = useState(localISODate());
  const [fMethods, setFMethods] = useState<string[]>([]);
  const [fActive, setFActive] = useState(true);

  const [trOpen, setTrOpen] = useState(false);
  const [trFrom, setTrFrom] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trValue, setTrValue] = useState(0);
  const [trDate, setTrDate] = useState(localISODate());
  const [trNotes, setTrNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchAccountBalances();
    setMissing(!!r.missing);
    setAccounts(r.data);
    setLoading(false);
    setSelId((cur) => cur && r.data.some((a) => a.id === cur) ? cur : r.data[0]?.id || null);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selId) { setLines(null); return; }
    setLines(null);
    fetchAccountStatement(selId, addDaysISO(-days), localISODate()).then((r) => setLines(r.data));
  }, [selId, days, accounts]);

  const active = accounts.filter((a) => a.active);
  const total = active.reduce((s, a) => s + a.balance, 0);
  const sel = accounts.find((a) => a.id === selId) || null;
  const methodOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of active) for (const k of a.default_methods) if (!m.has(k)) m.set(k, a.name);
    return m;
  }, [active]);
  const stTotals = (lines || []).reduce((t, l) => (l.amount >= 0 ? { ...t, in: t.in + l.amount } : { ...t, out: t.out - l.amount }), { in: 0, out: 0 });

  function openNew() {
    setEditing(null); setFName(""); setFKind("banco"); setFBank(""); setFOpening(0); setFOpeningDate(localISODate()); setFMethods([]); setFActive(true);
    setFormOpen(true);
  }
  function openEdit(a: AccountBalance) {
    setEditing(a); setFName(a.name); setFKind(a.kind); setFBank(a.bank_name || ""); setFOpening(a.opening_balance);
    setFOpeningDate(a.opening_date); setFMethods(a.default_methods); setFActive(a.active);
    setFormOpen(true);
  }
  async function saveForm() {
    if (!fName.trim()) { toast({ title: "Dê um nome à conta", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await saveAccount({
      id: editing?.id, companyId, name: fName, kind: fKind, bankName: fBank, openingBalance: fOpening,
      openingDate: fOpeningDate, defaultMethods: fMethods, active: fActive,
    });
    setSaving(false);
    if (error) { toast({ title: "Não foi possível salvar", description: error, variant: "destructive" }); return; }
    toast({ title: editing ? "Conta atualizada" : "Conta criada" });
    setFormOpen(false); load();
  }

  function openTransfer() {
    const caixa = active.find((a) => a.kind === "caixa");
    const banco = active.find((a) => a.kind !== "caixa");
    setTrFrom(caixa?.id || active[0]?.id || ""); setTrTo(banco?.id || active[1]?.id || "");
    setTrValue(0); setTrDate(localISODate()); setTrNotes(""); setTrOpen(true);
  }
  async function saveTransfer() {
    if (!trFrom || !trTo || trFrom === trTo) { toast({ title: "Escolha duas contas diferentes", variant: "destructive" }); return; }
    if (trValue <= 0) { toast({ title: "Informe o valor", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await createTransfer({ companyId, fromId: trFrom, toId: trTo, amount: trValue, date: trDate, notes: trNotes });
    setSaving(false);
    if (error) { toast({ title: "Não foi possível transferir", description: error, variant: "destructive" }); return; }
    toast({ title: "Transferência registrada", description: formatBRL(trValue) });
    setTrOpen(false); load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"><Landmark className="h-5 w-5 text-primary" /> Contas e saldos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Onde o dinheiro está: caixa, bancos e carteiras. Recebimentos e pagamentos entram na conta escolhida na baixa;
            cada forma de pagamento pode cair numa conta padrão.
          </p>
        </div>
        {!missing && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openTransfer} disabled={active.length < 2}><ArrowRightLeft className="mr-2 h-4 w-4" /> Transferir</Button>
            <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Nova conta</Button>
          </div>
        )}
      </div>

      {missing ? (
        <div className="rounded-[10px] border bg-card px-6 py-14 text-center text-sm text-muted-foreground">{MISSING_DB_MSG}</div>
      ) : loading ? (
        <div className="flex items-center justify-center rounded-[10px] border bg-card py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground">Saldo somado das contas ativas</span>
            <span className="text-2xl font-semibold tracking-tight">{formatBRL(total)}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <div
                key={a.id}
                className={`relative rounded-[10px] border bg-card transition-colors hover:border-primary/40 ${selId === a.id ? "border-primary ring-1 ring-primary" : ""} ${a.active ? "" : "opacity-60"}`}
              >
                <button
                  type="button"
                  aria-label={`Editar ${a.name}`}
                  onClick={() => openEdit(a)}
                  className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setSelId(a.id)} aria-pressed={selId === a.id} className="block w-full rounded-[10px] p-4 pr-11 text-left">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      {a.kind === "caixa" ? <Wallet className="h-4 w-4 text-muted-foreground" /> : <Landmark className="h-4 w-4 text-muted-foreground" />}
                      {a.name}{!a.active && <span className="text-xs text-muted-foreground">(inativa)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{ACCOUNT_KIND_LABEL[a.kind]}{a.bank_name ? ` · ${a.bank_name}` : ""}</div>
                  </div>
                </div>
                <div className={`mt-3 text-2xl font-semibold tracking-tight ${a.balance < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatBRL(a.balance)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  desde {fmtDate(a.opening_date)}: entrou {formatBRL(a.inflow + a.transfers_in)} · saiu {formatBRL(a.outflow + a.transfers_out)}
                </div>
                {a.default_methods.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.default_methods.map((m) => <span key={m} className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">{METHOD_LABELS[m] || m}</span>)}
                  </div>
                )}
                </button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Sangrias e suprimentos do PDV ficam no fechamento de caixa. Quando depositar o dinheiro no banco, registre uma transferência do Caixa para o banco.
          </p>

          {sel && (
            <section className="overflow-x-auto rounded-[10px] border bg-card">
              <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5">
                <h2 className="text-[13.5px] font-semibold">Extrato · {sel.name}</h2>
                <span className="text-xs text-muted-foreground">entrou {formatBRL(stTotals.in)} · saiu {formatBRL(stTotals.out)}</span>
                <select id="st-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-auto h-8 rounded-md border bg-background px-2 text-xs" aria-label="Período do extrato">
                  <option value={7}>Últimos 7 dias</option>
                  <option value={30}>Últimos 30 dias</option>
                  <option value={90}>Últimos 90 dias</option>
                </select>
              </header>
              {lines === null ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…</div>
              ) : lines.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum movimento nesse período.</p>
              ) : (
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow><TableHead>Data</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={`${l.ref_id}-${i}`}>
                        <TableCell className="num">{fmtDate(l.moved_on)}</TableCell>
                        <TableCell>{l.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.kind === "recebimento" ? "Recebimento" : l.kind === "pagamento" ? "Pagamento" : "Transferência"}</TableCell>
                        <TableCell className={`num text-right font-medium ${l.amount < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                          {l.amount < 0 ? "−" : "+"}{formatBRL(Math.abs(l.amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          )}
        </>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar conta" : "Nova conta"}</DialogTitle>
            <DialogDescription>O saldo inicial é o que tinha na conta na data informada; o sistema soma os movimentos a partir dela.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="ac-name" className="text-xs">Nome *</Label><Input id="ac-name" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ex.: Banco Inter, Mercado Pago" /></div>
              <div className="space-y-1.5">
                <Label htmlFor="ac-kind" className="text-xs">Tipo</Label>
                <select id="ac-kind" value={fKind} onChange={(e) => setFKind(e.target.value as AccountKind)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label htmlFor="ac-bank" className="text-xs">Banco</Label><Input id="ac-bank" value={fBank} onChange={(e) => setFBank(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Saldo inicial</Label><MoneyInput value={fOpening} onChange={setFOpening} className="text-right" /></div>
              <div className="space-y-1.5"><Label htmlFor="ac-date" className="text-xs">Na data</Label><Input id="ac-date" type="date" value={fOpeningDate} onChange={(e) => setFOpeningDate(e.target.value)} /></div>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium">Formas que caem aqui por padrão</legend>
              <div className="flex flex-wrap gap-1.5">
                {METHODS.map((m) => {
                  const on = fMethods.includes(m);
                  const owner = methodOwner.get(m);
                  const elsewhere = owner && owner !== editing?.name && !on;
                  return (
                    <button key={m} type="button" aria-pressed={on}
                      onClick={() => setFMethods((cur) => on ? cur.filter((x) => x !== m) : [...cur, m])}
                      title={elsewhere ? `Hoje cai em ${owner}` : undefined}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${on ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:text-foreground"}`}>
                      {METHOD_LABELS[m] || m}{elsewhere ? " ·" : ""}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Formas marcadas com · já caem em outra conta; a mais antiga tem preferência.</p>
            </fieldset>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input id="ac-active" type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} /> Conta ativa
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={saveForm} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={trOpen} onOpenChange={setTrOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transferir entre contas</DialogTitle>
            <DialogDescription>Ex.: depósito do dinheiro do caixa no banco.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tr-from" className="text-xs">De</Label>
                <select id="tr-from" value={trFrom} onChange={(e) => setTrFrom(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {active.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatBRL(a.balance)})</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-to" className="text-xs">Para</Label>
                <select id="tr-to" value={trTo} onChange={(e) => setTrTo(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Valor</Label><MoneyInput value={trValue} onChange={setTrValue} className="text-right" /></div>
              <div className="space-y-1.5"><Label htmlFor="tr-date" className="text-xs">Data</Label><Input id="tr-date" type="date" value={trDate} max={localISODate()} onChange={(e) => setTrDate(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="tr-notes" className="text-xs">Observação</Label><Input id="tr-notes" value={trNotes} onChange={(e) => setTrNotes(e.target.value)} placeholder="Ex.: depósito envelope 0412" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrOpen(false)}>Cancelar</Button>
            <Button onClick={saveTransfer} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Transferir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
