/**
 * Modal de VISUALIZAÇÃO de venda — read-only.
 *
 * Diferente do SaleEditor (que é o editor completo), este é só pra dar uma
 * "espiada" rápida no que tem dentro de uma venda: cabeçalho, itens,
 * pagamentos, totais. Bom pra abrir a partir de listas (Caixa, Recibo,
 * Histórico do cliente, etc.) sem precisar navegar pra outra página.
 *
 * Tem 2 ações:
 *   • Imprimir   → gera o PDF já no diálogo de impressão
 *   • Abrir venda → navega pro editor (`/sales/:id`)
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Printer, ExternalLink, FileText } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import type { Sale, SaleItem, SalePayment, Customer } from "@/types/delvor";
import { SALE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDateBR } from "@/lib/formatters";
import { generateSalePdf } from "@/lib/salePdf";
import { imageToDataUrl, loadCompanyHeader } from "@/lib/companyInfo";

const PAYMENT_LABEL: Record<string, string> = {
  dinheiro:           "Dinheiro",
  pix:                "PIX",
  boleto:             "Boleto",
  cartao_credito:     "Cartão crédito",
  cartao_debito:      "Cartão débito",
  credito_avista:     "Crédito à vista",
  credito_parcelado:  "Crédito parcelado",
  transferencia:      "Transferência",
  crediario:          "Crediário",
  outro:              "Outro",
};

interface SaleViewDialogProps {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SaleViewDialog({ saleId, open, onOpenChange }: SaleViewDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [sellerName, setSellerName] = useState<string>("");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!open || !saleId) {
      setSale(null); setCustomer(null); setItems([]); setPayments([]); setSellerName("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [sr, ir, pr] = await Promise.all([
        supabase.from("sales" as any).select("*").eq("id", saleId).maybeSingle(),
        supabase.from("sale_items" as any).select("*").eq("sale_id", saleId).order("position"),
        supabase.from("sale_payments" as any).select("*").eq("sale_id", saleId).order("due_date", { nullsFirst: false }),
      ]);
      if (cancelled) return;
      if (sr.error || !sr.data) {
        toast({ title: "Venda não encontrada", variant: "destructive" });
        setLoading(false);
        onOpenChange(false);
        return;
      }
      const s = sr.data as Sale;
      setSale(s);
      setItems((ir.data as any[]) ?? []);
      setPayments((pr.data as any[]) ?? []);
      // Cliente + vendedor em paralelo, sem bloquear o load principal
      void (async () => {
        if (s.customer_id) {
          const { data: c } = await supabase
            .from("customers" as any).select("*").eq("id", s.customer_id).maybeSingle();
          if (!cancelled) setCustomer((c as any) || null);
        }
        if (s.seller_id) {
          const { data: p } = await supabase
            .from("profiles" as any).select("nome").eq("id", s.seller_id).maybeSingle();
          if (!cancelled) setSellerName((p as any)?.nome || "");
        }
      })();
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, saleId, onOpenChange]);

  async function handlePrint() {
    if (!sale || !user?.company_id) return;
    setPrinting(true);
    const company = await loadCompanyHeader(user.company_id);
    const logoData = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;
    generateSalePdf({
      sale, customer, items, payments,
      company, companyLogoDataUrl: logoData,
      companyName: user?.company_name || "Delvor",
      sellerName: sellerName || user?.nome,
      output: "print",
    });
    setPrinting(false);
  }

  const statusMeta = sale ? SALE_STATUS_LABELS[sale.status] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {sale ? `Venda #${String(sale.number).padStart(6, "0")}` : "Visualizar venda"}
            {statusMeta && (
              <Badge className={`${statusMeta.tone} ring-1 ml-1`}>{statusMeta.label}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading || !sale ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando venda...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Cabeçalho */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Cliente</div>
                <div className="font-medium">{customer?.name || "—"}</div>
                {customer?.trade_name && (
                  <div className="text-xs text-muted-foreground">{customer.trade_name}</div>
                )}
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Vendedor</div>
                <div>{sellerName || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Emissão</div>
                <div>{formatDateBR(sale.issue_date)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Entrega</div>
                <div>{formatDateBR(sale.delivery_date)}</div>
              </div>
            </div>

            {/* Itens */}
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-16 text-right">Qtd</TableHead>
                    <TableHead className="w-24 text-right">Unit.</TableHead>
                    <TableHead className="w-24 text-right">Desc.</TableHead>
                    <TableHead className="w-28 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">
                        Sem itens.
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map((it, i) => (
                    <TableRow key={it.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">{it.description}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{it.qty}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatBRL(it.unit_price)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {it.discount ? formatBRL(it.discount) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatBRL(it.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Totais */}
            <div className="rounded-lg bg-muted/30 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{formatBRL(sale.subtotal)}</span>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between text-rose-700 dark:text-rose-400">
                  <span>Desconto</span>
                  <span className="font-mono">− {formatBRL(sale.discount)}</span>
                </div>
              )}
              {sale.freight > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frete</span>
                  <span className="font-mono">{formatBRL(sale.freight)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t mt-1">
                <span>Total</span>
                <span className="font-mono text-base">{formatBRL(sale.total)}</span>
              </div>
            </div>

            {/* Pagamentos */}
            {payments.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Forma de pagamento
                </div>
                <div className="rounded-lg border divide-y">
                  {payments.map((p) => (
                    <div key={p.id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <span>{PAYMENT_LABEL[p.method] || p.method}</span>
                        {p.due_date && (
                          <span className="text-xs text-muted-foreground">
                            venc. {formatDateBR(p.due_date)}
                          </span>
                        )}
                        <Badge variant="outline" className={`text-[10px] ${
                          p.status === "pago" ? "text-emerald-700 dark:text-emerald-400" :
                          p.status === "atrasado" ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"
                        }`}>
                          {p.status}
                        </Badge>
                      </div>
                      <span className="font-mono font-semibold">{formatBRL(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Observações */}
            {sale.notes && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  Observações
                </div>
                <div className="text-sm whitespace-pre-wrap rounded-md bg-muted/30 p-2.5">
                  {sale.notes}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {sale && (
            <>
              <Button variant="outline" onClick={handlePrint} disabled={printing}>
                {printing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Printer className="h-4 w-4 mr-1" />}
                Imprimir
              </Button>
              <Button onClick={() => { onOpenChange(false); navigate(`/sales/${sale.id}`); }}>
                <ExternalLink className="h-4 w-4 mr-1" /> Abrir editor
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
