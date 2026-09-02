import { useCallback, useEffect, useState } from "react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";

/**
 * Mesma conta da tela /financeiro/precificacao, pra usar em formulários
 * (ex.: cadastro de produto): digitou o custo → mostra o preço sugerido.
 *
 *   preço sugerido = (custo + rateio das fixas) ÷ (1 − margem alvo)
 *
 * Só fica `available` com o add-on Financeiro ativo. Se não houver volume
 * de vendas (nem manual), o rateio fica 0 e `hasVolume` = false — a
 * sugestão ainda sai, só sem carregar as fixas.
 */
export interface PricingSuggestion {
  rateio: number;
  breakEven: number;
  suggested: number;
  marginPct: number;
  hasVolume: boolean;
}

interface State {
  loading: boolean;
  addonActive: boolean;
  available: boolean;
  targetMarginPct: number;
  rateio: number;
  hasVolume: boolean;
}

const INITIAL: State = {
  loading: true, addonActive: false, available: false,
  targetMarginPct: 30, rateio: 0, hasVolume: false,
};

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
          .select("target_margin_pct, volume_mode, volume_window_days, manual_monthly_volume, fixed_cost_share_pct")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase.from("fixed_expenses")
          .select("amount_cents")
          .eq("company_id", companyId)
          .eq("active", true),
      ]);
      const s = setRes.data ?? {
        target_margin_pct: 30, volume_mode: "auto", volume_window_days: 30,
        manual_monthly_volume: 0, fixed_cost_share_pct: 100,
      };
      const windowDays = Number(s.volume_window_days) || 30;
      const fixedTotal = ((fixRes.data as any[]) ?? [])
        .reduce((a, r) => a + Number(r.amount_cents || 0), 0) / 100;

      let monthlyVolume = 0;
      if (s.volume_mode === "manual") {
        monthlyVolume = Number(s.manual_monthly_volume) || 0;
      } else {
        const { data } = await supabase.rpc("get_product_sales_volume", { p_days: windowDays });
        const total = ((data as any[]) ?? []).reduce((a, r) => a + (Number(r.qty_sold) || 0), 0);
        monthlyVolume = total / (windowDays / 30);
      }
      const share = fixedTotal * (Number(s.fixed_cost_share_pct) / 100);
      const rateio = monthlyVolume > 0 ? share / monthlyVolume : 0;

      if (cancelled) return;
      setState({
        loading: false, addonActive: true, available: true,
        targetMarginPct: Number(s.target_margin_pct) || 0,
        rateio, hasVolume: monthlyVolume > 0,
      });
    })().catch(() => {
      if (!cancelled) setState({ ...INITIAL, loading: false, addonActive: true });
    });
    return () => { cancelled = true; };
  }, [addon.loading, addon.active, companyId]);

  const suggest = useCallback((cost: number): PricingSuggestion | null => {
    if (!state.available || !(cost > 0)) return null;
    const breakEven = cost + state.rateio;
    const factor = 1 - state.targetMarginPct / 100;
    const suggested = factor > 0 ? breakEven / factor : breakEven;
    return {
      rateio: state.rateio, breakEven, suggested,
      marginPct: state.targetMarginPct, hasVolume: state.hasVolume,
    };
  }, [state]);

  return { ...state, suggest };
}
