/* =====================================================================
   Painéis do Dashboard (repaginada 2026-10)
   Arquivo idêntico no Delvor e no InfnityServices: só tokens de tema,
   nenhuma cor de marca fixa e nenhum import de @/types/*.
   Cores dos gráficos: --chart-1 / --chart-2 (validadas para daltonismo).
   Estado (vencido, atrasado, repor) sempre com etiqueta + ícone, nunca só cor.
===================================================================== */
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Clock, Package, Wallet } from "lucide-react";
import { formatBRL } from "@/lib/formatters";
import { getOpenSession, getSummary, type CashSession } from "@/lib/cashRegister";
import { daysUntil, listReceivables, localISODate, type Receivable } from "@/lib/receivables";

/* ---------- utilitários ---------- */
export function compactBRL(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function ddmm(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/* ---------- casca ---------- */
export function Panel({
  title, sub, action, children, className = "", bodyClassName = "px-4 pb-4 pt-3",
}: {
  title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode;
  className?: string; bodyClassName?: string;
}) {
  return (
    <section className={`min-w-0 rounded-[10px] border bg-card ${className}`}>
      <header className="flex items-baseline gap-2 px-4 pt-3.5">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {action && <span className="ml-auto text-[12.5px] font-medium">{action}</span>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="text-primary hover:underline">{children}</Link>;
}

export type Tone = "crit" | "serious" | "warn" | "good" | "info" | "muted";
const PILL: Record<Tone, string> = {
  crit: "bg-red-500/10 text-red-700 dark:text-red-400",
  serious: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  warn: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  info: "bg-accent text-accent-foreground",
  muted: "bg-muted text-muted-foreground",
};
export function StatusPill({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${PILL[tone]} [&_svg]:h-3 [&_svg]:w-3`}>
      {icon}
      {children}
    </span>
  );
}

/* ---------- Precisa de atenção ---------- */
export type AttentionItem = {
  key: string;
  tone: "crit" | "serious" | "warn" | "info";
  label: string;
  title: string;
  detail?: string;
  to: string;
  action: string;
};
const ATT_ICON = {
  crit: <AlertTriangle />,
  serious: <Clock />,
  warn: <Package />,
  info: <Wallet />,
};
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Panel title="Precisa de atenção" bodyClassName="px-4 pb-3.5 pt-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Nada pendente agora: sem boleto vencido, OS atrasada ou item abaixo do mínimo.
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Precisa de atenção" sub={`${items.length} ${items.length === 1 ? "item" : "itens"}`} bodyClassName="pt-2">
      <div className="grid sm:grid-cols-2">
        {items.map((it, i) => (
          <div
            key={it.key}
            className={`flex min-w-0 items-center gap-3 px-4 py-3 ${i === 0 ? "" : "border-t"} ${i < 2 ? "sm:border-t-0" : ""} ${i % 2 === 0 ? "sm:border-r" : ""}`}
          >
            <StatusPill tone={it.tone} icon={ATT_ICON[it.tone]}>{it.label}</StatusPill>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{it.title}</div>
              {it.detail && <div className="truncate text-xs text-muted-foreground">{it.detail}</div>}
            </div>
            <Link to={it.to} className="shrink-0 text-[12.5px] font-medium text-primary hover:underline">
              {it.action}
            </Link>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ---------- Vendido × Recebido (acumulado) ---------- */
export function SoldReceivedChart({
  days, sold, received, openTotal, overdueTotal, openCount, title = "Vendido × Recebido", sub,
}: {
  /** dias do período (yyyy-mm-dd), em ordem */
  days: string[];
  /** vendido por dia */
  sold: Record<string, number>;
  /** recebido por dia; null = sem acesso ao financeiro (mostra só o vendido) */
  received: Record<string, number> | null;
  openTotal?: number;
  overdueTotal?: number;
  openCount?: number;
  title?: string;
  sub?: string;
}) {
  const data = useMemo(() => {
    let v = 0, r = 0;
    return days.map((d) => {
      const vd = sold[d] || 0;
      const rd = received?.[d] || 0;
      v += vd; r += rd;
      return { d, label: ddmm(d), v, r, vd, rd };
    });
  }, [days, sold, received]);
  const last = data[data.length - 1] || { v: 0, r: 0 };
  const hasRec = received !== null;

  return (
    <Panel
      title={title}
      sub={sub || "acumulado no período"}
      action={<PanelLink to="/reports">Relatório</PanelLink>}
      bodyClassName="px-2 pb-3 pt-1"
    >
      <div className="flex flex-wrap gap-x-7 gap-y-2 px-2 pb-1 pt-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-[3px] w-2.5 rounded bg-chart-1" />Vendido
          </div>
          <div className="mt-0.5 text-2xl font-semibold tracking-tight">{formatBRL(last.v)}</div>
        </div>
        {hasRec && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-[3px] w-2.5 rounded bg-chart-2" />Recebido
            </div>
            <div className="mt-0.5 text-2xl font-semibold tracking-tight">{formatBRL(last.r)}</div>
          </div>
        )}
        {hasRec && openTotal != null && (
          <div>
            <div className="text-xs text-muted-foreground">A receber (em aberto)</div>
            <div className="mt-0.5 text-2xl font-semibold tracking-tight">{formatBRL(openTotal)}</div>
            <div className="text-xs text-muted-foreground">
              {overdueTotal && overdueTotal > 0
                ? <span className="font-semibold text-red-700 dark:text-red-400">{formatBRL(overdueTotal)} vencido</span>
                : "nada vencido"}
              {openCount != null && ` · ${openCount} pagamento${openCount === 1 ? "" : "s"}`}
            </div>
          </div>
        )}
      </div>
      <div className="h-[230px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="dash-vend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.18} />
                <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={{ stroke: "hsl(var(--border))" }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => compactBRL(Number(v))}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <div className="min-w-[180px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="mb-1 font-semibold">{p.label}{p.vd === 0 && p.rd === 0 ? " · sem movimento" : ""}</div>
                    <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="inline-block h-[3px] w-2.5 rounded bg-chart-1" />Vendido no dia</span><b className="num">{formatBRL(p.vd)}</b></div>
                    {hasRec && <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="inline-block h-[3px] w-2.5 rounded bg-chart-2" />Recebido no dia</span><b className="num">{formatBRL(p.rd)}</b></div>}
                    <div className="mt-1 flex justify-between gap-4 text-muted-foreground"><span>Acumulado</span><span className="num">{formatBRL(p.v)}{hasRec ? ` / ${formatBRL(p.r)}` : ""}</span></div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="v" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#dash-vend)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} className="glow-brand" isAnimationActive={false} />
            {hasRec && (
              <Area type="monotone" dataKey="r" stroke="hsl(var(--chart-2))" strokeWidth={2} fill="transparent" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} isAnimationActive={false} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ---------- Caixa de hoje ---------- */
export function CashTodayPanel({ userId }: { userId: string | undefined }) {
  const [state, setState] = useState<{ loading: boolean; session: CashSession | null; s: any | null }>({ loading: true, session: null, s: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId) { setState({ loading: false, session: null, s: null }); return; }
      const session = await getOpenSession(userId);
      const s = session ? await getSummary(session.id) : null;
      if (alive) setState({ loading: false, session, s });
    })();
    return () => { alive = false; };
  }, [userId]);

  const { loading, session, s } = state;
  const rows: [string, number][] = s
    ? [["Dinheiro", s.cash_in], ["Pix", s.pix_in], ["Cartão", s.card_in], ["Boleto e outros", s.other_in]]
    : [];
  const max = Math.max(1, ...rows.map((r) => r[1]));

  return (
    <Panel title="Seu caixa hoje" action={<PanelLink to="/pdv">Abrir PDV</PanelLink>}>
      {loading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted/60" />
      ) : !session ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <StatusPill tone="muted">Fechado</StatusPill>
          <p className="text-sm text-muted-foreground">
            Você não tem caixa aberto. Vendas no PDV e baixas de recebíveis entram no caixa de quem está com ele aberto.
          </p>
          <Link to="/pdv" className="text-sm font-medium text-primary hover:underline">Abrir caixa no PDV</Link>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <StatusPill tone="good" icon={<CheckCircle2 />}>Aberto</StatusPill>
            desde {new Date(session.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="mt-2 text-[26px] font-semibold tracking-tight">{formatBRL(s?.total_sales || 0)}</div>
          <div className="text-xs text-muted-foreground">entrou neste caixa · {s?.sales_count || 0} venda{s?.sales_count === 1 ? "" : "s"}</div>
          <div className="mt-4 flex flex-col gap-2.5">
            {rows.map(([label, v]) => (
              <div key={label} className="grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
                <span className="text-muted-foreground">{label}</span>
                <span className="h-1.5 overflow-hidden rounded bg-muted">
                  <i className="block h-full rounded bg-chart-1" style={{ width: `${(v / max) * 100}%` }} />
                </span>
                <span className="num">{formatBRL(v)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2.5 text-[12.5px]">
            <span className="text-muted-foreground">Dinheiro esperado na gaveta</span>
            <b className="num text-[15px]">{formatBRL(s?.expected_cash || 0)}</b>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Sangrias {formatBRL(s?.sangrias || 0)} · suprimentos {formatBRL(s?.suprimentos || 0)} · troco inicial {formatBRL(Number(session.opening_amount || 0))}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- OS por etapa ---------- */
type OsLike = {
  id: string; number?: number | null; status: string; due_at?: string | null; created_at?: string | null;
  technician_id?: string | null; reported_issue?: string | null; customers?: { name: string } | null;
};
export const OS_STAGES: { key: string; label: string; tone: Tone }[] = [
  { key: "aberta", label: "Aberta", tone: "info" },
  { key: "diagnostico", label: "Diagnóstico", tone: "info" },
  { key: "aguardando_aprovacao", label: "Aguard. aprovação", tone: "warn" },
  { key: "aguardando_peca", label: "Aguard. peça", tone: "warn" },
  { key: "em_execucao", label: "Em execução", tone: "info" },
  { key: "concluida", label: "Pronta p/ retirar", tone: "good" },
];
const OS_FINAL = ["entregue", "faturada", "cancelada"];
export function isOsLate(o: OsLike) {
  return !!o.due_at && new Date(o.due_at) < new Date() && !["concluida", ...OS_FINAL].includes(o.status);
}

export function OsStagesPanel({ serviceOrders }: { serviceOrders: OsLike[] }) {
  const rows = OS_STAGES.map((st) => {
    const list = serviceOrders.filter((o) => o.status === st.key);
    return { ...st, n: list.length, late: list.filter(isOsLate).length };
  });
  const open = rows.reduce((s, r) => s + r.n, 0);
  const late = rows.reduce((s, r) => s + r.late, 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Panel title="OS por etapa" sub={`${open} em andamento`} action={<PanelLink to="/service-orders">Kanban</PanelLink>}>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <Link
            key={r.key}
            to="/service-orders"
            title={`${r.label}: ${r.n} OS${r.late ? ` · ${r.late} atrasada(s)` : ""}`}
            className="grid grid-cols-[128px_minmax(0,1fr)_28px] items-center gap-2.5 rounded text-[13px] hover:bg-accent/40"
          >
            <span className="truncate text-muted-foreground">
              {r.label}
              {r.late > 0 && <span className="ml-1 text-orange-600 dark:text-orange-400" aria-label="tem OS atrasada">●</span>}
            </span>
            <span className="h-2.5">
              <i className="block h-full rounded-r bg-chart-1" style={{ width: `${Math.max(r.n ? 3 : 0, (r.n / max) * 100)}%` }} />
            </span>
            <span className="num text-right font-semibold">{r.n}</span>
          </Link>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {late > 0
          ? <><span className="text-orange-600 dark:text-orange-400">●</span> {late} OS passou do prazo</>
          : "Nenhuma OS fora do prazo."}
      </div>
    </Panel>
  );
}

/* ---------- A receber por vencimento ---------- */
const AGING = [
  { key: "v30", label: "+30 d", min: -Infinity, max: -31, tone: "crit" as const, overdue: true },
  { key: "v8", label: "8–30 d", min: -30, max: -8, tone: "crit" as const, overdue: true },
  { key: "v1", label: "1–7 d", min: -7, max: -1, tone: "serious" as const, overdue: true },
  { key: "h", label: "Hoje", min: 0, max: 0, tone: "warn" as const, overdue: false },
  { key: "f7", label: "1–7 d", min: 1, max: 7, tone: null, overdue: false },
  { key: "f8", label: "8 d +", min: 8, max: Infinity, tone: null, overdue: false },
];
const AGING_FILL: Record<string, string> = {
  crit: "hsl(var(--critical))",
  serious: "#e0773f",
  warn: "hsl(var(--warning))",
};

export function ReceivablesAgingPanel() {
  const [rows, setRows] = useState<Receivable[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;
    const today = localISODate();
    listReceivables(today, today).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setDenied(true); return; }
      setRows(data.filter((r) => r.status !== "pago"));
    });
    return () => { alive = false; };
  }, []);

  const buckets = useMemo(() => {
    return AGING.map((b) => {
      const v = (rows || [])
        .filter((r) => {
          const d = r.due_date ? daysUntil(r.due_date) : Infinity; // sem vencimento vai pro fim
          return d >= b.min && d <= b.max;
        })
        .reduce((s, r) => s + r.amount, 0);
      return { ...b, v };
    });
  }, [rows]);

  if (denied) return null;
  const overdue = buckets.filter((b) => b.overdue).reduce((s, b) => s + b.v, 0);
  const future = buckets.filter((b) => !b.overdue).reduce((s, b) => s + b.v, 0);

  return (
    <Panel
      title="A receber por vencimento"
      action={<PanelLink to="/financeiro/receber">Contas a receber</PanelLink>}
      bodyClassName="px-2 pb-3 pt-1"
    >
      {rows === null ? (
        <div className="m-2 h-44 animate-pulse rounded-md bg-muted/60" />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-2 pt-2 text-xs">
            <span><span className="font-semibold text-red-700 dark:text-red-400">Vencido {formatBRL(overdue)}</span></span>
            <span className="text-muted-foreground">A vencer {formatBRL(future)}</span>
          </div>
          <div className="h-[190px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 22, right: 8, left: 8, bottom: 0 }} barCategoryGap={6}>
                <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  interval={0}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const b = payload[0].payload as (typeof buckets)[number];
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="font-semibold">{b.overdue ? `Vencido há ${b.label}` : b.key === "h" ? "Vence hoje" : `Vence em ${b.label}`}</div>
                        <div className="num mt-0.5">{formatBRL(b.v)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {buckets.map((b) => (
                    <Cell key={b.key} fill={b.tone ? AGING_FILL[b.tone] : "hsl(var(--chart-1))"} />
                  ))}
                  <LabelList
                    dataKey="v"
                    position="top"
                    formatter={(v: number) => (v > 0 ? compactBRL(v) : "")}
                    style={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between px-2 text-[11px] text-muted-foreground">
            <span>← vencidos (dias)</span><span>a vencer (dias) →</span>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- Ranking (mais vendidos, vendedores) ---------- */
export function RankPanel({
  title, sub, action, items, empty,
}: {
  title: string; sub?: string; action?: ReactNode; empty: string;
  items: { key: string; name: string; meta?: ReactNode; value: number }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Panel title={title} sub={sub} action={action}>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col">
          {items.map((it, i) => (
            <div key={it.key} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2.5 ${i ? "border-t" : "pt-0"}`}>
              <span className="truncate text-sm font-medium">{it.name}</span>
              <span className="num text-right text-sm font-semibold">{formatBRL(it.value)}</span>
              {it.meta && <span className="col-span-2 -mt-0.5 truncate text-xs text-muted-foreground">{it.meta}</span>}
              <span className="col-span-2 h-1 overflow-hidden rounded bg-muted">
                <i className="block h-full rounded bg-chart-1" style={{ width: `${(it.value / max) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------- OS recentes ---------- */
const OS_LABEL: Record<string, { label: string; tone: Tone }> = {
  ...Object.fromEntries(OS_STAGES.map((s) => [s.key, { label: s.label, tone: s.tone }])),
  entregue: { label: "Entregue", tone: "muted" },
  faturada: { label: "Faturada", tone: "muted" },
  cancelada: { label: "Cancelada", tone: "muted" },
};
export function RecentOsPanel({ serviceOrders, techNames }: { serviceOrders: OsLike[]; techNames: Map<string, string> }) {
  const rows = [...serviceOrders]
    .filter((o) => !OS_FINAL.includes(o.status))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 6);
  return (
    <Panel title="OS em andamento" sub="mais recentes" action={<PanelLink to="/service-orders">Ver todas</PanelLink>} bodyClassName="pt-2">
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma OS em andamento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">OS</th>
                <th className="px-4 py-2">Cliente e defeito</th>
                <th className="px-4 py-2">Etapa</th>
                <th className="px-4 py-2">Técnico</th>
                <th className="px-4 py-2">Prazo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const st = OS_LABEL[o.status] || { label: o.status, tone: "muted" as Tone };
                const late = isOsLate(o);
                return (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Link to={`/service-orders/${o.id}`} className="font-mono text-primary hover:underline">#{o.number ?? "—"}</Link>
                    </td>
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="truncate font-medium">{o.customers?.name || "—"}</div>
                      {o.reported_issue && <div className="truncate text-xs text-muted-foreground">{o.reported_issue}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5"><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{(o.technician_id && techNames.get(o.technician_id)) || "—"}</td>
                    <td className={`num whitespace-nowrap px-4 py-2.5 ${late ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                      {o.due_at ? new Date(o.due_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}
                      {late && <span className="sr-only"> (atrasada)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ---------- Estoque crítico ---------- */
type ProductLike = { id: string; name: string; sku?: string | null; active?: boolean; stock_qty: number; stock_min: number | null };
export function lowStockOf(products: ProductLike[]) {
  return products
    .filter((p) => p.active !== false && p.stock_min != null && Number(p.stock_qty) < Number(p.stock_min))
    .sort((a, b) => Number(a.stock_qty) / Number(a.stock_min || 1) - Number(b.stock_qty) / Number(b.stock_min || 1));
}
export function StockCriticalPanel({ products }: { products: ProductLike[] }) {
  const low = lowStockOf(products).slice(0, 5);
  return (
    <Panel title="Estoque crítico" sub={low.length ? "abaixo do mínimo" : undefined} action={<PanelLink to="/products">Estoque</PanelLink>}>
      {low.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Tudo acima do estoque mínimo.</p>
      ) : (
        <div className="flex flex-col">
          {low.map((p, i) => {
            const q = Math.max(0, Number(p.stock_qty));
            const min = Math.max(1, Number(p.stock_min));
            const segs = Math.min(min, 10);
            return (
              <div key={p.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 ${i ? "border-t" : "pt-0"}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  {p.sku && <span className="block truncate font-mono text-xs text-muted-foreground">{p.sku}</span>}
                </span>
                <StatusPill tone={q === 0 ? "crit" : "warn"}>{q} de {min}</StatusPill>
                <span className="col-span-2 flex gap-[3px]" aria-hidden="true">
                  {Array.from({ length: segs }, (_, k) => (
                    <span
                      key={k}
                      className={`h-1.5 flex-1 rounded-sm ${k < Math.round((q / min) * segs) ? "bg-orange-500" : q === 0 && k === 0 ? "bg-red-500" : "bg-muted"}`}
                    />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
