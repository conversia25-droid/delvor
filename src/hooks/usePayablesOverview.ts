import { useEffect, useState } from "react";
import { fetchPayablesOverview, PAYABLES_CHANGED, type PayablesOverview } from "@/lib/finance";

/**
 * Resumo de contas a pagar (vencidas, vencendo hoje). Recarrega a cada 5 min,
 * ao voltar pra aba e logo depois de um pagamento. Banco sem a migration 60
 * devolve null (o menu simplesmente não mostra contador).
 */
export function usePayablesOverview(enabled: boolean) {
  const [data, setData] = useState<PayablesOverview | null>(null);

  useEffect(() => {
    if (!enabled) { setData(null); return; }
    let alive = true;
    const load = async () => {
      const r = await fetchPayablesOverview();
      if (alive) setData(r.error ? null : r.data);
    };
    load();
    const timer = window.setInterval(load, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener(PAYABLES_CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(PAYABLES_CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return data;
}
