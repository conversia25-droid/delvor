/**
 * Página /orcamentos — reaproveita <Sales> em modo "orcamentos".
 * Mesma UI, filtro server-side por status='orcamento', botão "Novo orçamento"
 * e ausência de KPI de "faturadas" (não aplicável).
 */
import Sales from "./Sales";

export default function Orcamentos() {
  return <Sales mode="orcamentos" />;
}
