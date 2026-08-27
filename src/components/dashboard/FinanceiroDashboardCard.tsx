import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Wallet, Loader2, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle,
  Sparkles, ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { usePermissions } from "@/hooks/usePermissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Summary {
  fixedTotal: number;
  fixedPaid: number;
  fixedPending: number;
  fixedOverdue: number;
  variablesTotal: number;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function firstDayOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Card do add-on Financeiro pro Dashboard.
 * - Só admin, gerente ou financeiro veem.
 * - Se addon ativo: mostra resumo do mês (fixas ativas / pagas / atraso + variáveis).
 * - Se addon inativo mas o cliente já teve alguma vez: mostra convite de retenção.
 */
export default function FinanceiroDashboardCard() {
  const { user } = useAuth();
  const perms = usePermissions();
  const addon = useAddon("financeiro");
  const companyId = user?.company_id ?? null;

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hasHistorical, setHasHistorical] = useState(false);

  const monthStart = firstDayOfMonthISO();
  const today = todayISO();

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    if (addon.active) {
      // Resumo do mês atual
      const [fixasRes, paysRes, varRes] = await Promise.all([
        supabase.from("fixed_expenses")
          .select("id, amount_cents, due_day, active")
          .eq("company_id", companyId)
          .eq("active", true),
        supabase.from("fixed_expense_payments")
          .select("fixed_expense_id, amount_cents")
          .eq("company_id", companyId)
          .eq("month_ref", monthStart),
        supabase.from("variable_expenses")
          .select("amount_cents")
          .eq("company_id", companyId)
          .gte("paid_on", monthStart)
          .lte("paid_on", today),
      ]);

      const fixas = (fixasRes.data as any[]) ?? [];
      const pays = (paysRes.data as any[]) ?? [];
      const vars_ = (varRes.data as any[]) ?? [];

      const paidIds = new Set(pays.map((p) => p.fixed_expense_id));
      const now = new Date();
      const currentDay = now.getDate();

      const fixedTotal = fixas.reduce((s, f) => s + Number(f.amount_cents || 0), 0);
      const fixedPaid = pays.reduce((s, p) => s + Number(p.amount_cents || 0), 0);
      const fixedOverdue = fixas
        .filter((f) => !paidIds.has(f.id) && Number(f.due_day) < currentDay)
        .reduce((s, f) => s + Number(f.amount_cents || 0), 0);
      const fixedPending = Math.max(0, fixedTotal - fixedPaid - fixedOverdue);
      const variablesTotal = vars_.reduce((s, v) => s + Number(v.amount_cents || 0), 0);

      setSummary({ fixedTotal, fixedPaid, fixedPending, fixedOverdue, variablesTotal });
    } else {
      // Detecta se algum dia usou (pra mostrar mensagem de retenção específica)
      const { data } = await supabase
        .from("fixed_expenses")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .limit(1);
      setHasHistorical(!!data);
      setSummary(null);
    }
    setLoading(false);
  }, [companyId, addon.active, monthStart, today]);

  useEffect(() => {
    if (addon.loading) return;
    void load();
  }, [addon.loading, load]);

  // Só admin ou financeiro
  if (!(perms.isAdmin || perms.isFinanceiro)) return null;

  if (addon.loading || loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-500" /> Financeiro
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!addon.active) {
    // Retenção: quem já teve vê mensagem sentida; quem nunca teve vê convite neutro
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-500" /> Financeiro
          </CardTitle>
          <CardDescription>
            {hasHistorical
              ? "Seus dados estão preservados. Reative pra continuar acompanhando o mês."
              : "Ative pra ver fluxo do mês, fixas em atraso e margem de produtos aqui no dashboard."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" className="w-full">
            <Link to="/settings?tab=billing">
              <Sparkles className="h-4 w-4 mr-2" />
              {hasHistorical ? "Reativar add-on" : "Conhecer o add-on"}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const s = summary!;
  const paidPct = s.fixedTotal > 0 ? Math.round((s.fixedPaid / s.fixedTotal) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-500" /> Financeiro do mês
            </CardTitle>
            <CardDescription>Fixas + variáveis do período corrente.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/financeiro/fixas">Abrir</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Total fixas</p>
            <p className="text-lg font-semibold">{formatMoney(s.fixedTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Variáveis do mês</p>
            <p className="text-lg font-semibold flex items-center gap-1">
              <TrendingDown className="h-4 w-4 text-rose-500" />
              {formatMoney(s.variablesTotal)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Já pago ({paidPct}%)</p>
            <p className="text-lg font-semibold text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              {formatMoney(s.fixedPaid)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Atraso</p>
            <p className={`text-lg font-semibold flex items-center gap-1 ${s.fixedOverdue > 0 ? "text-rose-500" : "text-muted-foreground"}`}>
              {s.fixedOverdue > 0 ? <AlertTriangle className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
              {formatMoney(s.fixedOverdue)}
            </p>
          </div>
        </div>

        {s.fixedTotal > 0 && (
          <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${paidPct}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
