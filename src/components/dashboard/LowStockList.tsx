import { Link } from "react-router-dom";
import { AlertTriangle, Package } from "lucide-react";

import type { Product } from "@/types/delvor";

interface LowStockListProps {
  products: Product[];
  limit?: number;
}

export default function LowStockList({ products, limit = 8 }: LowStockListProps) {
  const low = products
    .filter((p) => p.active && p.stock_min != null && p.stock_qty < p.stock_min)
    .sort((a, b) => (a.stock_qty / Math.max(1, a.stock_min || 1)) - (b.stock_qty / Math.max(1, b.stock_min || 1)))
    .slice(0, limit);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" /> Estoque crítico
      </h3>
      {low.length === 0 ? (
        <div className="h-32 flex flex-col items-center justify-center text-sm text-muted-foreground gap-1">
          <Package className="h-5 w-5 opacity-50" />
          Todos acima do mínimo.
        </div>
      ) : (
        <div className="divide-y">
          {low.map((p) => {
            const min = p.stock_min || 0;
            const ratio = min > 0 ? Math.min(1, p.stock_qty / min) : 0;
            return (
              <Link
                key={p.id}
                to="/products"
                className="flex items-center justify-between py-2 gap-3 hover:bg-muted/30 -mx-2 px-2 rounded transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover ring-1 ring-border shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted/40 flex items-center justify-center shrink-0">
                      <Package className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{p.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden max-w-[120px]">
                        <div
                          className={`h-full ${ratio < 0.3 ? "bg-rose-500" : "bg-amber-500"}`}
                          style={{ width: `${ratio * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {p.stock_qty}/{min} {p.unit}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
