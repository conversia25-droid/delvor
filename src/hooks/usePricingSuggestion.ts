import { useCallback, useEffect, useState } from "react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import {
  priceFor, fixedLoad, hasFixedLoad,
  type PricingMode, type PricingParams,
} from "@/lib/pricing";

/**
 * Mesma conta da tela /financeiro/precificacao (ver src/lib/pricing.ts),
 * pra usar em formulários: digitou o custo → mostra o preço sugerido.
 * Só fica `available` com o add-on Financeiro ativo.
 */
export interface PricingSuggestion {
  mode: PricingMode;
  rateio: number;
  breakEven: number;
  suggested: number;
  marginPct: number;
  /** % do preço que vai pras fixas (só modo meta) */
  fixedPct: number;
  /** as fixas estão entrando na conta (tem volume ou meta) */
  hasFixedLoad: boolean;
  valid: boolean;
}

interface State {
  loading: boolean;
  addonActive: boolean;
  available: boolean;
  params: PricingParams;
}

const DEFAULT_PARAMS: PricingParams = {
  mode: "auto", targetMarginPct: 30, fixedMonthly: 0, monthlyVolume: 0, monthlyRevenueTarget: 0,
};
const INITIAL: State = { loading: true, addonActive: false, available: false, params: DEFAULT_PARAMS };

export function usePricingSuggestion() {
  const { user } = useAuth();
  const addon = useAddon("financeiro");
  const companyId = user?.company_id ?? null;
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    if (addon.loading) return;
    if (!addon.active || !companyId) {
      setState({ ...INITIAL, loading: false, addonActive: addon.active });
      return;
    }
    let cancelled = false;
    (async () => {
      const [setRes, fixRes] = await Promise.all([
        supabase.from("financial_settings")
          .select("*")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase.from("fixed_expenses")
          .select("amount_cents")
          .eq("company_id", companyId)
          .eq("active", true),
      ]);
      const s = setRes.data ?? {
        target_margin_pct: 30, volume_mode: "auto", volume_window_days: 30,
        manual_monthly_volume: 0, fixed_cost_share_pct: 100, monthly_revenue_target_cents: 0,
      };
      const mode = (s.volume_mode as PricingMode) || "auto";
      const windowDays = Number(s.volume_window_days) || 30;
      const fixedTotal = ((fixRes.data as any[]) ?? [])
        .reduce((a, r) => a + Number(r.amount_cents || 0), 0) / 100;

      let monthlyVolume = 0;
      if (mode === "manual") {
        monthlyVolume = Number(s.manual_monthly_volume) || 0;
      } else if (mode === "auto") {
        const { data } = await supabase.rpc("get_product_sales_volume", { p_days: windowDays });
        const total = ((data as any[]) ?? []).reduce((a, r) => a + (Number(r.qty_sold) || 0), 0);
        monthlyVolume = total / (windowDays / 30);
      }

      if (cancelled) return;
      setState({
        loading: false, addonActive: true, available: true,
        params: {
          mode,
          targetMarginPct: Number(s.target_margin_pct) || 0,
          fixedMonthly: fixedTotal * (Number(s.fixed_cost_share_pct) / 100),
          monthlyVolume,
          monthlyRevenueTarget: (Number(s.monthly_revenue_target_cents) || 0) / 100,
        },
      });
    })().catch(() => {
      if (!cancelled) setState({ ...INITIAL, loading: false, addonActive: true });
    });
    return () => { cancelled = true; };
  }, [addon.loading, addon.active, companyId]);

  const suggest = useCallback((cost: number): PricingSuggestion | null => {
    if (!state.available || !(cost > 0)) return null;
    const r = priceFor(cost, state.params);
    return {
      mode: state.params.mode,
      rateio: r.rateio, breakEven: r.breakEven, suggested: r.suggested, valid: r.valid,
      marginPct: state.params.targetMarginPct,
      fixedPct: fixedLoad(state.params).pct * 100,
      hasFixedLoad: hasFixedLoad(state.params),
    };
  }, [state]);

  return { loading: state.loading, addonActive: state.addonActive, available: state.available, suggest };
}
