/**
 * Editor de venda no mobile — versão completa pra vendedor de campo.
 *
 * Estratégia de salvamento:
 *   A venda é persistida no banco assim que o vendedor escolhe o cliente
 *   (cria sale row vazia, status "orcamento"). A partir daí, cada operação
 *   (add item, edit payment, mudar status) é gravada imediatamente.
 *   Isso evita perda de dados se o vendedor fechar o app no meio.
 *
 * Status no mobile:
 *   orcamento → aprovado → faturado → entregue
 *   (vendedor pode avançar até "faturado". "Entregue" é o passo final do PDV.)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, Plus, Trash2, Check, ChevronRight, Package, Wrench,
  CreditCard, ListChecks, User, Calendar, ShoppingBag,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import MoneyInput from "@/components/MoneyInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import CustomerCombobox from "@/components/sales/CustomerCombobox";
import MobileItemPickerSheet from "@/components/mobile/MobileItemPickerSheet";

import type {
  Sale, SaleItem, SalePayment, SaleStatus,
  Customer, Product, ServiceCatalogItem,
  PaymentMethod, PaymentStatus,
} from "@/types/delvor";
import { SALE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDateBR } from "@/lib/formatters";

type ItemDraft = {
  id?: string;
  product_id: string | null;
  service_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount: number;
  position: number;
};

type PaymentDraft = {
  id?: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "dinheiro",          label: "Dinheiro" },
  { value: "pix",               label: "PIX" },
  { value: "credito_avista",    label: "Crédito à vista" },
  { value: "credito_parcelado", label: "Crédito parcelado" },
  { value: "cartao_debito",     label: "Cartão débito" },
  { value: "boleto",            label: "Boleto" },
  { value: "transferencia",     label: "Transferência" },
  { value: "crediario",         label: "Crediário" },
  { value: "outro",             label: "Outro" },
];

/** Status válidos a partir do atual — no mobile o vendedor avança até faturado. */
function allowedSaleTransitions(s: SaleStatus): SaleStatus[] {
  switch (s) {
    case "orcamento":  return ["aprovado", "cancelado", "perdido"];
    case "aprovado":   return ["faturado", "cancelado"];
    case "faturado":   return ["entregue"];
    case "entregue":   return [];
    case "cancelado":  return [];
    case "perdido":    return [];
  }
}

