/* =====================================================================
   Fechamento de mês (núcleo, migration 62)
   Mês fechado congela vendas, baixas, contas e transferências daquele
   período. Fecha: financeiro/admin. Reabre: só admin, com motivo.
   Idêntico nos dois repos.
===================================================================== */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, Lock, LockOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ReasonDialog, type ReasonRequest } from "@/components/finance/Dialogs";
import { closeFinanceMonth, fetchFinanceMonths, MISSING_DB_MSG, reopenFinanceMonth, type FinanceMonth } from "@/lib/finance";
import { localISODate } from "@/lib/receivables";

const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (iso: string) => `${MES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
const fmtTs = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString("pt-BR") : "");

export default function Fechamento() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const canClose = hasRole("admin") || hasRole("financeiro") || hasRole("super_admin");
  const canReopen = hasRole("admin") || hasRole("super_admin");

  const [months, setMonths] = useState<FinanceMonth[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonReq, setReasonReq] = useState<ReasonRequest | null>(null);

  const load = useCallback(async () => {
    const r = await fetchFinanceMonths(12);
    setMissing(!!r.missing);
    setError(r.missing ? null : r.error);
    setMonths(r.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const curMonth = `${localISODate().slice(0, 7)}-01`;

  async function close(m: FinanceMonth) {
    const pend = m.receivables_open + m.payables_open + m.boletos_to_issue + m.cash_sessions_open;
    const msg = pend > 0
      ? `Fechar ${monthName(m.month)} com pendências?\n\nO que está em aberto continua podendo ser pago depois, mas vendas, valores e vencimentos desse mês ficam travados.`
      : `Fechar ${monthName(m.month)}?\n\nVendas, baixas, contas e transferências desse mês ficam travadas. Só um administrador reabre.`;
    if (!window.confirm(msg)) return;
    setBusy(m.month);
    const { error } = await closeFinanceMonth(m.month);
    setBusy(null);
    if (error) { toast({ title: "Não foi possível fechar", description: error, variant: "destructive" }); return; }
    toast({ title: `${monthName(m.month)} fechado` });
    load();
  }

  function reopen(m: FinanceMonth) {
    setReasonReq({
      title: `Reabrir ${monthName(m.month)}`,
      description: "O mês volta a aceitar alterações. O motivo fica registrado.",
      confirmLabel: "Reabrir mês",
      placeholder: "Ex.: nota de fornecedor chegou atrasada",
      onConfirm: async (reason) => {
        const { error } = await reopenFinanceMonth(m.month, reason);
        if (error) return error;
        toast({ title: `${monthName(m.month)} reaberto` });
        load();
        return null;
      },
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"><Lock className="h-5 w-5 text-primary" /> Fechamento de mês</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Depois de conferir o mês, feche: ninguém mais altera vendas, baixas, valores ou vencimentos daquele período sem um administrador reabrir.
          Contas vencidas de um mês fechado continuam podendo ser pagas.
        </p>
      </div>

      {missing ? (
        <div className="rounded-[10px] border bg-card px-6 py-14 text-center text-sm text-muted-foreground">{MISSING_DB_MSG}</div>
      ) : error ? (
        <div className="rounded-[10px] border bg-card px-6 py-14 text-center text-sm text-muted-foreground">Não foi possível carregar: {error}</div>
      ) : !months ? (
        <div className="flex items-center justify-center rounded-[10px] border bg-card py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>
      ) : (
        <div className="divide-y rounded-[10px] border bg-card">
          {months.map((m) => {
            const isCurrent = m.month >= curMonth;
            const items = [
              m.boletos_to_issue > 0 && { n: m.boletos_to_issue, t: `boleto${m.boletos_to_issue > 1 ? "s" : ""} a emitir`, to: "/financeiro/receber" },
              m.receivables_open > 0 && { n: m.receivables_open, t: `recebimento${m.receivables_open > 1 ? "s" : ""} em aberto`, to: "/financeiro/receber" },
              m.payables_open > 0 && { n: m.payables_open, t: `conta${m.payables_open > 1 ? "s" : ""} a pagar em aberto`, to: "/financeiro/pagar" },
              m.cash_sessions_open > 0 && { n: m.cash_sessions_open, t: `caixa${m.cash_sessions_open > 1 ? "s" : ""} não fechado${m.cash_sessions_open > 1 ? "s" : ""}`, to: "/pdv" },
              m.payments_no_account > 0 && { n: m.payments_no_account, t: `baixa${m.payments_no_account > 1 ? "s" : ""} sem conta informada`, to: "/financeiro/receber" },
            ].filter(Boolean) as { n: number; t: string; to: string }[];
            return (
              <div key={m.month} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                <div className="flex w-48 items-center gap-2.5">
                  {m.closed
                    ? <Lock className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    : <LockOpen className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div>
                    <div className="font-medium capitalize">{monthName(m.month)}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.closed
                        ? `fechado ${fmtTs(m.closed_at)}${m.closed_by_name ? ` por ${m.closed_by_name}` : ""}`
                        : isCurrent ? "mês corrente" : m.reopened_at ? `reaberto ${fmtTs(m.reopened_at)}` : "aberto"}
                    </div>
                  </div>
                </div>

                <div className="min-w-0 flex-1 text-sm">
                  {items.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> sem pendências</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((it) => (
                        <Link key={it.t} to={it.to} className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 hover:underline dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> {it.n} {it.t}
                        </Link>
                      ))}
                    </div>
                  )}
                  {!m.closed && m.reopen_reason && <div className="mt-1 text-xs text-muted-foreground">Motivo da reabertura: {m.reopen_reason}{m.reopened_by_name ? ` (${m.reopened_by_name})` : ""}</div>}
                </div>

                <div className="ml-auto">
                  {m.closed ? (
                    canReopen && <Button size="sm" variant="ghost" onClick={() => reopen(m)}><LockOpen className="mr-1.5 h-4 w-4" /> Reabrir</Button>
                  ) : isCurrent ? null : canClose ? (
                    <Button size="sm" variant="outline" onClick={() => close(m)} disabled={busy === m.month}>
                      {busy === m.month ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Lock className="mr-1.5 h-4 w-4" />} Fechar mês
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">quem fecha: financeiro ou admin</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ReasonDialog request={reasonReq} onClose={() => setReasonReq(null)} />
    </div>
  );
}
