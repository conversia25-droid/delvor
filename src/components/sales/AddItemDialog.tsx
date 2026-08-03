import { useEffect, useState } from "react";
import { Package, Tags, Search, Plus } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { Product, ServiceCatalogItem } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";
import { usePermissions } from "@/hooks/usePermissions";
import QuickProductDialog from "@/components/products/QuickProductDialog";
import QuickServiceDialog from "./QuickServiceDialog";

export type PickedItem =
  | { kind: "product"; product: Product }
  | { kind: "service"; service: ServiceCatalogItem };

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: PickedItem) => void;
}

export default function AddItemDialog({ open, onOpenChange, onPick }: AddItemDialogProps) {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const { canSeePricing, isManager } = usePermissions();
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickServiceOpen, setQuickServiceOpen] = useState(false);

  // Só admin/gerente cadastra produto/serviço inline
  const canCreate = isManager;

  const [tab, setTab] = useState<"product" | "service">("product");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const q = query.trim();
      const ilike = q ? `%${q}%` : null;

      if (tab === "product") {
        let req = supabase
          .from("products" as any)
          .select("*")
          .eq("company_id", companyId)
          .eq("active", true)
          .is("hidden_at", null)
          .order("name")
          .limit(50);
        if (ilike) {
          req = req.or(`name.ilike.${ilike},sku.ilike.${ilike},brand.ilike.${ilike},model.ilike.${ilike},barcode.ilike.${ilike}`);
        }
        const { data } = await req;
        if (!cancelled) setProducts((data as any[]) ?? []);
      } else {
        let req = supabase
          .from("services_catalog" as any)
          .select("*")
          .eq("company_id", companyId)
          .eq("active", true)
          .order("name")
          .limit(50);
        if (ilike) {
          req = req.or(`name.ilike.${ilike},code.ilike.${ilike},description.ilike.${ilike}`);
        }
        const { data } = await req;
        if (!cancelled) setServices((data as any[]) ?? []);
      }
      if (!cancelled) setLoading(false);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, tab, companyId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Adicionar item</DialogTitle>
          <DialogDescription>Escolha um produto do estoque ou um serviço do catálogo.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v: any) => setTab(v)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="product"><Package className="h-4 w-4 mr-1" /> Produtos</TabsTrigger>
            <TabsTrigger value="service"><Tags className="h-4 w-4 mr-1" /> Serviços</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "product" ? "Buscar por nome, SKU, marca..." : "Buscar por nome, código..."}
                className="pl-9"
              />
            </div>
            {canCreate && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => tab === "product" ? setQuickProductOpen(true) : setQuickServiceOpen(true)}
                title={tab === "product" ? "Cadastrar novo produto" : "Cadastrar novo serviço"}
              >
                <Plus className="h-4 w-4 mr-1" />
                {tab === "product" ? "Produto" : "Serviço"}
              </Button>
            )}
          </div>

          <TabsContent value="product" className="flex-1 mt-3 overflow-y-auto">
            {loading && <div className="p-4 text-sm text-muted-foreground text-center">Buscando...</div>}
            {!loading && products.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">Nenhum produto encontrado.</div>
            )}
            <div className="divide-y">
              {products.map((p) => {
                const lowStock = p.stock_min != null && p.stock_qty < p.stock_min;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { onPick({ kind: "product", product: p }); onOpenChange(false); }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left"
                  >
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover ring-1 ring-border shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted/40 flex items-center justify-center shrink-0">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[p.sku, p.brand, p.model].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {canSeePricing && (
                        <div className="text-sm font-medium">{formatBRL(p.sale_price)}</div>
                      )}
                      <div className={`text-xs ${lowStock ? "text-amber-400" : "text-muted-foreground"}`}>
                        {p.stock_qty} {p.unit}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="service" className="flex-1 mt-3 overflow-y-auto">
            {loading && <div className="p-4 text-sm text-muted-foreground text-center">Buscando...</div>}
            {!loading && services.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">Nenhum serviço encontrado.</div>
            )}
            <div className="divide-y">
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onPick({ kind: "service", service: s }); onOpenChange(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left"
                >
                  <div className="h-10 w-10 rounded bg-emerald-500/10 ring-1 ring-emerald-500/30 flex items-center justify-center shrink-0">
                    <Tags className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {s.code && <Badge variant="outline" className="font-mono mr-2 text-[10px]">{s.code}</Badge>}
                      {s.name}
                    </div>
                    {s.description && (
                      <div className="text-xs text-muted-foreground truncate">{s.description}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {canSeePricing && (
                      <div className="text-sm font-medium">{formatBRL(s.default_price)}</div>
                    )}
                    {s.default_duration_min && (
                      <div className="text-xs text-muted-foreground">~{s.default_duration_min}min</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {canCreate && (
          <>
            <QuickProductDialog
              open={quickProductOpen}
              onOpenChange={setQuickProductOpen}
              initialName={query.trim() || undefined}
              defaultType="suprimento"
              onCreated={(p) => { onPick({ kind: "product", product: p }); onOpenChange(false); }}
            />
            <QuickServiceDialog
              open={quickServiceOpen}
              onOpenChange={setQuickServiceOpen}
              initialName={query.trim() || undefined}
              onCreated={(s) => { onPick({ kind: "service", service: s }); onOpenChange(false); }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
