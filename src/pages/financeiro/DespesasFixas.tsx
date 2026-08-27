import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Loader2, Trash2, Pencil, Repeat, Check, Undo2, CalendarClock,
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import MoneyInput from "@/components/MoneyInput";
import AddonUpsell from "@/components/addons/AddonUpsell";

interface Fixed {
  id: string;
  name: string;
  amount_cents: number;
  due_day: number;
  category_id: string | null;
  linked_user_id: string | null;
  active: boolean;
  notes: string | null;
}
interface Category { id: string; name: string; }
interface Person { id: string; name: string; }
interface Payment {
  id: string;
  fixed_expense_id: string;
  month_ref: string;
  paid_on: string;
  amount_cents: number;
}

const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function monthRefFromDate(year: number, monthIdx0: number) {
  // YYYY-MM-01
  const m = String(monthIdx0 + 1).padStart(2, "0");
  return `${year}-${m}-01`;
}
function formatBR(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function FinanceiroFixas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const addon = useAddon("financeiro");

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const monthRef = useMemo(() => monthRefFromDate(year, monthIdx), [year, monthIdx]);

  const [fixas, setFixas] = useState<Fixed[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Fixed | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState(0);
  const [dueDayDraft, setDueDayDraft] = useState(5);
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null);
  const [linkedUserDraft, setLinkedUserDraft] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState(true);
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.company_id) return;
    setLoading(true);
    const [fixasRes, catsRes, paysRes, peopleRes] = await Promise.all([
      supabase.from("fixed_expenses")
        .select("id, name, amount_cents, due_day, category_id, linked_user_id, active, notes")
        .eq("company_id", user.company_id)
        .order("name", { ascending: true }),
      supabase.from("expense_categories")
        .select("id, name")
        .eq("company_id", user.company_id)
        .eq("kind", "despesa")
        .order("name", { ascending: true }),
      supabase.from("fixed_expense_payments")
        .select("id, fixed_expense_id, month_ref, paid_on, amount_cents")
        .eq("company_id", user.company_id)
        .eq("month_ref", monthRef),
      supabase.from("profiles")
        .select("id, name:nome")
        .eq("company_id", user.company_id)
        .order("nome", { ascending: true }),
    ]);
    if (fixasRes.error || catsRes.error || paysRes.error || peopleRes.error) {
      toast({
        title: "Erro ao carregar",
        description: fixasRes.error?.message || catsRes.error?.message || paysRes.error?.message || peopleRes.error?.message,
        variant: "destructive",
      });
    } else {
      setFixas((fixasRes.data as Fixed[]) ?? []);
      setCategories((catsRes.data as Category[]) ?? []);
      setPayments((paysRes.data as Payment[]) ?? []);
      setPeople((peopleRes.data as Person[]) ?? []);
    }
    setLoading(false);
  }, [user?.company_id, monthRef, toast]);

  useEffect(() => { if (addon.active) void load(); }, [load, addon.active]);

  const paymentByFixed = useMemo(() => {
    const m = new Map<string, Payment>();
    payments.forEach((p) => m.set(p.fixed_expense_id, p));
    return m;
  }, [payments]);

  const catByFixed = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const personById = useMemo(() => {
    const m = new Map<string, string>();
    people.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [people]);

  const totalActive = useMemo(
    () => fixas.filter((f) => f.active).reduce((s, f) => s + f.amount_cents, 0),
    [fixas],
  );
  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + p.amount_cents, 0),
    [payments],
  );

  if (addon.loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;
  }
  if (!addon.active) return <AddonUpsell code="financeiro" />;

  function openNew() {
    setEditing(null);
    setNameDraft("");
    setAmountDraft(0);
    setDueDayDraft(5);
    setCategoryDraft(null);
    setLinkedUserDraft(null);
    setActiveDraft(true);
    setNotesDraft("");
    setDialogOpen(true);
  }
  function openEdit(row: Fixed) {
    setEditing(row);
    setNameDraft(row.name);
    setAmountDraft(row.amount_cents / 100);
    setDueDayDraft(row.due_day);
    setCategoryDraft(row.category_id);
    setLinkedUserDraft(row.linked_user_id);
    setActiveDraft(row.active);
    setNotesDraft(row.notes ?? "");
    setDialogOpen(true);
  }

  async function save() {
    if (!user?.company_id) return;
    if (!nameDraft.trim()) { toast({ title: "Informe um nome", variant: "destructive" }); return; }
    if (amountDraft <= 0) { toast({ title: "Informe o valor", variant: "destructive" }); return; }
    if (dueDayDraft < 1 || dueDayDraft > 31) { toast({ title: "Dia de vencimento inválido", variant: "destructive" }); return; }

    setSaving(true);
    const payload = {
      company_id: user.company_id,
      name: nameDraft.trim(),
      amount_cents: Math.round(amountDraft * 100),
      due_day: dueDayDraft,
      category_id: categoryDraft,
      linked_user_id: linkedUserDraft,
      active: activeDraft,
      notes: notesDraft.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("fixed_expenses").update({
          name: payload.name, amount_cents: payload.amount_cents, due_day: payload.due_day,
          category_id: payload.category_id, linked_user_id: payload.linked_user_id,
          active: payload.active, notes: payload.notes,
        }).eq("id", editing.id)
      : await supabase.from("fixed_expenses").insert(payload as any);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editing ? "Despesa atualizada" : "Despesa criada" });
      setDialogOpen(false);
      await load();
    }
    setSaving(false);
  }

  async function markPaid(row: Fixed) {
    if (!user?.company_id) return;
    setProcessing(row.id);
    const payload = {
      company_id: user.company_id,
      fixed_expense_id: row.id,
      month_ref: monthRef,
      paid_on: new Date().toISOString().slice(0, 10),
      amount_cents: row.amount_cents,
    };
    const { error } = await supabase.from("fixed_expense_payments").insert(payload as any);
    if (error) {
      toast({ title: "Erro ao marcar como paga", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Marcada como paga" });
      await load();
    }
    setProcessing(null);
  }

  async function undoPaid(paymentId: string) {
    setProcessing(paymentId);
    const { error } = await supabase.from("fixed_expense_payments").delete().eq("id", paymentId);
    if (error) {
      toast({ title: "Erro ao desfazer", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pagamento desfeito" });
      await load();
    }
    setProcessing(null);
  }

  async function remove(row: Fixed) {
    if (!confirm(`Excluir "${row.name}"? Isso remove todo o histórico de pagamentos dessa despesa.`)) return;
    const { error } = await supabase.from("fixed_expenses").delete().eq("id", row.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Despesa excluída" });
      await load();
    }
  }

  function prevMonth() {
    let m = monthIdx - 1, y = year;
    if (m < 0) { m = 11; y -= 1; }
    setMonthIdx(m); setYear(y);
  }
  function nextMonth() {
    let m = monthIdx + 1, y = year;
    if (m > 11) { m = 0; y += 1; }
    setMonthIdx(m); setYear(y);
  }

  function statusFor(row: Fixed) {
    const pay = paymentByFixed.get(row.id);
    if (pay) return { kind: "paid" as const, pay };
    // Só mostra vencido se o mês selecionado é o corrente ou anterior
    const today = new Date();
    const selMonthDate = new Date(year, monthIdx, row.due_day);
    if (selMonthDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      return { kind: "overdue" as const };
    }
    return { kind: "open" as const };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Repeat className="h-6 w-6 text-blue-500" /> Despesas Fixas
          </h1>
          <p className="text-sm text-muted-foreground">
            Contas recorrentes mensais. Marque como paga a cada mês pro fluxo de caixa acompanhar.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth} title="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="rounded-md border px-3 py-1.5 text-sm font-medium min-w-[160px] text-center">
            {MONTH_NAMES[monthIdx]} / {year}
          </div>
          <Button variant="outline" size="icon" onClick={nextMonth} title="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Nova despesa</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Editar despesa fixa" : "Nova despesa fixa"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Nome</Label>
                  <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Aluguel, Internet, Salário João…" autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Valor mensal</Label>
                    <MoneyInput value={amountDraft} onChange={setAmountDraft} />
                  </div>
                  <div>
                    <Label>Dia do vencimento</Label>
                    <Input
                      type="number" min={1} max={31}
                      value={dueDayDraft}
                      onChange={(e) => setDueDayDraft(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                    />
                  </div>
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select
                    value={categoryDraft ?? "__none__"}
                    onValueChange={(v) => setCategoryDraft(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem categoria</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vincular a colaborador <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                  <Select
                    value={linkedUserDraft ?? "__none__"}
                    onValueChange={(v) => setLinkedUserDraft(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Ninguém" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Ninguém</SelectItem>
                      {people.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Útil pra salário, pró-labore, plano de saúde por pessoa.
                  </p>
                </div>
                <div>
                  <Label>Observações</Label>
                  <Input value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Opcional" />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium text-sm">Ativa</p>
                    <p className="text-xs text-muted-foreground">Desativar mantém histórico mas remove do total mensal.</p>
                  </div>
                  <Switch checked={activeDraft} onCheckedChange={setActiveDraft} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total mensal (ativas)</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatMoney(totalActive)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Já pago no mês</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-semibold text-emerald-500">{formatMoney(totalPaid)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Falta pagar</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-semibold text-rose-500">{formatMoney(Math.max(0, totalActive - totalPaid))}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Despesas do mês</CardTitle>
          <CardDescription>{MONTH_NAMES[monthIdx]} / {year}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Venc.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[140px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : fixas.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma despesa fixa cadastrada.</TableCell></TableRow>
              ) : (
                fixas.map((row) => {
                  const st = statusFor(row);
                  const isProc = processing === row.id || processing === st.pay?.id;
                  return (
                    <TableRow key={row.id} className={row.active ? "" : "opacity-50"}>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.linked_user_id && (
                          <span className="ml-2 text-xs text-blue-500">
                            👤 {personById.get(row.linked_user_id) ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.category_id ? catByFixed.get(row.category_id) ?? "—" : "—"}
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(row.amount_cents)}</TableCell>
                      <TableCell className="text-center text-muted-foreground">Dia {row.due_day}</TableCell>
                      <TableCell>
                        {st.kind === "paid" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Pago em {formatBR(st.pay!.paid_on)}
                          </span>
                        ) : st.kind === "overdue" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-rose-500">
                            <AlertTriangle className="h-3.5 w-3.5" /> Atrasado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarClock className="h-3.5 w-3.5" /> Aberto
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {st.kind === "paid" ? (
                          <Button
                            variant="ghost" size="icon" title="Desfazer pagamento"
                            disabled={isProc}
                            onClick={() => void undoPaid(st.pay!.id)}
                          >
                            {isProc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" size="icon" title="Marcar como paga"
                            disabled={isProc || !row.active}
                            onClick={() => void markPaid(row)}
                          >
                            {isProc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => void remove(row)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
