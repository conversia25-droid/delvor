import React from "react";

type FullPageLoaderProps = {
  label?: string;
};

/**
 * Loader full-screen para transições de rota e carregamentos iniciais.
 */
export default function FullPageLoader({ label = "Carregando..." }: FullPageLoaderProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-4 border-muted border-t-primary animate-spin" />
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
