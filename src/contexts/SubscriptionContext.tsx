import { createContext, useContext, useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type SubscriptionRow = {
  id?: string;
  company_id: string;
  plan_id: string;
  status: string; // trialing, active, past_due, unpaid, canceled, suspended
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
  suspended_at?: string | null;
  notes?: string | null;
};

type SubscriptionContextType = {
  subscription: SubscriptionRow | null;
  loading: boolean;
  /** Sistema está bloqueado (trial expirou, cancelado, suspenso) */
  isBlocked: boolean;
  /** Está no período de trial */
  isTrial: boolean;
  /** Subscription ativa (pagando ou ilimitada) */
  isActive: boolean;
  /** Acesso ilimitado (sem data de fim) — configurado pelo master */
  isUnlimited: boolean;
  /** Dias restantes do trial (ou do período atual) */
  daysLeft: number | null;
  /** Deve mostrar o banner de aviso (faltam <= 7 dias) */
  showWarning: boolean;
  /** Recarregar dados */
  reload: () => void;
};

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  loading: true,
  isBlocked: false,
  isTrial: false,
  isActive: false,
  isUnlimited: false,
  daysLeft: null,
  showWarning: false,
  reload: () => {},
});

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadSubscription() {
    if (!companyId) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("company_subscriptions")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) {
      console.warn("Erro ao carregar subscription:", error.message);
      setSubscription(null);
      setLoading(false);
      return;
    }

    if (!data) {
      // Sem subscription — criar trial de 30 dias no plano Elite (acesso completo)
      const { data: elitePlan } = await supabase
        .from("billing_plans")
        .select("id")
        .eq("code", "elite")
        .single();

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);

      const newSub: any = {
        company_id: companyId,
        plan_id: elitePlan?.id || null,
        status: "trialing",
        trial_ends_at: trialEnd.toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: trialEnd.toISOString(),
      };

      const { data: created } = await supabase
        .from("company_subscriptions")
        .upsert(newSub, { onConflict: "company_id" })
        .select("*")
        .single();

      setSubscription(created as SubscriptionRow || newSub);
      setLoading(false);
      return;
    }

    setSubscription(data as SubscriptionRow);
    setLoading(false);
  }

  useEffect(() => {
    loadSubscription();
  }, [companyId]);

  // Realtime: bloquear/desbloquear instantaneamente
  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`subscription-${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_subscriptions", filter: `company_id=eq.${companyId}` },
        () => {
          loadSubscription();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [companyId]);

  const computed = useMemo(() => {
    if (!subscription) {
      return { isBlocked: false, isTrial: false, isActive: false, isUnlimited: false, daysLeft: null, showWarning: false };
    }

    const status = subscription.status;
    const now = new Date();

    // Acesso ilimitado: status "active" sem data de fim
    const isUnlimited = status === "active" && !subscription.current_period_end;

    if (isUnlimited) {
      return { isBlocked: false, isTrial: false, isActive: true, isUnlimited: true, daysLeft: null, showWarning: false };
    }

    // Status ativo com período
    if (status === "active") {
      const endDate = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
      const daysLeft = endDate ? Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
      const isBlocked = daysLeft !== null && daysLeft < 0;
      const showWarning = daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;

      return { isBlocked, isTrial: false, isActive: !isBlocked, isUnlimited: false, daysLeft, showWarning };
    }

    // Trial
    if (status === "trialing") {
      const trialEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
      const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
      const isBlocked = daysLeft !== null && daysLeft < 0;
      const showWarning = daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;

      return { isBlocked, isTrial: true, isActive: false, isUnlimited: false, daysLeft, showWarning };
    }

    // Suspenso, cancelado, past_due, unpaid
    if (["suspended", "canceled", "unpaid"].includes(status)) {
      return { isBlocked: true, isTrial: false, isActive: false, isUnlimited: false, daysLeft: 0, showWarning: false };
    }

    // past_due — dar um período de graça
    if (status === "past_due") {
      return { isBlocked: false, isTrial: false, isActive: true, isUnlimited: false, daysLeft: null, showWarning: true };
    }

    return { isBlocked: false, isTrial: false, isActive: false, isUnlimited: false, daysLeft: null, showWarning: false };
  }, [subscription]);

  return (
    <SubscriptionContext.Provider
      value={{
        subscription,
        loading,
        ...computed,
        reload: loadSubscription,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