function parseNum(v: string | number): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function MobileSaleEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id || id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saleId, setSaleId] = useState<string | null>(isNew ? null : id || null);
  const [saleNumber, setSaleNumber] = useState<number | null>(null);
  // Venda nova já entra como "aprovado" — botão "Aprovar" foi removido do fluxo,
  // então evita ficar presa em "orcamento" sem forma de avançar.
  const [status, setStatus] = useState<SaleStatus>("aprovado");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [discount, setDiscount] = useState(0);
  const [freight, setFreight] = useState(0);
  const [notes, setNotes] = useState("");

  const [savingHeader, setSavingHeader] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [editingPaymentIdx, setEditingPaymentIdx] = useState<number | null>(null);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);

  const headerSaveTimer = useRef<number | null>(null);
  // Promise pra "ensureSale" — evita race quando várias ops disparam juntas
  const ensureSalePromiseRef = useRef<Promise<string> | null>(null);

  const closed = status === "cancelado" || status === "perdido";

  /* ─────── LOAD venda existente ─────── */
  useEffect(() => {
    if (isNew) return;
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [sr, ir, pr] = await Promise.all([
        supabase.from("sales" as any).select("*").eq("id", id).maybeSingle(),
        supabase.from("sale_items" as any).select("*").eq("sale_id", id).order("position"),
        supabase.from("sale_payments" as any).select("*").eq("sale_id", id).order("due_date", { nullsFirst: false }),
      ]);
      if (cancelled) return;
      if (!sr.data) {
        toast({ title: "Venda não encontrada", variant: "destructive" });
        navigate("/m/sales");
        return;
      }
      const s = sr.data as Sale;
      setSaleId(s.id);
      setSaleNumber(s.number);
      setStatus(s.status);
      setCustomerId(s.customer_id);
      setDiscount(s.discount || 0);
      setFreight(s.freight || 0);
      setNotes(s.notes || "");
      setItems(((ir.data as any[]) ?? []).map((i: any) => ({
        id: i.id,
        product_id: i.product_id,
        service_id: i.service_id,
        description: i.description,
        qty: Number(i.qty),
        unit_price: Number(i.unit_price),
        discount: Number(i.discount),
        position: i.position,
      })));
      setPayments(((pr.data as any[]) ?? []).map((p: any) => ({
        id: p.id,
        method: p.method,
        status: p.status,
        amount: Number(p.amount),
        due_date: p.due_date,
        paid_at: p.paid_at,
        notes: p.notes,
      })));
      // Cliente em paralelo
      if (s.customer_id) {
        supabase.from("customers" as any).select("*").eq("id", s.customer_id).maybeSingle()
          .then(({ data }) => { if (!cancelled) setCustomer((data as any) || null); });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew, navigate]);

  /* ─────── TOTAIS ─────── */
  const subtotal = useMemo(
    () => items.reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0),
    [items]
  );
  const total = Math.max(0, subtotal - discount + freight);
  const paidSum = useMemo(
    () => payments.filter((p) => p.status === "pago").reduce((s, p) => s + p.amount, 0),
    [payments]
  );
  const paymentsSum = useMemo(
    () => payments.reduce((s, p) => s + p.amount, 0),
    [payments]
  );

  /* ─────── ENSURE SALE — cria row se ainda for nova ─────── */
  async function ensureSale(): Promise<string | null> {
    if (saleId) return saleId;
    if (!user?.company_id || !user.id) return null;
    if (!customerId) {
      toast({ title: "Escolha o cliente primeiro", variant: "destructive" });
      return null;
    }
    if (ensureSalePromiseRef.current) return ensureSalePromiseRef.current;
    ensureSalePromiseRef.current = (async () => {
      const { data, error } = await supabase
        .from("sales" as any)
        .insert({
          company_id: user.company_id,
          customer_id: customerId,
          seller_id: user.id,
          status: "aprovado",
          issue_date: new Date().toISOString().slice(0, 10),
          subtotal: 0,
          discount: 0,
          freight: 0,
          total: 0,
        })
        .select("id, number")
        .single();
      if (error || !data) throw error || new Error("Sem retorno");
      const newId = (data as any).id;
      setSaleId(newId);
      setSaleNumber((data as any).number);
      // Atualiza URL pra refletir a venda criada (sem recarregar)
      window.history.replaceState({}, "", `/m/sales/${newId}`);
      return newId;
    })();
    try {
      const r = await ensureSalePromiseRef.current;
      return r;
    } catch (err: any) {
      toast({ title: "Erro ao criar venda", description: err.message, variant: "destructive" });
      ensureSalePromiseRef.current = null;
      return null;
    }
  }

  /* ─────── HEADER auto-save (discount, freight, notes) ─────── */
  function scheduleHeaderSave(patch: Partial<{ discount: number; freight: number; notes: string }>) {
    if (!saleId) return; // só salva depois que tem sale row
    if (headerSaveTimer.current) clearTimeout(headerSaveTimer.current);
    headerSaveTimer.current = window.setTimeout(async () => {
      setSavingHeader(true);
      const newSubtotal = subtotal;
      const newDiscount = patch.discount ?? discount;
      const newFreight = patch.freight ?? freight;
      const { error } = await supabase
        .from("sales" as any)
        .update({
          ...patch,
          subtotal: newSubtotal,
          total: Math.max(0, newSubtotal - newDiscount + newFreight),
          updated_at: new Date().toISOString(),
        })
        .eq("id", saleId);
      setSavingHeader(false);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        return;
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1200);
    }, 700);
  }

  /* ─────── CLIENTE ─────── */
  async function handleCustomerChange(newId: string | null, newCustomer: Customer | null) {
    setCustomerId(newId);
    setCustomer(newCustomer);
    if (saleId && newId) {
      // venda já existe → só atualiza customer_id
      const { error } = await supabase
        .from("sales" as any)
        .update({ customer_id: newId, updated_at: new Date().toISOString() })
        .eq("id", saleId);
      if (error) {
        toast({ title: "Erro ao trocar cliente", description: error.message, variant: "destructive" });
      }
    }
  }

  /* ─────── ITEMS ─────── */
  async function addItem(picked: { kind: "peca" | "servico"; data: Product | ServiceCatalogItem }) {
    const sid = await ensureSale();
    if (!sid) return;
    const lastPos = items.length > 0 ? items[items.length - 1].position : 0;
    const isPart = picked.kind === "peca";
    const product = isPart ? (picked.data as Product) : null;
    const service = !isPart ? (picked.data as ServiceCatalogItem) : null;

    // Alerta de estoque: quanto sobra depois de vender essa qtd
    if (product && product.stock_qty != null) {
      const alreadyInSale = items
        .filter((it) => it.product_id === product.id)
        .reduce((sum, it) => sum + Number(it.qty || 0), 0);
      const afterSale = Number(product.stock_qty) - (alreadyInSale + 1);
      if (afterSale < 0) {
        toast({
          title: "Estoque insuficiente",
          description: `${product.name} — disponível: ${product.stock_qty}${product.unit ? " " + product.unit : ""}`,
          variant: "destructive",
        });
      } else if (product.stock_min != null && product.stock_min > 0 && afterSale <= product.stock_min) {
        toast({
          title: "⚠️ Estoque no limite",
          description: `${product.name} ficará com ${afterSale}${product.unit ? " " + product.unit : ""} (mínimo: ${product.stock_min}). Considere repor.`,
        });
      }
    }

    const payload: any = {
      sale_id: sid,
      product_id: product?.id ?? null,
      service_id: service?.id ?? null,
      description: product?.name || service?.name || "",
      qty: 1,
      unit_price: Number(product?.sale_price ?? service?.default_price ?? 0),
      discount: 0,
      position: lastPos + 1,
    };

    const { data, error } = await supabase
      .from("sale_items" as any)
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      toast({ title: "Erro ao adicionar", description: error.message, variant: "destructive" });
      return;
    }
    const row = data as any;
    setItems((arr) => [
      ...arr,
      {
        id: row.id,
        product_id: row.product_id,
        service_id: row.service_id,
        description: row.description,
        qty: Number(row.qty),
        unit_price: Number(row.unit_price),
        discount: Number(row.discount),
        position: row.position,
      },
    ]);
    setItemPickerOpen(false);
    // recalcula header
    scheduleHeaderSave({});
    toast({ title: `${isPart ? "Peça" : "Serviço"} adicionado` });
  }

  async function saveItem(idx: number, patch: Partial<ItemDraft>) {
    const it = items[idx];
    if (!it?.id) {
      setItems((arr) => arr.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
      return;
    }
    const next = { ...it, ...patch };
    setItems((arr) => arr.map((x, i) => (i === idx ? next : x)));
    const { error } = await supabase
      .from("sale_items" as any)
      .update({
        description: next.description,
        qty: next.qty,
        unit_price: next.unit_price,
        discount: next.discount,
      })
      .eq("id", it.id);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    }
    scheduleHeaderSave({});
  }

  async function removeItem(idx: number) {
    const it = items[idx];
    if (!it) return;
    if (it.id) {
      const { error } = await supabase.from("sale_items" as any).delete().eq("id", it.id);
      if (error) {
        toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
        return;
      }
    }
    setItems((arr) => arr.filter((_, i) => i !== idx));
    setEditingItemIdx(null);
    scheduleHeaderSave({});
  }

  /* ─────── PAYMENTS ─────── */
  async function addOrUpdatePayment(draft: PaymentDraft, idx?: number) {
    const sid = await ensureSale();
    if (!sid) return;
    const isUpdate = idx !== undefined && payments[idx]?.id;
    const payload: any = {
      sale_id: sid,
      method: draft.method,
      status: draft.status,
      amount: draft.amount,
      due_date: draft.due_date,
      paid_at: draft.status === "pago" ? (draft.paid_at || new Date().toISOString()) : null,
      notes: draft.notes,
    };
    if (isUpdate) {
      const { error } = await supabase
        .from("sale_payments" as any)
        .update(payload)
        .eq("id", payments[idx!]!.id!);
      if (error) {
        toast({ title: "Erro ao salvar pagamento", description: error.message, variant: "destructive" });
        return;
      }
      setPayments((arr) => arr.map((x, i) => (i === idx ? { ...draft, id: x.id } : x)));
    } else {
      const { data, error } = await supabase
        .from("sale_payments" as any)
        .insert(payload)
        .select("*")
        .single();
      if (error || !data) {
        toast({ title: "Erro ao salvar pagamento", description: error?.message, variant: "destructive" });
        return;
      }
      setPayments((arr) => [...arr, { ...draft, id: (data as any).id }]);
    }
    setPaymentSheetOpen(false);
    setEditingPaymentIdx(null);
  }

  async function removePayment(idx: number) {
    const p = payments[idx];
    if (!p) return;
    if (p.id) {
      const { error } = await supabase.from("sale_payments" as any).delete().eq("id", p.id);
      if (error) {
        toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
        return;
      }
    }
    setPayments((arr) => arr.filter((_, i) => i !== idx));
    setEditingPaymentIdx(null);
    setPaymentSheetOpen(false);
  }

  /* ─────── STATUS ─────── */
  async function changeStatus(target: SaleStatus) {
    if (!saleId) return;
    const { error } = await supabase
      .from("sales" as any)
      .update({
        status: target,
        approved_at: target === "aprovado" ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", saleId);
    if (error) {
      toast({ title: "Erro ao mudar status", description: error.message, variant: "destructive" });
      return;
    }
    setStatus(target);
    setStatusSheetOpen(false);
    toast({ title: `Venda marcada como "${SALE_STATUS_LABELS[target]?.label}"` });
  }

  /* ─────── RENDER ─────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando venda...
      </div>
    );
  }

  const statusMeta = SALE_STATUS_LABELS[status];
  const transitions = allowedSaleTransitions(status);
  const canEditItems = !["faturado", "entregue", "cancelado", "perdido"].includes(status);

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* HEADER STICKY */}
      <div className="sticky top-14 z-20 bg-background/95 backdrop-blur border-b border-border/60 px-3 py-2 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/m/sales")} className="h-9 w-9">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            {saleNumber ? `Venda #${String(saleNumber).padStart(6, "0")}` : "Nova venda"}
          </div>
          {statusMeta && (
            <button
              onClick={() => transitions.length && setStatusSheetOpen(true)}
              disabled={transitions.length === 0}
              className="inline-flex items-center gap-1 mt-0.5 disabled:opacity-70"
            >
              <Badge className={`${statusMeta.tone} ring-1 text-[10px] px-1.5 py-0`}>
                {statusMeta.label}
              </Badge>
              {transitions.length > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground rotate-90" />}
            </button>
          )}
        </div>
        {savedFlash && (
          <div className="text-[11px] text-emerald-400 flex items-center gap-1">
            <Check className="h-3 w-3" /> Salvo
          </div>
        )}
      </div>

      <div className="px-3 py-3 space-y-4">
        {/* CLIENTE */}
        <section className="rounded-xl border border-border/60 bg-card/50 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            <User className="h-3 w-3" /> Cliente
          </div>
          <CustomerCombobox
            value={customerId}
            onChange={handleCustomerChange}
            disabled={!canEditItems}
            placeholder="Buscar cliente..."
            createMode="full"
          />
          {customer?.phone && (
            <div className="text-[11px] text-muted-foreground">
              📞 {customer.phone}
            </div>
          )}
        </section>

        {!customerId && (
          <div className="rounded-xl border-2 border-dashed border-border/60 p-6 text-center">
            <ShoppingBag className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              Escolha o cliente pra começar a venda.
            </p>
          </div>
        )}

        {customerId && (
          <>
            {/* ITEMS */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                  <ListChecks className="h-3 w-3" /> Itens
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {items.length} item{items.length !== 1 ? "s" : ""}
                </div>
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-border/60 p-4 text-center">
                  <Package className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/60" />
                  <p className="text-xs text-muted-foreground mb-3">
                    Nenhum item ainda.
                  </p>
                  {canEditItems && (
                    <Button size="sm" variant="outline" onClick={() => setItemPickerOpen(true)}>
                      <Plus className="h-4 w-4 mr-1.5" /> Adicionar
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 divide-y divide-border/40 overflow-hidden">
                  {items.map((it, idx) => {
                    const subtotalLine = it.qty * it.unit_price - (it.discount || 0);
                    return (
                      <button
                        key={it.id || `tmp-${idx}`}
                        onClick={() => canEditItems && setEditingItemIdx(idx)}
                        disabled={!canEditItems}
                        className="w-full text-left p-3 active:bg-muted/30 transition flex items-center gap-3"
                      >
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                          it.product_id ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"
                        }`}>
                          {it.product_id ? <Package className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{it.description}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {it.qty}× {formatBRL(it.unit_price)}
                            {it.discount > 0 && <span className="text-rose-400"> · −{formatBRL(it.discount)}</span>}
                          </div>
                        </div>
                        <div className="text-sm font-mono font-semibold shrink-0">{formatBRL(subtotalLine)}</div>
                      </button>
                    );
                  })}
                  <div className="p-3 bg-muted/20 flex items-center justify-between gap-2">
                    {canEditItems && (
                      <Button size="sm" variant="outline" onClick={() => setItemPickerOpen(true)}>
                        <Plus className="h-4 w-4 mr-1.5" /> Adicionar
                      </Button>
                    )}
                    <div className="text-right ml-auto">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subtotal</div>
                      <div className="font-mono font-semibold">{formatBRL(subtotal)}</div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* TOTAIS */}
            {items.length > 0 && (
              <section className="rounded-xl border border-border/60 bg-card/50 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Desconto</Label>
                    <Input
                      inputMode="decimal"
                      value={discount === 0 ? "" : String(discount).replace(".", ",")}
                      onChange={(e) => {
                        const v = parseNum(e.target.value);
                        setDiscount(v);
                        scheduleHeaderSave({ discount: v });
                      }}
                      placeholder="0,00"
                      className="h-9 text-right font-mono"
                      disabled={!canEditItems}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Frete</Label>
                    <Input
                      inputMode="decimal"
                      value={freight === 0 ? "" : String(freight).replace(".", ",")}
                      onChange={(e) => {
                        const v = parseNum(e.target.value);
                        setFreight(v);
                        scheduleHeaderSave({ freight: v });
                      }}
                      placeholder="0,00"
                      className="h-9 text-right font-mono"
                      disabled={!canEditItems}
                    />
                  </div>
                </div>
                <div className="border-t border-border/40 pt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="font-mono font-bold text-lg">{formatBRL(total)}</span>
                </div>
              </section>
            )}

            {/* PAGAMENTOS */}
            {items.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                    <CreditCard className="h-3 w-3" /> Pagamentos
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {payments.length} parcela{payments.length !== 1 ? "s" : ""}
                  </div>
                </div>
                {payments.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-border/60 p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-3">Nenhum pagamento.</p>
                    {canEditItems && (
                      <Button size="sm" variant="outline" onClick={() => { setEditingPaymentIdx(null); setPaymentSheetOpen(true); }}>
                        <Plus className="h-4 w-4 mr-1.5" /> Adicionar
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 divide-y divide-border/40 overflow-hidden">
                    {payments.map((p, idx) => (
                      <button
                        key={p.id || `pn-${idx}`}
                        onClick={() => canEditItems && (setEditingPaymentIdx(idx), setPaymentSheetOpen(true))}
                        disabled={!canEditItems}
                        className="w-full text-left p-3 active:bg-muted/30 transition flex items-center gap-3"
                      >
                        <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">
                            {PAYMENT_METHODS.find((m) => m.value === p.method)?.label || p.method}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                            {p.due_date && (
                              <span>venc. {formatDateBR(p.due_date)}</span>
                            )}
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                              p.status === "pago" ? "text-emerald-400 border-emerald-500/30" :
                              p.status === "atrasado" ? "text-rose-400 border-rose-500/30" :
                              "text-muted-foreground"
                            }`}>
                              {p.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-sm font-mono font-semibold shrink-0">{formatBRL(p.amount)}</div>
                      </button>
                    ))}
                    <div className="p-3 bg-muted/20 flex items-center justify-between gap-2">
                      {canEditItems && (
                        <Button size="sm" variant="outline" onClick={() => { setEditingPaymentIdx(null); setPaymentSheetOpen(true); }}>
                          <Plus className="h-4 w-4 mr-1.5" /> Adicionar
                        </Button>
                      )}
                      <div className="text-right ml-auto">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pago / Total</div>
                        <div className="font-mono text-xs">
                          <span className="text-emerald-400 font-semibold">{formatBRL(paidSum)}</span>
                          {" / "}{formatBRL(paymentsSum)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {payments.length > 0 && Math.abs(paymentsSum - total) > 0.01 && (
                  <div className={`text-[11px] ${paymentsSum < total ? "text-amber-400" : "text-rose-400"}`}>
                    {paymentsSum < total
                      ? `Faltam ${formatBRL(total - paymentsSum)} pra cobrir o total.`
                      : `Pagamentos excedem o total em ${formatBRL(paymentsSum - total)}.`}
                  </div>
                )}
              </section>
            )}

            {/* NOTAS */}
            <section className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Observações
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  scheduleHeaderSave({ notes: e.target.value });
                }}
                placeholder="Notas pra cliente (sai no PDF) ou referências internas..."
                className="min-h-[80px] text-sm"
                disabled={!canEditItems}
              />
            </section>
          </>
        )}
      </div>

      {/* PICKERS / SHEETS */}
      <MobileItemPickerSheet
        open={itemPickerOpen}
        onOpenChange={setItemPickerOpen}
        onPick={addItem}
        companyId={user?.company_id || null}
      />

      <ItemEditorSheet
        open={editingItemIdx !== null}
        onOpenChange={(o) => !o && setEditingItemIdx(null)}
        item={editingItemIdx !== null ? items[editingItemIdx] : null}
        onSave={(patch) => { if (editingItemIdx !== null) void saveItem(editingItemIdx, patch); setEditingItemIdx(null); }}
        onRemove={() => editingItemIdx !== null && void removeItem(editingItemIdx)}
      />

      <PaymentEditorSheet
        open={paymentSheetOpen}
        onOpenChange={(o) => { setPaymentSheetOpen(o); if (!o) setEditingPaymentIdx(null); }}
        payment={editingPaymentIdx !== null ? payments[editingPaymentIdx] : null}
        defaultAmount={Math.max(0, total - paymentsSum)}
        onSave={(draft) => void addOrUpdatePayment(draft, editingPaymentIdx ?? undefined)}
        onRemove={() => editingPaymentIdx !== null && void removePayment(editingPaymentIdx)}
      />

      {/* STATUS SHEET */}
      <Sheet open={statusSheetOpen} onOpenChange={setStatusSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[85vh]">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Mudar status da venda</SheetTitle>
          </SheetHeader>
          <div className="p-3 space-y-2">
            <p className="text-xs text-muted-foreground px-1">
              Status atual: <b>{statusMeta?.label}</b>
            </p>
            {transitions.map((target) => {
              const meta = SALE_STATUS_LABELS[target];
              if (!meta) return null;
              return (
                <button
                  key={target}
                  onClick={() => void changeStatus(target)}
                  className="w-full flex items-center gap-3 rounded-xl border border-border/60 p-3 active:bg-muted/30 transition"
                >
                  <Badge className={`${meta.tone} ring-1 text-xs`}>{meta.label}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ═══════════════ ITEM EDITOR ═══════════════ */
function ItemEditorSheet({
  open, onOpenChange, item, onSave, onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: ItemDraft | null;
  onSave: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (item) {
      setQty(String(item.qty));
      setPrice(String(item.unit_price.toFixed(2)).replace(".", ","));
      setDiscount(String((item.discount || 0).toFixed(2)).replace(".", ","));
      setDescription(item.description);
    }
  }, [item]);

  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>Editar item</SheetTitle>
        </SheetHeader>
        <div className="p-4 space-y-3">
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Quantidade</Label>
              <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-10 text-right font-mono" />
            </div>
            <div>
              <Label className="text-xs">Valor unitário</Label>
              <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="h-10 text-right font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Desconto</Label>
            <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-10 text-right font-mono" />
          </div>
          <div className="rounded-lg bg-muted/30 p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Subtotal</span>
            <span className="font-mono font-bold">{formatBRL(parseNum(qty) * parseNum(price) - parseNum(discount))}</span>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="lg" onClick={onRemove} className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
              <Trash2 className="h-4 w-4 mr-1.5" /> Remover
            </Button>
            <Button size="lg" className="flex-1" onClick={() => onSave({
              description, qty: parseNum(qty), unit_price: parseNum(price), discount: parseNum(discount),
            })}>
              <Check className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════ PAYMENT EDITOR ═══════════════ */
function PaymentEditorSheet({
  open, onOpenChange, payment, defaultAmount, onSave, onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  payment: PaymentDraft | null;
  defaultAmount: number;
  onSave: (draft: PaymentDraft) => void;
  onRemove: () => void;
}) {
  const isNew = !payment;
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [pStatus, setPStatus] = useState<PaymentStatus>("pago");
  const [amount, setAmount] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [pNotes, setPNotes] = useState("");

  useEffect(() => {
    if (open) {
      if (payment) {
        setMethod(payment.method);
        setPStatus(payment.status);
        setAmount(payment.amount);
        setDueDate(payment.due_date || "");
        setPNotes(payment.notes || "");
      } else {
        setMethod("pix");
        setPStatus("pago");
        setAmount(defaultAmount > 0 ? defaultAmount : 0);
        setDueDate(new Date().toISOString().slice(0, 10));
        setPNotes("");
      }
    }
  }, [open, payment, defaultAmount]);

  function commit() {
    const draft: PaymentDraft = {
      method,
      status: pStatus,
      amount,
      due_date: dueDate || null,
      paid_at: pStatus === "pago" ? new Date().toISOString() : null,
      notes: pNotes || null,
    };
    onSave(draft);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>{isNew ? "Adicionar pagamento" : "Editar pagamento"}</SheetTitle>
        </SheetHeader>
        <div className="p-4 space-y-3">
          <div>
            <Label className="text-xs">Método</Label>
            <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Valor</Label>
              <MoneyInput value={amount} onChange={setAmount} className="h-10 text-right font-mono" />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> Vencimento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={pStatus} onValueChange={(v: PaymentStatus) => setPStatus(v)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="pago">Pago</SelectItem>
                <SelectItem value="parcial">Parcial</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
                <SelectItem value="estornado">Estornado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-2">
            {!isNew && (
              <Button variant="outline" size="lg" onClick={onRemove} className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
                <Trash2 className="h-4 w-4 mr-1.5" /> Remover
              </Button>
            )}
            <Button size="lg" className="flex-1" onClick={commit} disabled={parseNum(amount) <= 0}>
              <Check className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
