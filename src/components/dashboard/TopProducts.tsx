import { Package, Trophy } from "lucide-react";

import { formatBRL } from "@/lib/formatters";

interface TopProductsProps {
  items: Array<{
    product_id: string | null;
    name: string;
    qty: number;
    revenue: number;
  }>;
}

export default function TopProducts({ items }: TopProductsProps) {
  const top = items.slice(0, 5);
  const max = Math.max(1, ...top.map((i) => i.revenue));

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-700 dark:text-amber-400" /> Top produtos vendidos
      </h3>
      {top.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de vendas.
        </div>
      ) : (
        <div className="space-y-3">
          {top.map((it, idx) => (
            <div key={`${it.product_id}-${idx}`} className="space-y-1">
              <div className="flex items-center justify-between text-sm gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground w-4">{idx + 1}.</span>
                  <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{it.name}</span>
                </div>
                <span className="font-mono font-medium shrink-0">{formatBRL(it.revenue)}</span>
              </div>
              <div className="ml-6 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500/60"
                    style={{ width: `${(it.revenue / max) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-12 text-right">{it.qty} un</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
