/* Peças comuns dos filtros das listas (Contas a pagar/receber, Contatos,
   Chat, Relatórios): etiquetas dos filtros ativos, botão "Mais filtros"
   e a linha de resumo do que está filtrado. Idêntico nos dois repos. */
import type { ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ActiveFilter = { key: string; label: string; onRemove: () => void };

/** Etiquetas "Fornecedor: Alfa ×" + "Limpar filtros". Não renderiza nada sem filtro ativo. */
export function ActiveFilterChips({ filters, onClearAll }: { filters: ActiveFilter[]; onClearAll: () => void }) {
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/25">
          {f.label}
          <button type="button" onClick={f.onRemove} className="rounded-full p-0.5 hover:bg-primary/15" aria-label={`Tirar filtro ${f.label}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Limpar filtros
      </button>
    </div>
  );
}

/** Botão "Filtros (n)" que abre um painel com os campos extras. */
export function MoreFiltersButton({ count, children, width = "w-80" }: { count: number; children: ReactNode; width?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={count ? "default" : "outline"} size="sm" className="h-8 gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros{count ? ` (${count})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`${width} space-y-3 p-3`}>{children}</PopoverContent>
    </Popover>
  );
}

/** Um campo dentro do painel de filtros. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** Select nativo no padrão das telas (leve, funciona bem no celular). */
export function FilterSelect({
  value, onChange, options, placeholder = "Todos", className = "",
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 w-full rounded-md border bg-background px-2 text-xs ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export type SummaryItem = { label: string; value: string; tone?: "red" | "amber" | "emerald" | "muted" };

/** Linha de resumo do que está na tela: "12 contas · R$ 3.200 · vencido R$ 800 · ...". */
export function FilterSummary({ items }: { items: SummaryItem[] }) {
  const tone = (t?: SummaryItem["tone"]) =>
    t === "red" ? "text-red-700 dark:text-red-400"
      : t === "amber" ? "text-amber-700 dark:text-amber-400"
      : t === "emerald" ? "text-emerald-700 dark:text-emerald-400"
      : t === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
      {items.map((i) => (
        <span key={i.label} className="text-muted-foreground">
          {i.label} <strong className={`num font-semibold ${tone(i.tone)}`}>{i.value}</strong>
        </span>
      ))}
    </div>
  );
}
