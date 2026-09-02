import { useCallback, useEffect, useMemo, useState } from "react";
import { Puzzle, Loader2, CheckCircle2, Sparkles, X } from "lucide-react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface CatalogItem {
  code: string;
  name: string;
  description: string | null;
  default_price_cents: number;
  active: boolean;
}

interface CompanyAddon {
  addon_code: string;
  active: boolean;
  monthly_price_cents: number;
  activated_at: string | null;
  cancelled_at: string | null;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function formatBR(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function MyAddonsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.company_id ?? null;

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [mine, setMine] = useState<CompanyAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "activate" | "cancel"; addon: CatalogItem } | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [catRes, mineRes] = await Promise.all([
      supabase.from("addon_catalog")
        .select("code, name, description, default_price_cents, active")
        .eq("active", true)
        .order("name"),
      supabase.from("company_addons")
        .select("addon_code, active, monthly_price_cents, activated_at, cancelled_at")
        .eq("company_id", companyId),
    ]);
    if (catRes.error || mineRes.error) {
      toast({
        title: "Erro ao carregar add-ons",
        description: catRes.error?.message || mineRes.error?.message,
        variant: "destructive",
      });
    } else {
      setCatalog((catRes.data as CatalogItem[]) ?? []);
      setMine((mineRes.data as CompanyAddon[]) ?? []);
    }
    setLoading(false);
  }, [companyId, toast]);

  useEffect(() => { void load(); }, [load]);

  const mineByCode = useMemo(() => {
    const m = new Map<string, CompanyAddon>();
    mine.forEach((a) => m.set(a.addon_code, a));
    return m;
  }, [mine]);

  async function confirmActivate(code: string) {
    setProcessing(code);
    const { error } = await supabase.rpc("activate_addon", { p_code: code } as any);
    if (error) {
      toast({ title: "Erro ao ativar", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Add-on contratado",
        description: "Está ativo. O valor entra na sua próxima cobrança.",
      });
      await load();
    }
    setProcessing(null);
    setDialog(null);
  }

  async function confirmCancel(code: string) {
    setProcessing(code);
    const { error } = await supabase.rpc("deactivate_addon", { p_code: code } as any);
    if (error) {
      toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Add-on cancelado",
        description: "Seus dados ficam preservados. Você pode reativar quando quiser.",
      });
      await load();
    }
    setProcessing(null);
    setDialog(null);
  }

  const activeMine = catalog.filter((c) => mineByCode.get(c.code)?.active);
  const available = catalog.filter((c) => !mineByCode.get(c.code)?.active);

  return (
    <>
      <div className="rounded-lg border bg-card">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-blue-400" />
          <span className="font-semibold">Add-ons</span>
        </div>

        <div className="p-5 space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <>
              {activeMine.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Ativos
                  </p>
                  <div className="space-y-2">
                    {activeMine.map((c) => {
                      const row = mineByCode.get(c.code)!;
                      return (
                        <div key={c.code} className="rounded-md border p-4 flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">{c.name}</p>
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Ativo
                              </span>
                            </div>
                            {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
                            <p className="mt-2 text-xs text-muted-foreground">
                              {formatMoney(row.monthly_price_cents)} / mês · desde {formatBR(row.activated_at)}
                            </p>
                          </div>
                          <Button
                            variant="outline" size="sm"
                            disabled={processing === c.code}
                            onClick={() => setDialog({ kind: "cancel", addon: c })}
                          >
                            {processing === c.code ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <X className="h-4 w-4 mr-2" />}
                            Cancelar
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {available.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Disponíveis
                  </p>
                  <div className="space-y-2">
                    {available.map((c) => {
                      const wasActive = mineByCode.get(c.code); // já teve algum dia
                      return (
                        <div key={c.code} className="rounded-md border p-4 flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">{c.name}</p>
                              {wasActive && (
                                <span className="text-xs text-amber-500">
                                  cancelado em {formatBR(wasActive.cancelled_at)}
                                </span>
                              )}
                            </div>
                            {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
                            <p className="mt-2 text-sm font-medium">
                              {formatMoney(c.default_price_cents)} / mês
                            </p>
                          </div>
                          <Button
                            size="sm"
                            disabled={processing === c.code}
                            onClick={() => setDialog({ kind: "activate", addon: c })}
                          >
                            {processing === c.code ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                            {wasActive ? "Reativar" : "Contratar"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeMine.length === 0 && available.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum add-on disponível no momento.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "activate"
                ? `Contratar ${dialog.addon.name}?`
                : `Cancelar ${dialog?.addon.name}?`}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "activate" ? (
                <>
                  <strong>{formatMoney(dialog.addon.default_price_cents)}/mês</strong> serão somados
                  à sua próxima mensalidade. O add-on fica ativo imediatamente e você pode cancelar
                  quando quiser.
                </>
              ) : (
                <>
                  Seus dados ficam preservados. Se contratar de novo, tudo volta como estava.
                  A cobrança para na próxima fatura.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={!!processing}>
              Voltar
            </Button>
            {dialog?.kind === "activate" ? (
              <Button
                onClick={() => void confirmActivate(dialog.addon.code)}
                disabled={!!processing}
              >
                {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Confirmar contratação
              </Button>
            ) : dialog ? (
              <Button
                variant="destructive"
                onClick={() => void confirmCancel(dialog.addon.code)}
                disabled={!!processing}
              >
                {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Cancelar add-on
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
