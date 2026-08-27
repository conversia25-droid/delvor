import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Trash2, Pencil, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import MoneyInput from "@/components/MoneyInput";
import AddonUpsell from "@/components/addons/AddonUpsell";

interface Variable {
  id: string;
  name: string;
  amount_cents: number;
  paid_on: string;
  category_id: string | null;
  notes: string | null;
}
interface Category { id: string; name: string; }

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function formatBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function FinanceiroVariaveis() {
  const { user } = useAuth();
  const { toast } = useToast();
  const addon = useAddon("financeiro");

  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());

  const [rows, setRows] = useState<Variable[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Variable | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState(0);
  const [paidOnDraft, setPaidOnDraft] = useState(todayISO());
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.company_id) return;
    setLoading(true);
    const [rowsRes, catsRes] = await Promise.all([
      supabase.from("variable_expenses")
        .select("id, name, amount_cents, paid_on, category_id, notes")
        .eq("company_id", user.company_id)
        .gte("paid_on", from)
        .lte("paid_on", to)
        .order("paid_on", { ascending: false }),
      supabase.from("expense_categories")
        .select("id, name")
        .eq("company_id", user.company_id)
        .eq("kind", "despesa")
        .order("name", { ascending: true }),
    ]);
    if (rowsRes.error || catsRes.error) {
      toast({
        title: "Erro ao carregar",
        description: rowsRes.error?.message || catsRes.error?.message,
        variant: "destructive",
      });
    } else {
      setRows((rowsRes.data as Variable[]) ?? []);
      setCategories((catsRes.data as Category[]) ?? []);
    }
    setLoading(false);
  }, [user?.company_id, from, to, toast]);

  useEffect(() => { if (addon.active) void load(); }, [load, addon.active]);

  const catByRow = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount_cents, 0), [rows]);

  if (addon.loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;
  }
  if (!addon.active) return <AddonUpsell code="financeiro" />;

  function openNew() {
    setEditing(null);
    setNameDraft("");
    setAmountDraft(0);
    setPaidOnDraft(todayISO());
    setCategoryDraft(null);
    setNotesDraft("");
    setDialogOpen(true);
  }
  function openEdit(row: Variable) {
    setEditing(row);
    setNameDraft(row.name);
    setAmountDraft(row.amount_cents / 100);
    setPaidOnDraft(row.paid_on);
    setCategoryDraft(row.category_id);
    setNotesDraft(row.notes ?? "");
    setDialogOpen(true);
  }

  async function save() {
    if (!user?.company_id) return;
    if (!nameDraft.trim()) { toast({ title: "Informe um nome", variant: "destructive" }); return; }
    if (amountDraft <= 0) { toast({ title: "Informe o valor", variant: "destructive" }); return; }

    setSaving(true);
    const payload = {
      company_id: user.company_id,
      name: nameDraft.trim(),
      amount_cents: Math.round(amountDraft * 100),
      paid_on: paidOnDraft,
      category_id: categoryDraft,
      notes: notesDraft.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("variable_expenses").update({
          name: payload.name, amount_cents: payload.amount_cents, paid_on: payload.paid_on,
          category_id: payload.category_id, notes: payload.notes,
        }).eq("id", editing.id)
      : await supabase.from("variable_expenses").insert(payload as any);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editing ? "Despesa atualizada" : "Despesa lançada" });
      setDialogOpen(false);
      await load();
    }
    setSaving(false);
  }

  async function remove(row: Variable) {
    if (!confirm(`Excluir "${row.name}"?`)) return;
    const { error } = await supabase.from("variable_expenses").delete().eq("id", row.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Despesa excluída" });
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Receipt className="h-6 w-6 text-blue-500" /> Despesas Variáveis
          </h1>
          <p className="text-sm text-muted-foreground">
            Gastos pontuais que não se repetem todo mês (materiais, viagens, imprevistos).
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Nova despesa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar despesa" : "Nova despesa variável"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Ex: Almoço com cliente" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor</Label>
                  <MoneyInput value={amountDraft} onChange={setAmountDraft} />
                </div>
                <div>
                  <Label>Pago em</Label>
                  <Input type="date" value={paidOnDraft} onChange={(e) => setPaidOnDraft(e.target.value)} />
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
                <Label>Observações</Label>
                <Input value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Opcional" />
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

      <Card>
        <CardHeader>
          <CardTitle>Filtro por período</CardTitle>
          <CardDescription>Ajuste o intervalo pra ver o que foi gasto em cada janela.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="ml-auto">
              <Label className="text-xs text-muted-foreground">Total do período</Label>
              <p className="text-2xl font-semibold">{formatMoney(total)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lançamentos</CardTitle>
          <CardDescription>
            {loading ? "Carregando..." : `${rows.length} lançamento${rows.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pago em</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-[100px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma despesa no período.</TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">{formatBR(row.paid_on)}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.category_id ? catByRow.get(row.category_id) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(row.amount_cents)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => void remove(row)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
