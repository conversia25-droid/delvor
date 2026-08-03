import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Texto secundário pequeno embaixo do valor (ex: "do mês passado: R$ 12.000"). */
  hint?: ReactNode;
  /** Variação % comparada com período anterior. Mostra seta + cor. */
  delta?: number;
  icon?: ReactNode;
  /** Cor de destaque do ícone/valor (sky, emerald, amber, rose, violet, etc). */
  tone?: "default" | "emerald" | "amber" | "rose" | "violet" | "sky" | "teal";
  /** Se passar, o card vira clicável e leva pra essa rota. */
  to?: string;
  /** Pisca quando precisa de atenção. */
  alert?: boolean;
}

const TONES: Record<NonNullable<StatCardProps["tone"]>, { icon: string; bg: string }> = {
  default: { icon: "text-foreground",     bg: "bg-muted/40 ring-border" },
  emerald: { icon: "text-emerald-400",    bg: "bg-emerald-500/10 ring-emerald-500/30" },
  amber:   { icon: "text-amber-400",      bg: "bg-amber-500/10 ring-amber-500/30" },
  rose:    { icon: "text-rose-400",       bg: "bg-rose-500/10 ring-rose-500/30" },
  violet:  { icon: "text-blue-400",     bg: "bg-blue-500/10 ring-blue-500/30" },
  sky:     { icon: "text-sky-400",        bg: "bg-sky-500/10 ring-sky-500/30" },
  teal:    { icon: "text-teal-400",       bg: "bg-teal-500/10 ring-teal-500/30" },
};

export default function StatCard({
  label, value, hint, delta, icon, tone = "default", to, alert,
}: StatCardProps) {
  const t = TONES[tone];

  const inner = (
    <div className={`relative h-full rounded-lg border bg-card p-4 transition ${
      to ? "hover:bg-muted/30 hover:border-blue-500/30" : ""
    } ${alert ? "ring-1 ring-rose-500/40 animate-pulse-slow" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-bold ${t.icon}`}>{value}</div>
          {hint != null && (
            <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
          )}
        </div>
        {icon && (
          <div className={`shrink-0 rounded-full p-2 ring-1 ${t.bg}`}>
            <span className={t.icon}>{icon}</span>
          </div>
        )}
      </div>
      {typeof delta === "number" && isFinite(delta) && (
        <div className="mt-2 inline-flex items-center text-[11px] gap-1">
          {delta >= 0 ? (
            <TrendingUp className="h-3 w-3 text-emerald-400" />
          ) : (
            <TrendingDown className="h-3 w-3 text-rose-400" />
          )}
          <span className={delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">vs período anterior</span>
        </div>
      )}
      {to && (
        <ArrowUpRight className="absolute top-3 right-3 h-3.5 w-3.5 text-muted-foreground opacity-50" />
      )}
    </div>
  );

  return to ? <Link to={to}>{inner}</Link> : inner;
}
