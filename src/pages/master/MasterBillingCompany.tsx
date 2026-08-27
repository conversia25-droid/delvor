import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Ban, Building2, CalendarClock, CheckCircle2, CreditCard, History, Mail, Phone, RefreshCcw, Send, ShieldCheck, User, Users, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import CompanyAddonsCard from "@/components/master/CompanyAddonsCard";

interface CompanyRow {
  id: string;
  name: string;
  plan_tier?: string | null;
  created_at?: string | null;
  document_type?: string | null;     // 'CPF' ou 'CNPJ'
  document?: string | null;          // Valor do CPF/CNPJ
  owner_user_id?: string | null;     // FK pra profile dono
  onboarding_completed?: boolean | null;
  asaas_customer_id?: string | null; // Opcional — só existe se a SQL extra foi rodada
}
interface CompanyMemberRow {
  id: string;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;           // Profiles tem whatsapp, não phone
  role: string | null;               // Vem de user_roles (não de profiles)
  created_at: string | null;
}
interface SubscriptionRow {
  id: string;
  company_id: string;
  plan_id?: string | null;
  status?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: string | null;
  suspended_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
}
interface InvoiceRow {
  id: string;
  company_id: string;
  amount_cents?: number | null;
  status?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  payment_link?: string | null;
}
interface EventRow {
  id: string;
  company_id: string;
  action?: string | null;
  old_value?: any;
  new_value?: any;
  created_at?: string | null;
  notes?: string | null;
}
interface SummaryRow {
  company_id: string;
  company_name: string;
  plan_code?: string | null;
  plan_name?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  users_count?: number | null;
  instances_count?: number | null;
  max_users?: number | null;
  max_instances?: number | null;
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

// Limites por plano espelhando src/pages/Settings/PlansSettings.tsx (PLAN_DETAILS).
// null = ilimitado.
const PLAN_LIMITS: Record<string, { maxUsers: number | null; maxInstances: number | null }> = {
  starter: { maxUsers: 2, maxInstances: 1 },
  pro: { maxUsers: 2, maxInstances: 2 },
  scale: { maxUsers: 7, maxInstances: 5 },
  elite: { maxUsers: null, maxInstances: null },
};
function planLimitsFor(code?: string | null) {
  const key = String(code || "").toLowerCase();
  return PLAN_LIMITS[key] || { maxUsers: null, maxInstances: null };
}
function renderLimit(raw: number | null | undefined, isUnlimitedPlan: boolean) {
  if (typeof raw === "number") return String(raw);
  if (isUnlimitedPlan) return "∞";
  return "—";
}

function statusLabelBR(status?: string | null): string {
  const s = String(status || "").trim().toLowerCase();
  switch (s) {
    case "active": return "Ativo";
    case "trialing": return "Trial";
    case "past_due": return "Em atraso";
    case "unpaid": return "Não pago";
    case "canceled": return "Cancelado";
    case "suspended": return "Suspenso";
    case "expired": return "Expirado";
    case "": return "Sem assinatura";
    default: return status || "—";
  }
}

export default function MasterBillingCompany() {
  const { companyId = "" } = useParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [planDraft, setPlanDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("active");
  const [periodEndDraft, setPeriodEndDraft] = useState("");
  const [billingPlans, setBillingPlans] = useState<{ id: string; code: string; name: string }[]>([]);
  const [members, setMembers] = useState<CompanyMemberRow[]>([]);
  const [adminMember, setAdminMember] = useState<CompanyMemberRow | null>(null);

  async function loadData() {
    if (!companyId) return;
    setLoading(true);

    // Carregar planos disponíveis
    const { data: plans } = await supabase.from("billing_plans").select("id, code, name, price_cents").order("price_cents");
    if (plans) setBillingPlans(plans as any);

    // Usa select("*") em companies/profiles porque nem todo banco tem as mesmas colunas
    // (cnpj, document, email, phone, asaas_customer_id podem não existir).
    const [companyRes, summaryRes, subscriptionRes, invoicesRes, eventsRes, usersCountRes, instancesCountRes, membersRes, rolesRes] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).single(),
      supabase.from("v_company_billing_summary" as any).select("company_id,company_name,plan_code,plan_name,subscription_status,current_period_end,trial_ends_at,users_count,instances_count,max_users,max_instances,monthly_amount_cents").eq("company_id", companyId).maybeSingle(),
      supabase.from("company_subscriptions" as any).select("id,company_id,plan_id,status,current_period_start,current_period_end,trial_ends_at,cancel_at_period_end,canceled_at,suspended_at,notes,created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("billing_invoices" as any).select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
      supabase.from("billing_events" as any).select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      supabase.from("instancias").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      supabase.from("profiles").select("*").eq("company_id", companyId).order("created_at", { ascending: true }),
      supabase.from("user_roles").select("user_id,role"),
    ]);

    if (companyRes.error) {
      toast({ title: "Erro ao carregar empresa", description: companyRes.error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    setCompany(companyRes.data as any);

    const sub = (subscriptionRes.data as any) || null;
    const viewSummary = (summaryRes.data as any) || null;
    const latestInvoice = ((invoicesRes.data as any[]) || [])[0] || null;

    const planCodeResolved = String(
      viewSummary?.plan_code
        || (plans as any[] | null)?.find((p) => p.id === sub?.plan_id)?.code
        || (plans as any[] | null)?.find((p) => p.id === (companyRes.data as any)?.plan_tier)?.code
        || (companyRes.data as any)?.plan_tier
        || ""
    );
    const planFromMap = (plans as any[] | null)?.find(
      (p) => String(p.code || "").toLowerCase() === planCodeResolved.toLowerCase()
    );
    const planLimits = planLimitsFor(planCodeResolved);

    // Status e trial — com fallback baseado em created_at quando não tem company_subscriptions
    let resolvedStatus = viewSummary?.subscription_status ?? sub?.status ?? null;
    let resolvedTrialEnd = viewSummary?.trial_ends_at ?? sub?.trial_ends_at ?? null;
    let resolvedPeriodEnd = viewSummary?.current_period_end ?? sub?.current_period_end ?? latestInvoice?.due_date ?? null;

    if (!resolvedStatus && !resolvedTrialEnd && (companyRes.data as any)?.created_at) {
      const createdAt = new Date((companyRes.data as any).created_at);
      if (!Number.isNaN(createdAt.getTime())) {
        const TRIAL_DAYS = 30;
        const calcEnd = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        resolvedTrialEnd = calcEnd.toISOString();
        resolvedStatus = calcEnd.getTime() > Date.now() ? "trialing" : "expired";
        if (!resolvedPeriodEnd) resolvedPeriodEnd = resolvedTrialEnd;
      }
    }

    const enrichedSummary: SummaryRow = {
      company_id: (companyRes.data as any).id,
      company_name: viewSummary?.company_name ?? (companyRes.data as any).name,
      plan_code: viewSummary?.plan_code ?? planCodeResolved ?? null,
      plan_name: viewSummary?.plan_name ?? planFromMap?.name ?? (companyRes.data as any)?.plan_tier ?? null,
      subscription_status: resolvedStatus,
      current_period_end: resolvedPeriodEnd,
      trial_ends_at: resolvedTrialEnd,
      users_count: viewSummary?.users_count ?? (usersCountRes as any)?.count ?? 0,
      instances_count: viewSummary?.instances_count ?? (instancesCountRes as any)?.count ?? 0,
      max_users: viewSummary?.max_users ?? planLimits.maxUsers,
      max_instances: viewSummary?.max_instances ?? planLimits.maxInstances,
      monthly_amount_cents: viewSummary?.monthly_amount_cents ?? planFromMap?.price_cents ?? null,
    };

    setSummary(enrichedSummary);
    setSubscription(sub as SubscriptionRow | null);
    setInvoices((invoicesRes.data || []) as InvoiceRow[]);
    setEvents((eventsRes.data || []) as EventRow[]);

    // Processa membros e identifica administrador
    // Pega role de cada user em user_roles (1 role por user — PK é user_id)
    const allMembers = ((membersRes.data || []) as CompanyMemberRow[]);
    const rolesByUser = new Map<string, string>();
    ((rolesRes.data || []) as any[]).forEach((r) => {
      if (r?.user_id && r?.role) rolesByUser.set(r.user_id, r.role);
    });
    const enrichedMembers = allMembers.map((m) => ({
      ...m,
      role: rolesByUser.get(m.id) || null,
    }));
    setMembers(enrichedMembers);

    // Admin: 1) owner_user_id da empresa, 2) primeiro com role 'admin', 3) primeiro membro
    const ownerId = (companyRes.data as any)?.owner_user_id;
    const admin =
      (ownerId && enrichedMembers.find((m) => m.id === ownerId)) ||
      enrichedMembers.find((m) => m.role === "admin" || m.role === "super_admin") ||
      enrichedMembers[0] ||
      null;
    setAdminMember(admin);

    const planValue = String(sub?.plan_id || viewSummary?.plan_code || (companyRes.data as any)?.plan_tier || "elite");
    const statusValue = String(sub?.status || viewSummary?.subscription_status || "active");
    const periodEndValue = String(sub?.current_period_end || viewSummary?.current_period_end || "");

    setPlanDraft(planValue);
    setStatusDraft(statusValue);
    setPeriodEndDraft(periodEndValue ? periodEndValue.slice(0, 10) : "");
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, [companyId]);

  const usageCards = useMemo(() => {
    const code = summary?.plan_code;
    const limits = planLimitsFor(code);
    const isUnlimited = limits.maxUsers === null && limits.maxInstances === null && String(code || "").toLowerCase() === "elite";
    return [
      { label: "Usuários", current: summary?.users_count, maxDisplay: renderLimit(summary?.max_users, isUnlimited), icon: Users },
      { label: "Instâncias", current: summary?.instances_count, maxDisplay: renderLimit(summary?.max_instances, isUnlimited), icon: WalletCards },
    ];
  }, [summary]);

  async function saveSubscriptionChanges() {
    if (!companyId) return;
    setSaving(true);

    const payload = {
      company_id: companyId,
      plan_id: planDraft,
      status: statusDraft,
      current_period_end: periodEndDraft ? new Date(`${periodEndDraft}T12:00:00`).toISOString() : null,
    };

    const { error: subscriptionError } = await supabase.from("company_subscriptions" as any).upsert(payload as any, { onConflict: "company_id" });
    if (subscriptionError) {
      toast({ title: "Erro ao salvar assinatura", description: subscriptionError.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    const { error: companyError } = await supabase.from("companies").update({ plan_tier: planDraft } as any).eq("id", companyId);
    if (companyError) {
      toast({ title: "Assinatura salva, mas companies.plan_tier falhou", description: companyError.message, variant: "destructive" });
    }

    await supabase.from("billing_events" as any).insert({
      company_id: companyId,
      action: "subscription_manual_update",
      new_value: payload,
      notes: "Alteração manual via painel master",
    } as any);

    toast({ title: "Assinatura atualizada", description: "Os dados comerciais da empresa foram salvos." });
    setSaving(false);
    await loadData();
  }

  async function markLatestInvoicePaid() {
    const latestInvoice = invoices[0];
    if (!latestInvoice) return;
    setSaving(true);
    const { error } = await supabase.from("billing_invoices" as any).update({ status: "paid", paid_at: new Date().toISOString() } as any).eq("id", latestInvoice.id);
    if (error) {
      toast({ title: "Erro ao marcar fatura", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    await supabase.from("billing_events" as any).insert({ company_id: companyId, action: "invoice_marked_paid", new_value: { invoice_id: latestInvoice.id }, notes: "Fatura marcada como paga manualmente" } as any);
    toast({ title: "Fatura marcada como paga" });
    setSaving(false);
    await loadData();
  }

  async function suspendCompany() {
    if (!subscription?.id && !companyId) return;
    setSaving(true);
    const { error } = await supabase.from("company_subscriptions" as any).upsert({ company_id: companyId, plan_id: planDraft, status: "suspended", suspended_at: new Date().toISOString() } as any, { onConflict: "company_id" });
    if (error) {
      toast({ title: "Erro ao suspender", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    await supabase.from("billing_events" as any).insert({ company_id: companyId, action: "subscription_suspended", notes: "Suspensão manual via painel master" } as any);
    toast({ title: "Empresa suspensa" });
    setSaving(false);
    await loadData();
  }

  async function reactivateCompany() {
    setSaving(true);
    const { error } = await supabase.from("company_subscriptions" as any).upsert({ company_id: companyId, plan_id: planDraft, status: "active", suspended_at: null } as any, { onConflict: "company_id" });
    if (error) {
      toast({ title: "Erro ao reativar", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    await supabase.from("billing_events" as any).insert({ company_id: companyId, action: "subscription_reactivated", notes: "Reativação manual via painel master" } as any);
    toast({ title: "Empresa reativada" });
    setSaving(false);
    await loadData();
  }

  async function extendTrial() {
    if (!confirm("Estender o trial em +7 dias?")) return;
    setSaving(true);
    const currentEnd = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) : new Date();
    const newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()));
    newEnd.setDate(newEnd.getDate() + 7);

    const { error } = await supabase.from("company_subscriptions" as any).upsert({
      company_id: companyId, plan_id: planDraft, status: "trialing",
      trial_ends_at: newEnd.toISOString(), current_period_end: newEnd.toISOString(), suspended_at: null
    } as any, { onConflict: "company_id" });

    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); setSaving(false); return; }
    await supabase.from("billing_events" as any).insert({ company_id: companyId, action: "trial_extended", new_value: newEnd.toISOString(), notes: "Trial estendido +7 dias via painel master" } as any);
    toast({ title: "Trial estendido", description: `Novo vencimento: ${newEnd.toLocaleDateString("pt-BR")}` });
    setSaving(false);
    await loadData();
  }

  async function removeUnlimitedAccess() {
    if (!confirm("Remover acesso ilimitado? A empresa voltará ao trial de 30 dias.")) return;
    setSaving(true);
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 30);

    const { error } = await supabase.from("company_subscriptions" as any).upsert({
      company_id: companyId, plan_id: planDraft, status: "trialing",
      current_period_end: trialEnd.toISOString(), trial_ends_at: trialEnd.toISOString(), suspended_at: null
    } as any, { onConflict: "company_id" });

    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); setSaving(false); return; }
    await supabase.from("billing_events" as any).insert({ company_id: companyId, action: "unlimited_access_removed", notes: "Acesso ilimitado removido via painel master. Voltou ao trial de 30 dias." } as any);
    toast({ title: "Acesso ilimitado removido", description: "A empresa agora tem trial de 30 dias." });
    setSaving(false);
    await loadData();
  }

  async function sendTrialNotificationManually(milestone?: string) {
    if (!companyId) return;
    if (!confirm(`Enviar email de aviso de trial${milestone ? ` (marco: ${milestone})` : ""} pra ${company?.name}?\n\nEle vai pro email do administrador.`)) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const sb: any = supabase as any;
      const supabaseUrl: string = sb.supabaseUrl || sb.restUrl?.replace(/\/rest\/v1\/?$/, "") || "";
      const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/trial-expiry-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ company_id: companyId, force: true, milestone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        toast({ title: "Falha ao enviar", description: body?.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const r = (body.results || [])[0];
      if (r?.sent) {
        toast({ title: "Aviso enviado!", description: `Email enviado pra ${r.email} (marco ${r.milestone}).` });
      } else if (r?.error) {
        toast({ title: "Não foi possível enviar", description: r.error, variant: "destructive" });
      } else if (r?.reason) {
        toast({ title: "Pulado", description: r.reason });
      } else {
        toast({ title: "Sem ação", description: "Empresa não está em trial ou não atingiu nenhum marco." });
      }
      await loadData();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function grantUnlimitedAccess() {
    if (!confirm("Conceder acesso ilimitado (sem cobrança) para esta empresa?")) return;
    setSaving(true);
    const { error } = await supabase.from("company_subscriptions" as any).upsert({
      company_id: companyId, plan_id: planDraft, status: "active",
      current_period_end: null, trial_ends_at: null, suspended_at: null
    } as any, { onConflict: "company_id" });

    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); setSaving(false); return; }
    await supabase.from("billing_events" as any).insert({ company_id: companyId, action: "unlimited_access_granted", notes: "Acesso ilimitado concedido via painel master" } as any);
    toast({ title: "Acesso ilimitado concedido", description: "A empresa agora tem acesso sem prazo de validade." });
    setSaving(false);
    await loadData();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm"><Link to="/master/empresas"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Link></Button>
        <Button variant="outline" size="sm" onClick={() => void loadData()}><RefreshCcw className="mr-2 h-4 w-4" /> Atualizar</Button>
      </div>

      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Empresa</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">{company?.name || "Carregando empresa..."}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Gerencie assinatura, vencimento, faturas e histórico comercial desta conta.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-300" /> Plano</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{summary?.plan_name || company?.plan_tier || "—"}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-300" /> Status</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{statusLabelBR(subscription?.status || summary?.subscription_status)}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4 text-blue-300" /> Próximo vencimento</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{(() => { const d = subscription?.current_period_end || summary?.current_period_end; const s = String(subscription?.status || summary?.subscription_status || "").toLowerCase(); if (d) return formatDate(d); if (s === "active") return "Ilimitado"; return "—"; })()}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4 text-blue-300" /> Mensalidade</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{summary?.monthly_amount_cents ? formatMoney(summary.monthly_amount_cents) : "—"}</p></CardContent></Card>
      </div>

      {/* ADD-ONS */}
      <CompanyAddonsCard companyId={companyId} />

      {/* DADOS DA EMPRESA + ADMINISTRADOR */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-300" /> Dados da empresa</CardTitle>
            <CardDescription className="text-slate-400">Informações cadastrais e identificadores externos.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Nome</dt>
                <dd className="font-medium text-slate-100 break-words">{company?.name || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Cadastrada em</dt>
                <dd className="font-medium text-slate-100">{formatDate(company?.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{company?.document_type || "Documento"}</dt>
                <dd className="font-mono text-slate-100">{company?.document || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Plano</dt>
                <dd className="font-medium text-slate-100 capitalize">{company?.plan_tier || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Onboarding</dt>
                <dd className="font-medium">
                  {company?.onboarding_completed ? (
                    <span className="text-emerald-400">✓ Concluído</span>
                  ) : (
                    <span className="text-amber-400">⏳ Pendente</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Total de usuários</dt>
                <dd className="font-medium text-slate-100">{members.length}</dd>
              </div>
              {(company as any)?.asaas_customer_id ? (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Asaas Customer ID</dt>
                  <dd className="font-mono text-xs text-slate-300 break-all">{(company as any).asaas_customer_id}</dd>
                </div>
              ) : null}
            </dl>

            {/* Trial em destaque */}
            {(() => {
              const trialEnd = subscription?.trial_ends_at || summary?.trial_ends_at;
              const status = String(subscription?.status || summary?.subscription_status || "").toLowerCase();
              if (!trialEnd || (status !== "trialing" && status !== "expired")) return null;
              const endDate = new Date(trialEnd);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const diffMs = endDate.getTime() - today.getTime();
              const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              const expired = daysLeft < 0;
              const tone = expired ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : daysLeft <= 7 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-sky-500/40 bg-sky-500/10 text-sky-300";
              return (
                <div className={`mt-4 rounded-lg border p-3 text-sm flex items-center justify-between ${tone}`}>
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" />
                    <span className="font-medium">{expired ? "Trial expirado" : "Em período de trial"}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatDate(trialEnd)}</div>
                    <div className="text-xs opacity-80">
                      {expired ? `Há ${Math.abs(daysLeft)} dia${Math.abs(daysLeft) === 1 ? "" : "s"}` : `Faltam ${daysLeft} dia${daysLeft === 1 ? "" : "s"}`}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Disparar aviso de trial manualmente */}
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Send className="h-4 w-4 text-blue-300" />
                <span className="text-sm font-medium text-slate-200">Aviso de trial</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Envia email pro administrador da empresa avisando sobre o vencimento. Útil pra testar ou reenviar manualmente.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void sendTrialNotificationManually()} disabled={saving}>
                  Auto (marco do dia)
                </Button>
                <Button size="sm" variant="outline" onClick={() => void sendTrialNotificationManually("7d")} disabled={saving}>
                  Forçar 7 dias
                </Button>
                <Button size="sm" variant="outline" onClick={() => void sendTrialNotificationManually("3d")} disabled={saving}>
                  Forçar 3 dias
                </Button>
                <Button size="sm" variant="outline" onClick={() => void sendTrialNotificationManually("1d")} disabled={saving}>
                  Forçar último dia
                </Button>
                <Button size="sm" variant="outline" onClick={() => void sendTrialNotificationManually("0d")} disabled={saving}>
                  Forçar expirado
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="h-4 w-4 text-blue-300" /> Administrador da conta</CardTitle>
            <CardDescription className="text-slate-400">Contato principal da empresa no CRM.</CardDescription>
          </CardHeader>
          <CardContent>
            {adminMember ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/20 text-blue-200 text-base font-bold shrink-0">
                    {(adminMember.nome || adminMember.email || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-white truncate">{adminMember.nome || "Sem nome"}</div>
                    <div className="text-xs text-slate-400">
                      <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-200 text-[10px]">
                        {adminMember.role === "super_admin" ? "Super Admin" : adminMember.role === "admin" ? "Admin" : adminMember.role || "Usuário"}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="break-all">{adminMember.email || "Sem email"}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                    <span>{adminMember.whatsapp ? `${adminMember.whatsapp} (WhatsApp)` : "Sem WhatsApp cadastrado"}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    Cadastrado em: {formatDate(adminMember.created_at)}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Nenhum usuário cadastrado para esta empresa ainda.</p>
            )}

            {/* Lista resumida dos outros membros */}
            {members.length > 1 && (
              <div className="mt-5 border-t border-slate-800 pt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Outros membros ({members.length - 1})
                </div>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2">
                  {members.filter((m) => m.id !== adminMember?.id).map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm rounded-md border border-slate-800/50 bg-slate-950/30 px-3 py-1.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold shrink-0">
                        {(m.nome || m.email || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-slate-200 text-xs">{m.nome || m.email || "—"}</div>
                        <div className="text-[10px] text-slate-500 truncate">{m.email || "—"}{m.whatsapp ? ` · ${m.whatsapp}` : ""}</div>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">{m.role || "user"}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-blue-300" /> Assinatura</CardTitle>
            <CardDescription className="text-slate-400">Edite manualmente o plano e o status operacional da conta.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Plano</label>
                <select className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm" value={planDraft} onChange={(e) => setPlanDraft(e.target.value)}>
                  {billingPlans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <select className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
                  <option value="trialing">Trial</option>
                  <option value="active">Ativo</option>
                  <option value="past_due">Em atraso</option>
                  <option value="unpaid">Não pago</option>
                  <option value="canceled">Cancelado</option>
                  <option value="suspended">Suspenso</option>
                  <option value="expired">Expirado</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Fim do período</label>
                <Input type="date" value={periodEndDraft} onChange={(e) => setPeriodEndDraft(e.target.value)} className="border-slate-700 bg-slate-950" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveSubscriptionChanges()} disabled={saving || loading}>Salvar assinatura</Button>
              <Button variant="outline" onClick={() => void markLatestInvoicePaid()} disabled={saving || !invoices.length}>Marcar última fatura como paga</Button>
              <Button variant="outline" onClick={() => void extendTrial()} disabled={saving}>+7 dias trial</Button>
              {subscription?.status === "active" && !subscription?.current_period_end ? (
                <Button variant="outline" className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10" onClick={() => void removeUnlimitedAccess()} disabled={saving}>Remover ilimitado</Button>
              ) : (
                <Button variant="outline" className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10" onClick={() => void grantUnlimitedAccess()} disabled={saving}>Acesso ilimitado</Button>
              )}
              {subscription?.status === "suspended" ? (
                <Button variant="outline" className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10" onClick={() => void reactivateCompany()} disabled={saving}>Reativar empresa</Button>
              ) : (
                <Button variant="destructive" onClick={() => void suspendCompany()} disabled={saving}>Suspender empresa</Button>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
              <p><strong className="text-slate-200">Observação:</strong> este fluxo usa update manual para operação inicial do billing. Depois você pode conectar o mesmo painel ao gateway e deixar essas ações automatizadas.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-blue-300" /> Consumo e limites</CardTitle>
            <CardDescription className="text-slate-400">Resumo vindo da view de billing.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            {usageCards.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex items-center gap-2 text-slate-300"><Icon className="h-4 w-4 text-blue-300" /> {item.label}</div>
                  <p className="mt-2 text-3xl font-semibold text-white">{item.current ?? "—"}<span className="text-lg text-slate-500"> / {item.maxDisplay}</span></p>
                </div>
              );
            })}
            {(() => {
              const trialEnd = subscription?.trial_ends_at || summary?.trial_ends_at;
              const isTrialing = String(subscription?.status || summary?.subscription_status || "").toLowerCase() === "trialing";
              if (!trialEnd && !isTrialing) {
                return (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                    <p className="text-sm text-slate-300">Trial</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-500">Sem trial ativo</p>
                  </div>
                );
              }
              const endDate = trialEnd ? new Date(trialEnd) : null;
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const diffMs = endDate ? endDate.getTime() - today.getTime() : 0;
              const daysLeft = endDate ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : null;
              const expired = daysLeft !== null && daysLeft < 0;
              return (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-sm text-slate-300">Trial até</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatDate(trialEnd)}</p>
                  {daysLeft !== null && (
                    <p className={`mt-1 text-sm ${expired ? "text-rose-400" : daysLeft <= 7 ? "text-amber-400" : "text-slate-400"}`}>
                      {expired ? `Expirado há ${Math.abs(daysLeft)} dia${Math.abs(daysLeft) === 1 ? "" : "s"}` : `Restam ${daysLeft} dia${daysLeft === 1 ? "" : "s"}`}
                    </p>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-blue-300" /> Histórico de faturas</CardTitle>
            <CardDescription className="text-slate-400">Últimas 50 cobranças desta empresa.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[460px] pr-3">
              <div className="space-y-3">
                {loading ? <p className="text-sm text-slate-400">Carregando faturas...</p> : null}
                {!loading && !invoices.length ? <p className="text-sm text-slate-400">Nenhuma fatura encontrada.</p> : null}
                {invoices.map((invoice) => (
                  <div key={invoice.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{formatMoney(invoice.amount_cents)}</p>
                        <p className="text-xs text-slate-500">invoice_id: {invoice.id}</p>
                      </div>
                      <Badge variant="outline">{invoice.status || "—"}</Badge>
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-slate-400">
                      <p>Vencimento: {formatDate(invoice.due_date)}</p>
                      <p>Pagamento: {formatDate(invoice.paid_at, true)}</p>
                      <p>Criação: {formatDate(invoice.created_at, true)}</p>
                    </div>
                    {invoice.payment_link ? (
                      <div className="mt-3"><Button asChild size="sm" variant="outline"><a href={invoice.payment_link} target="_blank" rel="noreferrer">Abrir cobrança</a></Button></div>
                    ) : null}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-blue-300" /> Auditoria</CardTitle>
            <CardDescription className="text-slate-400">Eventos comerciais registrados no painel master.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[460px] pr-3">
              <div className="space-y-3">
                {loading ? <p className="text-sm text-slate-400">Carregando eventos...</p> : null}
                {!loading && !events.length ? <p className="text-sm text-slate-400">Nenhum evento encontrado.</p> : null}
                {events.map((event) => (
                  <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-white">{event.action || "evento"}</p>
                      <Badge variant="secondary">{formatDate(event.created_at, true)}</Badge>
                    </div>
                    {event.notes ? <p className="mt-2 text-sm text-slate-300">{event.notes}</p> : null}
                    {event.new_value ? <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(event.new_value, null, 2)}</pre> : null}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
