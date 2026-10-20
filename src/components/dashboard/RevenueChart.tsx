import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatBRL } from "@/lib/formatters";

interface RevenueChartProps {
  /** Vendas faturadas/entregues no período (cada item precisa de issue_date e total). */
  sales: Array<{ issue_date: string; total: number }>;
  /** Quantidade de dias no eixo X. */
  days?: number;
}

function buildSeries(sales: Array<{ issue_date: string; total: number }>, days: number) {
  // Cria buckets por dia (YYYY-MM-DD) preenchendo zeros
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    buckets[k] = 0;
  }
  for (const s of sales) {
    const k = s.issue_date.slice(0, 10);
    if (k in buckets) buckets[k] += Number(s.total) || 0;
  }
  return Object.entries(buckets).map(([k, v]) => ({
    date: k,
    label: new Date(k + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    total: v,
  }));
}

export default function RevenueChart({ sales, days = 30 }: RevenueChartProps) {
  const data = useMemo(() => buildSeries(sales, days), [sales, days]);
  const total = data.reduce((s, d) => s + d.total, 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">Vendido — últimos {days} dias</h3>
          <p className="text-xs text-muted-foreground">Total no período: <span className="font-mono text-foreground">{formatBRL(total)}</span></p>
        </div>
      </div>
      <div className="h-64">
        {total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Nenhuma venda faturada no período.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(124,58,237)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="rgb(124,58,237)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(120,120,140)" strokeOpacity={0.15} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "currentColor" }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.floor(days / 8))}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "currentColor" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                width={50}
              />
              <Tooltip
                contentStyle={{ background: "rgb(20,20,30)", border: "1px solid rgb(60,60,80)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "rgb(180,180,190)" }}
                formatter={(v: any) => [formatBRL(Number(v)), "Vendido"]}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="rgb(167,139,250)"
                strokeWidth={2}
                fill="url(#revFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
