import { useEffect, useState } from "react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { planIncludesAddon, type AddonCode } from "@/lib/addons";

export type { AddonCode };

interface AddonState {
  active: boolean;
  loading: boolean;
  monthlyPriceCents: number;
  activatedAt: string | null;
  /** ativo porque o plano da empresa já inclui (sem cobrança separada) */
  includedInPlan: boolean;
  planCode: string | null;
}

const INITIAL: AddonState = {
  active: false,
  loading: true,
  monthlyPriceCents: 0,
  activatedAt: null,
  includedInPlan: false,
  planCode: null,
};

/**
 * Diz se um add-on está ativo pra empresa do usuário logado.
 * Ativo = contratado em company_addons OU incluso no plano (src/lib/addons.ts).
 *
 * Uso na UI:
 *   const { active, loading } = useAddon("financeiro");
 *   if (loading) return <Spinner />;
 *   if (!active) return <AddonUpsell code="financeiro" />;
 */
export function useAddon(code: AddonCode): AddonState {
  const { user } = useAuth();
  const companyId = user?.company_id ?? null;
  const [state, setState] = useState<AddonState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!companyId) {
        setState({ ...INITIAL, loading: false });
        return;
      }
      const [addonRes, planRes] = await Promise.all([
        supabase
          .from("company_addons")
          .select("active, monthly_price_cents, activated_at")
          .eq("company_id", companyId)
          .eq("addon_code", code)
          .maybeSingle(),
        supabase
          .from("v_company_billing_summary")
          .select("plan_code")
          .eq("company_id", companyId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const planCode: string | null = (planRes.data as any)?.plan_code ?? null;
      const included = planIncludesAddon(planCode, code);
      const row = (addonRes.error ? null : addonRes.data) as any;

      setState({
        active: included || !!row?.active,
        loading: false,
        monthlyPriceCents: included ? 0 : (row?.monthly_price_cents ?? 0),
        activatedAt: row?.activated_at ?? null,
        includedInPlan: included,
        planCode,
      });
    }

    setState((s) => ({ ...s, loading: true }));
    void load();

    return () => {
      cancelled = true;
    };
  }, [companyId, code]);

  return state;
}
