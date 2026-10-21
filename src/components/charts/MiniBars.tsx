/* Gráfico de barras compacto pras telas de lista (repaginada 2026-10).
   Uma série = uma cor (--chart-1). Estado (crit/warn) só quando a barra
   significa problema, e aí o rótulo também diz. Idêntico nos dois repos. */
import { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type MiniBar = { key: string; label: string; value: number; detail?: string; tone?: "crit" | "warn" | null };

const FILL = {
  crit: "hsl(var(--critical))",
  warn: "hsl(var(--warning))",
};

export default function MiniBars({
  title, sub, data, format, height = 150, showValues = false, empty = "Sem dados no período.", right,
}: {
  title: string;
  sub?: string;
  data: MiniBar[];
  format: (v: number) => string;
  height?: number;
  /** escreve o valor em cima de cada barra (use só com poucas barras) */
  showValues?: boolean;
  empty?: string;
  right?: ReactNode;
}) {
  const hasData = data.some((d) => d.value > 0);
  return (
    <section className="min-w-0 rounded-[10px] border bg-card">
      <header className="flex items-baseline gap-2 px-4 pt-3.5">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {right && <span className="ml-auto text-[12.5px] text-muted-foreground">{right}</span>}
      </header>
      {!hasData ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="px-2 pb-2 pt-1" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: showValues ? 20 : 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                minTickGap={8}
              />
              <YAxis hide={showValues} width={52} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} />
              <Tooltip
                cursor={{ fill: "hsl(var(--accent))", opacity: 0.45 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as MiniBar;
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                      <div className="font-semibold">{d.detail || d.label}</div>
                      <div className="num mt-0.5">{format(d.value)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={44}>
                {data.map((d) => (
                  <Cell key={d.key} fill={d.tone ? FILL[d.tone] : "hsl(var(--chart-1))"} />
                ))}
                {showValues && (
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={(v: number) => (v > 0 ? format(v) : "")}
                    style={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** "12,3 mil" pra eixos e rótulos curtos. */
export function shortBRL(v: number): string {
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
