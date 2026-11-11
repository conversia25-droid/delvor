/* Cabeçalho da conversa: pendência do cliente + criar Venda / OS.
   Acha o cliente pelo número do WhatsApp; se não tiver cadastro, abre o
   cadastro completo já com nome e WhatsApp. Idêntico nos dois repos. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, ShoppingCart, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import FullCustomerDialog from "@/components/sales/FullCustomerDialog";
import { formatBRL } from "@/lib/formatters";
import { METHOD_LABELS } from "@/lib/receivables";
import { fetchCustomerPending, findCustomerByJid, pendingMessage, type CustomerPending } from "@/lib/customerPending";

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function ChatCustomerActions({
  jid, name, onInsertText,
}: { jid: string | null; name?: string | null; onInsertText: (text: string) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [pending, setPending] = useState<CustomerPending | null>(null);
  const [checking, setChecking] = useState(false);
  const [createFor, setCreateFor] = useState<"venda" | "os" | null>(null);

  const isGroup = !!jid && /@g\.us$/i.test(jid);

  useEffect(() => {
    setCustomer(null);
    setPending(null);
    if (!jid || isGroup || !user?.company_id) return;
    let alive = true;
    setChecking(true);
    (async () => {
      const c = await findCustomerByJid(user.company_id!, jid);
      if (!alive) return;
      setCustomer(c);
      if (c) {
        const p = await fetchCustomerPending(c.id);
        if (alive) setPending(p);
      }
      if (alive) setChecking(false);
    })();
    return () => { alive = false; };
  }, [jid, isGroup, user?.company_id]);

  if (!jid || isGroup) return null;

  function go(kind: "venda" | "os", customerId: string) {
    navigate(kind === "venda" ? `/sales/new?customer=${customerId}` : `/service-orders/new?customer=${customerId}`);
  }
  function start(kind: "venda" | "os") {
    if (customer) go(kind, customer.id);
    else setCreateFor(kind);
  }

  const has = !!pending && pending.total > 0.004;
  const late = !!pending && pending.overdueCount > 0;

  return (
    <>
      {has && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              title="Valores em aberto deste cliente"
              className={`p-1.5 sm:px-2 sm:py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition ring-1 ring-inset ${
                late ? "bg-red-500/10 text-red-700 ring-red-500/30 hover:bg-red-500/15 dark:text-red-400"
                     : "bg-amber-500/10 text-amber-800 ring-amber-500/30 hover:bg-amber-500/15 dark:text-amber-400"}`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{late ? "Em atraso" : "Em aberto"}</span>
              <span className="num">{formatBRL(pending!.total)}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <div className="mb-2 text-sm font-semibold">{customer?.name}</div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {pending!.items.map((i) => (
                <button
                  key={i.id}
                  onClick={() => navigate(`/sales/${i.sale_id}`)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{METHOD_LABELS[i.method] || i.method}</span>
                    <span className="text-muted-foreground"> · venda {String(i.sale_number).padStart(6, "0")}</span>
                    <span className={`block ${i.overdue ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                      {i.due_date ? `${i.overdue ? "venceu" : "vence"} ${br(i.due_date)}` : "sem vencimento"}
                    </span>
                  </span>
                  <span className="num shrink-0 font-semibold">{formatBRL(i.amount)}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="num font-semibold">{formatBRL(pending!.total)}</span>
            </div>
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={() => onInsertText(pendingMessage({ customer: customer?.name, company: user?.company_name, items: pending!.items }))}
            >
              Colocar cobrança na conversa
            </Button>
            <p className="mt-1.5 text-[11px] text-muted-foreground">A mensagem vai para a caixa de texto; confira e envie.</p>
          </PopoverContent>
        </Popover>
      )}

      <button
        title={customer ? `Nova venda para ${customer.name}` : "Nova venda (cadastra o cliente antes)"}
        onClick={() => start("venda")}
        disabled={checking}
        className="p-1.5 sm:p-2 rounded-md hover:bg-muted transition flex items-center gap-1 text-xs font-medium disabled:opacity-50"
      >
        {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
        <span className="hidden xl:inline">Venda</span>
      </button>
      <button
        title={customer ? `Nova OS para ${customer.name}` : "Nova OS (cadastra o cliente antes)"}
        onClick={() => start("os")}
        disabled={checking}
        className="p-1.5 sm:p-2 rounded-md hover:bg-muted transition flex items-center gap-1 text-xs font-medium disabled:opacity-50"
      >
        <Wrench className="h-4 w-4" />
        <span className="hidden xl:inline">OS</span>
      </button>

      <FullCustomerDialog
        open={!!createFor}
        onOpenChange={(o) => { if (!o) setCreateFor(null); }}
        initialName={name && !/^\d+(@|$)/.test(name) ? name : ""}
        initialWhatsapp={jid.split("@")[0]}
        onCreated={(c) => {
          const kind = createFor;
          setCreateFor(null);
          setCustomer({ id: c.id, name: c.name });
          if (kind) go(kind, c.id);
        }}
      />
    </>
  );
}
