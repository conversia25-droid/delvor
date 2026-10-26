/* Empréstimos e financiamentos (migration 63): lista, parcelas e cadastro
   com simulação Price. Idêntico nos dois repos. */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MoneyInput from "@/components/MoneyInput";
import { formatBRL } from "@/lib/formatters";
import { addDaysISO, localISODate } from "@/lib/receivables";
import {
  createLoan, deleteLoan, fetchLoanInstallments, listLoans, MISSING_DB_MSG, simulateLoan,
  type AccountBalance, type Loan,
} from "@/lib/finance";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
const pct = (rate: number) => `${(rate * 100).toFixed(2).replace(".", ",")}% a.m.`;

type Installment = { id: string; installment_no: number; due_date: string; amount: number; principal_part: number; interest_part: number; status: string; paid_at: string | null; paid_amount: number | null };

export function LoansPanel({ reloadKey, onChanged, onNew }: { reloadKey: number; onChanged: () => void; onNew: () => void }) {
  const { toast } = useToast();
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [inst, setInst] = useState<Record<string, Installment[]>>({});

  const load = useCallback(async () => {
    const r = await listLoans();
    setMissing(!!r.missing);
    setLoans(r.data);
    setInst({});
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!inst[id]) {
      const r = await fetchLoanInstallments(id);
      setInst((prev) => ({ ...prev, [id]: r.data as Installment[] }));
    }
  }

  async function remove(l: Loan) {
    if (!window.confirm(`Excluir o empréstimo "${l.description}"?\n\nSaem as ${l.installments} parcelas e a entrada de ${formatBRL(l.principal)} na conta. Só dá pra excluir se nenhuma parcela foi paga.`)) return;
    const { error } = await deleteLoan(l.id);
    if (error) { toast({ title: "Não foi possível excluir", description: error, variant: "destructive" }); return; }
    toast({ title: "Empréstimo excluído" });
    load(); onChanged();
  }

  if (missing) return <div className="px-6 py-14 text-center text-sm text-muted-foreground">{MISSING_DB_MSG}</div>;
  if (!loans) return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  if (loans.length === 0) {
    return (
      <div className="px-6 py-14 text-center text-sm text-muted-foreground">
        <Landmark className="mx-auto mb-2 h-5 w-5" />
        Nenhum empréstimo ou financiamento cadastrado.
        <div className="mt-3"><Button size="sm" variant="outline" onClick={onNew}><Plus className="mr-1.5 h-4 w-4" /> Novo empréstimo</Button></div>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Empréstimo</TableHead>
          <TableHead>Parcelas</TableHead>
          <TableHead>Próxima</TableHead>
          <TableHead className="text-right">Saldo devedor</TableHead>
          <TableHead className="text-right">Juros pagos / total</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {loans.map((l) => (
          <Fragment key={l.id}>
            <TableRow className="cursor-pointer" onClick={() => toggle(l.id)}>
              <TableCell>{open === l.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
              <TableCell>
                <div className="font-medium">{l.description}</div>
                <div className="text-xs text-muted-foreground">
                  {[l.lender, `${formatBRL(l.principal)} em ${fmtDate(l.received_on)}`, l.monthly_rate > 0 ? pct(l.monthly_rate) : "sem juros"].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell>
                <div className="num">{l.paid_count}/{l.installments} pagas</div>
                <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${(l.paid_count / Math.max(1, l.installments)) * 100}%` }} />
                </div>
                {l.overdue_count > 0 && <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{l.overdue_count} vencida{l.overdue_count > 1 ? "s" : ""}</div>}
              </TableCell>
              <TableCell>
                {l.next_due ? <><div className="num">{fmtDate(l.next_due)}</div><div className="num text-xs text-muted-foreground">{formatBRL(l.next_amount ?? 0)}</div></> : <span className="text-xs text-emerald-700 dark:text-emerald-400">quitado</span>}
              </TableCell>
              <TableCell className="num text-right font-medium">{formatBRL(l.balance_principal)}</TableCell>
              <TableCell className="num text-right text-muted-foreground">{formatBRL(l.interest_paid)} / {formatBRL(l.total_interest)}</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {l.paid_count === 0 && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-700" onClick={() => remove(l)} aria-label="Excluir empréstimo"><Trash2 className="h-4 w-4" /></Button>
                )}
              </TableCell>
            </TableRow>
            {open === l.id && (
              <TableRow className="hover:bg-transparent">
                <TableCell />
                <TableCell colSpan={6} className="pb-4">
                  {!inst[l.id] ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando parcelas…</div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr>
                            <th className="px-2.5 py-1.5 text-left font-medium">Nº</th>
                            <th className="px-2.5 py-1.5 text-left font-medium">Vencimento</th>
                            <th className="px-2.5 py-1.5 text-right font-medium">Parcela</th>
                            <th className="px-2.5 py-1.5 text-right font-medium">Amortização</th>
                            <th className="px-2.5 py-1.5 text-right font-medium">Juros</th>
                            <th className="px-2.5 py-1.5 text-left font-medium">Situação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inst[l.id].map((p) => (
                            <tr key={p.id} className="border-t">
                              <td className="num px-2.5 py-1.5">{p.installment_no}</td>
                              <td className="num px-2.5 py-1.5">{fmtDate(p.due_date)}</td>
                              <td className="num px-2.5 py-1.5 text-right">{formatBRL(p.amount)}</td>
                              <td className="num px-2.5 py-1.5 text-right text-muted-foreground">{formatBRL(p.principal_part)}</td>
                              <td className="num px-2.5 py-1.5 text-right text-muted-foreground">{formatBRL(p.interest_part)}</td>
                              <td className="px-2.5 py-1.5">
                                {p.status === "paga"
                                  ? <span className="text-emerald-700 dark:text-emerald-400">paga {p.paid_at ? new Date(p.paid_at).toLocaleDateString("pt-BR") : ""}</span>
                                  : p.status === "cancelada" ? <span className="text-muted-foreground">cancelada</span>
                                  : p.due_date < localISODate() ? <span className="font-medium text-red-700 dark:text-red-400">vencida</span>
                                  : <span className="text-muted-foreground">em aberto</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">As parcelas ficam em Contas a pagar → Em aberto e são pagas por lá. No DRE só os juros contam como despesa.</p>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export function LoanDialog({
  open, onOpenChange, accounts, categories, onCreated,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; accounts: AccountBalance[];
  categories: { id: string; name: string }[]; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [desc, setDesc] = useState("");
  const [lender, setLender] = useState("");
  const [principal, setPrincipal] = useState(0);
  const [receivedOn, setReceivedOn] = useState(localISODate());
  const [accountId, setAccountId] = useState("");
  const [n, setN] = useState(12);
  const [firstDue, setFirstDue] = useState(addDaysISO(30));
  const [mode, setMode] = useState<"taxa" | "parcela">("taxa");
  const [rate, setRate] = useState("");
  const [installment, setInstallment] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDesc(""); setLender(""); setPrincipal(0); setReceivedOn(localISODate()); setN(12); setFirstDue(addDaysISO(30));
    setMode("taxa"); setRate(""); setInstallment(0); setNotes(""); setSaving(false);
    setAccountId(accounts.find((a) => a.kind === "banco")?.id || accounts[0]?.id || "");
    setCategoryId(categories.find((c) => /juro|financ|emprést|emprest/i.test(c.name))?.id || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const ratePct = Number(rate.replace(",", ".")) || 0;
  const sim = useMemo(() => simulateLoan({
    principal, n, firstDue,
    ratePct: mode === "taxa" ? ratePct : null,
    installment: mode === "parcela" ? installment : null,
  }), [principal, n, firstDue, mode, ratePct, installment]);

  async function save() {
    if (!desc.trim()) { toast({ title: "Dê um nome ao empréstimo", variant: "destructive" }); return; }
    if (principal <= 0) { toast({ title: "Informe o valor recebido", variant: "destructive" }); return; }
    if (!accountId) { toast({ title: "Escolha a conta onde o dinheiro entrou", variant: "destructive" }); return; }
    if (sim.error) { toast({ title: sim.error, variant: "destructive" }); return; }
    setSaving(true);
    const r = await createLoan({
      description: desc.trim(), principal, receivedOn, accountId, installments: n, firstDue,
      ratePct: mode === "taxa" ? ratePct || null : null,
      installment: mode === "parcela" ? installment || null : null,
      lender: lender || null, categoryId: categoryId || null, notes: notes || null,
    });
    setSaving(false);
    if (r.error) { toast({ title: "Não foi possível cadastrar", description: r.error, variant: "destructive" }); return; }
    toast({ title: "Empréstimo cadastrado", description: `${n} parcelas lançadas em Contas a pagar.` });
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo empréstimo ou financiamento</DialogTitle>
          <DialogDescription>O valor entra na conta escolhida e as parcelas vão para Contas a pagar, separando amortização e juros.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ln-desc" className="text-xs">Descrição *</Label>
              <Input id="ln-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ex.: Capital de giro, financiamento da van" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-lender" className="text-xs">Banco / credor</Label>
              <Input id="ln-lender" value={lender} onChange={(e) => setLender(e.target.value)} placeholder="Ex.: Banco do Brasil" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Valor recebido *</Label>
                <MoneyInput value={principal} onChange={setPrincipal} className="text-right" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ln-recv" className="text-xs">Recebido em</Label>
                <Input id="ln-recv" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-acc" className="text-xs">Entrou na conta *</Label>
              <select id="ln-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ln-n" className="text-xs">Parcelas</Label>
                <Input id="ln-n" type="number" min={1} max={420} value={n} onChange={(e) => setN(Math.max(1, Math.min(420, Number(e.target.value) || 1)))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ln-first" className="text-xs">1º vencimento</Label>
                <Input id="ln-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
                {([["taxa", "Sei a taxa"], ["parcela", "Sei o valor da parcela"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setMode(k)}
                    className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>{label}</button>
                ))}
              </div>
              {mode === "taxa" ? (
                <div className="relative">
                  <Input id="ln-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" className="pr-16 text-right" aria-label="Taxa ao mês" />
                  <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted-foreground">% a.m.</span>
                </div>
              ) : (
                <MoneyInput value={installment} onChange={setInstallment} className="text-right" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-cat" className="text-xs">Categoria dos juros</Label>
              <select id="ln-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln-notes" className="text-xs">Observação</Label>
              <Input id="ln-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nº do contrato, garantia…" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-muted/60 px-2 py-2">
                <div className="text-[11px] text-muted-foreground">Parcela</div>
                <div className="num text-sm font-semibold">{sim.installment ? formatBRL(sim.installment) : "—"}</div>
              </div>
              <div className="rounded-md bg-muted/60 px-2 py-2">
                <div className="text-[11px] text-muted-foreground">Taxa</div>
                <div className="num text-sm font-semibold">{sim.schedule.length ? (sim.rate > 0 ? pct(sim.rate) : "sem juros") : "—"}</div>
              </div>
              <div className="rounded-md bg-muted/60 px-2 py-2">
                <div className="text-[11px] text-muted-foreground">Juros total</div>
                <div className="num text-sm font-semibold">{sim.schedule.length ? formatBRL(sim.totalInterest) : "—"}</div>
              </div>
            </div>
            {sim.error ? (
              <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">{sim.error}</p>
            ) : sim.schedule.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">Preencha valor e parcelas para ver a tabela.</p>
            ) : (
              <div className="max-h-[340px] overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Nº</th>
                      <th className="px-2 py-1.5 text-left font-medium">Vence</th>
                      <th className="px-2 py-1.5 text-right font-medium">Parcela</th>
                      <th className="px-2 py-1.5 text-right font-medium">Juros</th>
                      <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.schedule.map((s) => (
                      <tr key={s.n} className="border-t">
                        <td className="num px-2 py-1">{s.n}</td>
                        <td className="num px-2 py-1">{fmtDate(s.due)}</td>
                        <td className="num px-2 py-1 text-right">{formatBRL(s.amount)}</td>
                        <td className="num px-2 py-1 text-right text-muted-foreground">{formatBRL(s.interest)}</td>
                        <td className="num px-2 py-1 text-right text-muted-foreground">{formatBRL(s.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">Tabela Price (parcelas iguais). Se o banco descontou IOF ou tarifa na liberação, informe em "Valor recebido" o que de fato caiu e use "Sei o valor da parcela": a taxa mostrada passa a ser o custo efetivo.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !!sim.error}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar e lançar {n} parcelas</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
