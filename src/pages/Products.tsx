import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Package,
  Pencil,
  Trash2,
  RefreshCw,
  Boxes,
  AlertTriangle,
  Sliders,
  History,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import type { Product, ProductCategory, ProductType, Supplier } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";
import MiniBars, { shortBRL } from "@/components/charts/MiniBars";
import { usePermissions } from "@/hooks/usePermissions";
import ProductFormDialog from "@/components/products/ProductFormDialog";
import StockAdjustDialog from "@/components/products/StockAdjustDialog";
import StockHistoryDialog from "@/components/products/StockHistoryDialog";
import ImageLightbox from "@/components/ImageLightbox";

const TYPE_LABEL: Record<ProductType, string> = {
  equipamento:    "Equipamento",
  suprimento:     "Suprimento",
  peca:           "Peça",
  acessorio:      "Acessório",
  servico_avulso: "Serviço",
};

const TYPE_TONE: Record<ProductType, string> = {
  equipamento:    "bg-blue-500/15 text-blue-700 dark:text-blue-300 ring-blue-500/30",
  suprimento:     "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  peca:           "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  acessorio:      "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  servico_avulso: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
};

function isForeignKeyViolation(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "23503" ||
    /violates foreign key constraint|foreign key/i.test(error?.message || "")
  );
}

