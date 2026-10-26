/* =====================================================================
   DRE gerencial (add-on Financeiro)
   Receita − CMV = lucro bruto; − comissões − taxas − despesas = resultado.
   Idêntico nos dois repos.
===================================================================== */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, FileBarChart, Loader2 } from "lucide-react";
import { useAddon } from "@/hooks/useAddon";
import AddonUpsell from "@/components/addons/AddonUpsell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL } from "@/lib/formatters";
import { localISODate } from "@/lib/receivables";
import { fetchDre, MISSING_DB_MSG, type DreLine } from "@/lib/finance";
import { compactBRL } from "@/components/dashboard/panels";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const RANGES = [3, 6, 12] as const;

export default function Dre() {
  const addon = useAddon("financeiro");
  if (addon.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  if (!addon.active) return <AddonUpsell code="financeiro" />;
  return <DreInner />;
}

function DreInner() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(6);
  const [lines, setLines] = useState<DreLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openExp, setOpenExp] = useState(false);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: range }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (range - 1) + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [range]);
  const curMonth = localISODate().slice(0, 7);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchDre(`${months[0]}-01`, localISODate()).then((r) => {
      if (!alive) return;
      setMissing(!!r.missing);
      setError(r.missing ? null : r.error);
      setLines(r.data);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [months]);

  const t = useMemo(() => {
    const get = (line: DreLine["line"], m: string) => lines.filter((l) => l.line === line && l.month === m).reduce((s, l) => s + l.amount, 0);
    const cats = [...new Set(lines.filter((l) => l.line === "despesa").map((l) => l.label))].sort();
    const col = (m: string) => {
      const receita = get("receita", m), cmv = get("cmv", m), comissao = get("comissao", m), taxa = get("taxa", m), despesa = get("despesa", m);
      const juros = get("juros_emprestimo", m), encargos = get("encargos", m), descontos = get("descontos", m), recFin = get("receita_financeira", m);
      const bruto = receita - cmv;
      const operacional = bruto - comissao - taxa - despesa;
      const resultado = operacional - juros - encargos + descontos + recFin;
      return { receita, cmv, bruto, comissao, taxa, despesa, operacional, juros, encargos, descontos, recFin, resultado };
    };
    const byMonth = Object.fromEntries(months.map((m) => [m, col(m)]));
    type K = keyof ReturnType<typeof col>;
    const sum = (k: K) => months.reduce((s, m) => s + byMonth[m][k], 0);
    const keys: K[] = ["receita", "cmv", "bruto", "comissao", "taxa", "despesa", "operacional", "juros", "encargos", "descontos", "recFin", "resultado"];
    const total = Object.fromEntries(keys.map((k) => [k, sum(k)])) as Record<K, number>;
    const hasFin = ["juros", "encargos", "descontos", "recFin"].some((k) => Math.abs(total[k as K]) >= 0.005);
    const catVal = (c: string, m?: string) => lines.filter((l) => l.line === "despesa" && l.label === c && (!m || l.month === m)).reduce((s, l) => s + l.amount, 0);
    return { byMonth, total, cats, catVal, hasFin };
  }, [lines, months]);

  const label = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "—");
  const chart = months.map((m) => ({ key: m, label: label(m), v: t.byMonth[m]?.resultado || 0 }));

  const SUBTOTAL = new Set(["resultado", "bruto", "operacional"]);
  const Row = ({ name, k, sign = "", strong = false, muted = false }: { name: string; k: keyof typeof t.total; sign?: string; strong?: boolean; muted?: boolean }) => (
    <TableRow className={strong ? "bg-muted/40 font-semibold" : ""}>
      <TableCell className={`whitespace-nowrap ${muted ? "text-muted-foreground" : ""}`}>{sign && <span className="mr-1 text-muted-foreground">{sign}</span>}{name}</TableCell>
      {months.map((m) => {
        const v = t.byMonth[m][k];
        return <TableCell key={m} className={`num whitespace-nowrap text-right ${SUBTOTAL.has(k) && v < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatBRL(v)}</TableCell>;
      })}
      <TableCell className={`num whitespace-nowrap text-right font-semibold ${SUBTOTAL.has(k) && t.total[k] < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatBRL(t.total[k])}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"><FileBarChart className="h-5 w-5 text-primary" /> DRE</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Resultado do negócio mês a mês: o que foi vendido, quanto custou e quanto sobrou depois das despesas.
          </p>
        </div>
        <div role="group" aria-label="Período" className="inline-flex rounded-lg border bg-card p-[3px]">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${range === r ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {r} meses
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label={`Receita (${range} meses)`} value={formatBRL(t.total.receita)} />
            <Card label="Lucro bruto" value={formatBRL(t.total.bruto)} sub={`margem ${pct(t.total.bruto, t.total.receita)}`} />
            <Card label="Despesas" value={formatBRL(t.total.despesa + t.total.comissao + t.total.taxa)} sub="inclui comissões e taxas" />
            <Card label="Resultado" value={formatBRL(t.total.resultado)} sub={`margem ${pct(t.total.resultado, t.total.receita)}`} negative={t.total.resultado < 0} />
          </div>

          <section className="rounded-[10px] border bg-card">
            <header className="flex items-baseline gap-2 px-4 pt-3.5">
              <h2 className="text-[13.5px] font-semibold">Resultado por mês</h2>
              <span className="text-xs text-muted-foreground">vermelho = prejuízo</span>
            </header>
            <div className="h-[220px] px-2 pb-3 pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 22, right: 12, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                  <YAxis width={56} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => compactBRL(Number(v))} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as (typeof chart)[number];
                      const c = t.byMonth[d.key];
                      return (
                        <div className="min-w-[200px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-semibold">{d.label}{d.key === curMonth ? " (parcial)" : ""}</div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Receita</span><span className="num">{formatBRL(c.receita)}</span></div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Lucro bruto</span><span className="num">{formatBRL(c.bruto)}</span></div>
                          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Despesas, comissões e taxas</span><span className="num">{formatBRL(c.despesa + c.comissao + c.taxa)}</span></div>
                          <div className="mt-1 flex justify-between gap-4 border-t pt-1"><span className="text-muted-foreground">Resultado</span><b className="num">{formatBRL(c.resultado)}</b></div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={56}>
                    {chart.map((d) => <Cell key={d.key} fill={d.v < 0 ? "hsl(var(--critical))" : "hsl(var(--chart-1))"} />)}
                    <LabelList dataKey="v" position="top" formatter={(v: number) => compactBRL(v)} style={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-x-auto rounded-[10px] border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Linha</TableHead>
                  {months.map((m) => <TableHead key={m} className="text-right">{label(m)}{m === curMonth ? "*" : ""}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <Row name="Receita de vendas" k="receita" />
                <Row name="Custo das mercadorias vendidas" k="cmv" sign="−" muted />
                <Row name="Lucro bruto" k="bruto" sign="=" strong />
                <TableRow>
                  <TableCell className="text-xs text-muted-foreground">margem bruta</TableCell>
                  {months.map((m) => <TableCell key={m} className="num text-right text-xs text-muted-foreground">{pct(t.byMonth[m].bruto, t.byMonth[m].receita)}</TableCell>)}
                  <TableCell className="num text-right text-xs text-muted-foreground">{pct(t.total.bruto, t.total.receita)}</TableCell>
                </TableRow>
                <Row name="Comissões" k="comissao" sign="−" muted />
                <Row name="Taxas de recebimento" k="taxa" sign="−" muted />
                <TableRow className="cursor-pointer hover:bg-accent/40" onClick={() => setOpenExp((v) => !v)}>
                  <TableCell className="whitespace-nowrap">
                    <button type="button" aria-expanded={openExp} className="inline-flex items-center gap-1 text-muted-foreground">
                      <span>−</span>{openExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="text-foreground">Despesas</span>
                      <span className="text-xs">({t.cats.length} categoria{t.cats.length === 1 ? "" : "s"})</span>
                    </button>
                  </TableCell>
                  {months.map((m) => <TableCell key={m} className="num whitespace-nowrap text-right">{formatBRL(t.byMonth[m].despesa)}</TableCell>)}
                  <TableCell className="num whitespace-nowrap text-right font-semibold">{formatBRL(t.total.despesa)}</TableCell>
                </TableRow>
                {openExp && t.cats.map((c) => (
                  <Fragment key={c}>
                    <TableRow className="text-[12.5px]">
                      <TableCell className="pl-10 text-muted-foreground">{c}</TableCell>
                      {months.map((m) => <TableCell key={m} className="num whitespace-nowrap text-right text-muted-foreground">{formatBRL(t.catVal(c, m))}</TableCell>)}
                      <TableCell className="num whitespace-nowrap text-right text-muted-foreground">{formatBRL(t.catVal(c))}</TableCell>
                    </TableRow>
                  </Fragment>
                ))}
                {t.hasFin && (
                  <>
                    <Row name="Resultado operacional" k="operacional" sign="=" strong />
                    {Math.abs(t.total.juros) >= 0.005 && <Row name="Juros de empréstimos" k="juros" sign="−" muted />}
                    {Math.abs(t.total.encargos) >= 0.005 && <Row name="Juros e multas pagos" k="encargos" sign="−" muted />}
                    {Math.abs(t.total.descontos) >= 0.005 && <Row name="Descontos obtidos" k="descontos" sign="+" muted />}
                    {Math.abs(t.total.recFin) >= 0.005 && <Row name="Juros e multas recebidos" k="recFin" sign="+" muted />}
                  </>
                )}
                <Row name="Resultado" k="resultado" sign="=" strong />
                <TableRow>
                  <TableCell className="text-xs text-muted-foreground">margem líquida</TableCell>
                  {months.map((m) => <TableCell key={m} className="num text-right text-xs text-muted-foreground">{pct(t.byMonth[m].resultado, t.byMonth[m].receita)}</TableCell>)}
                  <TableCell className="num text-right text-xs text-muted-foreground">{pct(t.total.resultado, t.total.receita)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>* mês atual, ainda parcial.</li>
            <li>Custo das mercadorias usa o custo de cada produto cadastrado hoje (o sistema não guarda o custo da época da venda). Serviços entram sem custo.</li>
            <li>Despesas: contas a pagar no mês do vencimento, despesas variáveis no mês do pagamento, fixas pelo mês de referência.</li>
            <li>Empréstimos: só os juros de cada parcela entram como despesa; a amortização reduz a dívida e não é despesa. Juros, multas e descontos de pagamentos caem no mês em que foram pagos.</li>
          </ul>
        </>
      )}
    </div>
  );
}

function Card({ label, value, sub, negative }: { label: string; value: string; sub?: string; negative?: boolean }) {
  return (
    <div className={`rounded-[10px] border bg-card p-4 ${negative ? "border-critical/50" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tracking-tight ${negative ? "text-red-700 dark:text-red-400" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
