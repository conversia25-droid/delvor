/* =====================================================================
   Dashboard (repaginada 2026-10)
   Arquivo idêntico no Delvor e no InfnityServices: tipos locais (sem
   @/types/*) e cor de marca só por token (bg-primary etc.).
   Três visões: técnico, vendedor, gestor (admin/gerente/financeiro).
===================================================================== */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2, Clock, DollarSign, FileText, PackageOpen, Percent, RefreshCw,
  ShoppingCart, Wallet, Wrench,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useReceivablesOverview } from "@/hooks/useReceivablesOverview";
import { useVertical } from "@/hooks/useVertical";

import { Button } from "@/components/ui/button";
import StatCard from "@/components/dashboard/StatCard";
import FinanceiroDashboardCard from "@/components/dashboard/FinanceiroDashboardCard";
import UpcomingBillsStrip from "@/components/dashboard/UpcomingBillsStrip";
import {
  AttentionPanel, CashTodayPanel, OsStagesPanel, Panel, PanelLink, RankPanel,
  ReceivablesAgingPanel, RecentOsPanel, SoldReceivedChart, StatusPill, StockCriticalPanel,
  isOsLate, lowStockOf, type AttentionItem, type Tone,
} from "@/components/dashboard/panels";

import { formatBRL, formatDateBR } from "@/lib/formatters";
import { getOpenSession, type CashSession } from "@/lib/cashRegister";
import { fetchReceivedDaily, localISODate } from "@/lib/receivables";

/* ---------- tipos locais ---------- */
type SaleRow = {
  id: string; number: number; status: string; total: number; issue_date: string;
  seller_id: string | null; created_at: string; commission_amount?: number | null;
  customers?: { name: string } | null;
};
type OsRow = {
  id: string; number: number; status: string; due_at?: string | null; delivered_at?: string | null;
  finished_at?: string | null; updated_at?: string | null; created_at: string;
  technician_id?: string | null; reported_issue?: string | null; customers?: { name: string } | null;
};
type ProductRow = {
  id: string; name: string; sku?: string | null; active: boolean;
  stock_qty: number; stock_min: number | null; cost_price?: number | null;
};
type SaleItemRow = { product_id: string | null; description: string; qty: number; total: number };

