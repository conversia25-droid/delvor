import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Product, ProductCategory, ProductType, Supplier } from "@/types/delvor";
import ImageUpload from "./ImageUpload";

interface ProductFormDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  categories: ProductCategory[];
  suppliers: Supplier[];
}

type FormState = {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  model: string;
  type: ProductType;
  description: string;
  image_url: string | null;
  cost_price: string;
  sale_price: string;
  stock_qty: string;       // só usado na criação inicial
  stock_min: string;
  stock_max: string;
  unit: string;
  category_id: string;     // "" = nenhuma
  supplier_id: string;
  compatibility: string;   // separado por vírgula
  active: boolean;
};

const EMPTY: FormState = {
  sku: "",
  barcode: "",
  name: "",
  brand: "",
  model: "",
  type: "suprimento",
  description: "",
  image_url: null,
  cost_price: "",
  sale_price: "",
  stock_qty: "0",
  stock_min: "0",
  stock_max: "",
  unit: "UN",
  category_id: "",
  supplier_id: "",
  compatibility: "",
  active: true,
};

const TYPE_OPTS: { value: ProductType; label: string }[] = [
  { value: "equipamento",     label: "Equipamento" },
  { value: "suprimento",      label: "Suprimento" },
  { value: "peca",            label: "Peça" },
  { value: "acessorio",       label: "Acessório" },
  { value: "servico_avulso",  label: "Serviço avulso" },
];

function toForm(p: Product): FormState {
  return {
    id: p.id,
    sku: p.sku || "",
    barcode: p.barcode || "",
    name: p.name,
    brand: p.brand || "",
    model: p.model || "",
    type: p.type,
    description: p.description || "",
    image_url: p.image_url || null,
    cost_price: p.cost_price ? String(p.cost_price).replace(".", ",") : "",
    sale_price: p.sale_price ? String(p.sale_price).replace(".", ",") : "",
    stock_qty: String(p.stock_qty),
    stock_min: p.stock_min != null ? String(p.stock_min) : "0",
    stock_max: p.stock_max != null ? String(p.stock_max) : "",
    unit: p.unit || "UN",
    category_id: p.category_id || "",
    supplier_id: p.supplier_id || "",
    compatibility: p.compatibility ? p.compatibility.join(", ") : "",
    active: p.active,
  };
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function ProductFormDialog({
  product,
  open,
  onOpenChange,
  onSaved,
  categories,
  suppliers,
}: ProductFormDialogProps) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(product ? toForm(product) : EMPTY);
    }
  }, [open, product]);

  async function save() {
    if (!user?.company_id) return;
    if (!form.name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload: any = {
      company_id: user.company_id,
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      type: form.type,
      description: form.description.trim() || null,
      image_url: form.image_url,
      cost_price: parseNum(form.cost_price),
      sale_price: parseNum(form.sale_price),
      stock_min: form.stock_min ? parseNum(form.stock_min) : 0,
      stock_max: form.stock_max ? parseNum(form.stock_max) : null,
      unit: form.unit.trim().toUpperCase() || "UN",
      category_id: form.category_id || null,
      supplier_id: form.supplier_id || null,
      compatibility: form.compatibility
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      active: form.active,
    };

    let resp;
    if (form.id) {
      resp = await supabase.from("products" as any).update(payload).eq("id", form.id);
    } else {
      // No insert, define stock_qty inicial via insert direto e cria movimento de "ajuste"
      // pra deixar histórico coerente.
      const initialStock = parseNum(form.stock_qty);
      payload.stock_qty = 0; // será atualizado pelo movimento abaixo
      resp = await supabase.from("products" as any).insert(payload).select().single();

      if (!resp.error && initialStock > 0) {
        const newId = (resp.data as any)?.id;
        if (newId) {
          await supabase.from("stock_movements" as any).insert({
            company_id: user.company_id,
            product_id: newId,
            move_type: "entrada",
            qty: initialStock,
            unit_cost: parseNum(form.cost_price) || null,
            reference: "Estoque inicial",
            user_id: user.id,
          });
        }
      }
    }

    setSaving(false);
    if (resp.error) {
      toast({ title: "Erro ao salvar", description: resp.error.message, variant: "destructive" });
      return;
    }
    toast({ title: form.id ? "Produto atualizado" : "Produto cadastrado" });
    onOpenChange(false);
    onSaved?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            Cadastro completo: identificação, comercial e estoque.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-6">
          {/* Coluna esquerda: imagem */}
          <div>
            <Label className="mb-2 block">Foto</Label>
            <ImageUpload
              bucket="product-images"
              folder={user?.company_id || undefined}
              value={form.image_url}
              onChange={(url) => setForm((f) => ({ ...f, image_url: url }))}
              placeholder="Foto do produto (até 5MB)"
            />
          </div>

          {/* Coluna direita: campos */}
          <div className="space-y-4">
            {/* Identificação */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="TN-CF258A"
                />
              </div>
              <div>
                <Label>Código de barras</Label>
                <Input
                  value={form.barcode}
                  onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                  placeholder="EAN/UPC"
                />
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select
                  value={form.type}
                  onValueChange={(v: ProductType) => setForm((f) => ({ ...f, type: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Toner HP CF258A"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Marca</Label>
                <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="HP" />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="CF258A" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <Select
                  value={form.category_id || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, category_id: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem categoria</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fornecedor</Label>
                <Select
                  value={form.supplier_id || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem fornecedor</SelectItem>
                    {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Comercial */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Custo (R$)</Label>
                <Input
                  value={form.cost_price}
                  onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label>Venda (R$)</Label>
                <Input
                  value={form.sale_price}
                  onChange={(e) => setForm((f) => ({ ...f, sale_price: e.target.value }))}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label>Unidade</Label>
                <Input
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value.toUpperCase() }))}
                  placeholder="UN"
                  maxLength={6}
                />
              </div>
            </div>

            {/* Estoque */}
            <div className="grid grid-cols-3 gap-3">
              {!form.id && (
                <div>
                  <Label>Estoque inicial</Label>
                  <Input
                    value={form.stock_qty}
                    onChange={(e) => setForm((f) => ({ ...f, stock_qty: e.target.value }))}
                    placeholder="0"
                    inputMode="decimal"
                  />
                </div>
              )}
              <div>
                <Label>Estoque mín.</Label>
                <Input
                  value={form.stock_min}
                  onChange={(e) => setForm((f) => ({ ...f, stock_min: e.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label>Estoque máx.</Label>
                <Input
                  value={form.stock_max}
                  onChange={(e) => setForm((f) => ({ ...f, stock_max: e.target.value }))}
                  placeholder="—"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div>
              <Label>Compatibilidade</Label>
              <Input
                value={form.compatibility}
                onChange={(e) => setForm((f) => ({ ...f, compatibility: e.target.value }))}
                placeholder="HP M428, HP M404, ... (separar por vírgula)"
              />
            </div>

            <div>
              <Label>Descrição</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="prod-active">Ativo</Label>
              <Switch
                id="prod-active"
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
