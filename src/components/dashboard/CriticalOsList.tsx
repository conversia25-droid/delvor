import { Link } from "react-router-dom";
import { AlertTriangle, Clock, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ServiceOrder } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

type OsRow = ServiceOrder & {
  customers?: { name: string } | null;
};

interface CriticalOsListProps {
  serviceOrders: OsRow[];
  /** Limita quantos itens mostrar. */
  limit?: number;
  /** Se passar, troca o título. */
  title?: string;
}

const TERMINAL_STATUSES = new Set(["entregue", "faturada", "cancelada"]);

function isOverdue(o: OsRow): boolean {
  return !!o.due_at && new Date(o.due_at) < new Date() && !TERMINAL_STATUSES.has(o.status);
}

export default function CriticalOsList({ serviceOrders, limit = 8, title = "OS que precisam de atenção" }: CriticalOsListProps) {
  // Critério de "crítica": atrasada OU aguardando peça/aprovação por mais de 3 dias.
  const now = Date.now();
  const threshold = now - 3 * 24 * 60 * 60 * 1000;

  const critical = serviceOrders
    .filter((o) =>
      isOverdue(o)
      || (
        (o.status === "aguardando_peca" || o.status === "aguardando_aprovacao")
        && new Date(o.updated_at).getTime() < threshold
      )
    )
    .sort((a, b) => {
      // Atrasadas primeiro, depois mais antigas no aguardando
      const ao = isOverdue(a) ? 0 : 1;
      const bo = isOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    })
    .slice(0, limit);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400" /> {title}
      </h3>
      {critical.length === 0 ? (
        <div className="h-32 flex flex-col items-center justify-center text-sm text-muted-foreground gap-1">
          <Wrench className="h-5 w-5 opacity-50" />
          Tudo em dia.
        </div>
      ) : (
        <div className="divide-y">
          {critical.map((o) => {
            const meta = OS_STATUS_LABELS[o.status];
            const overdue = isOverdue(o);
            return (
              <Link
                key={o.id}
                to={`/service-orders/${o.id}`}
                className="flex items-center justify-between py-2 gap-3 hover:bg-muted/30 -mx-2 px-2 rounded transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    #{String(o.number).padStart(6, "0")}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm truncate">{o.customers?.name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1">{o.reported_issue || "—"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {overdue && (
                    <span className="inline-flex items-center text-[10px] text-rose-400">
                      <Clock className="h-3 w-3 mr-0.5" /> atraso
                    </span>
                  )}
                  <Badge className={`${meta.tone} ring-1 text-[10px]`}>{meta.label}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
