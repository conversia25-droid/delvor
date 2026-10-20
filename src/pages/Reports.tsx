import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Loader2, TrendingUp, Receipt, Users, Package,
  Percent, Calendar, RefreshCw, Trophy, Wrench, FileDown, FileSpreadsheet,
  AlertTriangle, UserRound, CheckCircle2, Wallet, HandCoins, CalendarClock,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/formatters";
import { OS_STATUS_LABELS } from "@/types/delvor";
import { downloadCSV, downloadReportPDF, type PdfSection } from "@/lib/reportExport";
import { loadCompanyHeader, imageToDataUrl } from "@/lib/companyInfo";
import { fetchReceivedSummary } from "@/lib/receivables";

/* ====================================================================
   PERÍODO — helpers + componente de filtro
==================================================================== */

/** Nome + logo (PNG data URI) da empresa pro cabeçalho dos relatórios. */
async function loadReportBranding(companyId: string | undefined): Promise<{
  companyName: string | undefined;
  logoDataUrl: string | null;
}> {
  if (!companyId) return { companyName: undefined, logoDataUrl: null };
  const company = await loadCompanyHeader(companyId);
  const logoDataUrl = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;
  return { companyName: company?.name, logoDataUrl };
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function presetRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const today = isoDate(now);
  if (preset === "today") return { start: today, end: today };
  if (preset === "week") { const d = new Date(); d.setDate(d.getDate() - 6); return { start: isoDate(d), end: today }; }
  if (preset === "month") { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { start: isoDate(d), end: today }; }
  if (preset === "lastmonth") {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: isoDate(s), end: isoDate(e) };
  }
  if (preset === "year") { const d = new Date(now.getFullYear(), 0, 1); return { start: isoDate(d), end: today }; }
  return { start: today, end: today };
}
const PRESETS = [
  { key: "today", label: "Hoje" },
  { key: "week", label: "7 dias" },
  { key: "month", label: "Este mês" },
  { key: "lastmonth", label: "Mês passado" },
  { key: "year", label: "Este ano" },
];

