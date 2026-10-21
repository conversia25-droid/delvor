import { useEffect, useState, type ReactNode } from "react";
import { CreditCard, Loader2, RefreshCw, FileText, CheckCircle2 } from "lucide-react";
import MyAddonsPanel from "@/components/addons/MyAddonsPanel";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/formatters";

/* ── rótulos de status ── */
const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  trialing:  { label: "Em teste",            cls: "text-sky-700 dark:text-sky-400" },
  active:    { label: "Ativa",               cls: "text-emerald-700 dark:text-emerald-400" },
  past_due:  { label: "Pagamento atrasado",  cls: "text-amber-700 dark:text-amber-400" },
  expired:   { label: "Expirada",            cls: "text-rose-700 dark:text-rose-400" },
  canceled:  { label: "Cancelada",           cls: "text-rose-700 dark:text-rose-400" },
  suspended: { label: "Suspensa",            cls: "text-rose-700 dark:text-rose-400" },
};
const INV_STATUS: Record<string, { label: string; cls: string }> = {
  open:     { label: "Aberta",     cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30" },
  paid:     { label: "Paga",       cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30" },
  overdue:  { label: "Vencida",    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30" },
  refunded: { label: "Estornada",  cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  canceled: { label: "Cancelada",  cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  void:     { label: "Cancelada",  cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("pt-BR");
}

export default function BillingSettings() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [sumRes, invRes, subRes, planRes] = await Promise.all([
        supabase.from("v_company_billing_summary" as any).select("*").eq("company_id", companyId).maybeSingle(),
        supabase.from("billing_invoices" as any).select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50),
        supabase.from("company_subscriptions" as any).select("plan_id").eq("company_id", companyId).maybeSingle(),
        supabase.from("billing_plans" as any).select("id, code, price_cents").neq("code", "trial").order("price_cents", { ascending: true }),
      ]);
      setSummary(sumRes.data || null);
      setInvoices((invRes.data as any[]) || []);
      // plano usado pra gerar cobrança: o da assinatura, ou o primeiro plano pago
      const subPlan = (subRes.data as any)?.plan_id;
      const firstPaid = ((planRes.data as any[]) || [])[0]?.id;
      setPlanId(subPlan || firstPaid || null);
    } catch (e: any) {
      toast({ title: "Erro ao carregar cobrança", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId]);

  async function generateCharge() {
    if (!planId) {
      toast({
        title: "Nenhum plano definido",
        description: "A plataforma ainda não configurou um plano de cobrança. Fale com o suporte.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("asaas-subscribe", {
      body: { plan_id: planId },
    });
    setGenerating(false);

    let payload: any = data || {};
    // Quando a função devolve 4xx/5xx, o motivo real vem no corpo (error.context).
    if (error) {
      try {
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") payload = await ctx.json();
      } catch {
        /* mantém payload genérico */
      }
    }
    if (error || payload?.error) {
      toast({
        title: "Não foi possível gerar a cobrança",
        description: payload?.message || payload?.error || error?.message || "Tente novamente em instantes.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Cobrança gerada!", description: "Abrindo o link de pagamento..." });
    if (payload.payment_link) window.open(payload.payment_link, "_blank", "noopener,noreferrer");
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  const sub = SUB_STATUS[summary?.subscription_status as string] || {
    label: summary?.subscription_status || "Teste grátis",
    cls: "text-sky-700 dark:text-sky-400",
  };
  const valor =
    summary?.monthly_amount_cents != null
      ? formatBRL(Number(summary.monthly_amount_cents) / 100)
      : "—";
  const isTrial = summary?.subscription_status === "trialing" || !summary?.subscription_status;
  const nextDate = summary?.trial_ends_at || summary?.current_period_end;
  const hasPrice =
    summary?.monthly_amount_cents != null && Number(summary.monthly_amount_cents) > 0;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* assinatura */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="h-5 w-5 text-blue-700 dark:text-blue-400" />
          <h2 className="font-semibold">Sua assinatura</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Info label="Plano" value={summary?.plan_name || "—"} />
          <Info label="Mensalidade" value={valor} />
          <Info label="Situação" value={<span className={sub.cls}>{sub.label}</span>} />
          <Info
            label={isTrial ? "Teste até" : "Válido até"}
            value={fmtDate(summary?.trial_ends_at || summary?.current_period_end)}
          />
        </div>

        {/* próxima cobrança — explícito */}
        <div className="mt-4 rounded-md bg-blue-500/10 ring-1 ring-blue-500/30 px-3 py-2.5 text-sm">
          {!hasPrice ? (
            <span className="text-amber-700 dark:text-amber-400">
              O valor da mensalidade ainda não foi definido neste plano — fale com o suporte.
            </span>
          ) : isTrial ? (
            <span>
              Você está em período de teste até <strong>{fmtDate(nextDate)}</strong>. Depois disso,
              a mensalidade do plano <strong>{summary?.plan_name}</strong> será{" "}
              <strong>{valor}/mês</strong>.
            </span>
          ) : (
            <span>
              Próxima cobrança em <strong>{fmtDate(nextDate)}</strong> — <strong>{valor}</strong>.
            </span>
          )}
        </div>

        <div className="mt-4">
          <Button onClick={generateCharge} disabled={generating}>
            {generating
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <CreditCard className="h-4 w-4 mr-2" />}
            Gerar cobrança / Pagar mensalidade
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Gera um boleto ou Pix da mensalidade — você escolhe a forma de pagamento na hora.
          </p>
        </div>
      </div>

      {/* faturas */}
      <div className="rounded-lg border bg-card">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <span className="font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> Boletos e faturas
          </span>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        {invoices.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma fatura gerada ainda.
          </div>
        ) : (
          <div className="divide-y">
            {invoices.map((inv) => {
              const st = INV_STATUS[inv.status as string] || {
                label: inv.status || "—",
                cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
              };
              return (
                <div key={inv.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-mono font-semibold">
                      {formatBRL(Number(inv.amount_cents || 0) / 100)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Vencimento: {fmtDate(inv.due_date)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${st.cls}`}>
                      {st.label}
                    </span>
                    {inv.payment_link && inv.status !== "paid" && (
                      <Button asChild size="sm" variant="outline">
                        <a href={inv.payment_link} target="_blank" rel="noreferrer">Pagar</a>
                      </Button>
                    )}
                    {inv.status === "paid" && <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add-ons — auto-contratação pelo cliente */}
      <MyAddonsPanel />
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium text-sm">{value}</div>
    </div>
  );
}
