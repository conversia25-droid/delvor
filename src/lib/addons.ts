/**
 * Catálogo de add-ons e o que cada plano já traz incluso.
 *
 * Empresa num plano listado em PLAN_INCLUDED_ADDONS tem o add-on ativo SEM
 * linha em company_addons — o hook useAddon resolve isso na leitura. Trocar
 * o plano no Master liga/desliga na hora; a tela de Cobrança mostra
 * "incluso no plano" em vez de Contratar/Cancelar.
 */
export type AddonCode = "financeiro";

export const PLAN_INCLUDED_ADDONS: Record<string, AddonCode[]> = {
  completo: ["financeiro"],
};

export const PLAN_LABEL: Record<string, string> = {
  trial: "Teste grátis",
  pro: "Profissional",
  completo: "Completo",
};

export function planIncludesAddon(planCode: string | null | undefined, code: AddonCode): boolean {
  if (!planCode) return false;
  return (PLAN_INCLUDED_ADDONS[planCode] ?? []).includes(code);
}

/** Plano que inclui o add-on (pra copy de upsell). */
export function planThatIncludes(code: AddonCode): string | null {
  const entry = Object.entries(PLAN_INCLUDED_ADDONS).find(([, addons]) => addons.includes(code));
  return entry ? entry[0] : null;
}
