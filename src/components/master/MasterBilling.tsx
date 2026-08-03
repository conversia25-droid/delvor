import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, Receipt, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InvoiceRow {
  id: string;
  company_id: string;
  subscription_id?: string | null;
  amount_cents?: number | null;
  status?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  payment_link?: string | null;
  company_name?: string | null;
}

interface SummaryRow {
  company_id: string;
  company_name: string;
  plan_name?: string | null;
  subscription_status?: string | null;
  latest_invoice_status?: string | null;
  latest_invoice_due_date?: string | null;
  monthly_amount_cents?: number | null;
}

function formatMoney(cents?: number | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", withTime ? undefined : { day: "2-digit", month: "2-digit", year: "numeric" });
}

function invoiceBadge(status?: string | null) {
  switch (String(status || "").toLowerCase()) {
    case "paid": return { label: "Paga", className: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" };
    case "open": return { label: "Aberta", className: "bg-sky-500/15 text-sky-200 border-sky-500/30" };
    case "overdue": return { label: "Vencida", className: "bg-amber-500/15 text-amber-200 border-amber-500/30" };
    case "void": return { label: "Cancelada", className: "bg-slate-500/15 text-slate-200 border-slate-500/30" };
    default: return { label: status || "—", className: "bg-slate-500/15 text-slate-200 border-slate-500/30" };
  }
}

export default function MasterBilling() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const selectedCompany = searchParams.get("company") || "";
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [search, setSearch] = useState(selectedCompany);

  async function loadData() {
    setLoading(true);
    const [summaryRes, invoicesRes, companyRes] = await Promise.all([
      supabase.from("v_company_billing_summary" as any).select("company_id,company_name,plan_name,subscription_status,latest_invoice_status,latest_invoice_due_date,monthly_amount_cents").order("company_name", { ascending: true }),
      supabase.from("billing_invoices" as any).select("id,company_id,subscription_id,amount_cents,status,due_date,paid_at,created_at,payment_link").order("created_at", { ascending: false }).limit(200),
      supabase.from("companies").select("id,name").order("name", { ascending: true }),
    ]);

    const companyMap = new Map<string, string>();
    ((companyRes.data || []) as any[]).forEach((company) => companyMap.set(company.id, company.name));

    if (summaryRes.error) {
      console.warn("Resumo billing indisponível:", summaryRes.error);
    }
    if (invoicesRes.error) {
      toast({ title: "Erro ao carregar faturas", description: invoicesRes.error.message, variant: "destructive" });
    }

    setSummaryRows(((summaryRes.data || []) as SummaryRow[]));
    setInvoices((((invoicesRes.data || []) as any[]).map((invoice) => ({ ...invoice, company_name: companyMap.get(invoice.company_id) || null }))));
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, []);

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (!term) return true;
      return invoice.company_id.toLowerCase().includes(term) || String(invoice.company_name || "").toLowerCase().includes(term);
    });
  }, [invoices, search]);

  const counters = useMemo(() => ({
    totalInvoices: invoices.length,
    paid: invoices.filter((invoice) => String(invoice.status || "").toLowerCase() === "paid").length,
    open: invoices.filter((invoice) => String(invoice.status || "").toLowerCase() === "open").length,
    overdue: invoices.filter((invoice) => ["overdue", "past_due", "unpaid"].includes(String(invoice.status || "").toLowerCase())).length,
  }), [invoices]);

  const focusCompany = useMemo(() => {
    if (!selectedCompany) return null;
    return summaryRows.find((row) => row.company_id === selectedCompany) || null;
  }, [selectedCompany, summaryRows]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Billing</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Cobrança e histórico financeiro</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Acompanhe as faturas emitidas, identifique inadimplência e abra o detalhe comercial de cada empresa.</p>
      </div>

      {focusCompany ? (
        <Card className="border-blue-500/40 bg-blue-500/10 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-blue-300" /> Empresa em foco</CardTitle>
            <CardDescription className="text-slate-300">Filtro aplicado a partir do atalho da tela de empresas.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-white">{focusCompany.company_name}</p>
              <p className="text-sm text-slate-300">Plano: {focusCompany.plan_name || "—"} • Status: {focusCompany.subscription_status || "—"}</p>
            </div>
            <Button asChild variant="secondary"><Link to={`/master/empresas/${focusCompany.company_id}`}>Abrir detalhe da empresa</Link></Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-blue-300" /> Faturas</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{counters.totalInvoices}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Pagas</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold text-emerald-300">{counters.paid}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock3 className="h-4 w-4 text-sky-300" /> Em aberto</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold text-sky-300">{counters.open}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-300" /> Inadimplentes</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold text-amber-300">{counters.overdue}</p></CardContent></Card>
      </div>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="h-4 w-4 text-blue-300" /> Localizar faturas</CardTitle>
          <CardDescription className="text-slate-400">Busque por empresa ou por ID da companhia.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome da empresa ou company_id" className="border-slate-700 bg-slate-950" />
          <Button variant="outline" onClick={() => void loadData()}>Atualizar</Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[420px,1fr]">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Receipt className="h-4 w-4 text-blue-300" /> Resumo por empresa</CardTitle>
            <CardDescription className="text-slate-400">Leitura rápida do status comercial atual.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-3">
              <div className="space-y-3">
                {(summaryRows.length ? summaryRows : []).map((row) => (
                  <div key={row.company_id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <p className="font-medium text-white">{row.company_name}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                      <Badge variant="secondary">{row.plan_name || "Sem plano"}</Badge>
                      <Badge variant="outline">{row.subscription_status || "Sem status"}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">Próx. vencimento: {formatDate(row.latest_invoice_due_date)}</p>
                    <p className="text-sm text-slate-400">Mensalidade: {row.monthly_amount_cents ? formatMoney(row.monthly_amount_cents) : "—"}</p>
                    <div className="mt-3 flex gap-2">
                      <Button asChild size="sm"><Link to={`/master/empresas/${row.company_id}`}>Abrir</Link></Button>
                    </div>
                  </div>
                ))}
                {!loading && !summaryRows.length ? <p className="text-sm text-slate-400">Resumo indisponível até a view ser criada.</p> : null}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Receipt className="h-4 w-4 text-blue-300" /> Últimas faturas</CardTitle>
            <CardDescription className="text-slate-400">As 200 faturas mais recentes, com link de pagamento quando disponível.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-3">
              <div className="space-y-3">
                {loading ? <p className="text-sm text-slate-400">Carregando faturas...</p> : null}
                {!loading && !filteredInvoices.length ? <p className="text-sm text-slate-400">Nenhuma fatura encontrada.</p> : null}
                {filteredInvoices.map((invoice) => {
                  const badge = invoiceBadge(invoice.status);
                  return (
                    <div key={invoice.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="font-medium text-white">{invoice.company_name || invoice.company_id}</p>
                          <p className="text-xs text-slate-500">invoice_id: {invoice.id}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-400">
                            <span>Valor: {formatMoney(invoice.amount_cents)}</span>
                            <span>Vencimento: {formatDate(invoice.due_date)}</span>
                            <span>Pagamento: {formatDate(invoice.paid_at, true)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${badge.className}`}>{badge.label}</span>
                          <Button asChild size="sm" variant="outline"><Link to={`/master/empresas/${invoice.company_id}`}>Empresa</Link></Button>
                          {invoice.payment_link ? (
                            <Button asChild size="sm"><a href={invoice.payment_link} target="_blank" rel="noreferrer">Abrir cobrança</a></Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
