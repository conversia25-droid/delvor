import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Truck, Pencil, Trash2, RefreshCw, Loader2, Tags, X } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { lookupCnpj, CNPJ_ERROR_MESSAGES } from "@/lib/cnpjLookup";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Supplier, SupplierCategory } from "@/types/delvor";
import {
  formatDocument,
  formatPhone,
  maskDocument,
  maskPhone,
} from "@/lib/formatters";

type FormState = {
  id?: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  phone2: string;
  contact_name: string;
  notes: string;
  active: boolean;
  category_id: string | null;
};

const EMPTY: FormState = {
  name: "",
  document: "",
  email: "",
  phone: "",
  phone2: "",
  contact_name: "",
  notes: "",
  active: true,
  category_id: null,
};

function toForm(s: Supplier): FormState {
  return {
    id: s.id,
    name: s.name,
    document: formatDocument(s.document),
    email: s.email || "",
    phone: formatPhone(s.phone),
    phone2: formatPhone(s.phone2),
    contact_name: s.contact_name || "",
    notes: s.notes || "",
    active: s.active,
    category_id: s.category_id ?? null,
  };
}

export default function Suppliers() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [items, setItems] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<SupplierCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [catManagerOpen, setCatManagerOpen] = useState(false);

  /** Busca dados do fornecedor na Receita pelo CNPJ. */
  async function handleCnpjBlur() {
    const digits = form.document.replace(/\D+/g, "");
    if (digits.length !== 14) return;
    setCnpjLoading(true);
    const r = await lookupCnpj(digits);
    setCnpjLoading(false);
    if (!r.ok) {
      if (r.error !== "invalid_cnpj") {
        toast({ title: CNPJ_ERROR_MESSAGES[r.error], variant: "destructive" });
      }
      return;
    }
    const d = r.data;
    setForm((f) => ({
      ...f,
      name: f.name || d.razao_social || "",
      email: f.email || d.email || "",
      phone: f.phone || (d.ddd_telefone_1 ? maskPhone(d.ddd_telefone_1) : ""),
      phone2: f.phone2 || (d.ddd_telefone_2 ? maskPhone(d.ddd_telefone_2) : ""),
    }));
    toast({
      title: d.razao_social,
      description: `Situação: ${d.situacao_cadastral}${d.nome_fantasia ? ` • ${d.nome_fantasia}` : ""}`,
    });
  }
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const [supResp, catResp] = await Promise.all([
      supabase
        .from("suppliers" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      supabase
        .from("supplier_categories" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
    ]);
    setLoading(false);
    if (supResp.error) {
      toast({ title: "Erro ao carregar", description: supResp.error.message, variant: "destructive" });
      return;
    }
    setItems((supResp.data as any[]) ?? []);
    if (!catResp.error) setCategories((catResp.data as any[]) ?? []);
  }

  function categoryName(id: string | null) {
    if (!id) return "—";
    return categories.find((c) => c.id === id)?.name || "—";
  }

  useEffect(() => { load(); }, [companyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      if (filterCategory === "none" && s.category_id) return false;
      if (filterCategory !== "all" && filterCategory !== "none" && s.category_id !== filterCategory) return false;
      if (!q) return true;
      const blob = [s.name, s.document, s.email, s.phone, s.phone2, s.contact_name]
        .filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterCategory]);

  function openNew() { setForm(EMPTY); setDialogOpen(true); }
  function openEdit(s: Supplier) { setForm(toForm(s)); setDialogOpen(true); }

  async function save() {
    if (!companyId) return;
    if (!form.name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload: any = {
      company_id: companyId,
      name: form.name.trim(),
      document: form.document.replace(/\D+/g, "") || null,
      email: form.email.trim() || null,
      phone: form.phone.replace(/\D+/g, "") || null,
      phone2: form.phone2.replace(/\D+/g, "") || null,
      contact_name: form.contact_name.trim() || null,
      notes: form.notes.trim() || null,
      active: form.active,
      category_id: form.category_id,
    };

    const resp = form.id
      ? await supabase.from("suppliers" as any).update(payload).eq("id", form.id)
      : await supabase.from("suppliers" as any).insert(payload);

    setSaving(false);
    if (resp.error) {
      toast({ title: "Erro ao salvar", description: resp.error.message, variant: "destructive" });
      return;
    }
    toast({ title: form.id ? "Fornecedor atualizado" : "Fornecedor cadastrado" });
    setDialogOpen(false);
    load();
  }

  async function doDelete(s: Supplier) {
    const { error } = await supabase.from("suppliers" as any).delete().eq("id", s.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fornecedor excluído" });
    setConfirmDelete(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" /> Fornecedores
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastro de fornecedores de impressoras, suprimentos e peças.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setCatManagerOpen(true)}>
            <Tags className="h-4 w-4 mr-2" /> Categorias
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo fornecedor</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{form.id ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
                <DialogDescription>Dados de identificação e contato.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label>Razão social *</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select
                    value={form.category_id ?? "__none__"}
                    onValueChange={(v) => setForm((f) => ({ ...f, category_id: v === "__none__" ? null : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sem categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem categoria</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {categories.length === 0 && (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Nenhuma categoria cadastrada. Clique em <b>Categorias</b> no topo pra criar.
                    </div>
                  )}
                </div>
                <div>
                  <Label className="flex items-center gap-1.5">
                    CNPJ
                    {cnpjLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-700 dark:text-blue-400" />}
                  </Label>
                  <Input
                    value={form.document}
                    onChange={(e) => setForm((f) => ({ ...f, document: maskDocument(e.target.value, "PJ") }))}
                    onBlur={handleCnpjBlur}
                    placeholder="00.000.000/0000-00"
                    title="Sai do campo pra buscar dados na Receita"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Telefone 1</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))}
                      placeholder="(11) 0000-0000"
                    />
                  </div>
                  <div>
                    <Label>Telefone 2</Label>
                    <Input
                      value={form.phone2}
                      onChange={(e) => setForm((f) => ({ ...f, phone2: maskPhone(e.target.value) }))}
                      placeholder="(11) 90000-0000"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>E-mail</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Contato (nome)</Label>
                    <Input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="sup-active">Ativo</Label>
                  <Switch id="sup-active" checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, CNPJ, e-mail, telefone..." className="pl-9" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            <SelectItem value="none">Sem categoria</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} de {items.length}</Badge>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="w-32">Categoria</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhum fornecedor encontrado.</TableCell></TableRow>
            )}
            {!loading && filtered.map((s) => (
              <TableRow key={s.id} className={s.active ? "" : "opacity-50"}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{s.name}</span>
                    {s.contact_name && <span className="text-xs text-muted-foreground">{s.contact_name}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{categoryName(s.category_id)}</TableCell>
                <TableCell className="font-mono text-xs">{formatDocument(s.document)}</TableCell>
                <TableCell>
                  <div className="flex flex-col text-xs">
                    {s.email && <span>{s.email}</span>}
                    {s.phone && <span>{formatPhone(s.phone)}</span>}
                    {s.phone2 && <span>{formatPhone(s.phone2)}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {s.active
                    ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25">Ativo</Badge>
                    : <Badge variant="secondary">Inativo</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(s)} title="Excluir">
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <b>{confirmDelete?.name}</b>. Produtos vinculados perderão a referência ao fornecedor mas continuam no estoque.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => confirmDelete && doDelete(confirmDelete)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SupplierCategoriesDialog
        open={catManagerOpen}
        onOpenChange={setCatManagerOpen}
        companyId={companyId}
        categories={categories}
        onChanged={load}
      />
    </div>
  );
}

/* ====================================================================
   DIALOG — gerenciar categorias de fornecedor (criar, renomear, excluir)
==================================================================== */
function SupplierCategoriesDialog({
  open, onOpenChange, companyId, categories, onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId: string | undefined;
  categories: SupplierCategory[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!companyId || !newName.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from("supplier_categories" as any)
      .insert({ company_id: companyId, name: newName.trim() });
    setBusy(false);
    if (error) {
      toast({ title: "Erro ao criar categoria", description: error.message, variant: "destructive" });
      return;
    }
    setNewName("");
    onChanged();
  }

  async function rename(c: SupplierCategory) {
    const next = prompt("Novo nome da categoria:", c.name)?.trim();
    if (!next || next === c.name) return;
    const { error } = await supabase
      .from("supplier_categories" as any)
      .update({ name: next })
      .eq("id", c.id);
    if (error) {
      toast({ title: "Erro ao renomear", description: error.message, variant: "destructive" });
      return;
    }
    onChanged();
  }

  async function remove(c: SupplierCategory) {
    if (!confirm(`Excluir a categoria "${c.name}"? Fornecedores nessa categoria ficarão sem categoria.`)) return;
    const { error } = await supabase
      .from("supplier_categories" as any)
      .delete()
      .eq("id", c.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" /> Categorias de fornecedor
          </DialogTitle>
          <DialogDescription>
            Agrupe fornecedores por segmento (ex: Impressoras, Toners, Peças).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nome da nova categoria"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <Button onClick={add} disabled={busy || !newName.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {categories.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma categoria cadastrada.
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{c.name}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => rename(c)} title="Renomear">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(c)} title="Excluir">
                      <X className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