/* ---------- período ---------- */
type Period = "month" | "30d" | "90d" | "1y";
const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "Este mês" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "1y", label: "1 ano" },
];
function periodStart(p: Period): string {
  const d = new Date();
  if (p === "month") return localISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  d.setDate(d.getDate() - (p === "30d" ? 29 : p === "90d" ? 89 : 364));
  return localISODate(d);
}
function daysBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = toISO;
  while (localISODate(cur) <= end) {
    out.push(localISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const SALE_STATUS: Record<string, { label: string; tone: Tone }> = {
  orcamento: { label: "Orçamento", tone: "muted" },
  aprovado: { label: "Aprovada", tone: "info" },
  faturado: { label: "Faturada", tone: "good" },
  entregue: { label: "Entregue", tone: "good" },
  cancelado: { label: "Cancelada", tone: "muted" },
  perdido: { label: "Perdida", tone: "muted" },
};
const isInvoiced = (s: SaleRow) => s.status === "faturado" || s.status === "entregue";

export default function Dashboard() {
  const { user } = useAuth();
  const perms = usePermissions();
  const { vertical } = useVertical();
  const companyId = user?.company_id;
  const usesOs = vertical === "assistencia_tecnica";

  const [period, setPeriod] = useState<Period>("month");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [serviceOrders, setServiceOrders] = useState<OsRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; nome: string }>>([]);
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [receivedDaily, setReceivedDaily] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);

  // Recebido / a receber (só quem tem acesso ao financeiro)
  const canSeeReceivables = !!perms.hasFinancialAccess;
  const receivables = useReceivablesOverview(canSeeReceivables);

  const start = periodStart(period);
  const today = localISODate();

  async function load() {
    if (!companyId) return;
    setLoading(true);

    // Vendas no período (RLS já filtra conforme o papel)
    const salesP = supabase
      .from("sales" as any)
      .select("*, customers ( name )")
      .eq("company_id", companyId)
      .gte("issue_date", start)
      .lte("issue_date", today)
      .order("issue_date", { ascending: false })
      .limit(2000);

    // OS (todas as abertas e recentes; RLS filtra técnico/vendedor)
    const osP = supabase
      .from("service_orders" as any)
      .select("*, customers ( name )")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);

    // Itens vendidos no período (mais vendidos)
    const itemsP = supabase
      .from("sale_items" as any)
      .select("product_id, description, qty, total, sales!inner(company_id, issue_date, status)")
      .eq("sales.company_id", companyId)
      .gte("sales.issue_date", start)
      .lte("sales.issue_date", today)
      .in("sales.status", ["faturado", "entregue"]);

    const productsP = supabase
      .from("products" as any)
      .select("*")
      .eq("company_id", companyId)
      .is("hidden_at", null);

    const profilesP = supabase.from("profiles" as any).select("id, nome").eq("company_id", companyId);

    const cashP: Promise<CashSession | null> = user?.id ? getOpenSession(user.id) : Promise.resolve(null);
    const recP = canSeeReceivables ? fetchReceivedDaily(start, today) : Promise.resolve(null);

    const [sr, or, ir, pr, prof, cash, rec] = await Promise.all([salesP, osP, itemsP, productsP, profilesP, cashP, recP]);

    setSales(((sr.data as any[]) ?? []).map((s) => ({ ...s, total: Number(s.total || 0) })));
    setServiceOrders((or.data as any[]) ?? []);
    setSaleItems((ir.data as any[]) ?? []);
    setProducts((pr.data as any[]) ?? []);
    setProfiles((prof.data as any[]) ?? []);
    setCashSession(cash);
    setReceivedDaily(rec ? Object.fromEntries(rec.map((r) => [r.day, r.total])) : null);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [companyId, period, canSeeReceivables]);

  /* ---------- derivados ---------- */
  const days = useMemo(() => daysBetween(start, today), [start, today]);
  const soldByDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of sales) if (isInvoiced(s)) m[s.issue_date.slice(0, 10)] = (m[s.issue_date.slice(0, 10)] || 0) + s.total;
    return m;
  }, [sales]);

  const profileName = useMemo(() => new Map(profiles.map((p) => [p.id, p.nome])), [profiles]);

  const topItems = useMemo(() => {
    const map = new Map<string, { key: string; name: string; qty: number; value: number }>();
    for (const it of saleItems) {
      const k = it.product_id || `srv:${it.description}`;
      const cur = map.get(k) || { key: k, name: it.description, qty: 0, value: 0 };
      cur.qty += Number(it.qty) || 0;
      cur.value += Number(it.total) || 0;
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  }, [saleItems]);

  const topSellers = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number; value: number }>();
    for (const s of sales) {
      if (!isInvoiced(s)) continue;
      const k = s.seller_id || "—";
      const cur = map.get(k) || { key: k, name: profileName.get(s.seller_id || "") || "Sem responsável", count: 0, value: 0 };
      cur.count += 1;
      cur.value += s.total;
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  }, [sales, profileName]);

  const lateOs = useMemo(() => serviceOrders.filter(isOsLate), [serviceOrders]);
  const lowStock = useMemo(() => lowStockOf(products), [products]);

  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (receivables && receivables.overdue_count > 0) {
      items.push({
        key: "rec-overdue", tone: "crit", label: "Vencido",
        title: `${receivables.overdue_count} pagamento${receivables.overdue_count > 1 ? "s" : ""} vencido${receivables.overdue_count > 1 ? "s" : ""} · ${formatBRL(receivables.overdue_total)}`,
        detail: "boleto, crediário, transferência ou cartão aguardando baixa",
        to: "/financeiro/receber", action: "Cobrar",
      });
    }
    if (receivables && receivables.due_today_count > 0) {
      items.push({
        key: "rec-today", tone: "warn", label: "Vence hoje",
        title: `${receivables.due_today_count} pagamento${receivables.due_today_count > 1 ? "s" : ""} · ${formatBRL(receivables.due_today_total)}`,
        detail: "confira se caiu e dê baixa",
        to: "/financeiro/receber", action: "Ver",
      });
    }
    if (usesOs && lateOs.length > 0) {
      items.push({
        key: "os-late", tone: "serious", label: "Atrasada",
        title: `${lateOs.length} OS passou${lateOs.length > 1 ? "ram" : ""} do prazo`,
        detail: lateOs.slice(0, 3).map((o) => `#${o.number} ${o.customers?.name || ""}`.trim()).join(" · "),
        to: "/service-orders", action: "Abrir",
      });
    }
    if (lowStock.length > 0 && (perms.isManager || perms.isTecnico)) {
      items.push({
        key: "stock", tone: "warn", label: "Repor",
        title: `${lowStock.length} ite${lowStock.length > 1 ? "ns" : "m"} abaixo do mínimo`,
        detail: lowStock.slice(0, 3).map((p) => `${p.name} (${Math.max(0, Number(p.stock_qty))} de ${p.stock_min})`).join(" · "),
        to: "/products", action: "Ver lista",
      });
    }
    if (cashSession && cashSession.opened_at.slice(0, 10) < today) {
      items.push({
        key: "cash-old", tone: "info", label: "Caixa",
        title: "Seu caixa está aberto desde " + new Date(cashSession.opened_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        detail: "feche o caixa do dia anterior antes de vender hoje",
        to: "/pdv", action: "Fechar",
      });
    }
    return items;
  }, [receivables, usesOs, lateOs, lowStock, cashSession, today, perms.isManager, perms.isTecnico]);

  /* ---------- cabeçalho ---------- */
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const dateLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const Header = (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">
          {greet}, {user?.nome?.split(" ")[0] || "bem-vindo"}
        </h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{dateLabel}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Período" className="inline-flex rounded-lg border bg-card p-[3px]">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${
                period === p.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" onClick={load} title="Recarregar" aria-label="Recarregar">
          <RefreshCw className="h-4 w-4" />
        </Button>
        {(perms.isManager || perms.isVendedor) && (
          <Button asChild variant="outline"><Link to="/pdv">Venda rápida</Link></Button>
        )}
        {usesOs && (
          <Button asChild><Link to="/service-orders/new">Nova OS</Link></Button>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {Header}
        <div className="h-24 animate-pulse rounded-[10px] border bg-card" />
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="h-80 animate-pulse rounded-[10px] border bg-card xl:col-span-2" />
          <div className="h-80 animate-pulse rounded-[10px] border bg-card" />
        </div>
      </div>
    );
  }

  /* ================= TÉCNICO ================= */
  if (perms.isTecnico && !perms.isManager && !perms.isVendedor) {
    const open = serviceOrders.filter((o) => !["entregue", "faturada", "cancelada"].includes(o.status));
    const inProgress = open.filter((o) => o.status === "em_execucao").length;
    const waiting = open.filter((o) => o.status === "aguardando_aprovacao" || o.status === "aguardando_peca").length;
    const monthStart = localISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const finishedMonth = serviceOrders.filter((o) => {
      if (o.status !== "entregue" && o.status !== "faturada") return false;
      const ref = o.delivered_at || o.finished_at || o.updated_at;
      return !!ref && ref.slice(0, 10) >= monthStart;
    }).length;
    return (
      <div className="space-y-4">
        {Header}
        <AttentionPanel items={attention} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Suas OS abertas" value={open.length} icon={<Wrench />} to="/service-orders" />
          <StatCard label="Em execução agora" value={inProgress} icon={<Clock />} />
          <StatCard label="Aguardando peça ou aprovação" value={waiting} icon={<PackageOpen />} tone="amber" alert={waiting > 0} />
          <StatCard label="Concluídas no mês" value={finishedMonth} icon={<CheckCircle2 />} />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <OsStagesPanel serviceOrders={serviceOrders} />
          <div className="xl:col-span-2"><RecentOsPanel serviceOrders={serviceOrders} techNames={profileName} /></div>
        </div>
      </div>
    );
  }

  /* ================= VENDEDOR ================= */
  if (perms.isVendedor && !perms.isManager) {
    const todaySales = sales.filter((s) => isInvoiced(s) && s.issue_date.slice(0, 10) === today);
    const todayValue = todaySales.reduce((n, s) => n + s.total, 0);
    const todayCommission = todaySales.reduce((n, s) => n + Number(s.commission_amount || 0), 0);
    const monthStart = localISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const monthSales = sales.filter((s) => isInvoiced(s) && s.issue_date >= monthStart);
    const monthValue = monthSales.reduce((n, s) => n + s.total, 0);
    const monthCommission = monthSales.reduce((n, s) => n + Number(s.commission_amount || 0), 0);
    const openSales = sales.filter((s) => s.status === "orcamento" || s.status === "aprovado");
    const recent = [...sales].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 7);
    const cashOpen = !!cashSession;

    return (
      <div className="space-y-4">
        {Header}
        {!cashOpen && (
          <Link
            to="/pdv"
            className="flex items-center gap-3 rounded-[10px] border border-warning/50 bg-warning/10 px-4 py-3 text-sm transition-colors hover:bg-warning/15"
          >
            <StatusPill tone="warn" icon={<Wallet />}>Caixa fechado</StatusPill>
            <span className="text-foreground">Abra o caixa pra começar a vender.</span>
            <span className="ml-auto shrink-0 font-medium text-primary">Abrir caixa</span>
          </Link>
        )}
        <AttentionPanel items={attention.filter((a) => a.key !== "stock")} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Vendido hoje" value={formatBRL(todayValue)} hint={`${todaySales.length} venda${todaySales.length === 1 ? "" : "s"}`} icon={<DollarSign />} to="/sales" />
          <StatCard label="Comissão hoje" value={formatBRL(todayCommission)} icon={<Percent />} />
          <StatCard label="Vendido no mês" value={formatBRL(monthValue)} hint={`comissão ${formatBRL(monthCommission)}`} icon={<ShoppingCart />} to="/sales" />
          <StatCard label="Em aberto" value={openSales.length} hint="orçamentos e pedidos" icon={<FileText />} to="/orcamentos" />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <SoldReceivedChart days={days} sold={soldByDay} received={null} title="Suas vendas" sub="acumulado no período" />
          </div>
          <RecentSalesPanel sales={recent} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <RankPanel
            title="Mais vendidos"
            sub="no período"
            empty="Nenhuma venda faturada no período."
            items={topItems.map((t) => ({ key: t.key, name: t.name, meta: `${t.qty.toLocaleString("pt-BR")} un`, value: t.value }))}
          />
          {usesOs ? <RecentOsPanel serviceOrders={serviceOrders} techNames={profileName} /> : <CashTodayPanel userId={user?.id} />}
        </div>
      </div>
    );
  }

  /* ================= GESTOR ================= */
  return (
    <div className="space-y-4">
      {Header}
      <AttentionPanel items={attention} />
      <UpcomingBillsStrip />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <SoldReceivedChart
            days={days}
            sold={soldByDay}
            received={canSeeReceivables ? receivedDaily || {} : null}
            openTotal={receivables?.open_total}
            overdueTotal={receivables?.overdue_total}
            openCount={receivables?.open_count}
          />
        </div>
        <CashTodayPanel userId={user?.id} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {usesOs ? (
          <OsStagesPanel serviceOrders={serviceOrders} />
        ) : (
          <RankPanel
            title="Vendedores"
            sub="no período"
            empty="Nenhuma venda faturada no período."
            items={topSellers.map((s) => ({ key: s.key, name: s.name, meta: `${s.count} venda${s.count === 1 ? "" : "s"}`, value: s.value }))}
          />
        )}
        {canSeeReceivables && <ReceivablesAgingPanel />}
        <RankPanel
          title="Mais vendidos"
          sub="no período"
          action={<PanelLink to="/reports">Relatório</PanelLink>}
          empty="Nenhuma venda faturada no período."
          items={topItems.map((t) => ({ key: t.key, name: t.name, meta: `${t.qty.toLocaleString("pt-BR")} un`, value: t.value }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {usesOs ? (
            <RecentOsPanel serviceOrders={serviceOrders} techNames={profileName} />
          ) : (
            <RecentSalesPanel sales={[...sales].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 7)} />
          )}
        </div>
        <StockCriticalPanel products={products} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {usesOs && (
          <RankPanel
            title="Vendedores"
            sub="no período"
            empty="Nenhuma venda faturada no período."
            items={topSellers.map((s) => ({ key: s.key, name: s.name, meta: `${s.count} venda${s.count === 1 ? "" : "s"}`, value: s.value }))}
          />
        )}
        <FinanceiroDashboardCard />
      </div>
    </div>
  );
}

/* ---------- últimas vendas ---------- */
function RecentSalesPanel({ sales }: { sales: SaleRow[] }) {
  return (
    <Panel title="Últimas vendas" action={<PanelLink to="/sales">Ver todas</PanelLink>} bodyClassName="pt-2">
      {sales.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma venda registrada ainda.</p>
      ) : (
        <div className="divide-y">
          {sales.map((s) => {
            const st = SALE_STATUS[s.status] || { label: s.status, tone: "muted" as Tone };
            return (
              <Link key={s.id} to={`/sales/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.customers?.name || "Consumidor final"}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">#{String(s.number).padStart(6, "0")}</span> · {formatDateBR(s.issue_date)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num text-sm font-semibold">{formatBRL(s.total)}</span>
                  <StatusPill tone={st.tone}>{st.label}</StatusPill>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
