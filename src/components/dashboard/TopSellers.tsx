import { Medal } from "lucide-react";

import { formatBRL } from "@/lib/formatters";

interface TopSellersProps {
  items: Array<{
    seller_id: string | null;
    name: string;
    revenue: number;
    count: number;
  }>;
}

const MEDAL_TONE = ["text-amber-700 dark:text-amber-400", "text-zinc-300", "text-orange-700 dark:text-orange-400"];

export default function TopSellers({ items }: TopSellersProps) {
  const top = items.slice(0, 5);
  const max = Math.max(1, ...top.map((i) => i.revenue));

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Medal className="h-4 w-4 text-amber-700 dark:text-amber-400" /> Ranking de vendedores
      </h3>
      {top.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
          Sem dados de vendas.
        </div>
      ) : (
        <div className="space-y-3">
          {top.map((it, idx) => (
            <div key={`${it.seller_id || idx}`} className="space-y-1">
              <div className="flex items-center justify-between text-sm gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Medal className={`h-4 w-4 shrink-0 ${MEDAL_TONE[idx] || "text-muted-foreground"}`} />
                  <span className="truncate">{it.name}</span>
                </div>
                <span className="font-mono font-medium shrink-0">{formatBRL(it.revenue)}</span>
              </div>
              <div className="ml-6 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/60"
                    style={{ width: `${(it.revenue / max) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-16 text-right">
                  {it.count} {it.count === 1 ? "venda" : "vendas"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
