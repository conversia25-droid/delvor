import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Search, CreditCard, AlertTriangle, CheckCircle2, Clock3, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CompanyBillingSummary {
  company_id: string;
  company_name: string;
  plan_code: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  /** Data em que a empresa foi cadastrada (companies.created_at) */
  created_at: string | null;
  /** true quando o status/trial foi inferido a partir de created_at (sem row em company_subscriptions) */
  inferred: boolean;
  users_count?: number | null;
  instances_count?: number | null;
  max_users?: number | null;
  max_instances?: number | null;
  latest_invoice_status?: string | null;
  latest_invoice_due_date?: string | null;
  monthly_amount_cents?: number | null;
}

// Trial padrão é de 30 dias a partir do cadastro — alinhado com SubscriptionContext.
const TRIAL_DAYS = 30;

function formatMoney(cents?: number | null) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function statusMeta(status?: string | null) {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return { label: "Ativo", icon: CheckCircle2 };
    case "trialing":
      return { label: "Trial", icon: Clock3 };
    case "past_due":
      return { label: "Em atraso", icon: AlertTriangle };
    case "unpaid":
      return { label: "Não pago", icon: AlertTriangle };
    case "canceled":
      return { label: "Cancelado", icon: Ban };
    case "suspended":
      return { label: "Suspenso", icon: Ban };
    case "expired":
      return { label: "Expirado", icon: AlertTriangle };
    default:
      return { label: status || "Sem status", icon: CreditCard };
  }
}

