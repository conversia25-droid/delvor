import { useAuth } from '@/contexts/AuthContext';
import { getVerticalConfig, DEFAULT_VERTICAL, type Vertical } from '@/config/verticals';

/**
 * Ramo da empresa logada + helpers.
 *   const { vertical, t } = useVertical();
 *   t('customers') -> "Alunos" numa auto escola, "Clientes" na assistência.
 */
export function useVertical() {
  const { user } = useAuth();
  const vertical = (user?.vertical as Vertical) || DEFAULT_VERTICAL;
  const cfg = getVerticalConfig(vertical);
  const t = (key: string) => cfg.terms[key] ?? key;
  const isVertical = (v: Vertical) => vertical === v;
  return { vertical, cfg, t, isVertical };
}
