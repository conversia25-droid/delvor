import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, Trash2, Pencil, Tag } from "lucide-react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import AddonUpsell from "@/components/addons/AddonUpsell";

interface Category {
  id: string;
  name: string;
  kind: "despesa" | "receita";
  created_at: string;
}

export default function FinanceiroCategorias() {
  const { user } = useAuth();
  const { toast } = useToast();
  const addon = useAddon("financeiro");
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Category | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [kindDraft, setKindDraft] = useState<"despesa" | "receita">("despesa");
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user?.company_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("expense_categories")
      .select("id, name, kind, created_at")
      .eq("company_id", user.company_id)
      .order("name", { ascending: true });
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data as Category[]) ?? []);
    }
    setLoading(false);
  }, [user?.company_id, toast]);

  useEffect(() => { if (addon.active) void load(); }, [load, addon.active]);

  if (addon.loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;
  }
  if (!addon.active) return <AddonUpsell code="financeiro" />;

  function openNew() {
    setEditing(null);
    setNameDraft("");
    setKindDraft("despesa");
    setDialogOpen(true);
  }
  function openEdit(row: Category) {
    setEditing(row);
    setNameDraft(row.name);
    setKindDraft(row.kind);
    setDialogOpen(true);
  }

  async function save() {
    if (!user?.company_id) return;
    if (!nameDraft.trim()) {
      toast({ title: "Informe um nome", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      company_id: user.company_id,
      name: nameDraft.trim(),
      kind: kindDraft,
    };
    const { error } = editing
      ? await supabase.from("expense_categories").update({ name: payload.name, kind: payload.kind }).eq("id", editing.id)
      : await supabase.from("expense_categories").insert(payload as any);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editing ? "Categoria atualizada" : "Categoria criada" });
      setDialogOpen(false);
      await load();
    }
    setSaving(false);
  }

  async function remove(row: Category) {
    if (!confirm(`Excluir a categoria "${row.name}"?`)) return;
    const { error } = await supabase.from("expense_categories").delete().eq("id", row.id);
    if (error) {
      toast({
        title: "Não foi possível excluir",
        description: error.message.includes("foreign key")
          ? "Essa categoria está em uso em despesas. Reatribua antes de excluir."
          : error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Categoria excluída" });
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Tag className="h-6 w-6 text-blue-500" /> Categorias
          </h1>
          <p className="text-sm text-muted-foreground">
            Plano de contas simplificado usado nas despesas fixas e variáveis.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Nova categoria</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
              </div>
              <div>
                <Label>Tipo</Label>
                <div className="mt-1 flex gap-2">
                  <Button
                    type="button"
                    variant={kindDraft === "despesa" ? "default" : "outline"}
                    onClick={() => setKindDraft("despesa")}
                  >Despesa</Button>
                  <Button
                    type="button"
                    variant={kindDraft === "receita" ? "default" : "outline"}
                    onClick={() => setKindDraft("receita")}
                  >Receita</Button>
                </div>
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
          <CardTitle>Todas as categorias</CardTitle>
          <CardDescription>
            {loading ? "Carregando..." : `${rows.length} categoria${rows.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-[100px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhuma categoria cadastrada.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <span className={`inline-block rounded px-2 py-0.5 text-xs ${
                        r.kind === "receita"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "bg-rose-500/10 text-rose-500"
                      }`}>
                        {r.kind === "receita" ? "Receita" : "Despesa"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => void remove(r)}>
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
