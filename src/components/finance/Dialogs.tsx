/* Diálogos compartilhados do financeiro: motivo (estorno, cancelamento,
   reabertura) e histórico de um lançamento. Idêntico nos dois repos. */
import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/formatters";
import { fetchFinanceHistory, MISSING_DB_MSG, type HistoryEntry } from "@/lib/finance";

/* ---------- Motivo ---------- */
export type ReasonRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  placeholder?: string;
  required?: boolean;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<string | null>; // devolve erro ou null
};

export function ReasonDialog({ request, onClose }: { request: ReasonRequest | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(""); setError(null); setBusy(false); }, [request]);
  if (!request) return null;
  const required = request.required ?? true;

  async function confirm() {
    if (required && !reason.trim()) { setError("Escreva o motivo; ele fica no histórico."); return; }
    setBusy(true);
    const err = await request!.onConfirm(reason.trim());
    setBusy(false);
    if (err) { setError(err); return; }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reason-text" className="text-xs">Motivo {required ? "*" : <span className="text-muted-foreground">(opcional)</span>}</Label>
          <Textarea id="reason-text" value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder={request.placeholder || "Ex.: cliente estornou o pix; lançado em duplicidade"} autoFocus />
          {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button variant={request.destructive ? "destructive" : "default"} onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{request.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Histórico ---------- */
const ACTION_LABEL: Record<string, string> = {
  baixa: "Baixa registrada",
  estorno: "Baixa desfeita",
  emissao: "Boleto emitido",
  emissao_desfeita: "Emissão desfeita",
  valor_alterado: "Valor alterado",
  vencimento_alterado: "Vencimento alterado",
  alteracao: "Alteração",
  exclusao: "Excluído",
  saldo_de_parcial: "Saldo de pagamento parcial",
  criacao: "Lançado",
  pagamento: "Pago",
  pagamento_desfeito: "Pagamento desfeito",
  cancelamento: "Cancelado",
};
const FIELD_LABEL: Record<string, string> = {
  status: "situação", amount: "valor", received_amount: "valor recebido", paid_amount: "valor pago", fee_amount: "taxa",
  due_date: "vencimento", paid_at: "pago em", method: "forma", payment_method: "forma", issue_status: "emissão",
  boleto_line: "linha digitável", account_id: "conta", description: "descrição", category_id: "categoria",
  supplier_id: "fornecedor", document_number: "documento",
};
const MONEY = new Set(["amount", "received_amount", "paid_amount", "fee_amount"]);
const HIDE = new Set(["cash_session_id", "parent_id", "account_id", "category_id", "supplier_id", "boleto_line"]);

function fmtVal(k: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (MONEY.has(k)) return formatBRL(Number(v));
  if (k === "due_date") { const s = String(v); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; }
  if (k === "paid_at") return new Date(String(v)).toLocaleDateString("pt-BR");
  return String(v).replace(/_/g, " ");
}

export function HistoryDialog({
  target, onClose,
}: { target: { entity: "sale_payment" | "payable"; id: string; title: string } | null; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!target) return;
    setRows(null);
    fetchFinanceHistory(target.entity, target.id).then((r) => { setMissing(!!r.missing); setRows(r.data); });
  }, [target]);
  if (!target) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Histórico</DialogTitle>
          <DialogDescription>{target.title}</DialogDescription>
        </DialogHeader>
        {missing ? (
          <p className="text-sm text-muted-foreground">{MISSING_DB_MSG}</p>
        ) : rows === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma alteração registrada desde que o histórico foi ligado.</p>
        ) : (
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((h, i) => {
              const keys = Object.keys({ ...(h.old_data || {}), ...(h.new_data || {}) }).filter((k) => FIELD_LABEL[k] && !HIDE.has(k));
              return (
                <li key={i} className="rounded-md border px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{ACTION_LABEL[h.action] || h.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {h.user_name}
                    </span>
                  </div>
                  {keys.length > 0 && h.action !== "criacao" && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {keys.map((k) => (
                        <li key={k}>
                          {FIELD_LABEL[k]}: {h.old_data && k in h.old_data ? <span className="line-through">{fmtVal(k, h.old_data[k])}</span> : null}
                          {h.old_data && k in h.old_data ? " → " : ""}
                          <span className="text-foreground">{fmtVal(k, h.new_data?.[k])}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {h.action === "criacao" && h.new_data && (
                    <div className="mt-1 text-xs text-muted-foreground">{fmtVal("amount", h.new_data.amount)} · vence {fmtVal("due_date", h.new_data.due_date)}</div>
                  )}
                  {h.reason && <div className="mt-1.5 rounded bg-muted/60 px-2 py-1 text-xs">Motivo: {h.reason}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
