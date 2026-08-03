import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Truck, Plus } from "lucide-react";

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

import type { Supplier } from "@/types/delvor";
import { formatDocument } from "@/lib/formatters";
import QuickSupplierDialog from "./QuickSupplierDialog";

interface SupplierComboboxProps {
  value: string | null;
  onChange: (id: string | null, supplier: Supplier | null) => void;
  disabled?: boolean;
  allowCreate?: boolean;
}

export default function SupplierCombobox({
  value, onChange, disabled, allowCreate = true,
}: SupplierComboboxProps) {
  const { user } = useAuth();
  const { isManager } = usePermissions();
  const companyId = user?.company_id;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const canCreate = allowCreate && isManager;

  useEffect(() => {
    if (!value || !companyId) { setSelected(null); return; }
    if (selected?.id === value) return;
    supabase.from("suppliers" as any).select("*").eq("id", value).maybeSingle()
      .then(({ data }) => setSelected((data as any) || null));
  }, [value, companyId]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      let req = supabase
        .from("suppliers" as any)
        .select("*")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("name")
        .limit(50);
      if (query.trim()) {
        const q = `%${query.trim()}%`;
        req = req.or(`name.ilike.${q},document.ilike.${q},contact_name.ilike.${q}`);
      }
      const { data } = await req;
      if (cancelled) return;
      setItems((data as any[]) ?? []);
      setLoading(false);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, companyId, refreshKey]);

  function handleCreated(s: Supplier) {
    setSelected(s);
    setItems((arr) => [s, ...arr]);
    setRefreshKey((k) => k + 1);
    onChange(s.id, s);
    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" disabled={disabled} className="w-full justify-between font-normal">
            {selected ? (
              <span className="flex items-center gap-2 truncate">
                <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Selecionar fornecedor...</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar fornecedor..." value={query} onValueChange={setQuery} />
            <CommandList>
              {loading && <div className="p-3 text-xs text-muted-foreground">Buscando...</div>}
              {!loading && items.length === 0 && (
                <CommandEmpty>
                  <div className="py-3">
                    Nenhum fornecedor.
                    {canCreate && query.trim() && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Use o botão abaixo pra cadastrar.
                      </div>
                    )}
                  </div>
                </CommandEmpty>
              )}
              <CommandGroup>
                {items.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={s.id}
                    onSelect={() => {
                      onChange(s.id, s);
                      setSelected(s);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check className={`h-4 w-4 ${value === s.id ? "opacity-100" : "opacity-0"}`} />
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-sm">{s.name}</span>
                      {(s.document || s.contact_name) && (
                        <span className="text-xs text-muted-foreground">
                          {[formatDocument(s.document), s.contact_name].filter(Boolean).join(" • ")}
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
                      onSelect={() => { setOpen(false); setCreateOpen(true); }}
                      className="flex items-center gap-2 text-emerald-500 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span className="font-medium">
                        {query.trim() ? `Cadastrar "${query.trim()}"` : "Novo fornecedor"}
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
        <QuickSupplierDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={query.trim() || undefined}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
