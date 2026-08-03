import { useState, useEffect } from "react";
import { Plus, Minus, Sliders } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Product, StockMoveType } from "@/types/delvor";

interface StockAdjustDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado quando uma movimentação é gravada com sucesso. */
  onAdjusted?: () => void;
}

type Mode = "in" | "out" | "set";

export default function StockAdjustDialog({
  product,
  open,
  onOpenChange,
  onAdjusted,
}: StockAdjustDialogProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("in");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && product) {
      setMode("in");
      setQty("");
      setUnitCost(product.cost_price ? String(product.cost_price).replace(".", ",") : "");
      setNotes("");
    }
  }, [open, product]);

  if (!product) return null;

  function parseNum(v: string): number {
    const n = parseFloat(v.replace(",", "."));
    return isNaN(n) ? 0 : n;
  }

  async function save() {
    if (!product || !user?.company_id) return;
    const qtyNum = parseNum(qty);
    if (qtyNum <= 0) {
      toast({ title: "Quantidade inválida", variant: "destructive" });
      return;
    }
    setSaving(true);

    let move_type: StockMoveType;
    let qtyToInsert = qtyNum;

    if (mode === "in") {
      move_type = "entrada";
    } else if (mode === "out") {
      move_type = "saida";
    } else {
      // set: ajusta para o valor desejado (delta = novo - atual)
      move_type = "ajuste";
      qtyToInsert = qtyNum - product.stock_qty;
      if (qtyToInsert === 0) {
        toast({ title: "Estoque já está nesse valor" });
        setSaving(false);
        return;
      }
    }

    const { error } = await supabase.from("stock_movements" as any).insert({
      company_id: user.company_id,
      product_id: product.id,
      move_type,
      qty: qtyToInsert,
      unit_cost: unitCost ? parseNum(unitCost) : null,
      reference: mode === "set" ? "Ajuste manual de estoque" : "Movimentação manual",
      user_id: user.id,
      notes: notes.trim() || null,
    });

    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Estoque atualizado",
      description: `${product.name}: ${mode === "in" ? "+" : mode === "out" ? "-" : "="}${qtyNum}`,
    });
    onOpenChange(false);
    onAdjusted?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste de estoque</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{product.name}</span>
            <br />
            Estoque atual: <span className="font-mono">{product.stock_qty} {product.unit}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Toggle de modo */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant={mode === "in" ? "default" : "outline"}
              onClick={() => setMode("in")}
              className={mode === "in" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            >
              <Plus className="h-4 w-4 mr-1" /> Entrada
            </Button>
            <Button
              type="button"
              variant={mode === "out" ? "default" : "outline"}
              onClick={() => setMode("out")}
              className={mode === "out" ? "bg-rose-600 hover:bg-rose-700 text-white" : ""}
            >
              <Minus className="h-4 w-4 mr-1" /> Saída
            </Button>
            <Button
              type="button"
              variant={mode === "set" ? "default" : "outline"}
              onClick={() => setMode("set")}
            >
              <Sliders className="h-4 w-4 mr-1" /> Ajustar
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>
                {mode === "set" ? `Novo estoque (${product.unit})` : `Quantidade (${product.unit})`}
              </Label>
              <Input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                autoFocus
              />
            </div>
            {mode === "in" && (
              <div>
                <Label>Custo unitário (R$)</Label>
                <Input
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </div>
            )}
          </div>

          <div>
            <Label>Observação</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo do ajuste, NF de origem, etc."
            />
          </div>

          {mode === "set" && qty && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
              Diferença: <b>{(parseNum(qty) - product.stock_qty).toFixed(2)} {product.unit}</b>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
