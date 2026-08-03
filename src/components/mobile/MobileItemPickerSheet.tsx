/**
 * Sheet de seleção de peça/serviço pra usar em telas mobile.
 *
 * Reutilizado em:
 *   - MobileOrderDetail (lançar peça/serviço na OS)
 *   - MobileSaleEditor  (adicionar item à venda)
 *
 * Busca server-side com debounce 250ms. Listagem é tap-pra-selecionar.
 */
import { useEffect, useState } from "react";
import { Loader2, Package, Search, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { Product, ServiceCatalogItem } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";

export type MobileItemPicked =
  | { kind: "peca"; data: Product }
  | { kind: "servico"; data: ServiceCatalogItem };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (picked: MobileItemPicked) => void;
  companyId: string | null;
  /** Pra ocultar preço (técnico puro). Default: mostra. */
  showPricing?: boolean;
}

export default function MobileItemPickerSheet({
  open,
  onOpenChange,
  onPick,
  companyId,
  showPricing = true,
}: Props) {
  const [tab, setTab] = useState<"peca" | "servico">("peca");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
  }, [open]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const q = query.trim();
      const ilike = q ? `%${q}%` : null;
      if (tab === "peca") {
        let req = supabase
          .from("products" as any)
          .select("*")
          .eq("company_id", companyId)
          .eq("active", true)
          .is("hidden_at", null)
          .order("name")
          .limit(50);
        if (ilike) req = req.or(`name.ilike.${ilike},sku.ilike.${ilike},brand.ilike.${ilike}`);
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
        if (ilike) req = req.ilike("name", ilike);
        const { data } = await req;
        if (!cancelled) setServices((data as any[]) ?? []);
      }
      if (!cancelled) setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, companyId, tab, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl p-0 h-[85vh] flex flex-col">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>Adicionar peça ou serviço</SheetTitle>
        </SheetHeader>

        <div className="p-3 border-b space-y-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid grid-cols-2 w-full h-10">
              <TabsTrigger value="peca" className="text-xs">
                <Package className="h-3.5 w-3.5 mr-1.5" /> Peça
              </TabsTrigger>
              <TabsTrigger value="servico" className="text-xs">
                <Wrench className="h-3.5 w-3.5 mr-1.5" /> Serviço
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={tab === "peca" ? "Buscar peça (nome, SKU, marca)" : "Buscar serviço"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-10"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Buscando...
            </div>
          ) : tab === "peca" ? (
            products.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhuma peça encontrada.
              </div>
            ) : (
              products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPick({ kind: "peca", data: p })}
                  className="w-full text-left p-3 rounded-lg active:bg-muted/30 transition flex items-center gap-3 border-b border-border/30 last:border-0"
                >
                  <Package className="h-4 w-4 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    {(p.sku || p.brand) && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[p.sku, p.brand, p.model].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  {showPricing && p.sale_price !== null && p.sale_price !== undefined && (
                    <div className="text-sm font-mono text-muted-foreground shrink-0">
                      {formatBRL(Number(p.sale_price))}
                    </div>
                  )}
                </button>
              ))
            )
          ) : services.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhum serviço encontrado.
            </div>
          ) : (
            services.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick({ kind: "servico", data: s })}
                className="w-full text-left p-3 rounded-lg active:bg-muted/30 transition flex items-center gap-3 border-b border-border/30 last:border-0"
              >
                <Wrench className="h-4 w-4 text-sky-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                </div>
                {showPricing && s.default_price !== null && s.default_price !== undefined && (
                  <div className="text-sm font-mono text-muted-foreground shrink-0">
                    {formatBRL(Number(s.default_price))}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
