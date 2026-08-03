import { useEffect, useState } from "react";
import { Package, Search, Plus } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import type { Product } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";
import QuickProductDialog from "@/components/products/QuickProductDialog";

interface AddPurchaseItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filtra por fornecedor selecionado se passado (sugere produtos do mesmo). */
  supplierId?: string | null;
  onPick: (product: Product) => void;
}

export default function AddPurchaseItemDialog({
  open, onOpenChange, supplierId, onPick,
}: AddPurchaseItemDialogProps) {
  const { user } = useAuth();
  const { isManager } = usePermissions();
  const [quickOpen, setQuickOpen] = useState(false);
  const companyId = user?.company_id;

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) setQuery(""); }, [open]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      let req = supabase
        .from("products" as any)
        .select("*")
        .eq("company_id", companyId)
        .is("hidden_at", null)
        .order("name")
        .limit(50);
      // Filtra por fornecedor (se já tiver vinculado)
      if (supplierId) {
        req = req.or(`supplier_id.eq.${supplierId},supplier_id.is.null`);
      }
      const q = query.trim();
      if (q) {
        const ilike = `%${q}%`;
        req = req.or(`name.ilike.${ilike},sku.ilike.${ilike},brand.ilike.${ilike},model.ilike.${ilike},barcode.ilike.${ilike}`);
      }
      const { data } = await req;
      if (!cancelled) {
        setItems((data as any[]) ?? []);
        setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, supplierId, companyId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Adicionar produto à compra</DialogTitle>
          <DialogDescription>
            Escolha um produto do estoque. O custo unitário pode ser ajustado depois na linha.
            {supplierId && " (Filtrando produtos deste fornecedor + produtos sem fornecedor.)"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, SKU, marca..."
              className="pl-9"
            />
          </div>
          {isManager && (
            <Button type="button" variant="outline" size="sm" onClick={() => setQuickOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto mt-3 divide-y">
          {loading && <div className="p-4 text-sm text-muted-foreground text-center">Buscando...</div>}
          {!loading && items.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">Nenhum produto encontrado.</div>
          )}
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onPick(p); onOpenChange(false); }}
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
                <div className="text-xs text-muted-foreground">Último custo</div>
                <div className="text-sm font-medium">{formatBRL(p.cost_price)}</div>
                <div className="text-[10px] text-muted-foreground">
                  estoque: {p.stock_qty} {p.unit}
                </div>
              </div>
            </button>
          ))}
        </div>

        {isManager && (
          <QuickProductDialog
            open={quickOpen}
            onOpenChange={setQuickOpen}
            initialName={query.trim() || undefined}
            defaultType="suprimento"
            onCreated={(p) => { onPick(p); onOpenChange(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
