import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Product, ProductType } from "@/types/delvor";

interface QuickProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  /** Pré-define o tipo (ex: 'peca' ao adicionar peça em OS). Default: 'suprimento'. */
  defaultType?: ProductType;
  /** Pré-define o estoque inicial. Útil em compras (vai dar entrada ao salvar). */
  defaultStockQty?: number;
  onCreated?: (product: Product) => void;
}

const TYPE_OPTS: { value: ProductType; label: string }[] = [
  { value: "equipamento",     label: "Equipamento" },
  { value: "suprimento",      label: "Suprimento" },
  { value: "peca",            label: "Peça" },
  { value: "acessorio",       label: "Acessório" },
];

function parseNum(v: string): number {
  const n = parseFloat((v || "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function QuickProductDialog({
  open, onOpenChange, initialName, defaultType = "suprimento", defaultStockQty = 0, onCreated,
}: QuickProductDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [type, setType] = useState<ProductType>(defaultType);
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [stockQty, setStockQty] = useState("0");
  const [unit, setUnit] = useState("UN");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName || "");
    setSku("");
    setType(defaultType);
    setCostPrice(""); setSalePrice("");
    setStockQty(String(defaultStockQty));
    setUnit("UN");
  }, [open, initialName, defaultType, defaultStockQty]);

  async function save() {
    if (!user?.company_id) return;
    if (!name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const initialStock = parseNum(stockQty);
    const payload: any = {
      company_id: user.company_id,
      name: name.trim(),
      sku: sku.trim() || null,
      type,
      cost_price: parseNum(costPrice),
      sale_price: parseNum(salePrice),
      unit: unit.trim().toUpperCase() || "UN",
      stock_qty: 0,    // será atualizado via stock_movement abaixo se houver
      stock_min: 0,
      active: true,
    };

    const { data, error } = await supabase
      .from("products" as any)
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      setSaving(false);
      toast({ title: "Erro ao criar produto", description: error?.message, variant: "destructive" });
      return;
    }

    const newProduct = data as Product;

    // Estoque inicial via stock_movements (mantém histórico)
    if (initialStock > 0) {
      await supabase.from("stock_movements" as any).insert({
        company_id: user.company_id,
        product_id: newProduct.id,
        move_type: "entrada",
        qty: initialStock,
        unit_cost: parseNum(costPrice) || null,
        reference: "Estoque inicial (cadastro rápido)",
        user_id: user.id,
      });
      // Atualiza o objeto retornado pra refletir o estoque (otimista)
      newProduct.stock_qty = initialStock;
    }

    setSaving(false);
    toast({ title: "Produto cadastrado" });
    onOpenChange(false);
    onCreated?.(newProduct);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Cadastrar produto
          </DialogTitle>
          <DialogDescription>
            Cadastro rápido — você pode completar imagem, categoria e fornecedor em <b>Estoque</b> depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Nome *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Toner HP CF258A" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="TN-CF258A" />
            </div>
            <div className="col-span-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v: ProductType) => setType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Custo (R$)</Label>
              <Input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label>Venda (R$)</Label>
              <Input value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label>Unidade</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} maxLength={6} />
            </div>
          </div>

          <div>
            <Label>Estoque inicial</Label>
            <Input value={stockQty} onChange={(e) => setStockQty(e.target.value)} inputMode="decimal" placeholder="0" />
            <div className="text-[11px] text-muted-foreground mt-1">
              Cria uma entrada no histórico de movimentações.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
