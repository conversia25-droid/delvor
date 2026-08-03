import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/* ================= STEPS CONFIG ================= */

export const ONBOARDING_STEPS = [
  {
    key: "company",
    title: "Cadastre sua Empresa",
    description: "CNPJ, endereço, telefone e logo — aparece nos PDFs e mensagens pro cliente.",
    path: "/settings?tab=company",
    label: "Configurações",
    tutorial: [] as readonly string[],
  },
  {
    key: "team",
    title: "Configure sua Equipe",
    description: "Adicione técnicos e vendedores que vão usar o sistema.",
    path: "/team",
    label: "Equipe",
    tutorial: [] as readonly string[],
  },
  {
    key: "inventory",
    title: "Comece o Estoque",
    description: "Cadastre o primeiro produto, peça ou serviço — sem isso não dá pra abrir venda.",
    path: "/products",
    label: "Estoque",
    tutorial: [] as readonly string[],
  },
  {
    key: "customer",
    title: "Adicione um Cliente",
    description: "Cadastre seu primeiro cliente — pessoa física ou empresa.",
    path: "/customers",
    label: "Clientes",
    tutorial: [] as readonly string[],
  },
  {
    key: "whatsapp",
    title: "Conecte seu WhatsApp",
    description: "Crie uma instância e leia o QR Code pra mandar/receber mensagens.",
    path: "/settings?tab=whatsapp",
    label: "Configurações",
    tutorial: [
      "Clique em \"Nova instância\" e dê um nome (ex: Atendimento)",
      "Espere o QR Code aparecer na tela",
      "No celular, abra o WhatsApp → ⋮ Menu → Aparelhos conectados → Conectar um aparelho",
      "Aponte a câmera do celular para o QR Code da tela",
      "Quando o status virar \"Conectado\", volte aqui e clique em Concluir etapa",
    ] as readonly string[],
  },
] as const;

/* ================= CONTEXT ================= */

type OnboardingContextType = {
  isOnboarding: boolean;
  showModal: boolean;
  currentStep: number;
  currentStepConfig: (typeof ONBOARDING_STEPS)[number];
  allowedPath: string;
  totalSteps: number;
  /** Whether the current step's requirement is met (e.g., at least 1 stage in funnel step) */
  stepRequirementMet: boolean;
  /** Pages can call this to signal the step requirement is met */
  setStepRequirementMet: (met: boolean) => void;
  completeStep: () => void;
  skipStep: () => void;
  finishOnboarding: () => void;
  dismissModal: () => void;
  isPathAllowed: (path: string) => boolean;
};

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const companyId = user?.company_id;

  const [isOnboarding, setIsOnboarding] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepRequirementMet, setStepRequirementMet] = useState(false);
  const [checked, setChecked] = useState(false);

  // Verificar no banco se a empresa já completou o onboarding
  useEffect(() => {
    // Esperar o auth carregar e ter um companyId
    if (authLoading || !companyId) return;
    if (checked) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("companies")
          .select("onboarding_completed")
          .eq("id", companyId)
          .single();

        if (error) {
          console.error("[Onboarding] Erro ao verificar status:", error.message);
          setChecked(true);
          return;
        }

        // Se onboarding_completed é false ou null, ativar onboarding
        if (!data?.onboarding_completed) {
          console.log("[Onboarding] Empresa nova detectada, ativando onboarding");
          setIsOnboarding(true);
          setShowModal(true);
        } else {
          console.log("[Onboarding] Empresa já completou onboarding");
        }
      } catch (err) {
        console.error("[Onboarding] Erro inesperado:", err);
      } finally {
        setChecked(true);
      }
    })();
  }, [authLoading, companyId, checked]);

  // Re-ativar onboarding quando signup reseta o flag
  useEffect(() => {
    const handleReset = () => {
      setIsOnboarding(true);
      setShowModal(true);
      setCurrentStep(0);
      setStepRequirementMet(false);
      setChecked(false);
    };
    window.addEventListener("onboarding-reset", handleReset);
    return () => window.removeEventListener("onboarding-reset", handleReset);
  }, []);

  const currentStepConfig = ONBOARDING_STEPS[currentStep] ?? ONBOARDING_STEPS[0];
  const allowedPath = currentStepConfig.path;
  const totalSteps = ONBOARDING_STEPS.length;

  // Marcar onboarding como concluído no banco de dados
  const markDoneInDB = useCallback(async () => {
    if (!companyId) return;
    try {
      const { error } = await supabase
        .from("companies")
        .update({ onboarding_completed: true } as any)
        .eq("id", companyId);

      if (error) {
        console.error("[Onboarding] Erro ao marcar como concluído:", error.message);
      } else {
        console.log("[Onboarding] Marcado como concluído no banco");
      }
    } catch (err) {
      console.error("[Onboarding] Erro ao atualizar banco:", err);
    }
  }, [companyId]);

  const completeStep = useCallback(() => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
      setShowModal(true);
      setStepRequirementMet(false);
    } else {
      setIsOnboarding(false);
      setShowModal(false);
      markDoneInDB();
    }
  }, [currentStep, markDoneInDB]);

  const skipStep = useCallback(() => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
      setShowModal(true);
      setStepRequirementMet(false);
    } else {
      setIsOnboarding(false);
      setShowModal(false);
      markDoneInDB();
    }
  }, [currentStep, markDoneInDB]);

  const finishOnboarding = useCallback(() => {
    setIsOnboarding(false);
    setShowModal(false);
    markDoneInDB();
  }, [markDoneInDB]);

  const dismissModal = useCallback(() => {
    setShowModal(false);
  }, []);

  const isPathAllowed = useCallback(
    (path: string) => {
      if (!isOnboarding) return true;
      if (path === "/dashboard") return true;
      // Compara só os pathnames (ignora query strings) — assim /settings bate
      // com /settings?tab=whatsapp.
      const allowedBase = allowedPath.split("?")[0];
      const pathBase = path.split("?")[0];
      if (pathBase === allowedBase) return true;
      // Na etapa de WhatsApp, libera o /chat também — assim o usuário consegue
      // testar a instância recém-conectada sem ter que pular a etapa.
      if (currentStepConfig.key === "whatsapp" && pathBase === "/chat") return true;
      return false;
    },
    [isOnboarding, allowedPath, currentStepConfig.key]
  );

  return (
    <OnboardingContext.Provider
      value={{
        isOnboarding,
        showModal,
        currentStep,
        currentStepConfig,
        allowedPath,
        totalSteps,
        stepRequirementMet,
        setStepRequirementMet,
        completeStep,
        skipStep,
        finishOnboarding,
        dismissModal,
        isPathAllowed,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return ctx;
}
