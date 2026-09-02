import { useCallback, useEffect, useMemo, useState } from "react";
import { Puzzle, Loader2, Check, X } from "lucide-react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  companyId: string;
}

interface Row {
  id: string;
  addon_code: string;
  active: boolean;
  monthly_price_cents: number;
  activated_at: string | null;
}

interface CatalogItem {
  code: string;
  name: string;
  description: string | null;
  defaultPriceCents: number;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export default function CompanyAddonsCard({ companyId }: Props) {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [catRes, rowsRes] = await Promise.all([
      supabase.from("addon_catalog")
        .select("code, name, description, default_price_cents")
        .eq("active", true)
        .order("name"),
      supabase.from("company_addons")
        .select("id, addon_code, active, monthly_price_cents, activated_at")
        .eq("company_id", companyId),
    ]);
    if (catRes.error || rowsRes.error) {
      toast({
        title: "Erro ao carregar add-ons",
        description: catRes.error?.message || rowsRes.error?.message,
        variant: "destructive",
      });
      setCatalog([]); setRows([]);
    } else {
      setCatalog(((catRes.data as any[]) ?? []).map((c) => ({
        code: c.code, name: c.name, description: c.description,
        defaultPriceCents: c.default_price_cents,
      })));
      setRows((rowsRes.data as Row[]) ?? []);
    }
    setLoading(false);
  }, [companyId, toast]);

  useEffect(() => { void load(); }, [load]);

  const rowByCode = useMemo(() => {
    const map = new Map<string, Row>();
    rows.forEach((r) => map.set(r.addon_code, r));
    return map;
  }, [rows]);

  async function toggle(code: string, next: boolean) {
    setSaving(code);
    const catalogItem = catalog.find((c) => c.code === code);
    const existing = rowByCode.get(code);
    const priceInputRaw = priceDraft[code];
    const priceInputCents = priceInputRaw ? Math.round(Number(priceInputRaw.replace(",", ".")) * 100) : NaN;
    const priceCents = Number.isFinite(priceInputCents)
      ? priceInputCents
      : existing?.monthly_price_cents ?? catalogItem?.defaultPriceCents ?? 0;

    const payload = {
      company_id: companyId,
      addon_code: code,
      active: next,
      monthly_price_cents: priceCents,
      activated_at: next ? (existing?.activated_at ?? new Date().toISOString()) : existing?.activated_at ?? null,
      cancelled_at: next ? null : new Date().toISOString(),
    } as Record<string, unknown>;

    const { error } = await supabase
      .from("company_addons")
      .upsert(payload as any, { onConflict: "company_id,addon_code" });

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: next ? "Add-on ativado" : "Add-on desativado" });
      await load();
    }
    setSaving(null);
  }

  async function updatePrice(code: string) {
    const raw = priceDraft[code];
    if (!raw) return;
    const cents = Math.round(Number(raw.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast({ title: "Preço inválido", variant: "destructive" });
      return;
    }
    setSaving(code);
    const existing = rowByCode.get(code);
    const payload = {
      company_id: companyId,
      addon_code: code,
      active: existing?.active ?? false,
      monthly_price_cents: cents,
      activated_at: existing?.activated_at ?? null,
    } as Record<string, unknown>;
    const { error } = await supabase
      .from("company_addons")
      .upsert(payload as any, { onConflict: "company_id,addon_code" });
    if (error) {
      toast({ title: "Erro ao salvar preço", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Preço atualizado" });
      setPriceDraft((p) => ({ ...p, [code]: "" }));
      await load();
    }
    setSaving(null);
  }

  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-blue-300" /> Add-ons
        </CardTitle>
        <CardDescription className="text-slate-400">
          Extensões opcionais cobradas em cima do plano principal desta empresa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : catalog.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum add-on cadastrado no catálogo.</p>
        ) : (
          <div className="space-y-4">
            {catalog.map((addon) => {
              const row = rowByCode.get(addon.code);
              const active = !!row?.active;
              const currentPrice = row?.monthly_price_cents ?? addon.defaultPriceCents;
              const isSaving = saving === addon.code;
              return (
                <div key={addon.code} className="rounded-lg border border-slate-800 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-100">{addon.name}</p>
                        {active ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                            <Check className="h-3 w-3" /> Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <X className="h-3 w-3" /> Inativo
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{addon.description}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Preço atual: <span className="font-medium text-slate-300">{formatMoney(currentPrice)}</span> / mês
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={active}
                        disabled={isSaving}
                        onCheckedChange={(v) => void toggle(addon.code, v)}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <Label className="text-xs text-slate-500">Novo preço (R$)</Label>
                      <Input
                        className="mt-1 w-40 bg-slate-950 border-slate-800 text-slate-100"
                        placeholder={(currentPrice / 100).toFixed(2).replace(".", ",")}
                        value={priceDraft[addon.code] ?? ""}
                        onChange={(e) => setPriceDraft((p) => ({ ...p, [addon.code]: e.target.value }))}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isSaving || !priceDraft[addon.code]}
                      onClick={() => void updatePrice(addon.code)}
                    >
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Atualizar preço
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