export default function MasterCompanies() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CompanyBillingSummary[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadRows() {
    setLoading(true);

    const [
      summaryRes,
      companiesRes,
      subscriptionsRes,
      invoicesRes,
      plansRes,
      profilesRes,
      instancesRes,
    ] = await Promise.all([
      supabase
        .from("v_company_billing_summary" as any)
        .select("company_id,company_name,plan_code,plan_name,subscription_status,current_period_end,trial_ends_at,users_count,instances_count,max_users,max_instances,latest_invoice_status,latest_invoice_due_date,monthly_amount_cents"),
      supabase.from("companies").select("id,name,plan_tier,created_at").order("name", { ascending: true }),
      supabase.from("company_subscriptions" as any).select("company_id,plan_id,status,current_period_end,trial_ends_at,created_at").order("created_at", { ascending: false }),
      supabase.from("billing_invoices" as any).select("company_id,amount_cents,status,due_date,created_at").order("created_at", { ascending: false }),
      supabase.from("billing_plans").select("id,code,name,price_cents"),
      supabase.from("profiles").select("id,company_id"),
      supabase.from("instancias").select("id,company_id"),
    ]);

    if (companiesRes.error) {
      toast({
        title: "Erro ao carregar empresas",
        description: companiesRes.error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const plansById = new Map<string, any>();
    const plansByCode = new Map<string, any>();
    ((plansRes.data || []) as any[]).forEach((p) => {
      if (p?.id) plansById.set(String(p.id), p);
      if (p?.code) plansByCode.set(String(p.code).toLowerCase(), p);
    });

    const subByCompany = new Map<string, any>();
    ((subscriptionsRes.data || []) as any[]).forEach((s) => {
      if (!s?.company_id) return;
      if (!subByCompany.has(s.company_id)) subByCompany.set(s.company_id, s);
    });

    const latestInvoiceByCompany = new Map<string, any>();
    ((invoicesRes.data || []) as any[]).forEach((i) => {
      if (!i?.company_id) return;
      if (!latestInvoiceByCompany.has(i.company_id)) latestInvoiceByCompany.set(i.company_id, i);
    });

    const usersByCompany = new Map<string, number>();
    ((profilesRes.data || []) as any[]).forEach((p) => {
      if (!p?.company_id) return;
      usersByCompany.set(p.company_id, (usersByCompany.get(p.company_id) || 0) + 1);
    });

    const instancesByCompany = new Map<string, number>();
    ((instancesRes.data || []) as any[]).forEach((i) => {
      if (!i?.company_id) return;
      instancesByCompany.set(i.company_id, (instancesByCompany.get(i.company_id) || 0) + 1);
    });

    const viewByCompany = new Map<string, any>();
    ((summaryRes.data || []) as any[]).forEach((v) => {
      if (v?.company_id) viewByCompany.set(v.company_id, v);
    });

    const merged: CompanyBillingSummary[] = ((companiesRes.data || []) as any[]).map((company) => {
      const view = viewByCompany.get(company.id) || {};
      const sub = subByCompany.get(company.id) || {};
      const invoice = latestInvoiceByCompany.get(company.id) || {};
      const plan =
        (sub.plan_id && plansById.get(String(sub.plan_id))) ||
        (company.plan_tier && plansByCode.get(String(company.plan_tier).toLowerCase())) ||
        (view.plan_code && plansByCode.get(String(view.plan_code).toLowerCase())) ||
        null;

      // Status e datas explícitos (do banco)
      let status = view.subscription_status ?? sub.status ?? null;
      let trialEndsAt = view.trial_ends_at ?? sub.trial_ends_at ?? null;
      let periodEnd = view.current_period_end ?? sub.current_period_end ?? null;
      let inferred = false;

      // Fallback: se a empresa NÃO tem subscription nem entrada na view,
      // calcula trial de 30 dias a partir do cadastro (igual SubscriptionContext faz no primeiro login)
      if (!status && !trialEndsAt && company.created_at) {
        const createdAt = new Date(company.created_at);
        if (!Number.isNaN(createdAt.getTime())) {
          const calcTrialEnd = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
          trialEndsAt = calcTrialEnd.toISOString();
          status = calcTrialEnd.getTime() > Date.now() ? "trialing" : "expired";
          if (!periodEnd) periodEnd = trialEndsAt;
          inferred = true;
        }
      }

      return {
        company_id: company.id,
        company_name: view.company_name ?? company.name,
        plan_code: view.plan_code ?? plan?.code ?? company.plan_tier ?? null,
        plan_name: view.plan_name ?? plan?.name ?? company.plan_tier ?? "Sem plano",
        subscription_status: status,
        current_period_end: periodEnd,
        trial_ends_at: trialEndsAt,
        created_at: company.created_at ?? null,
        inferred,
        users_count: view.users_count ?? usersByCompany.get(company.id) ?? 0,
        instances_count: view.instances_count ?? instancesByCompany.get(company.id) ?? 0,
        max_users: view.max_users ?? null,
        max_instances: view.max_instances ?? null,
        latest_invoice_status: view.latest_invoice_status ?? invoice.status ?? null,
        latest_invoice_due_date: view.latest_invoice_due_date ?? invoice.due_date ?? null,
        monthly_amount_cents: view.monthly_amount_cents ?? plan?.price_cents ?? invoice.amount_cents ?? null,
      };
    });

    merged.sort((a, b) => String(a.company_name || "").localeCompare(String(b.company_name || ""), "pt-BR"));

    setRows(merged);
    setLoading(false);
  }

  useEffect(() => {
    void loadRows();
  }, []);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !term || row.company_name?.toLowerCase().includes(term) || row.plan_code?.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || String(row.subscription_status || "").toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      active: rows.filter((row) => String(row.subscription_status || "").toLowerCase() === "active").length,
      pastDue: rows.filter((row) => ["past_due", "unpaid"].includes(String(row.subscription_status || "").toLowerCase())).length,
      trialing: rows.filter((row) => String(row.subscription_status || "").toLowerCase() === "trialing").length,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Empresas</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Controle comercial por empresa</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Consulte plano, status da assinatura, vencimento e consumo de cada conta a partir do painel master.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base">Empresas</CardTitle><CardDescription className="text-slate-400">Total mapeado</CardDescription></CardHeader><CardContent><p className="text-3xl font-semibold">{stats.total}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base">Ativas</CardTitle><CardDescription className="text-slate-400">Assinaturas operacionais</CardDescription></CardHeader><CardContent><p className="text-3xl font-semibold text-emerald-300">{stats.active}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base">Em atraso</CardTitle><CardDescription className="text-slate-400">Past due ou unpaid</CardDescription></CardHeader><CardContent><p className="text-3xl font-semibold text-amber-300">{stats.pastDue}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base">Trials</CardTitle><CardDescription className="text-slate-400">Período de teste</CardDescription></CardHeader><CardContent><p className="text-3xl font-semibold text-sky-300">{stats.trialing}</p></CardContent></Card>
      </div>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="h-4 w-4 text-blue-300" /> Filtros</CardTitle>
          <CardDescription className="text-slate-400">Localize a empresa e refine pelo status comercial.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr,220px,160px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por empresa ou plano..."
            className="border-slate-700 bg-slate-950"
          />
          <select className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="trialing">Trial</option>
            <option value="past_due">Em atraso</option>
            <option value="unpaid">Não pago</option>
            <option value="canceled">Cancelado</option>
            <option value="suspended">Suspenso</option>
            <option value="expired">Expirado</option>
          </select>
          <Button variant="outline" onClick={() => void loadRows()}>Atualizar</Button>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-300" /> Lista de empresas</CardTitle>
          <CardDescription className="text-slate-400">Clique para abrir os detalhes financeiros da conta.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[620px] pr-3">
            <div className="space-y-3">
              {loading ? <p className="text-sm text-slate-400">Carregando empresas...</p> : null}
              {!loading && !filteredRows.length ? <p className="text-sm text-slate-400">Nenhuma empresa encontrada.</p> : null}

              {filteredRows.map((row) => {
                const meta = statusMeta(row.subscription_status);
                const StatusIcon = meta.icon;
                return (
                  <div key={row.company_id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-lg font-semibold text-white">{row.company_name}</h3>
                          <Badge variant="secondary">{row.plan_name || row.plan_code || "Sem plano"}</Badge>
                          {row.inferred && (
                            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px]" title="Status calculado a partir da data de cadastro — empresa ainda não acessou o CRM">
                              auto
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                          <span className="inline-flex items-center gap-1"><StatusIcon className="h-4 w-4" /> {meta.label}</span>
                          {row.subscription_status === "trialing" && row.trial_ends_at && (() => {
                            const ms = new Date(row.trial_ends_at).getTime() - Date.now();
                            const days = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
                            return <span className="text-sky-300">Trial: {days} {days === 1 ? "dia" : "dias"}</span>;
                          })()}
                          <span>Cadastro: {formatDate(row.created_at)}</span>
                          <span>Vencimento: {formatDate(row.trial_ends_at || row.current_period_end || row.latest_invoice_due_date)}</span>
                          <span>Valor: {row.monthly_amount_cents ? formatMoney(row.monthly_amount_cents) : "—"}</span>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 lg:min-w-[340px]">
                        <div className="rounded-xl border border-slate-800 px-3 py-2">Usuários: <strong>{row.users_count ?? "—"}</strong> / {row.max_users ?? "—"}</div>
                        <div className="rounded-xl border border-slate-800 px-3 py-2">Instâncias: <strong>{row.instances_count ?? "—"}</strong> / {row.max_instances ?? "—"}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm"><Link to={`/master/empresas/${row.company_id}`}>Abrir empresa</Link></Button>
                      <Button asChild variant="outline" size="sm"><Link to={`/master/billing?company=${row.company_id}`}>Ver financeiro</Link></Button>
                      <Button asChild variant="outline" size="sm"><Link to={`/master/empresas/${row.company_id}/arquivo`}>Arquivo</Link></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
