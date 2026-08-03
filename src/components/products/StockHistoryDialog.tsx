import { useEffect, useState } from "react";
import { History, ArrowDown, ArrowUp, Sliders } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import type { Product, StockMovement, StockMoveType } from "@/types/delvor";
import { usePermissions } from "@/hooks/usePermissions";

interface StockHistoryDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MOVE_LABEL: Record<StockMoveType, { label: string; tone: string; icon: any; sign: 1 | -1 | 0 }> = {
  entrada:        { label: "Entrada",          tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", icon: ArrowUp,    sign: 1  },
  saida:          { label: "Saída",            tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30",          icon: ArrowDown,  sign: -1 },
  ajuste:         { label: "Ajuste",           tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30",        icon: Sliders,    sign: 0  },
  transferencia:  { label: "Transferência",    tone: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30",          icon: ArrowDown,  sign: 0  },
  reserva:        { label: "Reserva",          tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30",     icon: Sliders,    sign: 0  },
  baixa_os:       { label: "Baixa por OS",     tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30",          icon: ArrowDown,  sign: -1 },
  baixa_venda:    { label: "Baixa por venda",  tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30",          icon: ArrowDown,  sign: -1 },
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function StockHistoryDialog({
  product,
  open,
  onOpenChange,
}: StockHistoryDialogProps) {
  const { canSeePricing } = usePermissions();
  const [items, setItems] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !product) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("stock_movements" as any)
        .select("*")
        .eq("product_id", product.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      setLoading(false);
      if (error) {
        toast({ title: "Erro ao carregar histórico", description: error.message, variant: "destructive" });
        return;
      }
      setItems((data as any[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [open, product]);

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Histórico de movimentações
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{product.name}</span>
            <br />
            Estoque atual: <span className="font-mono">{product.stock_qty} {product.unit}</span>
            {" "}— últimas 100 movimentações.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Quando</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right w-28">Qtd</TableHead>
                {canSeePricing && <TableHead className="text-right w-32">Custo unit.</TableHead>}
                <TableHead>Referência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={canSeePricing ? 5 : 4} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow><TableCell colSpan={canSeePricing ? 5 : 4} className="text-center py-6 text-muted-foreground">Sem movimentações.</TableCell></TableRow>
              )}
              {!loading && items.map((m) => {
                const meta = MOVE_LABEL[m.move_type];
                const Icon = meta.icon;
                const signed = meta.sign === -1 ? -Math.abs(m.qty) : m.qty;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${meta.tone} ring-1`}>
                        <Icon className="h-3 w-3 mr-1" /> {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-mono ${signed < 0 ? "text-rose-400" : signed > 0 ? "text-emerald-400" : ""}`}>
                      {signed > 0 ? "+" : ""}{signed} {product.unit}
                    </TableCell>
                    {canSeePricing && (
                      <TableCell className="text-right text-xs">
                        {m.unit_cost != null ? m.unit_cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-xs">
                      <div className="flex flex-col">
                        {m.reference && <span>{m.reference}</span>}
                        {m.notes && <span className="text-muted-foreground">{m.notes}</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
