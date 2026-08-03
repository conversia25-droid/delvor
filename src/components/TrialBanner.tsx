import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, Lock, MessageSquare, CreditCard } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

export default function TrialBanner() {
  const { isBlocked, isTrial, showWarning, daysLeft, subscription, loading } = useSubscription();
  const { hasRole, logout } = useAuth();
  const isAdmin = hasRole("admin");

  if (loading) return null;

  // ══════════ TELA DE BLOQUEIO (fullscreen) ══════════
  if (isBlocked) {
    return (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950">
        {/* Background */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-20 w-72 h-72 bg-red-500 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: "2s" }} />
        </div>

        <div className="relative z-10 text-center max-w-md mx-auto px-6">
          <BrandLogo size={3} className="mb-8" />

          <div className="h-20 w-20 rounded-full bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center mx-auto mb-6">
            <Lock className="h-10 w-10 text-red-400" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-3">
            {subscription?.status === "suspended" ? "Conta suspensa" :
             subscription?.status === "canceled" ? "Conta cancelada" :
             isTrial ? "Período de teste encerrado" : "Assinatura expirada"}
          </h1>

          {isAdmin ? (
            <>
              <p className="text-white/50 text-sm mb-8">
                {isTrial
                  ? "Seu período de teste de 30 dias chegou ao fim. Assine um plano para continuar usando o sistema."
                  : "Sua assinatura não está ativa. Renove para continuar usando o sistema."
                }
              </p>

              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => window.location.href = "/settings"}
                  className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-lg"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Ver planos e assinar
                </Button>

                <Button
                  variant="outline"
                  onClick={() => window.open("https://wa.me/5531912844900?text=Olá! Preciso de ajuda com minha assinatura do CRM.", "_blank")}
                  className="w-full h-12 bg-white/5 border-white/10 text-white hover:bg-white/10"
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Falar com suporte
                </Button>

                <button onClick={logout} className="text-xs text-white/30 hover:text-white/50 transition mt-2">
                  Sair da conta
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-white/50 text-sm mb-8">
                O acesso ao sistema está temporariamente suspenso.<br />
                Entre em contato com o administrador da sua empresa para regularizar a situação.
              </p>

              <button onClick={logout} className="text-sm text-blue-400 hover:text-blue-300 transition">
                Sair da conta
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ══════════ BANNER DE AVISO (faltam <= 7 dias) ══════════
  if (showWarning && isAdmin) {
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <span className="font-semibold">
              {isTrial ? "Período de teste" : "Assinatura"}
            </span>
            {" "}expira em{" "}
            <span className="font-bold">{daysLeft} dia{daysLeft !== 1 ? "s" : ""}</span>.
            {" "}Assine um plano para não perder o acesso.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => window.location.href = "/settings"}
          className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-xs h-7"
        >
          Ver planos
        </Button>
      </div>
    );
  }

  return null;
}
