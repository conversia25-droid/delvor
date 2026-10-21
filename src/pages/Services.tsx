import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Tags, Pencil, Trash2, RefreshCw, Clock } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

import type { ServiceCatalogItem } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";

type FormState = {
  id?: string;
  code: string;
  name: string;
  description: string;
  default_price: string;       // string pra digitar, converte ao salvar
  default_duration_min: string;
  active: boolean;
};

const EMPTY: FormState = {
  code: "",
  name: "",
  description: "",
  default_price: "",
  default_duration_min: "",
  active: true,
};

function toForm(s: ServiceCatalogItem): FormState {
  return {
    id: s.id,
    code: s.code || "",
    name: s.name,
    description: s.description || "",
    default_price: s.default_price ? String(s.default_price).replace(".", ",") : "",
    default_duration_min: s.default_duration_min ? String(s.default_duration_min) : "",
    active: s.active,
  };
}

function parsePrice(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function Services() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [items, setItems] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ServiceCatalogItem | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("services_catalog" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as any[]) ?? []);
  }

  useEffect(() => { load(); }, [companyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => {
      const blob = [s.code, s.name, s.description].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search]);

  function openNew() { setForm(EMPTY); setDialogOpen(true); }
  function openEdit(s: ServiceCatalogItem) { setForm(toForm(s)); setDialogOpen(true); }

  async function save() {
    if (!companyId) return;
    if (!form.name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload: any = {
      company_id: companyId,
      code: form.code.trim().toUpperCase() || null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      default_price: parsePrice(form.default_price),
      default_duration_min: form.default_duration_min ? parseInt(form.default_duration_min, 10) : null,
      active: form.active,
    };

    const resp = form.id
      ? await supabase.from("services_catalog" as any).update(payload).eq("id", form.id)
      : await supabase.from("services_catalog" as any).insert(payload);

    setSaving(false);
    if (resp.error) {
      toast({ title: "Erro ao salvar", description: resp.error.message, variant: "destructive" });
      return;
    }
    toast({ title: form.id ? "Serviço atualizado" : "Serviço cadastrado" });
    setDialogOpen(false);
    load();
  }

  async function doDelete(s: ServiceCatalogItem) {
    const { error } = await supabase.from("services_catalog" as any).delete().eq("id", s.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Serviço excluído" });
    setConfirmDelete(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
            <Tags className="h-5 w-5 text-primary" /> Catálogo de Serviços
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Itens reutilizáveis em vendas e ordens de serviço (limpeza, recarga,
            instalação, locação...). Define preço base e tempo médio.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo serviço</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{form.id ? "Editar serviço" : "Novo serviço"}</DialogTitle>
                <DialogDescription>
                  Cadastre uma tarefa típica que sua equipe executa nos clientes.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Código</Label>
                    <Input
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                      placeholder="ex: LIMP, RECG"
                      maxLength={12}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Nome *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Limpeza geral de impressora"
                    />
                  </div>
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Inclui desmontagem, limpeza interna, sopro, troca de pads..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Preço base (R$)</Label>
                    <Input
                      value={form.default_price}
                      onChange={(e) => setForm((f) => ({ ...f, default_price: e.target.value }))}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <Label>Duração média (min)</Label>
                    <Input
                      value={form.default_duration_min}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          default_duration_min: e.target.value.replace(/\D+/g, ""),
                        }))
                      }
                      placeholder="60"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="svc-active">Ativo</Label>
                  <Switch
                    id="svc-active"
                    checked={form.active}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
                  />
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
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, nome, descrição..."
            className="pl-9"
          />
        </div>
        <Badge variant="secondary" className="text-xs">{filtered.length} de {items.length}</Badge>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead className="w-32 text-right">Preço base</TableHead>
              <TableHead className="w-28 text-right">Duração</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-28 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhum serviço cadastrado.</TableCell></TableRow>
            )}
            {!loading && filtered.map((s) => (
              <TableRow key={s.id} className={s.active ? "" : "opacity-50"}>
                <TableCell className="font-mono text-xs">{s.code || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{s.name}</span>
                    {s.description && <span className="text-xs text-muted-foreground line-clamp-1">{s.description}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">{formatBRL(s.default_price)}</TableCell>
                <TableCell className="text-right text-xs">
                  {s.default_duration_min ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> {s.default_duration_min} min
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  {s.active
                    ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25">Ativo</Badge>
                    : <Badge variant="secondary">Inativo</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(s)} title="Excluir"><Trash2 className="h-4 w-4 text-rose-500" /></Button>
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
            <AlertDialogTitle>Excluir serviço?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <b>{confirmDelete?.name}</b>. Não afeta vendas ou OS já criadas com esse serviço.
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
    </div>
  );
}
