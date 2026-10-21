/* =====================================================================
   Fluxo de caixa (add-on Financeiro)
   Passado = realizado (baixas e pagamentos). Futuro = previsto (recebíveis e
   contas a pagar em aberto). Atrasados ficam de fora da projeção e aparecem
   à parte: não é dinheiro garantido. Idêntico nos dois repos.
===================================================================== */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, Loader2, TrendingUp } from "lucide-react";
import { useAddon } from "@/hooks/useAddon";
import { useReceivablesOverview } from "@/hooks/useReceivablesOverview";
import AddonUpsell from "@/components/addons/AddonUpsell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/lib/formatters";
import { addDaysISO, localISODate } from "@/lib/receivables";
import {
  fetchAccountBalances, fetchCashFlow, fetchPayablesOverview, MISSING_DB_MSG,
  type CashFlowDay, type PayablesOverview,
} from "@/lib/finance";
import { compactBRL } from "@/components/dashboard/panels";

const HORIZONS = [30, 60, 90] as const;
type Horizon = (typeof HORIZONS)[number];

function ddmm(iso: string) { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`; }
/** segunda-feira da semana do dia */
function weekStart(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  return localISODate(dt);
}

export default function Fluxo() {
  const addon = useAddon("financeiro");
  if (addon.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  if (!addon.active) return <AddonUpsell code="financeiro" />;
  return <FluxoInner />;
}

function FluxoInner() {
  const [horizon, setHorizon] = useState<Horizon>(60);
  const [days, setDays] = useState<CashFlowDay[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [accCount, setAccCount] = useState(0);
  const [pov, setPov] = useState<PayablesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rov = useReceivablesOverview(true);
  const today = localISODate();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [cf, acc, po] = await Promise.all([
        fetchCashFlow(addDaysISO(-28), addDaysISO(horizon)),
        fetchAccountBalances(),
        fetchPayablesOverview(),
      ]);
      if (!alive) return;
      setMissing(!!cf.missing);
      setError(cf.missing ? null : cf.error);
      setDays(cf.data);
      const active = acc.data.filter((a) => a.active);
      setAccCount(active.length);
      setBalance(active.length ? active.reduce((s, a) => s + a.balance, 0) : null);
      setPov(po.data);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [horizon]);

  /* semanas: realizado até ontem, previsto de hoje em diante */
  const weeks = useMemo(() => {
    const map = new Map<string, { key: string; label: string; inV: number; outV: number; future: boolean; past: boolean }>();
    for (const d of days) {
      const k = weekStart(d.day);
      const w = map.get(k) || { key: k, label: ddmm(k), inV: 0, outV: 0, future: false, past: false };
      if (d.day < today) { w.inV += d.in_realized; w.outV += d.out_realized; w.past = true; }
      else {
        // hoje: o que já entrou + o que ainda vence hoje
        w.inV += d.in_expected + (d.day === today ? d.in_realized : 0);
        w.outV += d.out_expected + (d.day === today ? d.out_realized : 0);
        w.future = true;
      }
      map.set(k, w);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [days, today]);

  /* saldo projetado dia a dia a partir de hoje */
  const projection = useMemo(() => {
    let s = balance ?? 0;
    const out: { d: string; label: string; saldo: number; inV: number; outV: number }[] = [];
    for (const d of days) {
      if (d.day < today) continue;
      s += d.in_expected - d.out_expected;
      out.push({ d: d.day, label: ddmm(d.day), saldo: Math.round(s * 100) / 100, inV: d.in_expected, outV: d.out_expected });
    }
    return out;
  }, [days, balance, today]);

  const future = days.filter((d) => d.day >= today);
  const inFuture = future.reduce((s, d) => s + d.in_expected, 0);
  const outFuture = future.reduce((s, d) => s + d.out_expected, 0);
  const endBalance = projection.length ? projection[projection.length - 1].saldo : balance ?? 0;
  const firstNegative = projection.find((p) => p.saldo < 0);
  const minPoint = projection.reduce<{ saldo: number; d: string } | null>((m, p) => (!m || p.saldo < m.saldo ? { saldo: p.saldo, d: p.d } : m), null);

  const weekTable = useMemo(() => {
    let s = balance ?? 0;
    return weeks.map((w) => {
      const net = w.inV - w.outV;
      if (w.future) s += net;
      return { ...w, net, saldo: w.future ? s : null };
    });
  }, [weeks, balance]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"><TrendingUp className="h-5 w-5 text-primary" /> Fluxo de caixa</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Últimas 4 semanas com o que de fato entrou e saiu; daqui pra frente, o que está previsto em recebíveis e contas a pagar.
          </p>
        </div>
        <div role="group" aria-label="Horizonte" className="inline-flex rounded-lg border bg-card p-[3px]">
          {HORIZONS.map((h) => (
            <button key={h} type="button" aria-pressed={horizon === h} onClick={() => setHorizon(h)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${horizon === h ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              próximos {h} dias
            </button>
          ))}
        </div>
      </div>

      {missing ? (
        <div className="rounded-[10px] border bg-card px-6 py-14 text-center text-sm text-muted-foreground">{MISSING_DB_MSG}</div>
      ) : loading ? (
        <div className="flex items-center justify-center rounded-[10px] border bg-card py-24 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Calculando…</div>
      ) : error ? (
        <div className="rounded-[10px] border bg-card px-6 py-14 text-center text-sm text-muted-foreground">Não foi possível carregar: {error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Saldo hoje" value={balance == null ? "—" : formatBRL(balance)}
              sub={balance == null ? <Link to="/financeiro/contas" className="text-primary hover:underline">cadastre suas contas</Link> : `${accCount} conta${accCount > 1 ? "s" : ""}`} />
            <Kpi label={`Entradas previstas (${horizon} d)`} value={formatBRL(inFuture)} swatch="bg-chart-1" />
            <Kpi label={`Saídas previstas (${horizon} d)`} value={formatBRL(outFuture)} swatch="bg-chart-3" />
            <Kpi label={`Saldo em ${horizon} dias`} value={formatBRL(endBalance)}
              sub={firstNegative ? undefined : minPoint ? `menor saldo: ${formatBRL(minPoint.saldo)} em ${ddmm(minPoint.d)}` : undefined}
              alert={firstNegative ? `fica negativo em ${ddmm(firstNegative.d)}` : undefined} />
            <Kpi label="Recebíveis vencidos"
              value={formatBRL(rov?.overdue_total || 0)}
              sub={`contas vencidas ${formatBRL(pov?.overdue_total || 0)} · ambos fora da projeção`} />
          </div>

          <section className="rounded-[10px] border bg-card">
            <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pt-3.5">
              <h2 className="text-[13.5px] font-semibold">Entradas × saídas por semana</h2>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-1" />Entradas</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-3" />Saídas</span>
              <span className="text-xs text-muted-foreground">barras claras = previsto</span>
            </header>
            <div className="h-[260px] px-2 pb-3 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                  <YAxis width={56} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => compactBRL(Number(v))} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const w = payload[0].payload as (typeof weeks)[number];
                      return (
                        <div className="min-w-[190px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-semibold">Semana de {w.label} · {w.past && w.future ? "realizado + previsto" : w.future ? "previsto" : "realizado"}</div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Entradas</span><b className="num">{formatBRL(w.inV)}</b></div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Saídas</span><b className="num">{formatBRL(w.outV)}</b></div>
                          <div className="mt-1 flex justify-between gap-4 border-t pt-1"><span className="text-muted-foreground">Resultado</span><b className="num">{formatBRL(w.inV - w.outV)}</b></div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="inV" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} isAnimationActive={false}
                    shape={(props: any) => <rect x={props.x} y={props.y} width={props.width} height={props.height} rx={3} fill="hsl(var(--chart-1))" fillOpacity={props.payload.future && !props.payload.past ? 0.45 : 1} />} />
                  <Bar dataKey="outV" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} isAnimationActive={false}
                    shape={(props: any) => <rect x={props.x} y={props.y} width={props.width} height={props.height} rx={3} fill="hsl(var(--chart-3))" fillOpacity={props.payload.future && !props.payload.past ? 0.45 : 1} />} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-[10px] border bg-card">
            <header className="flex flex-wrap items-baseline gap-2 px-4 pt-3.5">
              <h2 className="text-[13.5px] font-semibold">{balance == null ? "Variação projetada do caixa" : "Saldo projetado"}</h2>
              <span className="text-xs text-muted-foreground">
                {balance == null ? "sem contas cadastradas, parte de zero" : `parte do saldo de hoje (${formatBRL(balance)})`}
              </span>
              {firstNegative && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" /> fica negativo em {ddmm(firstNegative.d)}
                </span>
              )}
            </header>
            <div className="h-[220px] px-2 pb-3 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fluxo-saldo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={28} />
                  <YAxis width={56} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => compactBRL(Number(v))} />
                  <ReferenceLine y={0} stroke="hsl(var(--critical))" strokeOpacity={0.6} />
                  <Tooltip
                    cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof projection)[number];
                      return (
                        <div className="min-w-[180px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-semibold">{p.label}</div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Entra</span><span className="num">{formatBRL(p.inV)}</span></div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Sai</span><span className="num">{formatBRL(p.outV)}</span></div>
                          <div className="mt-1 flex justify-between gap-4 border-t pt-1"><span className="text-muted-foreground">Saldo</span><b className={`num ${p.saldo < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatBRL(p.saldo)}</b></div>
                        </div>
                      );
                    }}
                  />
                  <Area type="stepAfter" dataKey="saldo" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#fluxo-saldo)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} isAnimationActive={false} className="glow-brand" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-x-auto rounded-[10px] border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Semana</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">Saldo projetado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weekTable.map((w) => (
                  <TableRow key={w.key}>
                    <TableCell className="num">{w.label}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.past && w.future ? "esta semana" : w.future ? "previsto" : "realizado"}</TableCell>
                    <TableCell className="num text-right">{formatBRL(w.inV)}</TableCell>
                    <TableCell className="num text-right">{formatBRL(w.outV)}</TableCell>
                    <TableCell className={`num text-right font-medium ${w.net < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatBRL(w.net)}</TableCell>
                    <TableCell className={`num text-right ${w.saldo != null && w.saldo < 0 ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{w.saldo == null ? "—" : formatBRL(w.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, alert, swatch }: { label: string; value: string; sub?: ReactNode; alert?: string; swatch?: string }) {
  return (
    <div className={`rounded-[10px] border bg-card p-4 ${alert ? "border-critical/50" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{swatch && <i className={`inline-block h-2.5 w-2.5 rounded-sm ${swatch}`} />}{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {alert && <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-400"><AlertTriangle className="h-3 w-3" />{alert}</div>}
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
