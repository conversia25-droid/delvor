import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { OsStatus } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

interface OsStatusDonutProps {
  /** Lista de OS com seu status — gráfico monta o agrupamento. */
  serviceOrders: Array<{ status: OsStatus }>;
}

/** Cores fixas por status (paleta do app). */
const COLORS: Record<OsStatus, string> = {
  aberta:                "rgb(56,189,248)",   // sky
  diagnostico:           "rgb(167,139,250)",  // violet
  aguardando_aprovacao:  "rgb(250,204,21)",   // yellow
  aguardando_peca:       "rgb(251,146,60)",   // orange
  em_execucao:           "rgb(34,211,238)",   // cyan
  concluida:             "rgb(74,222,128)",   // green
  entregue:              "rgb(45,212,191)",   // teal
  faturada:              "rgb(20,184,166)",   // teal-darker
  cancelada:             "rgb(244,63,94)",    // rose
};

const ACTIVE_STATUSES: OsStatus[] = [
  "aberta", "diagnostico", "aguardando_aprovacao",
  "aguardando_peca", "em_execucao", "concluida", "entregue",
];

export default function OsStatusDonut({ serviceOrders }: OsStatusDonutProps) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of serviceOrders) {
      if (!ACTIVE_STATUSES.includes(o.status)) continue;
      counts[o.status] = (counts[o.status] || 0) + 1;
    }
    return ACTIVE_STATUSES
      .filter((s) => counts[s])
      .map((s) => ({
        name: OS_STATUS_LABELS[s].label,
        status: s,
        value: counts[s],
        color: COLORS[s],
      }));
  }, [serviceOrders]);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">OS em andamento</h3>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{total}</span> abertas — distribuição por status
          </p>
        </div>
      </div>
      <div className="h-64">
        {total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Nenhuma OS em andamento.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                strokeWidth={1}
              >
                {data.map((d) => (
                  <Cell key={d.status} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "rgb(20,20,30)", border: "1px solid rgb(60,60,80)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "rgb(180,180,190)" }}
              />
              <Legend
                verticalAlign="bottom"
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