function PeriodFilter({
  preset, range, onPreset, onCustom,
}: {
  preset: string;
  range: { start: string; end: string };
  onPreset: (k: string) => void;
  onCustom: (start: string, end: string) => void;
}) {
  const [cs, setCs] = useState(range.start);
  const [ce, setCe] = useState(range.end);
  useEffect(() => { setCs(range.start); setCe(range.end); }, [range.start, range.end]);
  return (
    <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPreset(p.key)}
          className={`text-xs px-3 py-1.5 rounded-full ring-1 transition ${
            preset === p.key
              ? "bg-blue-600 ring-blue-600 text-white font-medium"
              : "bg-background ring-blue-500/30 text-muted-foreground hover:ring-blue-500/60 hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1 ml-auto">
        <input type="date" value={cs} onChange={(e) => setCs(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs" />
        <span className="text-xs text-muted-foreground">até</span>
        <input type="date" value={ce} onChange={(e) => setCe(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs" />
        <Button size="sm" variant="outline" className="h-8" onClick={() => onCustom(cs, ce)}>Aplicar</Button>
      </div>
    </div>
  );
}

function ExportButtons({ onCSV, onPDF }: { onCSV: () => void; onPDF: () => void }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={onCSV}>
        <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-emerald-500" /> CSV
      </Button>
      <Button size="sm" variant="outline" onClick={onPDF}>
        <FileDown className="h-3.5 w-3.5 mr-1.5 text-rose-500" /> PDF
      </Button>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone, hint }: { icon: any; label: string; value: string; tone?: string; hint?: string }) {
  const toneClass: Record<string, string> = { emerald: "text-emerald-400", violet: "text-blue-400", amber: "text-amber-400" };
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" /> {label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone ? toneClass[tone] : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/* ====================================================================
   SHELL
==================================================================== */
type ReportTab = "vendas" | "comissoes" | "estoque" | "os";

export default function Reports() {
  const perms = usePermissions();
  const [tab, setTab] = useState<ReportTab>("vendas");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BarChart3 className="h-7 w-7" /> Relatórios
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vendas, estoque e ordens de serviço — exportáveis em CSV e PDF.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReportTab)}>
        <TabsList>
          <TabsTrigger value="vendas"><Receipt className="h-3.5 w-3.5 mr-1" /> Vendas</TabsTrigger>
          {perms.isManager && (
            <TabsTrigger value="comissoes"><Percent className="h-3.5 w-3.5 mr-1" /> Comissões</TabsTrigger>
          )}
          <TabsTrigger value="estoque"><Package className="h-3.5 w-3.5 mr-1" /> Estoque</TabsTrigger>
          <TabsTrigger value="os"><Wrench className="h-3.5 w-3.5 mr-1" /> OS</TabsTrigger>
        </TabsList>
        <TabsContent value="vendas" className="mt-5"><SalesReport /></TabsContent>
        {perms.isManager && (
          <TabsContent value="comissoes" className="mt-5"><CommissionsReport /></TabsContent>
        )}
        <TabsContent value="estoque" className="mt-5"><StockReport /></TabsContent>
        <TabsContent value="os" className="mt-5"><OsReport /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ====================================================================
   RELATÓRIO DE VENDAS
==================================================================== */
const COUNTED_SALE = ["faturado", "entregue"];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  dinheiro:          "Dinheiro",
  pix:               "PIX",
  boleto:            "Boleto",
  cartao_credito:    "Cartão crédito",
  cartao_debito:     "Cartão débito",
  credito_avista:    "Crédito à vista",
  credito_parcelado: "Crédito parcelado",
  transferencia:     "Transferência",
  crediario:         "Crediário",
  outro:             "Outro",
};

function SalesReport() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [sellerNames, setSellerNames] = useState<Record<string, string>>({});
  const [custNames, setCustNames] = useState<Record<string, string>>({});
  const [sellerFilter, setSellerFilter] = useState("all");

  /* Recebido no período pela DATA DO RECEBIMENTO (baixa de hoje de venda antiga
     entra hoje). Sem acesso ao financeiro a RPC recusa e o card mostra "—". */
  const [received, setReceived] = useState<{ received_total: number; received_count: number; fee_total: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetchReceivedSummary(range.start, range.end, sellerFilter === "all" ? null : sellerFilter)
      .then((r) => { if (alive) setReceived(r); });
    return () => { alive = false; };
  }, [range.start, range.end, sellerFilter]);

  /* quais blocos incluir no relatório (escolhidos antes de gerar) */
  const [show, setShow] = useState({
    seller: true, customer: true, product: false, detailed: false, pending: false, payment: false,
  });
  function toggle(k: keyof typeof show) {
    setShow((s) => ({ ...s, [k]: !s[k] }));
  }
  const nothingSelected =
    !show.seller && !show.customer && !show.product && !show.detailed && !show.pending && !show.payment;

  /* Vendas com pagamentos pendentes/parciais no período (independente do status contável).
     Puxadas em query separada porque a listagem "faturamento" ignora orçamentos, mas
     um orçamento aprovado com PIX pendente ainda conta como pendência a receber. */
  const [pendingSalesRaw, setPendingSalesRaw] = useState<any[]>([]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data: salesData, error } = await supabase
        .from("sales" as any)
        .select("id, number, seller_id, customer_id, total, commission_amount, status, issue_date")
        .eq("company_id", companyId)
        .in("status", COUNTED_SALE)
        .is("hidden_at", null)
        .gte("issue_date", range.start)
        .lte("issue_date", range.end)
        .limit(5000);
      if (error) throw error;
      const rows = (salesData as any[]) || [];
      setSales(rows);

      const ids = rows.map((s) => s.id);
      if (ids.length) {
        const { data: it } = await supabase
          .from("sale_items" as any)
          .select("sale_id, product_id, service_id, description, qty, total")
          .in("sale_id", ids).limit(20000);
        setItems((it as any[]) || []);
      } else setItems([]);

      // nomes dos clientes das vendas
      const custIds = Array.from(new Set(rows.map((s) => s.customer_id).filter(Boolean)));
      if (custIds.length) {
        const { data: cs } = await supabase
          .from("customers").select("id, name").in("id", custIds);
        const cm: Record<string, string> = {};
        for (const c of (cs as any[]) || []) cm[c.id] = c.name || "—";
        setCustNames(cm);
      } else setCustNames({});

      const { data: profs } = await supabase
        .from("profiles").select("id, nome").eq("company_id", companyId);
      const nm: Record<string, string> = {};
      for (const p of (profs as any[]) || []) nm[p.id] = p.nome || "—";
      setSellerNames(nm);

      // Vendas com pagamentos pendentes no período (qualquer status ativo).
      // Excluímos cancelado/perdido — pendências ali não fazem sentido.
      const { data: pend } = await supabase
        .from("sales" as any)
        .select("id, number, seller_id, customer_id, total, status, issue_date, sale_payments ( status, amount, method, due_date )")
        .eq("company_id", companyId)
        .not("status", "in", "(cancelado,perdido)")
        .is("hidden_at", null)
        .gte("issue_date", range.start)
        .lte("issue_date", range.end)
        .limit(5000);
      setPendingSalesRaw((pend as any[]) || []);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, range.start, range.end]);

  /* opções de vendedor pro dropdown (só os que têm venda no período) */
  const sellerOptions = useMemo(() => {
    const ids = new Set(sales.map((s) => s.seller_id).filter(Boolean));
    return Array.from(ids)
      .map((id) => ({ id: id as string, name: sellerNames[id as string] || "—" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sales, sellerNames]);

  /* aplica o filtro de vendedor */
  const filteredSales = useMemo(
    () => (sellerFilter === "all" ? sales : sales.filter((s) => s.seller_id === sellerFilter)),
    [sales, sellerFilter]
  );
  const filteredItems = useMemo(() => {
    if (sellerFilter === "all") return items;
    const ids = new Set(filteredSales.map((s) => s.id));
    return items.filter((it) => ids.has(it.sale_id));
  }, [items, filteredSales, sellerFilter]);

  const totals = useMemo(() => {
    const revenue = filteredSales.reduce((s, x) => s + (x.total || 0), 0);
    const commission = filteredSales.reduce((s, x) => s + (x.commission_amount || 0), 0);
    return { revenue, commission, count: filteredSales.length, avg: filteredSales.length ? revenue / filteredSales.length : 0 };
  }, [filteredSales]);

  const bySeller = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of filteredSales) {
      const key = s.seller_id || "_none";
      const cur = map.get(key) || {
        name: s.seller_id ? (sellerNames[s.seller_id] || "—") : "Sem vendedor",
        count: 0, revenue: 0, commission: 0,
      };
      cur.count += 1; cur.revenue += s.total || 0; cur.commission += s.commission_amount || 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, sellerNames]);

  const byProduct = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of filteredItems) {
      const key = it.product_id || it.service_id || `d:${it.description}`;
      const cur = map.get(key) || {
        name: it.description || "—",
        kind: it.product_id ? "Produto" : "Serviço",
        qty: 0, revenue: 0,
      };
      cur.qty += Number(it.qty || 0); cur.revenue += Number(it.total || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredItems]);

  /* agrupado por cliente */
  const byCustomer = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of filteredSales) {
      const key = s.customer_id || "_none";
      const cur = map.get(key) || {
        name: s.customer_id ? (custNames[s.customer_id] || "—") : "Sem cliente",
        count: 0, revenue: 0,
      };
      cur.count += 1; cur.revenue += s.total || 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, custNames]);

  /* Vendas com pendência — aplica filtro de vendedor + computa valor/vencimento. */
  const pendingSales = useMemo(() => {
    const source = sellerFilter === "all"
      ? pendingSalesRaw
      : pendingSalesRaw.filter((s) => s.seller_id === sellerFilter);
    const today = new Date().toISOString().slice(0, 10);
    return source
      .map((s) => {
        const items = (s.sale_payments || []).filter(
          (p: any) => p.status === "pendente" || p.status === "parcial"
        );
        const amount = items.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        if (amount <= 0) return null;
        const withDue = items.filter((p: any) => p.due_date);
        const overdue = withDue.some((p: any) => (p.due_date as string) < today);
        const nextDue = withDue
          .map((p: any) => p.due_date as string)
          .sort()[0] || null;
        const methods = Array.from(
          new Set(items.map((p: any) => PAYMENT_METHOD_LABELS[p.method] || p.method))
        ) as string[];
        return {
          id: s.id,
          number: s.number,
          date: s.issue_date as string,
          status: s.status as string,
          customer: s.customer_id ? (custNames[s.customer_id] || "—") : "Sem cliente",
          seller: s.seller_id ? (sellerNames[s.seller_id] || "—") : "Sem vendedor",
          total: Number(s.total || 0),
          pendingAmount: amount,
          methods,
          nextDue,
          overdue,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        // Vencidos primeiro; entre vencidos, o mais antigo. Depois por vencimento próximo.
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.nextDue && b.nextDue) return a.nextDue.localeCompare(b.nextDue);
        if (a.nextDue) return -1;
        if (b.nextDue) return 1;
        return 0;
      }) as any[];
  }, [pendingSalesRaw, sellerFilter, custNames, sellerNames]);

  const pendingTotals = useMemo(() => {
    const amount = pendingSales.reduce((s, x) => s + x.pendingAmount, 0);
    const overdue = pendingSales.filter((x) => x.overdue).length;
    return { count: pendingSales.length, amount, overdue };
  }, [pendingSales]);

  /* Quebra por forma de pagamento — só pagamentos JÁ PAGOS no período.
     Reutiliza `pendingSalesRaw` porque ela já traz todas as vendas ativas
     do período com todos os sale_payments. Filtramos por status=pago. */
  const paymentsByMethod = useMemo(() => {
    const source = sellerFilter === "all"
      ? pendingSalesRaw
      : pendingSalesRaw.filter((s) => s.seller_id === sellerFilter);
    const map = new Map<string, { method: string; label: string; amount: number; count: number }>();
    let total = 0;
    for (const s of source) {
      for (const p of (s.sale_payments || []) as any[]) {
        if (p.status !== "pago") continue;
        const amt = Number(p.amount || 0);
        if (amt <= 0) continue;
        const key = p.method || "outro";
        const cur = map.get(key) || {
          method: key,
          label: PAYMENT_METHOD_LABELS[key] || key,
          amount: 0,
          count: 0,
        };
        cur.amount += amt;
        cur.count += 1;
        map.set(key, cur);
        total += amt;
      }
    }
    return {
      rows: Array.from(map.values()).sort((a, b) => b.amount - a.amount),
      total,
    };
  }, [pendingSalesRaw, sellerFilter]);

  /* lista venda a venda (mais recentes primeiro) */
  const detailedSales = useMemo(() => {
    return [...filteredSales]
      .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""))
      .map((s) => ({
        id: s.id,
        number: s.number,
        date: s.issue_date as string,
        customer: s.customer_id ? (custNames[s.customer_id] || "—") : "Sem cliente",
        seller: s.seller_id ? (sellerNames[s.seller_id] || "—") : "Sem vendedor",
        total: Number(s.total || 0),
        commission: Number(s.commission_amount || 0),
      }));
  }, [filteredSales, custNames, sellerNames]);

  const periodLabel = `${new Date(range.start + "T12:00").toLocaleDateString("pt-BR")} a ${new Date(range.end + "T12:00").toLocaleDateString("pt-BR")}`;

  function fmtDate(d: string) {
    return d ? new Date(d + "T12:00").toLocaleDateString("pt-BR") : "—";
  }
  function fmtNum(n: number | null | undefined) {
    return "#" + String(n ?? "").padStart(6, "0");
  }

  function exportCSV() {
    downloadCSV(
      `vendas_${range.start}_${range.end}`,
      [
        { key: "number", label: "Venda" },
        { key: "date", label: "Data" },
        { key: "customer", label: "Cliente" },
        { key: "seller", label: "Vendedor" },
        { key: "total", label: "Total" },
        { key: "commission", label: "Comissao" },
      ],
      detailedSales.map((s) => ({
        number: fmtNum(s.number),
        date: fmtDate(s.date),
        customer: s.customer,
        seller: s.seller,
        total: s.total.toFixed(2).replace(".", ","),
        commission: s.commission.toFixed(2).replace(".", ","),
      }))
    );
  }
  async function exportPDF() {
    const sellerLabel = sellerFilter === "all"
      ? "Todos os vendedores"
      : (sellerNames[sellerFilter] || "—");

    const sections: PdfSection[] = [];

    if (show.seller) {
      sections.push({
        heading: "Desempenho por vendedor",
        columns: [
          { header: "Vendedor", dataKey: "name" },
          { header: "Vendas", dataKey: "count", align: "right" },
          { header: "Faturado", dataKey: "revenue", align: "right" },
          { header: "Comissão", dataKey: "commission", align: "right" },
        ],
        rows: bySeller.map((s) => ({
          name: s.name, count: s.count,
          revenue: formatBRL(s.revenue), commission: formatBRL(s.commission),
        })),
        totalRow: { name: "TOTAL", count: totals.count, revenue: formatBRL(totals.revenue), commission: formatBRL(totals.commission) },
      });
    }
    if (show.customer) {
      sections.push({
        heading: "Vendas por cliente",
        columns: [
          { header: "Cliente", dataKey: "name" },
          { header: "Compras", dataKey: "count", align: "right" },
          { header: "Total", dataKey: "revenue", align: "right" },
          { header: "Ticket médio", dataKey: "ticket", align: "right" },
        ],
        rows: byCustomer.map((c) => ({
          name: c.name, count: c.count,
          revenue: formatBRL(c.revenue),
          ticket: formatBRL(c.count ? c.revenue / c.count : 0),
        })),
        totalRow: { name: "TOTAL", count: totals.count, revenue: formatBRL(totals.revenue), ticket: formatBRL(totals.avg) },
      });
    }
    if (show.product) {
      sections.push({
        heading: "Produtos e serviços mais vendidos",
        columns: [
          { header: "Item", dataKey: "name" },
          { header: "Tipo", dataKey: "kind" },
          { header: "Qtd", dataKey: "qty", align: "right" },
          { header: "Faturado", dataKey: "revenue", align: "right" },
        ],
        rows: byProduct.slice(0, 50).map((p) => ({
          name: p.name, kind: p.kind, qty: p.qty, revenue: formatBRL(p.revenue),
        })),
      });
    }
    if (show.detailed) {
      sections.push({
        heading: `Vendas detalhadas (${detailedSales.length})`,
        columns: [
          { header: "Venda", dataKey: "number" },
          { header: "Data", dataKey: "date" },
          { header: "Cliente", dataKey: "customer" },
          { header: "Vendedor", dataKey: "seller" },
          { header: "Total", dataKey: "total", align: "right" },
        ],
        rows: detailedSales.map((s) => ({
          number: fmtNum(s.number),
          date: fmtDate(s.date),
          customer: s.customer,
          seller: s.seller,
          total: formatBRL(s.total),
        })),
      });
    }

    if (show.payment) {
      sections.push({
        heading: "Recebimentos por forma de pagamento",
        columns: [
          { header: "Forma de pagamento", dataKey: "label" },
          { header: "Qtd.", dataKey: "count", align: "right" },
          { header: "Total", dataKey: "amount", align: "right" },
          { header: "%", dataKey: "pct", align: "right" },
        ],
        rows: paymentsByMethod.rows.map((r) => ({
          label: r.label,
          count: r.count,
          amount: formatBRL(r.amount),
          pct: paymentsByMethod.total > 0
            ? `${((r.amount / paymentsByMethod.total) * 100).toFixed(1)}%`
            : "0%",
        })),
        totalRow: {
          label: "TOTAL",
          count: paymentsByMethod.rows.reduce((s, r) => s + r.count, 0),
          amount: formatBRL(paymentsByMethod.total),
          pct: "100%",
        },
      });
    }

    if (show.pending) {
      sections.push({
        heading: `Vendas com pendências (${pendingSales.length})`,
        columns: [
          { header: "Venda", dataKey: "number" },
          { header: "Emissão", dataKey: "date" },
          { header: "Cliente", dataKey: "customer" },
          { header: "Método", dataKey: "methods" },
          { header: "Vencimento", dataKey: "due" },
          { header: "Pendente", dataKey: "pending", align: "right" },
          { header: "Total", dataKey: "total", align: "right" },
        ],
        rows: pendingSales.map((s: any) => ({
          number: fmtNum(s.number),
          date: fmtDate(s.date),
          customer: s.customer,
          methods: s.methods.join(" / "),
          due: s.nextDue
            ? `${s.overdue ? "Vencido " : ""}${fmtDate(s.nextDue)}`
            : "—",
          pending: formatBRL(s.pendingAmount),
          total: formatBRL(s.total),
        })),
        totalRow: {
          number: "TOTAL", date: "", customer: "", methods: "", due: "",
          pending: formatBRL(pendingTotals.amount),
          total: "",
        },
      });
    }

    if (sections.length === 0) {
      toast({
        title: "Nada selecionado",
        description: "Marque pelo menos um bloco em \"Incluir no relatório\".",
        variant: "destructive",
      });
      return;
    }

    const { companyName, logoDataUrl } = await loadReportBranding(companyId);
    downloadReportPDF({
      title: "Relatório de Vendas",
      subtitle: `Período: ${periodLabel}  ·  Vendedor: ${sellerLabel}`,
      companyName,
      logoDataUrl,
      filename: `vendas_${range.start}_${range.end}.pdf`,
      sections,
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ExportButtons onCSV={exportCSV} onPDF={exportPDF} />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <PeriodFilter
        preset={preset} range={range}
        onPreset={(k) => { setPreset(k); setRange(presetRange(k)); }}
        onCustom={(s, e) => { setPreset("custom"); setRange({ start: s, end: e }); }}
      />

      {/* filtro de vendedor */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> Vendedor:
        </span>
        <select
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">Todos os vendedores</option>
          {sellerOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {sellerFilter !== "all" && (
          <button
            type="button"
            onClick={() => setSellerFilter("all")}
            className="text-xs text-blue-400 hover:underline"
          >
            limpar filtro
          </button>
        )}
      </div>

      {/* o que incluir no relatório (escolha antes de exportar) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Incluir no relatório:</span>
        {([
          ["seller", "Por vendedor"],
          ["customer", "Por cliente"],
          ["product", "Por produto"],
          ["detailed", "Detalhado (venda a venda)"],
          ["pending", "Pendências"],
          ["payment", "Por forma de pagamento"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className={`text-xs px-3 py-1 rounded-full ring-1 transition ${
              show[k]
                ? "bg-blue-600 ring-blue-600 text-white font-medium"
                : "bg-background ring-blue-500/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={TrendingUp} label="Vendido" value={formatBRL(totals.revenue)} hint="vendas fechadas no período" />
            <Kpi
              icon={HandCoins}
              label="Recebido"
              value={received ? formatBRL(received.received_total) : "—"}
              tone="emerald"
              hint={received && received.fee_total > 0 ? `taxas ${formatBRL(received.fee_total)}` : "pela data do recebimento"}
            />
            <Kpi
              icon={CalendarClock}
              label="A receber"
              value={formatBRL(pendingTotals.amount)}
              tone="amber"
              hint={pendingTotals.overdue > 0 ? `${pendingTotals.overdue} vencida${pendingTotals.overdue > 1 ? "s" : ""} · vendas do período` : "das vendas do período"}
            />
            <Kpi icon={Receipt} label="Vendas" value={String(totals.count)} />
            <Kpi icon={BarChart3} label="Ticket médio" value={formatBRL(totals.avg)} />
            <Kpi icon={Percent} label="Comissões" value={formatBRL(totals.commission)} tone="violet" />
          </div>

          {show.seller && (
          <ReportCard icon={Users} title="Desempenho por vendedor">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
                <TableHead className="text-right">Ticket médio</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {bySeller.length === 0 && <EmptyRow cols={5} />}
                {bySeller.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {i === 0 && s.revenue > 0 && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
                        {s.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                    <TableCell className="text-right font-mono">{formatBRL(s.revenue)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{formatBRL(s.count ? s.revenue / s.count : 0)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-blue-300">{formatBRL(s.commission)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReportCard>
          )}

          {show.customer && (
          <ReportCard icon={UserRound} title={`Vendas por cliente (${byCustomer.length})`}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Ticket médio</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {byCustomer.length === 0 && <EmptyRow cols={5} />}
                {byCustomer.slice(0, 50).map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {i === 0 && c.revenue > 0 && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
                        {c.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{c.count}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatBRL(c.revenue)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{formatBRL(c.count ? c.revenue / c.count : 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {byCustomer.length > 50 && (
              <div className="px-4 py-2 border-t text-center text-xs text-muted-foreground">
                Mostrando os 50 maiores de {byCustomer.length}. Exporte pra ver todos.
              </div>
            )}
          </ReportCard>
          )}

          {show.product && (
          <ReportCard icon={Package} title="Produtos e serviços mais vendidos">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {byProduct.length === 0 && <EmptyRow cols={5} />}
                {byProduct.slice(0, 30).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{p.kind}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{p.qty}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatBRL(p.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReportCard>
          )}

          {show.detailed && (
          <ReportCard icon={Receipt} title={`Vendas detalhadas (${detailedSales.length})`}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-24">Venda</TableHead>
                <TableHead className="w-28">Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {detailedSales.length === 0 && <EmptyRow cols={5} />}
                {detailedSales.slice(0, 200).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">{fmtNum(s.number)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(s.date)}</TableCell>
                    <TableCell className="font-medium">{s.customer}</TableCell>
                    <TableCell className="text-muted-foreground">{s.seller}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatBRL(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {detailedSales.length > 200 && (
              <div className="px-4 py-2 border-t text-center text-xs text-muted-foreground">
                Mostrando 200 de {detailedSales.length}. Exporte pra ver tudo.
              </div>
            )}
          </ReportCard>
          )}

          {show.pending && (
          <ReportCard
            icon={AlertTriangle}
            title={`Vendas com pendências (${pendingSales.length})`}
          >
            {pendingSales.length > 0 && (
              <div className="px-4 py-2 border-b bg-muted/20 flex flex-wrap gap-4 text-xs">
                <span>
                  <span className="text-muted-foreground">Total pendente: </span>
                  <span className="font-mono font-semibold text-amber-400">
                    {formatBRL(pendingTotals.amount)}
                  </span>
                </span>
                {pendingTotals.overdue > 0 && (
                  <span className="text-rose-400">
                    {pendingTotals.overdue} vencida{pendingTotals.overdue > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-24">Venda</TableHead>
                <TableHead className="w-28">Emissão</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="w-32">Vencimento</TableHead>
                <TableHead className="text-right w-32">Pendente</TableHead>
                <TableHead className="text-right w-32">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pendingSales.length === 0 && <EmptyRow cols={7} />}
                {pendingSales.slice(0, 200).map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">{fmtNum(s.number)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(s.date)}</TableCell>
                    <TableCell className="font-medium">{s.customer}</TableCell>
                    <TableCell className="text-xs">{s.methods.join(" • ")}</TableCell>
                    <TableCell className="text-xs">
                      {s.nextDue ? (
                        <span className={s.overdue ? "text-rose-400 font-medium" : "text-muted-foreground"}>
                          {s.overdue ? "Vencido " : ""}{fmtDate(s.nextDue)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${s.overdue ? "text-rose-400" : "text-amber-400"}`}>
                      {formatBRL(s.pendingAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatBRL(s.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pendingSales.length > 200 && (
              <div className="px-4 py-2 border-t text-center text-xs text-muted-foreground">
                Mostrando 200 de {pendingSales.length}. Exporte pra ver tudo.
              </div>
            )}
          </ReportCard>
          )}

          {show.payment && (
          <ReportCard icon={Wallet} title="Recebimentos por forma de pagamento">
            {paymentsByMethod.rows.length > 0 && (
              <div className="px-4 py-2 border-b bg-muted/20 text-xs">
                <span className="text-muted-foreground">Total recebido no período: </span>
                <span className="font-mono font-semibold text-emerald-400">
                  {formatBRL(paymentsByMethod.total)}
                </span>
              </div>
            )}
            <Table>
              <TableHeader><TableRow>
                <TableHead>Forma de pagamento</TableHead>
                <TableHead className="text-right w-24">Qtd.</TableHead>
                <TableHead className="text-right w-32">Total</TableHead>
                <TableHead className="text-right w-20">%</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paymentsByMethod.rows.length === 0 && <EmptyRow cols={4} />}
                {paymentsByMethod.rows.map((r) => {
                  const pct = paymentsByMethod.total > 0
                    ? (r.amount / paymentsByMethod.total) * 100
                    : 0;
                  return (
                    <TableRow key={r.method}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{r.count}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatBRL(r.amount)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ReportCard>
          )}

          {nothingSelected && (
            <div className="rounded-lg border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
              Marque acima o que deseja ver no relatório.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ====================================================================
   RELATÓRIO DE COMISSÕES
==================================================================== */
interface SellerComm {
  id: string;
  name: string;
  rate: number;
  count: number;
  total: number;
  paid: number;
  pending: number;
}

function CommissionsReport() {
  const { user } = useAuth();
  const perms = usePermissions();
  const companyId = user?.company_id;

  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);

  const [payTarget, setPayTarget] = useState<SellerComm | null>(null);
  const [paying, setPaying] = useState(false);
  const [recalcing, setRecalcing] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data: salesData, error } = await supabase
        .from("sales" as any)
        .select("id, seller_id, total, commission_rate, commission_amount, commission_paid_at, status, issue_date")
        .eq("company_id", companyId)
        .in("status", COUNTED_SALE)
        .gte("issue_date", range.start)
        .lte("issue_date", range.end)
        .limit(5000);
      if (error) throw error;
      setSales((salesData as any[]) || []);

      const { data: profs } = await supabase
        .from("profiles").select("id, nome, commission_rate").eq("company_id", companyId);
      setProfiles((profs as any[]) || []);

      const { data: pay } = await supabase
        .from("commission_payouts" as any)
        .select("*")
        .eq("company_id", companyId)
        .order("paid_at", { ascending: false })
        .limit(100);
      setPayouts((pay as any[]) || []);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, range.start, range.end]);

  const profById = useMemo(() => {
    const m = new Map<string, { nome: string; rate: number }>();
    for (const p of profiles) {
      m.set(p.id, { nome: p.nome || "—", rate: Number(p.commission_rate) || 0 });
    }
    return m;
  }, [profiles]);
  const profileName = (id: string) => profById.get(id)?.nome || "—";

  /* comissão agrupada por vendedor */
  const bySeller = useMemo<SellerComm[]>(() => {
    const map = new Map<string, SellerComm>();
    for (const s of sales) {
      if (!s.seller_id) continue;
      const amt = Number(s.commission_amount || 0);
      const info = profById.get(s.seller_id);
      const cur = map.get(s.seller_id) || {
        id: s.seller_id,
        name: info?.nome || "—",
        rate: info?.rate || 0,
        count: 0, total: 0, paid: 0, pending: 0,
      };
      if (amt > 0) {
        cur.count += 1;
        cur.total += amt;
        if (s.commission_paid_at) cur.paid += amt;
        else cur.pending += amt;
      }
      map.set(s.seller_id, cur);
    }
    return Array.from(map.values())
      .filter((x) => x.total > 0)
      .sort((a, b) => b.pending - a.pending || b.total - a.total);
  }, [sales, profById]);

  const totals = useMemo(
    () => bySeller.reduce(
      (a, s) => ({ total: a.total + s.total, paid: a.paid + s.paid, pending: a.pending + s.pending }),
      { total: 0, paid: 0, pending: 0 }
    ),
    [bySeller]
  );

  const periodLabel = `${new Date(range.start + "T12:00").toLocaleDateString("pt-BR")} a ${new Date(range.end + "T12:00").toLocaleDateString("pt-BR")}`;

  async function confirmPay() {
    if (!payTarget) return;
    setPaying(true);
    const { error } = await supabase.rpc("pay_seller_commission" as any, {
      p_seller_id: payTarget.id,
      p_period_start: range.start,
      p_period_end: range.end,
      p_notes: null,
    } as any);
    setPaying(false);
    if (error) {
      toast({ title: "Erro ao pagar comissão", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Comissão paga!", description: `${payTarget.name} — ${formatBRL(payTarget.pending)}` });
    setPayTarget(null);
    load();
  }

  async function recalc() {
    setRecalcing(true);
    const { data, error } = await supabase.rpc("recalc_pending_commissions" as any);
    setRecalcing(false);
    if (error) {
      toast({ title: "Erro ao recalcular", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Comissões recalculadas", description: `${data ?? 0} venda(s) atualizada(s).` });
    load();
  }

  function exportCSV() {
    downloadCSV(
      `comissoes_${range.start}_${range.end}`,
      [
        { key: "name", label: "Vendedor" },
        { key: "rate", label: "Taxa %" },
        { key: "count", label: "Vendas" },
        { key: "total", label: "Comissao total" },
        { key: "paid", label: "Pago" },
        { key: "pending", label: "A pagar" },
      ],
      bySeller.map((s) => ({
        name: s.name,
        rate: String(s.rate).replace(".", ","),
        count: s.count,
        total: s.total.toFixed(2).replace(".", ","),
        paid: s.paid.toFixed(2).replace(".", ","),
        pending: s.pending.toFixed(2).replace(".", ","),
      }))
    );
  }
  async function exportPDF() {
    const { companyName, logoDataUrl } = await loadReportBranding(companyId);
    downloadReportPDF({
      title: "Relatório de Comissões",
      subtitle: `Período: ${periodLabel}`,
      companyName,
      logoDataUrl,
      filename: `comissoes_${range.start}_${range.end}.pdf`,
      sections: [{
        heading: "Comissão por vendedor",
        columns: [
          { header: "Vendedor", dataKey: "name" },
          { header: "Taxa", dataKey: "rate", align: "right" },
          { header: "Vendas", dataKey: "count", align: "right" },
          { header: "Comissão", dataKey: "total", align: "right" },
          { header: "Pago", dataKey: "paid", align: "right" },
          { header: "A pagar", dataKey: "pending", align: "right" },
        ],
        rows: bySeller.map((s) => ({
          name: s.name, rate: `${s.rate}%`, count: s.count,
          total: formatBRL(s.total), paid: formatBRL(s.paid), pending: formatBRL(s.pending),
        })),
        totalRow: {
          name: "TOTAL", rate: "", count: "",
          total: formatBRL(totals.total), paid: formatBRL(totals.paid), pending: formatBRL(totals.pending),
        },
      }],
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ExportButtons onCSV={exportCSV} onPDF={exportPDF} />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={recalc} disabled={recalcing}
            title="Reaplica a taxa atual de cada vendedor nas comissões ainda não pagas">
            {recalcing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Recalcular
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <PeriodFilter
        preset={preset} range={range}
        onPreset={(k) => { setPreset(k); setRange(presetRange(k)); }}
        onCustom={(s, e) => { setPreset("custom"); setRange({ start: s, end: e }); }}
      />

      {loading ? <Loading /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi icon={Percent} label="Comissão do período" value={formatBRL(totals.total)} />
            <Kpi icon={CheckCircle2} label="Já pago" value={formatBRL(totals.paid)} tone="emerald" />
            <Kpi icon={Wallet} label="A pagar" value={formatBRL(totals.pending)} tone="amber" />
          </div>

          <ReportCard icon={Users} title="Comissão por vendedor">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right w-16">Taxa</TableHead>
                <TableHead className="text-right w-20">Vendas</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">A pagar</TableHead>
                <TableHead className="w-32" />
              </TableRow></TableHeader>
              <TableBody>
                {bySeller.length === 0 && <EmptyRow cols={7} />}
                {bySeller.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{s.rate}%</TableCell>
                    <TableCell className="text-right">{s.count}</TableCell>
                    <TableCell className="text-right font-mono">{formatBRL(s.total)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">{formatBRL(s.paid)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-amber-300">{formatBRL(s.pending)}</TableCell>
                    <TableCell className="text-right">
                      {s.pending > 0.005 ? (
                        perms.isManager && (
                          <Button size="sm" className="h-7" onClick={() => setPayTarget(s)}>
                            <Wallet className="h-3.5 w-3.5 mr-1" /> Pagar
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> quitado
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReportCard>

          <ReportCard icon={Receipt} title={`Pagamentos de comissão (${payouts.length})`}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-36">Data</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right w-20">Vendas</TableHead>
                <TableHead className="text-right">Valor pago</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {payouts.length === 0 && <EmptyRow cols={5} />}
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.paid_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="font-medium">{profileName(p.seller_id)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.period_start && p.period_end
                        ? `${new Date(p.period_start + "T12:00").toLocaleDateString("pt-BR")} a ${new Date(p.period_end + "T12:00").toLocaleDateString("pt-BR")}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">{p.sales_count}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatBRL(Number(p.total_amount || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReportCard>
        </>
      )}

      {/* dialog: confirmar pagamento */}
      <Dialog open={!!payTarget} onOpenChange={(o) => { if (!o) setPayTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-blue-400" /> Pagar comissão
            </DialogTitle>
            <DialogDescription>
              Confirmar o pagamento da comissão pendente de{" "}
              <strong className="text-foreground">{payTarget?.name}</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Período</span>
              <span>{periodLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor a pagar</span>
              <span className="font-mono font-bold text-amber-300">{formatBRL(payTarget?.pending || 0)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            As vendas do período serão marcadas como comissão paga e o pagamento entra no histórico.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={paying}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={paying}>
              {paying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ====================================================================
   RELATÓRIO DE ESTOQUE
==================================================================== */
function StockReport() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const [onlyCritical, setOnlyCritical] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("products" as any)
      .select("id, name, sku, type, unit, stock_qty, stock_min, cost_price, sale_price")
      .eq("company_id", companyId)
      .is("hidden_at", null)
      .order("name")
      .limit(5000);
    setProducts((data as any[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId]);

  const types = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.type).filter(Boolean)));
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (filterType !== "all" && p.type !== filterType) return false;
      if (onlyCritical && Number(p.stock_qty || 0) > Number(p.stock_min || 0)) return false;
      return true;
    });
  }, [products, filterType, onlyCritical]);

  const stats = useMemo(() => {
    const totalCost = filtered.reduce((s, p) => s + Number(p.stock_qty || 0) * Number(p.cost_price || 0), 0);
    const totalSale = filtered.reduce((s, p) => s + Number(p.stock_qty || 0) * Number(p.sale_price || 0), 0);
    const critical = filtered.filter((p) => Number(p.stock_qty || 0) <= Number(p.stock_min || 0)).length;
    return { skus: filtered.length, totalCost, totalSale, critical };
  }, [filtered]);

  function rowsForExport() {
    return filtered.map((p) => {
      const qty = Number(p.stock_qty || 0);
      const valor = qty * Number(p.cost_price || 0);
      const critico = qty <= Number(p.stock_min || 0);
      return {
        name: p.name, sku: p.sku || "", type: p.type || "",
        unit: p.unit || "UN", qty, min: Number(p.stock_min || 0),
        cost: Number(p.cost_price || 0), sale: Number(p.sale_price || 0),
        valor, status: critico ? "CRÍTICO" : "OK",
      };
    });
  }
  function exportCSV() {
    downloadCSV(
      `estoque_${isoDate(new Date())}`,
      [
        { key: "name", label: "Produto" }, { key: "sku", label: "SKU" },
        { key: "type", label: "Tipo" }, { key: "unit", label: "Unidade" },
        { key: "qty", label: "Estoque" }, { key: "min", label: "Minimo" },
        { key: "cost", label: "Custo" }, { key: "sale", label: "Venda" },
        { key: "valor", label: "Valor em estoque" }, { key: "status", label: "Status" },
      ],
      rowsForExport().map((r) => ({
        ...r,
        cost: r.cost.toFixed(2).replace(".", ","),
        sale: r.sale.toFixed(2).replace(".", ","),
        valor: r.valor.toFixed(2).replace(".", ","),
      }))
    );
  }
  async function exportPDF() {
    const { companyName, logoDataUrl } = await loadReportBranding(companyId);
    downloadReportPDF({
      title: "Relatório de Estoque",
      subtitle: `${filterType === "all" ? "Todos os tipos" : `Tipo: ${filterType}`}${onlyCritical ? "  ·  Apenas estoque crítico" : ""}`,
      companyName,
      logoDataUrl,
      filename: `estoque_${isoDate(new Date())}.pdf`,
      sections: [{
        heading: `Itens (${stats.skus}) — valor em estoque ${formatBRL(stats.totalCost)}`,
        columns: [
          { header: "Produto", dataKey: "name" },
          { header: "SKU", dataKey: "sku" },
          { header: "Estoque", dataKey: "qty", align: "right" },
          { header: "Mín.", dataKey: "min", align: "right" },
          { header: "Custo", dataKey: "cost", align: "right" },
          { header: "Valor", dataKey: "valor", align: "right" },
          { header: "Status", dataKey: "status", align: "center" },
        ],
        rows: rowsForExport().map((r) => ({
          name: r.name, sku: r.sku, qty: r.qty, min: r.min,
          cost: formatBRL(r.cost), valor: formatBRL(r.valor), status: r.status,
        })),
      }],
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ExportButtons onCSV={exportCSV} onPDF={exportPDF} />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* filtro tipo */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Tipo:</span>
        <button onClick={() => setFilterType("all")}
          className={`text-xs px-3 py-1 rounded-full ring-1 transition ${filterType === "all" ? "bg-blue-600 ring-blue-600 text-white font-medium" : "bg-background ring-blue-500/30 text-muted-foreground"}`}>
          Todos
        </button>
        {types.map((t) => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`text-xs px-3 py-1 rounded-full ring-1 transition capitalize ${filterType === t ? "bg-blue-600 ring-blue-600 text-white font-medium" : "bg-background ring-blue-500/30 text-muted-foreground"}`}>
            {t}
          </button>
        ))}
        <button onClick={() => setOnlyCritical((v) => !v)}
          className={`text-xs px-3 py-1 rounded-full ring-1 transition flex items-center gap-1 ml-2 ${onlyCritical ? "bg-amber-600 ring-amber-600 text-white font-medium" : "bg-background ring-blue-500/30 text-muted-foreground"}`}>
          <AlertTriangle className="h-3 w-3" /> Só estoque crítico
        </button>
      </div>

      {loading ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Package} label="Itens (SKUs)" value={String(stats.skus)} />
            <Kpi icon={TrendingUp} label="Valor (custo)" value={formatBRL(stats.totalCost)} />
            <Kpi icon={TrendingUp} label="Valor (venda)" value={formatBRL(stats.totalSale)} tone="emerald" />
            <Kpi icon={AlertTriangle} label="Estoque crítico" value={String(stats.critical)} tone="amber" />
          </div>

          <ReportCard icon={Package} title="Posição de estoque">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="w-28">SKU</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mín.</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Valor estoque</TableHead>
                <TableHead className="w-20 text-center">Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 && <EmptyRow cols={7} />}
                {filtered.map((p) => {
                  const qty = Number(p.stock_qty || 0);
                  const critico = qty <= Number(p.stock_min || 0);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.sku || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{qty} {p.unit || ""}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{Number(p.stock_min || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(Number(p.cost_price || 0))}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatBRL(qty * Number(p.cost_price || 0))}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-[10px] ${critico ? "text-rose-400" : "text-emerald-400"}`}>
                          {critico ? "Crítico" : "OK"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ReportCard>
        </>
      )}
    </div>
  );
}

/* ====================================================================
   RELATÓRIO DE OS
==================================================================== */
function OsReport() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [custNames, setCustNames] = useState<Record<string, string>>({});
  const [techNames, setTechNames] = useState<Record<string, string>>({});
  const [techFilter, setTechFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("service_orders" as any)
        .select("id, number, status, customer_id, technician_id, total, created_at")
        .eq("company_id", companyId)
        .gte("created_at", range.start)
        .lte("created_at", range.end + "T23:59:59")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const rows = (data as any[]) || [];
      setOrders(rows);

      const custIds = Array.from(new Set(rows.map((o) => o.customer_id).filter(Boolean)));
      const techIds = Array.from(new Set(rows.map((o) => o.technician_id).filter(Boolean)));
      if (custIds.length) {
        const { data: cs } = await supabase.from("customers").select("id, name").in("id", custIds);
        const m: Record<string, string> = {};
        for (const c of (cs as any[]) || []) m[c.id] = c.name;
        setCustNames(m);
      }
      if (techIds.length) {
        const { data: ts } = await supabase.from("profiles").select("id, nome").in("id", techIds);
        const m: Record<string, string> = {};
        for (const t of (ts as any[]) || []) m[t.id] = t.nome || "—";
        setTechNames(m);
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, range.start, range.end]);

  /* opções de filtro */
  const techOptions = useMemo(() => {
    const ids = new Set(orders.map((o) => o.technician_id).filter(Boolean));
    return Array.from(ids)
      .map((id) => ({ id: id as string, name: techNames[id as string] || "—" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, techNames]);

  const statusOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.status))),
    [orders]
  );

  /* aplica filtros */
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (techFilter === "all") { /* ok */ }
      else if (techFilter === "_none") { if (o.technician_id) return false; }
      else if (o.technician_id !== techFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      return true;
    });
  }, [orders, techFilter, statusFilter]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of filteredOrders) m.set(o.status, (m.get(o.status) || 0) + 1);
    return Array.from(m.entries());
  }, [filteredOrders]);

  const totalValue = useMemo(
    () => filteredOrders.reduce((s, o) => s + Number(o.total || 0), 0),
    [filteredOrders]
  );

  const periodLabel = `${new Date(range.start + "T12:00").toLocaleDateString("pt-BR")} a ${new Date(range.end + "T12:00").toLocaleDateString("pt-BR")}`;

  function statusLabel(s: string) {
    return (OS_STATUS_LABELS as any)[s]?.label || s;
  }

  function exportCSV() {
    downloadCSV(
      `ordens-servico_${range.start}_${range.end}`,
      [
        { key: "number", label: "OS" }, { key: "cliente", label: "Cliente" },
        { key: "tecnico", label: "Tecnico" }, { key: "status", label: "Status" },
        { key: "total", label: "Total" }, { key: "abertura", label: "Abertura" },
      ],
      filteredOrders.map((o) => ({
        number: "#" + String(o.number).padStart(6, "0"),
        cliente: custNames[o.customer_id] || "—",
        tecnico: o.technician_id ? (techNames[o.technician_id] || "—") : "Não atribuído",
        status: statusLabel(o.status),
        total: Number(o.total || 0).toFixed(2).replace(".", ","),
        abertura: new Date(o.created_at).toLocaleDateString("pt-BR"),
      }))
    );
  }
  async function exportPDF() {
    const techLabel =
      techFilter === "all" ? "Todos"
      : techFilter === "_none" ? "Não atribuído"
      : techNames[techFilter] || "—";
    const stLabel = statusFilter === "all" ? "Todos" : statusLabel(statusFilter);
    const { companyName, logoDataUrl } = await loadReportBranding(companyId);
    downloadReportPDF({
      title: "Relatório de Ordens de Serviço",
      subtitle: `Período: ${periodLabel}  ·  Técnico: ${techLabel}  ·  Status: ${stLabel}`,
      companyName,
      logoDataUrl,
      filename: `os_${range.start}_${range.end}.pdf`,
      sections: [
        {
          heading: "Resumo por status",
          columns: [
            { header: "Status", dataKey: "status" },
            { header: "Quantidade", dataKey: "count", align: "right" },
          ],
          rows: byStatus.map(([s, c]) => ({ status: statusLabel(s), count: c })),
        },
        {
          heading: `Ordens de serviço (${filteredOrders.length})`,
          columns: [
            { header: "OS", dataKey: "number" },
            { header: "Cliente", dataKey: "cliente" },
            { header: "Técnico", dataKey: "tecnico" },
            { header: "Status", dataKey: "status" },
            { header: "Total", dataKey: "total", align: "right" },
          ],
          rows: filteredOrders.map((o) => ({
            number: "#" + String(o.number).padStart(6, "0"),
            cliente: custNames[o.customer_id] || "—",
            tecnico: o.technician_id ? (techNames[o.technician_id] || "—") : "—",
            status: statusLabel(o.status),
            total: formatBRL(Number(o.total || 0)),
          })),
        },
      ],
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ExportButtons onCSV={exportCSV} onPDF={exportPDF} />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <PeriodFilter
        preset={preset} range={range}
        onPreset={(k) => { setPreset(k); setRange(presetRange(k)); }}
        onCustom={(s, e) => { setPreset("custom"); setRange({ start: s, end: e }); }}
      />

      {/* filtros de técnico + status */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Wrench className="h-3.5 w-3.5" /> Técnico:
        </span>
        <select
          value={techFilter}
          onChange={(e) => setTechFilter(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">Todos os técnicos</option>
          <option value="_none">Não atribuído</option>
          {techOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <span className="text-xs text-muted-foreground flex items-center gap-1 ml-2">
          <Receipt className="h-3.5 w-3.5" /> Status:
        </span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">Todos os status</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>

        {(techFilter !== "all" || statusFilter !== "all") && (
          <button
            type="button"
            onClick={() => { setTechFilter("all"); setStatusFilter("all"); }}
            className="text-xs text-blue-400 hover:underline"
          >
            limpar filtros
          </button>
        )}
      </div>

      {loading ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Wrench} label="Total de OS" value={String(filteredOrders.length)} />
            <Kpi icon={TrendingUp} label="Valor total" value={formatBRL(totalValue)} tone="emerald" />
            {byStatus.slice(0, 2).map(([s, c]) => (
              <Kpi key={s} icon={Receipt} label={statusLabel(s)} value={String(c)} />
            ))}
          </div>

          <ReportCard icon={BarChart3} title="Resumo por status">
            <div className="p-4 flex flex-wrap gap-2">
              {byStatus.length === 0 && <span className="text-sm text-muted-foreground">Nenhuma OS no período.</span>}
              {byStatus.map(([s, c]) => (
                <div key={s} className="rounded-lg border px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{statusLabel(s)}: </span>
                  <span className="font-bold">{c}</span>
                </div>
              ))}
            </div>
          </ReportCard>

          <ReportCard icon={Wrench} title={`Ordens de serviço (${filteredOrders.length})`}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-24">OS</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-28">Abertura</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredOrders.length === 0 && <EmptyRow cols={6} />}
                {filteredOrders.slice(0, 200).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-sm">#{String(o.number).padStart(6, "0")}</TableCell>
                    <TableCell className="font-medium">{custNames[o.customer_id] || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.technician_id ? (techNames[o.technician_id] || "—") : "Não atribuído"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{statusLabel(o.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatBRL(Number(o.total || 0))}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredOrders.length > 200 && (
              <div className="px-4 py-2 border-t text-center text-xs text-muted-foreground">
                Mostrando 200 de {filteredOrders.length}. Exporte pra ver tudo.
              </div>
            )}
          </ReportCard>
        </>
      )}
    </div>
  );
}

/* ── componentes auxiliares ── */
function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
    </div>
  );
}
function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center py-8 text-muted-foreground">
        Nenhum dado no período.
      </TableCell>
    </TableRow>
  );
}
function ReportCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}
