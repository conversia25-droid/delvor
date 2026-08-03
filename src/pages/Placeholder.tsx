import { Construction } from "lucide-react";

interface PlaceholderProps {
  title: string;
  phase: string;
  description?: string;
}

/**
 * Página placeholder para módulos ainda não implementados.
 * Usada nas rotas /products, /services, /suppliers, /sales, /service-orders
 * até as próximas fases serem entregues.
 */
export default function Placeholder({ title, phase, description }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="rounded-full bg-amber-500/10 p-6 ring-1 ring-amber-500/30 mb-6">
        <Construction className="h-12 w-12 text-amber-500" />
      </div>
      <h1 className="text-3xl font-bold mb-2">{title}</h1>
      <p className="text-muted-foreground max-w-md">
        Em desenvolvimento — entrega prevista na <b>{phase}</b>.
      </p>
      {description && (
        <p className="text-sm text-muted-foreground mt-4 max-w-lg">
          {description}
        </p>
      )}
    </div>
  );
}