export default function Products() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const { canSeePricing, isManager } = usePermissions();

  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | ProductType>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [historyOf, setHistoryOf] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const [pr, cr, sr] = await Promise.all([
      supabase.from("products" as any).select("*").eq("company_id", companyId).is("hidden_at", null).order("name"),
      supabase.from("product_categories" as any).select("*").eq("company_id", companyId).order("name"),
      supabase.from("suppliers" as any).select("*").eq("company_id", companyId).eq("active", true).order("name"),
    ]);
    setLoading(false);
    if (pr.error) {
      toast({ title: "Erro ao carregar produtos", description: pr.error.message, variant: "destructive" });
    } else {
      setItems((pr.data as any[]) ?? []);
    }
    if (!cr.error) setCategories((cr.data as any[]) ?? []);
    if (!sr.error) setSuppliers((sr.data as any[]) ?? []);
  }

  useEffect(() => { load(); }, [companyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (filterType !== "all" && p.type !== filterType) return false;
      if (filterCategory !== "all" && p.category_id !== filterCategory) return false;
      if (onlyLowStock && !(p.active && p.stock_min != null && p.stock_qty < p.stock_min)) return false;
      if (!q) return true;
      const blob = [p.sku, p.name, p.brand, p.model, p.barcode, p.description]
        .filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterType, filterCategory, onlyLowStock]);

  const stats = useMemo(() => {
    const total = items.length;
    const low = items.filter((p) => p.active && p.stock_min != null && p.stock_qty < p.stock_min).length;
    const stockValue = items.reduce((s, p) => s + (p.cost_price || 0) * (p.stock_qty || 0), 0);
    return { total, low, stockValue };
  }, [items]);

  /* Dinheiro parado em estoque (custo × quantidade) por tipo de item. */
  const valueByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of items) {
      if (!p.active) continue;
      const v = (p.cost_price || 0) * Math.max(0, p.stock_qty || 0);
      m.set(p.type, (m.get(p.type) || 0) + v);
    }
    return [...m.entries()]
      .map(([type, value]) => ({ key: type, label: (TYPE_LABEL as Record<string, string>)[type] || type, value }))
      .sort((a, b) => b.value - a.value);
  }, [items]);

  function openNew() { setEditing(null); setFormOpen(true); }
  function openEdit(p: Product) { setEditing(p); setFormOpen(true); }

  async function doDelete(p: Product) {
    const { error } = await supabase.from("products" as any).delete().eq("id", p.id);
    if (error) {
      if (isForeignKeyViolation(error)) {
        const { error: hideError } = await supabase
          .from("products" as any)
          .update({ active: false, hidden_at: new Date().toISOString() })
          .eq("id", p.id)
          .eq("company_id", companyId);

        if (hideError) {
          toast({ title: "Erro ao ocultar", description: hideError.message, variant: "destructive" });
          return;
        }

        toast({
          title: "Produto ocultado",
          description: "Ele possui historico vinculado e foi ocultado para preservar movimentacoes, vendas, compras ou OS.",
        });
        setConfirmDelete(null);
        load();
        return;
      }

      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Produto excluído" });
    setConfirmDelete(null);
    load();
  }

  function categoryName(id: string | null) {
    if (!id) return "—";
    return categories.find((c) => c.id === id)?.name || "—";
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Estoque
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Impressoras, suprimentos, peças e periféricos. Movimente o estoque pelo botão de ajuste.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          {isManager && (
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo produto</Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className={`grid grid-cols-1 gap-3 ${canSeePricing ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Boxes className="h-3 w-3" /> Produtos cadastrados
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-1">{stats.total}</div>
        </div>
        <button
          type="button"
          onClick={() => setOnlyLowStock((v) => !v)}
          className={`rounded-lg border p-4 text-left transition ${
            onlyLowStock ? "border-amber-500/50 bg-amber-500/10" : "bg-card hover:bg-muted/30"
          }`}
        >
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Estoque baixo {onlyLowStock && "(filtrado)"}
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-1 text-amber-700 dark:text-amber-400">{stats.low}</div>
        </button>
        {canSeePricing && (
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground">Valor em estoque (custo)</div>
            <div className="text-2xl font-semibold tracking-tight mt-1">{formatBRL(stats.stockValue)}</div>
          </div>
        )}
      </div>

      {canSeePricing && valueByType.length > 1 && (
        <MiniBars
          title="Valor parado em estoque"
          sub="por tipo de item, a preço de custo"
          data={valueByType}
          format={shortBRL}
          height={150}
          showValues
        />
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU, nome, marca, modelo, barcode..."
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={(v: any) => setFilterType(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {(Object.keys(TYPE_LABEL) as ProductType[]).map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} de {items.length}</Badge>
      </div>

      {/* Tabela */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14"></TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="w-28">SKU</TableHead>
              <TableHead className="w-32">Tipo</TableHead>
              <TableHead className="w-32">Categoria</TableHead>
              {canSeePricing && <TableHead className="w-32 text-right">Custo</TableHead>}
              {canSeePricing && <TableHead className="w-32 text-right">Venda</TableHead>}
              <TableHead className="w-36 text-right">Estoque</TableHead>
              <TableHead className="w-44 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={canSeePricing ? 9 : 7} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={canSeePricing ? 9 : 7} className="text-center py-10 text-muted-foreground">Nenhum produto encontrado.</TableCell></TableRow>
            )}
            {!loading && filtered.map((p) => {
              const isLow = p.active && p.stock_min != null && p.stock_qty < p.stock_min;
              return (
                <TableRow key={p.id} className={p.active ? "" : "opacity-50"}>
                  <TableCell>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        onClick={() => setViewer(p.image_url)}
                        title="Ver imagem"
                        className="h-10 w-10 rounded object-cover ring-1 ring-border cursor-zoom-in"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted/40 flex items-center justify-center">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium flex items-center gap-2">
                        {p.name}
                        {!p.active && <Badge variant="secondary" className="w-fit">Inativo</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[p.brand, p.model].filter(Boolean).join(" • ")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.sku || "—"}</TableCell>
                  <TableCell>
                    <Badge className={`${TYPE_TONE[p.type]} ring-1`}>{TYPE_LABEL[p.type]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{categoryName(p.category_id)}</TableCell>
                  {canSeePricing && (
                    <TableCell className="text-right font-mono text-xs">{formatBRL(p.cost_price)}</TableCell>
                  )}
                  {canSeePricing && (
                    <TableCell className="text-right font-mono text-sm font-medium">{formatBRL(p.sale_price)}</TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {isLow && <AlertTriangle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />}
                      <span className={`font-mono ${isLow ? "text-amber-700 dark:text-amber-400 font-medium" : ""}`}>
                        {p.stock_qty} {p.unit}
                      </span>
                    </div>
                    {p.stock_min != null && p.stock_min > 0 && (
                      <div className="text-[10px] text-muted-foreground">mín: {p.stock_min}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {isManager && p.active && (
                        <Button variant="ghost" size="icon" onClick={() => setAdjusting(p)} title="Ajustar estoque">
                          <Sliders className="h-4 w-4 text-emerald-500" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => setHistoryOf(p)} title="Histórico">
                        <History className="h-4 w-4" />
                      </Button>
                      {isManager && (
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isManager && (
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(p)} title="Excluir ou ocultar">
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ProductFormDialog
        product={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={load}
        categories={categories}
        suppliers={suppliers}
      />

      <StockAdjustDialog
        product={adjusting}
        open={!!adjusting}
        onOpenChange={(o) => !o && setAdjusting(null)}
        onAdjusted={load}
      />

      <StockHistoryDialog
        product={historyOf}
        open={!!historyOf}
        onOpenChange={(o) => !o && setHistoryOf(null)}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ou ocultar produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <b>{confirmDelete?.name}</b> definitivamente quando nao houver historico.
              Se houver movimentacoes, vendas, compras ou OS vinculadas, o produto sera ocultado para preservar os registros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700 text-white" onClick={() => confirmDelete && doDelete(confirmDelete)}>
              Excluir ou ocultar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImageLightbox src={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}
