import { useEffect } from "react";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_PREFIX = "trial-expiry-notified:";

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Dispara notificação no sino ao carregar o app quando faltam <= 7 dias
// (trial ou assinatura) — no máximo 1 vez por dia por usuário.
export function useTrialExpiryNotification() {
  const { user } = useAuth();
  const { loading, showWarning, isTrial, daysLeft } = useSubscription();

  useEffect(() => {
    if (loading || !showWarning || daysLeft === null || !user?.id) return;

    const storageKey = `${STORAGE_PREFIX}${user.id}:${todayKey()}`;
    try {
      if (localStorage.getItem(storageKey)) return;
    } catch {
      // sem localStorage disponível — continua mas pode duplicar na sessão
    }

    const label = isTrial ? "Período de teste" : "Assinatura";
    const noun = daysLeft === 1 ? "dia" : "dias";
    const title = isTrial
      ? `Seu teste expira em ${daysLeft} ${noun}`
      : `Sua assinatura expira em ${daysLeft} ${noun}`;
    const description = `${label} termina em breve. Assine um plano para não perder o acesso.`;

    window.dispatchEvent(
      new CustomEvent("crm-notification", {
        detail: {
          type: "system",
          title,
          description,
          action: { label: "Ver planos", href: "/settings" },
        },
      }),
    );

    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
  }, [loading, showWarning, isTrial, daysLeft, user?.id]);
}
