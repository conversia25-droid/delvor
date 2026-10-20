import { useEffect, useState } from "react";
import {
  fetchReceivablesOverview,
  RECEIVABLES_CHANGED,
  type ReceivablesOverview,
} from "@/lib/receivables";

/**
 * Resumo de contas a receber (vencidos, a vencer, recebido no mês).
 * Recarrega a cada 5 min, ao voltar pra aba e logo depois de uma baixa.
 * `enabled=false` não consulta (quem não tem acesso ao financeiro).
 */
export function useReceivablesOverview(enabled: boolean) {
  const [data, setData] = useState<ReceivablesOverview | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let alive = true;
    const load = async () => {
      const r = await fetchReceivablesOverview();
      if (alive) setData(r);
    };
    load();
    const timer = window.setInterval(load, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener(RECEIVABLES_CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(RECEIVABLES_CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return data;
}
