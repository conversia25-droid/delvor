import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Texto secundário pequeno embaixo do valor. */
  hint?: ReactNode;
  /** Variação % comparada com período anterior. */
  delta?: number;
  icon?: ReactNode;
  /** rose/amber marcam estado (problema/atenção); os demais só dão o tom do ícone. */
  tone?: "default" | "emerald" | "amber" | "rose" | "violet" | "sky" | "teal";
  /** Se passar, o card vira clicável e leva pra essa rota. */
  to?: string;
  /** Precisa de atenção: mostra etiqueta e borda de alerta. */
  alert?: boolean;
}

/* Repaginada: valor sempre na cor do texto; o estado aparece como etiqueta,
   não como cor do número nem como bolinha colorida com ícone. */
export default function StatCard({
  label, value, hint, delta, icon, tone = "default", to, alert,
}: StatCardProps) {
  const isProblem = tone === "rose";
  const isAttention = tone === "amber";

  const inner = (
    <div
      className={`relative h-full rounded-[10px] border bg-card p-4 transition-colors ${
        to ? "hover:border-primary/40 hover:bg-accent/40" : ""
      } ${alert ? (isProblem ? "border-critical/50" : "border-warning/60") : ""}`}
    >
      <div className="flex items-center gap-1.5 pr-5 text-xs text-muted-foreground">
        {icon && <span className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint != null && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      {alert && (isProblem || isAttention) && (
        <span
          className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            isProblem
              ? "bg-critical/10 text-red-700 dark:text-red-400"
              : "bg-warning/15 text-amber-700 dark:text-amber-400"
          }`}
        >
          {isProblem ? "Precisa de ação" : "Atenção"}
        </span>
      )}
      {typeof delta === "number" && isFinite(delta) && (
        <div className="mt-2 inline-flex items-center gap-1 text-[11px]">
          {delta >= 0 ? (
            <TrendingUp className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
          ) : (
            <TrendingDown className="h-3 w-3 text-rose-700 dark:text-rose-400" />
          )}
          <span className={delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">vs período anterior</span>
        </div>
      )}
      {to && <ArrowUpRight className="absolute right-3 top-3 h-3.5 w-3.5 text-muted-foreground/60" />}
    </div>
  );

  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}
