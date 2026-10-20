// =====================================================================
// Delvor — Configuração dos ramos (verticals)
// Fonte única sobre "o que cada ramo é": rótulo, módulos e terminologia.
// O menu (Sidebar) e futuras telas leem daqui.
// =====================================================================

export type Vertical = 'assistencia_tecnica' | 'auto_escola' | 'deposito_construcao';

export interface VerticalConfig {
  id: Vertical;
  label: string;
  /** Termos que trocam por ramo (ex.: customer → "Aluno"). */
  terms: Record<string, string>;
}

export const VERTICALS: Record<Vertical, VerticalConfig> = {
  assistencia_tecnica: {
    id: 'assistencia_tecnica',
    label: 'Assistência Técnica',
    terms: { customer: 'Cliente', customers: 'Clientes', order: 'OS' },
  },
  auto_escola: {
    id: 'auto_escola',
    label: 'Auto Escola',
    terms: { customer: 'Aluno', customers: 'Alunos', order: 'Matrícula' },
  },
  deposito_construcao: {
    id: 'deposito_construcao',
    label: 'Depósito de Material',
    terms: { customer: 'Cliente', customers: 'Clientes', order: 'Pedido' },
  },
};

export const DEFAULT_VERTICAL: Vertical = 'assistencia_tecnica';

export function getVerticalConfig(v?: string | null): VerticalConfig {
  return VERTICALS[(v as Vertical)] ?? VERTICALS[DEFAULT_VERTICAL];
}
