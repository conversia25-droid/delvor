import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Plus, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

import type { CustomerEquipment } from "@/types/delvor";

interface EquipmentComboboxProps {
  customerId: string | null;
  value: string | null;
  onChange: (equipmentId: string | null, equipment: CustomerEquipment | null) => void;
  /** Sinaliza ao pai que o user quer criar um novo (abrir EquipmentFormDialog). */
  onCreateRequested?: () => void;
  disabled?: boolean;
  /** Trigger para recarregar a lista (incrementar quando criar um novo via dialog). */
  refreshKey?: number;
}

export default function EquipmentCombobox({
  customerId,
  value,
  onChange,
  onCreateRequested,
  disabled,
  refreshKey,
}: EquipmentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CustomerEquipment[]>([]);
  const [selected, setSelected] = useState<CustomerEquipment | null>(null);
  const [loading, setLoading] = useState(false);

  // Carrega todos os equipamentos do cliente.
  useEffect(() => {
    setSelected(null);
    if (!customerId) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("customer_equipments" as any)
        .select("*")
        .eq("customer_id", customerId)
        .neq("status", "baixado")
        .order("brand")
        .order("model")
        .limit(200);
      if (cancelled) return;
      setLoading(false);
      setItems((data as any[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [customerId, refreshKey]);

  // Resolve o equipamento selecionado quando temos value.
  useEffect(() => {
    if (!value) { setSelected(null); return; }
    const found = items.find((e) => e.id === value);
    if (found) { setSelected(found); return; }
    // fallback: busca
    supabase.from("customer_equipments" as any).select("*").eq("id", value).maybeSingle()
      .then(({ data }) => setSelected((data as any) || null));
  }, [value, items]);

  function label(e: CustomerEquipment) {
    return [e.brand, e.model].filter(Boolean).join(" ") || e.serial_number || "Equipamento";
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !customerId}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{label(selected)}</span>
              {selected.serial_number && (
                <span className="text-xs text-muted-foreground font-mono">SN {selected.serial_number}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {customerId ? "Selecionar equipamento (opcional)" : "Selecione um cliente primeiro"}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command>
          <CommandInput placeholder="Buscar equipamento..." />
          <CommandList>
            {loading && <div className="p-3 text-xs text-muted-foreground">Carregando...</div>}
            {!loading && items.length === 0 && <CommandEmpty>Nenhum equipamento.</CommandEmpty>}
            <CommandGroup>
              {items.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`${e.brand || ""} ${e.model || ""} ${e.serial_number || ""}`}
                  onSelect={() => {
                    onChange(e.id, e);
                    setSelected(e);
                    setOpen(false);
                  }}
                >
                  <Check className={`h-4 w-4 mr-2 ${value === e.id ? "opacity-100" : "opacity-0"}`} />
                  <Wrench className="h-4 w-4 mr-2 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm">{label(e)}</span>
                    <span className="text-xs text-muted-foreground">
                      {[e.serial_number && `SN ${e.serial_number}`, e.location].filter(Boolean).join(" • ")}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreateRequested && customerId && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      onCreateRequested();
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2 text-emerald-500" /> Novo equipamento...
                  </CommandItem>
                  {value && (
                    <CommandItem
                      onSelect={() => {
                        onChange(null, null);
                        setSelected(null);
                        setOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">Limpar seleção</span>
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
