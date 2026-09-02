/**
 * Conta de precificação — usada na tela /financeiro/precificacao, no hook
 * usePricingSuggestion e no cadastro de produto. Pura: sem React, sem banco.
 *
 * Dois jeitos de embutir as despesas fixas no preço:
 *
 *  Por UNIDADE (modo "auto" ou "manual"):
 *    fixas ÷ unidades vendidas/mês = R$ fixo por unidade. Bom pra loja
 *    com histórico de vendas.
 *      mínimo   = custo + rateio
 *      sugerido = mínimo ÷ (1 − margem)
 *
 *  Por META DE FATURAMENTO (modo "meta"):
 *    fixas ÷ faturamento-alvo = % de cada venda. Bom pra loja nova, que não
 *    sabe quantas unidades vai vender mas sabe quanto precisa faturar.
 *    É o método clássico de markup (Sebrae).
 *      mínimo   = custo ÷ (1 − %fixas)
 *      sugerido = custo ÷ (1 − %fixas − margem)
 *
 * Margem é sempre SOBRE O PREÇO DE VENDA (lucro ÷ preço):
 * 30% = de cada R$ 100 vendidos, R$ 30 é lucro.
 */
export type PricingMode = "auto" | "manual" | "meta";

export interface PricingParams {
  mode: PricingMode;
  /** 0–99, sobre o preço de venda */
  targetMarginPct: number;
  /** R$/mês de fixas que os produtos precisam absorver (já aplicada a parcela %) */
  fixedMonthly: number;
  /** unidades/mês — usado em "auto" e "manual" */
  monthlyVolume: number;
  /** R$/mês — usado em "meta" */
  monthlyRevenueTarget: number;
}

export interface PricingResult {
  /** R$ de fixas embutido no preço mínimo */
  rateio: number;
  /** preço com margem zero */
  breakEven: number;
  /** preço na margem alvo */
  suggested: number;
  /** false quando %fixas + margem ≥ 100% (modo meta) — a conta não fecha */
  valid: boolean;
}

/** Carga de fixas: R$ por unidade (auto/manual) ou fração do preço (meta). */
export function fixedLoad(p: PricingParams): { perUnit: number; pct: number } {
  if (p.mode === "meta") {
    const pct = p.monthlyRevenueTarget > 0 ? p.fixedMonthly / p.monthlyRevenueTarget : 0;
    return { perUnit: 0, pct: Math.min(pct, 0.99) };
  }
  const perUnit = p.monthlyVolume > 0 ? p.fixedMonthly / p.monthlyVolume : 0;
  return { perUnit, pct: 0 };
}

/** true quando as fixas estão de fato entrando na conta. */
export function hasFixedLoad(p: PricingParams): boolean {
  return p.mode === "meta" ? p.monthlyRevenueTarget > 0 : p.monthlyVolume > 0;
}

export function priceFor(cost: number, p: PricingParams): PricingResult {
  const m = Math.min(Math.max(p.targetMarginPct, 0), 99) / 100;
  const load = fixedLoad(p);
  if (p.mode === "meta") {
    const denomMin = 1 - load.pct;
    const denomSug = 1 - load.pct - m;
    const breakEven = denomMin > 0 ? cost / denomMin : cost;
    const suggested = denomSug > 0 ? cost / denomSug : breakEven;
    return { rateio: breakEven - cost, breakEven, suggested, valid: denomSug > 0 };
  }
  const breakEven = cost + load.perUnit;
  const suggested = 1 - m > 0 ? breakEven / (1 - m) : breakEven;
  return { rateio: load.perUnit, breakEven, suggested, valid: true };
}

/** Margem real (sobre o preço) de um preço praticado. null se preço ≤ 0. */
export function realMarginPct(cost: number, price: number, p: PricingParams): number | null {
  if (!(price > 0)) return null;
  const load = fixedLoad(p);
  const fixedCost = p.mode === "meta" ? price * load.pct : load.perUnit;
  return ((price - cost - fixedCost) / price) * 100;
}
