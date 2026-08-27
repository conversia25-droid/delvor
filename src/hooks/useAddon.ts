import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AddonCode = "financeiro";

interface AddonState {
  active: boolean;
  loading: boolean;
  monthlyPriceCents: number;
  activatedAt: string | null;
}

const INITIAL: AddonState = {
  active: false,
  loading: true,
  monthlyPriceCents: 0,
  activatedAt: null,
};

/**
 * Consulta company_addons pra saber se um add-on está ativo pra empresa
 * do usuário logado.
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
      const { data, error } = await supabase
        .from("company_addons")
        .select("active, monthly_price_cents, activated_at")
        .eq("company_id", companyId)
        .eq("addon_code", code)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setState({ ...INITIAL, loading: false });
        return;
      }

      setState({
        active: !!data.active,
        loading: false,
        monthlyPriceCents: data.monthly_price_cents ?? 0,
        activatedAt: data.activated_at ?? null,
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
