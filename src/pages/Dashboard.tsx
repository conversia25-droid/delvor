import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  PackageOpen,
  Percent,
  Plus,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import StatCard from "@/components/dashboard/StatCard";
import RevenueChart from "@/components/dashboard/RevenueChart";
import OsStatusDonut from "@/components/dashboard/OsStatusDonut";
import TopProducts from "@/components/dashboard/TopProducts";
import TopSellers from "@/components/dashboard/TopSellers";
import CriticalOsList from "@/components/dashboard/CriticalOsList";
import LowStockList from "@/components/dashboard/LowStockList";
import FinanceiroDashboardCard from "@/components/dashboard/FinanceiroDashboardCard";

import type { Product, Sale, SaleItem, SaleStatus, ServiceOrder } from "@/types/delvor";
import { SALE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { getOpenSession, type CashSession } from "@/lib/cashRegister";

type Period = "month" | "30d" | "90d" | "1y";

const PERIOD_LABELS: Record<Period, string> = {
  month: "Este mês",
  "30d": "30 dias",
  "90d": "90 dias",
  "1y": "1 ano",
};

/** Data ISO (YYYY-MM-DD) do início do período pra filtrar issue_date. */
function periodStartDate(p: Period): string {
  if (p === "month") {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  const days = p === "30d" ? 30 : p === "90d" ? 90 : 365;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Data ISO do fim do período. Pra "Este mês" = último dia do mês corrente.
 *  Pros rolling (30d/90d/1y) = null, sem teto (até hoje). */
function periodEndDate(p: Period): string | null {
  if (p === "month") {
    const d = new Date();
    // Último dia do mês: vai pro mês seguinte e volta 1 dia
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Quantidade de dias do período — usado nos gráficos pra dimensionar o eixo X. */
function periodDays(p: Period): number {
  if (p === "month") {
    // Dia atual do mês = dias decorridos no mês corrente
    return new Date().getDate();
  }
  return p === "30d" ? 30 : p === "90d" ? 90 : 365;
}

/** Rótulo curto pro hint ("mês", "30d", "90d", "1a"). */
function periodHintLabel(p: Period): string {
  return p === "month" ? "mês" : p === "1y" ? "1a" : p;
}

type SaleRow = Sale & {
  customers?: { name: string } | null;
  /** preenchido pelo trigger de comissão; pode faltar em vendas antigas */
  commission_amount?: number | null;
};
type OsRow = ServiceOrder & {
  customers?: { name: string } | null;
};

function startOfMonth(): string {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** Data local de hoje no formato YYYY-MM-DD (sem distorção de fuso). */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { user } = useAuth();
  const perms = usePermissions();
  const companyId = user?.company_id;

  const [period, setPeriod] = useState<Period>("month");

  const [sales, setSales] = useState<SaleRow[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [serviceOrders, setServiceOrders] = useState<OsRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; nome: string }>>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!companyId) return;
    setLoading(true);

    const periodStart = periodStartDate(period);
    const periodEnd   = periodEndDate(period);

    // Vendas no período (já filtradas por RLS conforme role)
    let salesP = supabase
      .from("sales" as any)
      .select("*, customers ( name )")
      .eq("company_id", companyId)
      .gte("issue_date", periodStart)
      .order("issue_date", { ascending: false })
      .limit(1000);
    if (periodEnd) salesP = salesP.lte("issue_date", periodEnd);

    // OS (todas — pra ver fila e status; RLS já filtra pra técnico/vendedor)
    const osP = supabase
      .from("service_orders" as any)
      .select("*, customers ( name )")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);

    // Itens de venda no período pra calcular top produtos (do mesmo conjunto autorizado)
    let itemsP = supabase
      .from("sale_items" as any)
      .select("product_id, description, qty, unit_price, total, sale_id, sales!inner(company_id, issue_date, status)")
      .eq("sales.company_id", companyId)
      .gte("sales.issue_date", periodStart)
      .in("sales.status", ["faturado", "entregue"]);
    if (periodEnd) itemsP = itemsP.lte("sales.issue_date", periodEnd);

    // Produtos (todo mundo lê pra mostrar estoque crítico)
    const productsP = supabase
      .from("products" as any)
      .select("*")
      .eq("company_id", companyId)
      .is("hidden_at", null);

    // Profiles (pra mostrar nome no ranking de vendedores)
    const profilesP = supabase
      .from("profiles" as any)
      .select("id, nome")
      .eq("company_id", companyId);

    // Contagem de clientes (head:true pega só count)
    const customersP = supabase
      .from("customers" as any)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("active", true);

    // Caixa aberto do vendedor logado (pra mostrar status no dashboard)
    const cashP: Promise<CashSession | null> = user?.id
      ? getOpenSession(user.id)
      : Promise.resolve(null);

    const [sr, or, ir, pr, prof, cr, cash] = await Promise.all([
      salesP, osP, itemsP, productsP, profilesP, customersP, cashP,
    ]);

    setSales((sr.data as any[]) ?? []);
    setServiceOrders((or.data as any[]) ?? []);
    setSaleItems((ir.data as any[]) ?? []);
    setProducts((pr.data as any[]) ?? []);
    setProfiles((prof.data as any[]) ?? []);
    setCustomerCount(cr.count || 0);
    setCashSession(cash);

    setLoading(false);
  }

  useEffect(() => { load(); }, [companyId, period]);

  // ---------- KPIs ----------
  const kpis = useMemo(() => {
    const monthStart = startOfMonth();
    const invoiced = sales.filter((s) => s.status === "faturado" || s.status === "entregue");
    const monthRevenue = invoiced
      .filter((s) => s.issue_date >= monthStart)
      .reduce((sum, s) => sum + s.total, 0);
    const periodRevenue = invoiced.reduce((sum, s) => sum + s.total, 0);
    const avgTicket = invoiced.length ? periodRevenue / invoiced.length : 0;

    const openSales = sales.filter((s) => s.status === "orcamento" || s.status === "aprovado").length;

    const openOs = serviceOrders.filter((o) =>
      !["entregue", "faturada", "cancelada"].includes(o.status)
    ).length;
    const waitingPart = serviceOrders.filter((o) => o.status === "aguardando_peca").length;
    const overdueOs = serviceOrders.filter((o) =>
      o.due_at && new Date(o.due_at) < new Date()
      && !["concluida", "entregue", "faturada", "cancelada"].includes(o.status)
    ).length;
    // OS contam como "concluídas no mês" se foram entregues OU faturadas no período.
    // Usa delivered_at, mas cai pra finished_at / updated_at se não estiver preenchido
    // (cobre OS antigas e o caso de pular direto pra 'faturada').
    const finishedMonthOs = serviceOrders.filter((o) => {
      if (o.status !== "entregue" && o.status !== "faturada") return false;
      const ref = o.delivered_at || o.finished_at || o.updated_at;
      return !!ref && ref >= monthStart;
    }).length;

    const lowStockCount = products.filter((p) =>
      p.active && p.stock_min != null && p.stock_qty < p.stock_min
    ).length;
    const stockValue = products.reduce(
      (s, p) => s + (Number(p.cost_price) || 0) * (Number(p.stock_qty) || 0), 0
    );

    return { monthRevenue, periodRevenue, avgTicket, openSales, openOs, waitingPart, overdueOs, finishedMonthOs, lowStockCount, stockValue };
  }, [sales, serviceOrders, products]);

  // ---------- Top produtos ----------
  const topProducts = useMemo(() => {
    const map = new Map<string, { product_id: string | null; name: string; qty: number; revenue: number }>();
    for (const it of saleItems) {
      if (!it.product_id) continue;
      const k = it.product_id;
      const cur = map.get(k) || { product_id: it.product_id, name: it.description, qty: 0, revenue: 0 };
      cur.qty += Number(it.qty) || 0;
      cur.revenue += Number(it.total) || 0;
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [saleItems]);

  // ---------- Top vendedores ----------
  const topSellers = useMemo(() => {
    const profileById = new Map(profiles.map((p) => [p.id, p.nome]));
    const map = new Map<string, { seller_id: string | null; name: string; revenue: number; count: number }>();
    for (const s of sales) {
      if (!(s.status === "faturado" || s.status === "entregue")) continue;
      const k = s.seller_id || "—";
      const cur = map.get(k) || {
        seller_id: s.seller_id,
        name: profileById.get(s.seller_id || "") || "Sem responsável",
        revenue: 0,
        count: 0,
      };
      cur.revenue += s.total;
      cur.count += 1;
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales, profiles]);

  // ============================================================
  // RENDER por papel
  // ============================================================

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted/40 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg border bg-card animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg border bg-card animate-pulse" />
      </div>
    );
  }

  // -------- Header comum --------
  const Header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">
          Olá, {user?.nome?.split(" ")[0] || "bem-vindo"} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {perms.isManager
            ? "Visão geral da operação."
            : perms.isTecnico
            ? "Suas ordens de serviço."
            : "Suas vendas e atendimentos."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Tabs value={period} onValueChange={(v: any) => setPeriod(v)}>
          <TabsList>
            <TabsTrigger value="month">Este mês</TabsTrigger>
            <TabsTrigger value="30d">30 dias</TabsTrigger>
            <TabsTrigger value="90d">90 dias</TabsTrigger>
            <TabsTrigger value="1y">1 ano</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="icon" onClick={load} title="Recarregar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // -------- TÉCNICO --------
  if (perms.isTecnico && !perms.isManager && !perms.isVendedor) {
    const myOs = serviceOrders;
    const inProgress = myOs.filter((o) => o.status === "em_execucao").length;
    const waitingApproval = myOs.filter((o) => o.status === "aguardando_aprovacao" || o.status === "aguardando_peca").length;
    return (
      <div className="space-y-6">
        {Header}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="OS atribuídas"
            value={myOs.filter((o) => !["entregue", "faturada", "cancelada"].includes(o.status)).length}
            icon={<Wrench className="h-4 w-4" />}
            tone="violet"
            to="/service-orders"
          />
          <StatCard
            label="Em execução agora"
            value={inProgress}
            icon={<Clock className="h-4 w-4" />}
            tone="sky"
          />
          <StatCard
            label="Aguardando peça/aprovação"
            value={waitingApproval}
            icon={<PackageOpen className="h-4 w-4" />}
            tone="amber"
            alert={waitingApproval > 0}
          />
          <StatCard
            label="Concluídas no mês"
            value={kpis.finishedMonthOs}
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone="emerald"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CriticalOsList serviceOrders={myOs} title="Suas OS que precisam de atenção" />
          <OsStatusDonut serviceOrders={myOs} />
        </div>

        <Button asChild>
          <Link to="/service-orders"><Plus className="h-4 w-4 mr-1" /> Abrir nova OS</Link>
        </Button>
      </div>
    );
  }

  // -------- VENDEDOR (sem visão de gerência) --------
  if (perms.isVendedor && !perms.isManager) {
    const mySales = sales; // RLS já filtra
    const today = todayISO();
    const monthStart = startOfMonth();
    const isInvoiced = (s: SaleRow) => s.status === "faturado" || s.status === "entregue";

    // --- hoje ---
    const todaySales = mySales.filter(
      (s) => isInvoiced(s) && (s.issue_date || "").slice(0, 10) === today
    );
    const todayRevenue = todaySales.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const todayCommission = todaySales.reduce((sum, s) => sum + Number(s.commission_amount || 0), 0);

    // --- mês ---
    const myInvoicedMonth = mySales.filter((s) => isInvoiced(s) && s.issue_date >= monthStart);
    const myMonthRevenue = myInvoicedMonth.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const myMonthCommission = myInvoicedMonth.reduce(
      (sum, s) => sum + Number(s.commission_amount || 0), 0
    );

    const myOpenSales = mySales.filter((s) => s.status === "orcamento" || s.status === "aprovado");
    const myOpenOs = serviceOrders.filter(
      (o) => !["entregue", "faturada", "cancelada"].includes(o.status)
    ).length;

    // --- últimas vendas ---
    const recentSales = [...mySales]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 7);

    const cashOpen = !!cashSession;
    const cashOpenedTime = cashSession
      ? new Date(cashSession.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : null;

    return (
      <div className="space-y-6">
        {Header}

        {/* aviso: caixa fechado */}
        {!cashOpen && (
          <Link
            to="/pdv"
            className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm transition hover:bg-amber-500/15"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-amber-200">
              Seu caixa está fechado — abra o caixa pra começar a vender.
            </span>
            <span className="ml-auto shrink-0 font-medium text-amber-300">Abrir caixa →</span>
          </Link>
        )}

        {/* HOJE */}
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> Hoje
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Vendas hoje"
              value={todaySales.length}
              hint={todaySales.length === 1 ? "venda fechada" : "vendas fechadas"}
              icon={<ShoppingCart className="h-4 w-4" />}
              tone="violet"
              to="/pdv"
            />
            <StatCard
              label="Faturamento hoje"
              value={formatBRL(todayRevenue)}
              icon={<DollarSign className="h-4 w-4" />}
              tone="emerald"
              to="/pdv"
            />
            <StatCard
              label="Comissão hoje"
              value={formatBRL(todayCommission)}
              icon={<Percent className="h-4 w-4" />}
              tone="teal"
            />
            <StatCard
              label="Caixa"
              value={cashOpen ? "Aberto" : "Fechado"}
              hint={cashOpen ? `aberto desde ${cashOpenedTime}` : "toque pra abrir"}
              icon={<Wallet className="h-4 w-4" />}
              tone={cashOpen ? "emerald" : "amber"}
              to="/pdv"
              alert={!cashOpen}
            />
          </div>
        </div>

        {/* NO MÊS */}
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> No mês
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Faturamento do mês"
              value={formatBRL(myMonthRevenue)}
              hint={`${myInvoicedMonth.length} ${myInvoicedMonth.length === 1 ? "venda" : "vendas"} fechadas`}
              icon={<DollarSign className="h-4 w-4" />}
              tone="emerald"
              to="/sales"
            />
            <StatCard
              label="Comissão do mês"
              value={formatBRL(myMonthCommission)}
              icon={<Percent className="h-4 w-4" />}
              tone="teal"
            />
            <StatCard
              label="Em aberto"
              value={myOpenSales.length}
              hint="orçamentos + pedidos"
              icon={<FileText className="h-4 w-4" />}
              tone="sky"
              to="/sales"
            />
            <StatCard
              label="Suas OS abertas"
              value={myOpenOs}
              icon={<Wrench className="h-4 w-4" />}
              tone="violet"
              to="/service-orders"
            />
          </div>
        </div>

        {/* atalhos rápidos */}
        <div className="flex flex-wrap gap-2">
          <Button asChild className="bg-blue-600 hover:bg-blue-700">
            <Link to="/pdv"><Zap className="h-4 w-4 mr-1" /> Venda rápida (PDV)</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/sales/new"><ShoppingCart className="h-4 w-4 mr-1" /> Venda completa</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/service-orders/new"><Wrench className="h-4 w-4 mr-1" /> Nova OS</Link>
          </Button>
        </div>

        {/* gráfico + últimas vendas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <RevenueChart
              sales={mySales.filter((s) => s.status === "faturado" || s.status === "entregue")}
              days={periodDays(period)}
            />
          </div>
          <RecentSalesList sales={recentSales} />
        </div>

        {/* produtos + OS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopProducts items={topProducts} />
          <CriticalOsList serviceOrders={serviceOrders} limit={6} title="Suas OS críticas" />
        </div>
      </div>
    );
  }

  // -------- ADMIN / GERENTE --------
  return (
    <div className="space-y-6">
      {Header}

      {/* KPIs principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Faturamento do mês"
          value={formatBRL(kpis.monthRevenue)}
          hint={`Período (${periodHintLabel(period)}): ${formatBRL(kpis.periodRevenue)}`}
          icon={<DollarSign className="h-4 w-4" />}
          tone="emerald"
          to="/sales"
        />
        <StatCard
          label="OS em andamento"
          value={kpis.openOs}
          hint={kpis.overdueOs > 0 ? `${kpis.overdueOs} em atraso` : "todas no prazo"}
          icon={<Wrench className="h-4 w-4" />}
          tone={kpis.overdueOs > 0 ? "rose" : "violet"}
          to="/service-orders"
          alert={kpis.overdueOs > 0}
        />
        <StatCard
          label="Aguardando peça"
          value={kpis.waitingPart}
          icon={<PackageOpen className="h-4 w-4" />}
          tone="amber"
          to="/service-orders"
        />
        <StatCard
          label="Vendas em aberto"
          value={kpis.openSales}
          hint="orçamentos + pedidos"
          icon={<FileText className="h-4 w-4" />}
          tone="sky"
          to="/sales"
        />

        <StatCard
          label="Ticket médio"
          value={formatBRL(kpis.avgTicket)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="teal"
        />
        <StatCard
          label="Estoque crítico"
          value={kpis.lowStockCount}
          hint={`Valor em estoque: ${formatBRL(kpis.stockValue)}`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={kpis.lowStockCount > 0 ? "amber" : "default"}
          to="/products"
          alert={kpis.lowStockCount >= 5}
        />
        <StatCard
          label="Clientes ativos"
          value={customerCount}
          icon={<Users className="h-4 w-4" />}
          tone="default"
          to="/customers"
        />
        <StatCard
          label="OS concluídas no mês"
          value={kpis.finishedMonthOs}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
      </div>

      {/* Linha 1: Faturamento + OS Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RevenueChart
            sales={sales.filter((s) => s.status === "faturado" || s.status === "entregue")}
            days={periodDays(period)}
          />
        </div>
        <OsStatusDonut serviceOrders={serviceOrders} />
      </div>

      {/* Linha 2: Top produtos + Top vendedores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopProducts items={topProducts} />
        <TopSellers items={topSellers} />
      </div>

      {/* Linha 3: Financeiro (só admin/financeiro) + OS críticas + Estoque crítico */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FinanceiroDashboardCard />
        <CriticalOsList serviceOrders={serviceOrders} />
        <LowStockList products={products} />
      </div>

      {/* Atalhos */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Atalhos</h3>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/service-orders/new"><Wrench className="h-3 w-3 mr-1" /> Nova OS</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/sales/new"><ShoppingCart className="h-3 w-3 mr-1" /> Nova venda</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/customers"><Users className="h-3 w-3 mr-1" /> Novo cliente</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/products"><Boxes className="h-3 w-3 mr-1" /> Estoque</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
   Lista das últimas vendas do vendedor
==================================================================== */
function RecentSalesList({ sales }: { sales: SaleRow[] }) {
  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <ShoppingCart className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-semibold">Suas últimas vendas</span>
      </div>
      {sales.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma venda registrada ainda.
        </div>
      ) : (
        <div className="divide-y">
          {sales.map((s) => {
            const st = SALE_STATUS_LABELS[s.status as SaleStatus];
            return (
              <Link
                key={s.id}
                to={`/sales/${s.id}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {s.customers?.name || "Consumidor final"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    #{String(s.number).padStart(4, "0")} ·{" "}
                    {formatDateBR(s.issue_date)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold">{formatBRL(s.total)}</div>
                  {st && (
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] ring-1 ${st.tone}`}>
                      {st.label}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
