import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Archive, ArrowLeft, Loader2, RotateCcw, ShoppingCart, Package, Wrench, Truck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Configuração de cada tipo de dado que pode ser arquivado.
 * `dateField` é a coluna usada pra comparar com o corte
 * (issue_date pra vendas/compras, created_at pra OS/produtos).
 */
const TARGETS = [
  { key: "sales",          table: "sales",          label: "Vendas",             dateField: "issue_date",  icon: ShoppingCart },
  { key: "products",       table: "products",       label: "Produtos",           dateField: "created_at",  icon: Package },
  { key: "service_orders", table: "service_orders", label: "Ordens de Serviço",  dateField: "created_at",  icon: Wrench },
  { key: "purchases",      table: "purchases",      label: "Compras",            dateField: "issue_date",  icon: Truck },
] as const;

type TargetKey = typeof TARGETS[number]["key"];

interface Counts {
  eligible: number;   // registros elegíveis pro arquivamento (data < corte, ainda não arquivados)
  archived: number;   // registros já arquivados
  total: number;      // total no banco
}

export default function MasterArchive() {
  const { companyId } = useParams<{ companyId: string }>();
  const [companyName, setCompanyName] = useState<string>("");
  const [cutoffDate, setCutoffDate] = useState("2026-06-01");
  const [selected, setSelected] = useState<Record<TargetKey, boolean>>({
    sales: true, products: true, service_orders: true, purchases: true,
  });
  const [counts, setCounts] = useState<Record<TargetKey, Counts>>({} as any);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<"archive" | "restore" | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "restore" | null>(null);

  async function loadCounts() {
    if (!companyId) return;
    setLoading(true);
    const [{ data: comp }, ...results] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      ...TARGETS.map(async (t) => {
        // Três queries: elegíveis pra arquivar, já arquivados, total.
        // Usa head:true + count:exact pra não trazer dados.
        const [{ count: eligible }, { count: archived }, { count: total }] = await Promise.all([
          supabase.from(t.table as any).select("*", { count: "exact", head: true })
            .eq("company_id", companyId)
            .is("hidden_at", null)
            .lt(t.dateField, cutoffDate),
          supabase.from(t.table as any).select("*", { count: "exact", head: true })
            .eq("company_id", companyId)
            .not("hidden_at", "is", null),
          supabase.from(t.table as any).select("*", { count: "exact", head: true })
            .eq("company_id", companyId),
        ]);
        return { key: t.key, counts: { eligible: eligible ?? 0, archived: archived ?? 0, total: total ?? 0 } };
      }),
    ]);
    setCompanyName((comp as any)?.name || "");
    const next: any = {};
    for (const r of results) next[r.key] = r.counts;
    setCounts(next);
    setLoading(false);
  }

  useEffect(() => { loadCounts(); }, [companyId, cutoffDate]);

  const totalEligible = useMemo(
    () => TARGETS.reduce((sum, t) => sum + (selected[t.key] ? (counts[t.key]?.eligible || 0) : 0), 0),
    [counts, selected]
  );
  const totalArchived = useMemo(
    () => TARGETS.reduce((sum, t) => sum + (selected[t.key] ? (counts[t.key]?.archived || 0) : 0), 0),
    [counts, selected]
  );

  async function archive() {
    if (!companyId) return;
    setRunning("archive");
    const now = new Date().toISOString();
    let ok = 0, err = 0;
    for (const t of TARGETS) {
      if (!selected[t.key]) continue;
      const { error, count } = await supabase.from(t.table as any)
        .update({ hidden_at: now }, { count: "exact" })
        .eq("company_id", companyId)
        .is("hidden_at", null)
        .lt(t.dateField, cutoffDate);
      if (error) err++; else ok += count || 0;
    }
    setRunning(null);
    setConfirm(null);
    toast({
      title: err > 0 ? "Arquivamento parcial" : "Arquivamento concluído",
      description: `${ok} registro(s) escondidos${err > 0 ? ` — ${err} tabela(s) falharam` : ""}.`,
      variant: err > 0 ? "destructive" : "default",
    });
    loadCounts();
  }

  async function restore() {
    if (!companyId) return;
    setRunning("restore");
    let ok = 0, err = 0;
    for (const t of TARGETS) {
      if (!selected[t.key]) continue;
      const { error, count } = await supabase.from(t.table as any)
        .update({ hidden_at: null }, { count: "exact" })
        .eq("company_id", companyId)
        .not("hidden_at", "is", null);
      if (error) err++; else ok += count || 0;
    }
    setRunning(null);
    setConfirm(null);
    toast({
      title: err > 0 ? "Restauração parcial" : "Restauração concluída",
      description: `${ok} registro(s) restaurados${err > 0 ? ` — ${err} tabela(s) falharam` : ""}.`,
      variant: err > 0 ? "destructive" : "default",
    });
    loadCounts();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/master/empresas"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Link>
        </Button>
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Arquivo</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {companyName || "Empresa"}
          </h1>
        </div>
      </div>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Archive className="h-4 w-4 text-blue-300" /> Esconder dados antigos</CardTitle>
          <CardDescription className="text-slate-400">
            Registros ocultados <strong>não aparecem nas telas</strong> mas continuam no banco.
            Basta clicar em "Restaurar" pra devolver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider">Data de corte</label>
              <Input
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                className="mt-1 border-slate-700 bg-slate-950"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Vendas/Compras usam a data de emissão. Produtos/OS usam a data de cadastro.
              </p>
            </div>
            <div className="flex items-end">
              <div className="text-sm text-slate-300">
                <div className="font-semibold text-amber-300 text-base">
                  {loading ? "…" : totalEligible} registro(s) elegível(is)
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {loading ? "" : `${totalArchived} já arquivado(s)`}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {TARGETS.map((t) => {
              const Icon = t.icon;
              const c = counts[t.key] || { eligible: 0, archived: 0, total: 0 };
              return (
                <label
                  key={t.key}
                  className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition ${
                    selected[t.key]
                      ? "border-blue-500/60 bg-blue-500/10"
                      : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected[t.key]}
                    onChange={(e) => setSelected((s) => ({ ...s, [t.key]: e.target.checked }))}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-blue-300" />
                      <span className="font-medium">{t.label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline" className="border-amber-500/30 text-amber-300">
                        {c.eligible} elegível(is)
                      </Badge>
                      <Badge variant="outline" className="border-slate-700 text-slate-400">
                        {c.archived} arquivado(s)
                      </Badge>
                      <Badge variant="outline" className="border-slate-700 text-slate-500">
                        {c.total} total
                      </Badge>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => setConfirm("archive")}
              disabled={loading || totalEligible === 0 || !!running}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {running === "archive"
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Archive className="h-4 w-4 mr-2" />}
              Esconder {totalEligible} registro(s)
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirm("restore")}
              disabled={loading || totalArchived === 0 || !!running}
            >
              {running === "restore"
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <RotateCcw className="h-4 w-4 mr-2" />}
              Restaurar {totalArchived} arquivado(s)
            </Button>
            <Button variant="ghost" size="sm" onClick={loadCounts} disabled={loading}>
              Atualizar contagens
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirm === "archive"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Esconder {totalEligible} registro(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai marcar como oculto tudo com data anterior a {new Date(cutoffDate + "T12:00").toLocaleDateString("pt-BR")}
              &nbsp;nas categorias selecionadas. Os dados <strong>continuam no banco</strong> — o botão "Restaurar" desfaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-amber-600 hover:bg-amber-700 text-white" onClick={archive}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "restore"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar {totalArchived} registro(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Devolve todos os registros arquivados dessa empresa (das categorias selecionadas) pras telas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={restore}>Restaurar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
