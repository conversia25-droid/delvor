import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Building2, User as UserIcon, Plus } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";

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

import type { Customer } from "@/types/delvor";
import QuickCustomerDialog from "./QuickCustomerDialog";
import FullCustomerDialog from "./FullCustomerDialog";

interface CustomerComboboxProps {
  value: string | null;
  onChange: (customerId: string | null, customer: Customer | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Se true, inclui clientes marcados como `is_internal` (ativos da empresa).
   * Default: false. Use true em telas como Locações onde admin/gerente precisa
   * selecionar a "empresa interna" como cliente do contrato.
   */
  includeInternal?: boolean;
  /**
   * Permite criar um cliente novo direto do combobox (admin/gerente/vendedor).
   * Default: true. Use `false` em contextos read-only.
   */
  allowCreate?: boolean;
  /**
   * Formulário usado ao criar um cliente novo:
   *  - "quick" (default): dialog reduzido — nome, doc, telefone, email.
   *  - "full": dialog com todos os campos (endereço, IE/IM, observações, etc).
   * Use "full" em Vendas pra garantir cadastro completo.
   */
  createMode?: "quick" | "full";
}

/**
 * Combobox de cliente com busca server-side e botão "+ Novo cliente"
 * pra criar inline (visível só pra quem tem permissão).
 */
export default function CustomerCombobox({
  value,
  onChange,
  placeholder = "Selecionar cliente...",
  disabled,
  includeInternal = false,
  allowCreate = true,
  createMode = "quick",
}: CustomerComboboxProps) {
  const { user } = useAuth();
  const { isManager, isVendedor } = usePermissions();
  const companyId = user?.company_id;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  // Quem pode criar cliente: admin, gerente, vendedor (não técnico puro)
  const canCreate = allowCreate && (isManager || isVendedor);

  // Cliente atualmente selecionado.
  useEffect(() => {
    if (!value || !companyId) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    (async () => {
      const { data } = await supabase
        .from("customers" as any)
        .select("*")
        .eq("id", value)
        .maybeSingle();
      if (data) setSelected(data as any);
    })();
  }, [value, companyId]);

  // Busca debounced.
  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      let req = supabase
        .from("customers" as any)
        .select("id, person_type, name, trade_name, document, city, state, remote_jid, company_id, is_internal")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("name")
        .limit(50);

      if (!includeInternal) {
        req = req.eq("is_internal", false);
      }
      if (query.trim()) {
        const q = `%${query.trim()}%`;
        req = req.or(`name.ilike.${q},trade_name.ilike.${q},document.ilike.${q}`);
      }
      const { data } = await req;
      if (cancelled) return;
      setLoading(false);
      setItems((data as any[]) ?? []);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query, companyId, refreshKey]);

  function handleCreated(c: Customer) {
    // Seleciona o cliente recém-criado e fecha o combobox.
    setSelected(c);
    setItems((arr) => [c, ...arr]);
    setRefreshKey((k) => k + 1);
    onChange(c.id, c);
    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {selected ? (
              <span className="flex items-center gap-2 truncate">
                {selected.person_type === "PJ"
                  ? <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  : <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nome, fantasia, CNPJ..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {loading && <div className="p-3 text-xs text-muted-foreground">Buscando...</div>}
              {!loading && items.length === 0 && (
                <CommandEmpty>
                  <div className="py-3">
                    Nenhum cliente encontrado.
                    {canCreate && query.trim() && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Use o botão abaixo pra cadastrar.
                      </div>
                    )}
                  </div>
                </CommandEmpty>
              )}
              <CommandGroup>
                {items.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => {
                      onChange(c.id, c);
                      setSelected(c);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={`h-4 w-4 ${value === c.id ? "opacity-100" : "opacity-0"}`}
                    />
                    {c.person_type === "PJ"
                      ? <Building2 className="h-4 w-4 text-muted-foreground" />
                      : <UserIcon className="h-4 w-4 text-muted-foreground" />}
                    <div className="flex flex-col">
                      <span className="text-sm">{c.name}</span>
                      {(c.trade_name || c.document) && (
                        <span className="text-xs text-muted-foreground">
                          {[c.trade_name, c.document].filter(Boolean).join(" • ")}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>

              {canCreate && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => {
                        setOpen(false);
                        setCreateOpen(true);
                      }}
                      className="flex items-center gap-2 text-emerald-500 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span className="font-medium">
                        {query.trim() ? `Cadastrar "${query.trim()}"` : "Novo cliente"}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {canCreate && (
        createMode === "full" ? (
          <FullCustomerDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialName={query.trim() || undefined}
            onCreated={handleCreated}
          />
        ) : (
          <QuickCustomerDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            initialName={query.trim() || undefined}
            onCreated={handleCreated}
          />
        )
      )}
    </>
  );
}
