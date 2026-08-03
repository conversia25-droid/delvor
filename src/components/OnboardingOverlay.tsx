import { useNavigate } from "react-router-dom";
import { useOnboarding, ONBOARDING_STEPS } from "@/contexts/OnboardingContext";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Users,
  Package,
  UserPlus,
  MessageSquare,
  ArrowRight,
  Check,
  Rocket,
  CheckCircle2,
} from "lucide-react";

// Ordem tem que bater com ONBOARDING_STEPS em OnboardingContext.tsx:
// company → team → inventory → customer → whatsapp
const STEP_ICONS = [Building2, Users, Package, UserPlus, MessageSquare];

export default function OnboardingOverlay() {
  const {
    isOnboarding,
    showModal,
    currentStep,
    currentStepConfig,
    totalSteps,
    completeStep,
    skipStep,
    finishOnboarding,
    dismissModal,
  } = useOnboarding();

  const navigate = useNavigate();

  if (!isOnboarding) return null;

  const isLastStep = currentStep === totalSteps - 1;
  const Icon = STEP_ICONS[currentStep] ?? Users;

  function handleGoToStep() {
    dismissModal();
    navigate(currentStepConfig.path);
  }

  // ══════════════════════════════════════════
  // PAINEL LATERAL (quando está cumprindo a etapa)
  // ══════════════════════════════════════════
  if (!showModal) {
    return (
      <div className="fixed top-0 right-0 z-[9998] h-full w-72 border-l bg-card shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
        {/* HEADER */}
        <div className="bg-gradient-to-b from-primary to-primary/90 px-4 py-5 text-primary-foreground">
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="h-4 w-4" />
            <span className="text-xs font-semibold opacity-80">CONFIGURAÇÃO</span>
          </div>
          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${((currentStep) / totalSteps) * 100}%` }}
            />
          </div>
          <p className="text-[11px] opacity-60 mt-1.5">
            Passo {currentStep + 1} de {totalSteps}
          </p>
        </div>

        {/* STEPS CHECKLIST */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
          {ONBOARDING_STEPS.map((step, idx) => {
            const StepIcon = STEP_ICONS[idx];
            const isDone = idx < currentStep;
            const isCurrent = idx === currentStep;

            return (
              <div
                key={step.key}
                className={`
                  flex items-center gap-3 p-3 rounded-lg border transition-all
                  ${isCurrent
                    ? "border-primary bg-primary/5"
                    : isDone
                    ? "border-green-500/30 bg-green-50 dark:bg-green-950/20"
                    : "border-transparent opacity-40"
                  }
                `}
              >
                <div
                  className={`
                    flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                    ${isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isDone
                      ? "bg-green-500 text-white"
                      : "bg-muted text-muted-foreground"
                    }
                  `}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-semibold ${
                      isCurrent ? "text-foreground" : isDone ? "text-green-700 dark:text-green-400" : "text-muted-foreground"
                    }`}
                  >
                    {step.title}
                  </p>
                  {isCurrent && (
                    <>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {step.description}
                      </p>
                      {step.tutorial.length > 0 && (
                        <ol className="mt-2 space-y-1.5 text-[11px] text-muted-foreground list-decimal list-outside pl-4">
                          {step.tutorial.map((line, i) => (
                            <li key={i} className="leading-snug">
                              {line}
                            </li>
                          ))}
                        </ol>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* FOOTER */}
        <div className="border-t px-3 py-3 space-y-2">
          <Button
            className="w-full"
            onClick={completeStep}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isLastStep ? "Concluir configuração" : "Concluir etapa"}
          </Button>

          <div className="flex gap-2">
            {!isLastStep && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={skipStep}
              >
                Pular etapa
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground"
              onClick={finishOnboarding}
            >
              Pular tudo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════
  // MODAL FULLSCREEN (entre etapas)
  // ══════════════════════════════════════════
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* BACKDROP */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* CARD */}
      <div className="relative w-full max-w-lg mx-4 animate-in zoom-in-95 fade-in duration-300">
        <div className="rounded-2xl bg-card border shadow-2xl overflow-hidden">

          {/* HEADER */}
          <div className="bg-gradient-to-br from-primary to-primary/80 px-8 pt-8 pb-10 text-primary-foreground text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Rocket className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold">
              Configure seu CRM
            </h2>
            <p className="text-sm opacity-70 mt-2">
              Passo {currentStep + 1} de {totalSteps} — Complete cada etapa para começar
            </p>

            {/* PROGRESS BAR */}
            <div className="mt-4 h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-500"
                style={{ width: `${((currentStep) / totalSteps) * 100}%` }}
              />
            </div>
          </div>

          {/* STEPS LIST */}
          <div className="px-6 -mt-5">
            <div className="space-y-3">
              {ONBOARDING_STEPS.map((step, idx) => {
                const StepIcon = STEP_ICONS[idx];
                const isDone = idx < currentStep;
                const isCurrent = idx === currentStep;

                return (
                  <button
                    key={step.key}
                    onClick={() => {
                      if (isCurrent) handleGoToStep();
                    }}
                    disabled={!isCurrent}
                    className={`
                      w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all
                      ${isCurrent
                        ? "border-primary bg-card shadow-lg shadow-primary/10 cursor-pointer hover:bg-primary/5 scale-[1.02]"
                        : isDone
                        ? "border-green-500/40 bg-green-50 dark:bg-green-950/20"
                        : "border-muted bg-muted/20 opacity-40 cursor-not-allowed"
                      }
                    `}
                  >
                    <div
                      className={`
                        flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all
                        ${isCurrent
                          ? "bg-primary text-primary-foreground"
                          : isDone
                          ? "bg-green-500 text-white"
                          : "bg-muted text-muted-foreground"
                        }
                      `}
                    >
                      {isDone ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <StepIcon className="h-5 w-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3
                        className={`font-semibold ${
                          isCurrent ? "text-foreground" : isDone ? "text-green-700 dark:text-green-400" : "text-muted-foreground"
                        }`}
                      >
                        {step.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {step.description}
                      </p>
                    </div>

                    <div className="shrink-0">
                      {isDone ? (
                        <Check className="h-5 w-5 text-green-500" />
                      ) : isCurrent ? (
                        <ArrowRight className="h-5 w-5 text-primary animate-pulse" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FOOTER */}
          <div className="px-6 py-5 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={finishOnboarding}
              className="text-muted-foreground"
            >
              Pular tudo
            </Button>

            <div className="flex gap-2">
              {!isLastStep && (
                <Button variant="outline" size="sm" onClick={skipStep}>
                  Pular etapa
                </Button>
              )}
              <Button onClick={handleGoToStep}>
                {isLastStep ? "Concluir configuração" : "Começar"}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
