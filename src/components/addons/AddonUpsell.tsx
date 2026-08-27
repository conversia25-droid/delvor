import { Lock, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AddonCode } from "@/hooks/useAddon";

interface Props {
  code: AddonCode;
}

const COPY: Record<AddonCode, { name: string; tagline: string; bullets: string[] }> = {
  financeiro: {
    name: "Financeiro",
    tagline: "Fluxo de caixa, contas fixas, margem e precificação no piloto automático.",
    bullets: [
      "Cadastro de despesas fixas com controle de pagamento mensal",
      "Lançamentos avulsos por categoria (energia, marketing, salário…)",
      "Fluxo de caixa em tempo real com entradas de Vendas e OS",
      "Calculadora de preço mínimo por produto — nunca mais venda no prejuízo",
    ],
  },
};

export default function AddonUpsell({ code }: Props) {
  const copy = COPY[code];
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 ring-1 ring-blue-500/30">
            <Lock className="h-6 w-6 text-blue-500" />
          </div>
          <h2 className="mt-6 text-2xl font-semibold">
            Add-on <span className="text-blue-500">{copy.name}</span> não está ativo
          </h2>
          <p className="mt-2 text-muted-foreground">{copy.tagline}</p>

          <ul className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm">
            {copy.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              <a
                href="https://wa.me/5500000000000?text=Quero%20ativar%20o%20add-on%20Financeiro"
                target="_blank"
                rel="noreferrer"
              >
                Falar com suporte pra ativar
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/dashboard">Voltar</a>
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Já ativou? Faça logout e login pra atualizar suas permissões.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
