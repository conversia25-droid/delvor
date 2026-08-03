import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Loader2, Lock,
  Banknote, CreditCard, Smartphone, FileText, X, CheckCircle2, Package,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MoneyInput from "@/components/MoneyInput";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import CustomerCombobox from "@/components/sales/CustomerCombobox";
import { formatBRL } from "@/lib/formatters";
import { getOpenSession, openSession, type CashSession } from "@/lib/cashRegister";

/* ====================================================================
   TIPOS
==================================================================== */
interface SearchResult {
  id: string;
  kind: "produto" | "servico";
  name: string;
  price: number;
  stock: number | null;      // null pra serviço
  stock_min: number | null;  // idem
  sku: string | null;
  unit: string | null;
}

interface CartItem {
  key: string;
  kind: "produto" | "servico";
  product_id: string | null;
  service_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
  stock: number | null;
  stock_min: number | null;
}

type PayMethod = "dinheiro" | "pix" | "cartao_credito" | "cartao_debito" | "boleto" | "transferencia" | "crediario" | "outro";

interface Payment {
  id: string;
  method: PayMethod;
  amount: number;
}

const PAY_LABELS: Record<PayMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao_credito: "Cartão crédito",
  cartao_debito: "Cartão débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  crediario: "Crediário",
  outro: "Outro",
};

interface Props {
  onSold: () => void;
}

/* ====================================================================
   COMPONENTE
==================================================================== */
export default function QuickSaleTab({ onSold }: Props) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [session, setSession] = useState<CashSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  // abrir caixa inline (quando não tem caixa aberto)
  const [openAmount, setOpenAmount] = useState("");
  const [openingCash, setOpeningCash] = useState(false);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);

  // checkout
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [finishing, setFinishing] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);

  // índice do resultado selecionado (navegação por ↑↓)
  const [selIdx, setSelIdx] = useState(0);

  /* ─────── caixa aberto? ─────── */
  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      setLoadingSession(true);
      setSession(await getOpenSession(user.id));
      setLoadingSession(false);
    })();
  }, [user?.id]);

  // reseta seleção quando os resultados mudam
  useEffect(() => { setSelIdx(0); }, [results]);

  /* ─────── abrir caixa inline ─────── */
  async function handleOpenCash() {
    if (!companyId || !user?.id) return;
    const amount = parseFloat(openAmount.replace(/\./g, "").replace(",", ".")) || 0;
    setOpeningCash(true);
    const r = await openSession({ companyId, userId: user.id, openingAmount: amount });
    setOpeningCash(false);
    if (!r.ok) {
      toast({ title: "Erro ao abrir caixa", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Caixa aberto!", description: "Pode começar a vender." });
    setSession(r.session || null);
    setOpenAmount("");
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  /* ─────── ATALHO GLOBAL F2 (finalizar / concluir) ─────── */
  // Ref sempre com o estado atual — evita closure velha no listener.
  const hotkeyRef = useRef({ checkoutOpen: false, cartLen: 0 });
  hotkeyRef.current = { checkoutOpen, cartLen: cart.length };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        if (hotkeyRef.current.checkoutOpen) {
          document.getElementById("pdv-concluir")?.click();
        } else if (hotkeyRef.current.cartLen > 0) {
          document.getElementById("pdv-finalizar")?.click();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ─────── busca de produtos/serviços ─────── */
  useEffect(() => {
    if (!companyId) return;
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const [prodRes, servRes] = await Promise.all([
        supabase
          .from("products" as any)
          .select("id, name, sku, barcode, sale_price, stock_qty, stock_min, unit")
          .eq("company_id", companyId)
          .is("hidden_at", null)
          .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
          .limit(20),
        supabase
          .from("services_catalog" as any)
          .select("id, name, code, default_price")
          .eq("company_id", companyId)
          .eq("active", true)
          .ilike("name", `%${q}%`)
          .limit(10),
      ]);
      const prods: SearchResult[] = ((prodRes.data as any[]) || []).map((p) => ({
        id: p.id, kind: "produto", name: p.name,
        price: Number(p.sale_price || 0), stock: Number(p.stock_qty || 0),
        stock_min: p.stock_min != null ? Number(p.stock_min) : null,
        sku: p.sku, unit: p.unit,
      }));
      const servs: SearchResult[] = ((servRes.data as any[]) || []).map((s) => ({
        id: s.id, kind: "servico", name: s.name,
        price: Number(s.default_price || 0), stock: null,
        stock_min: null,
        sku: s.code, unit: null,
      }));
      setResults([...prods, ...servs]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [search, companyId]);

  /* ─────── carrinho ─────── */
  function addToCart(r: SearchResult) {
    // Alerta de estoque baixo — calcula quanto sobra depois de vender essa unidade.
    // Serviço não tem estoque, então pula. Produto sem stock_min também.
    if (r.kind === "produto" && r.stock != null) {
      const currentInCart = cart.find((c) => c.key === `${r.kind}:${r.id}`)?.qty ?? 0;
      const afterSale = r.stock - (currentInCart + 1);
      if (afterSale < 0) {
        toast({
          title: "Estoque insuficiente",
          description: `${r.name} — disponível: ${r.stock}${r.unit ? " " + r.unit : ""}`,
          variant: "destructive",
        });
      } else if (r.stock_min != null && r.stock_min > 0 && afterSale <= r.stock_min) {
        toast({
          title: "⚠️ Estoque no limite",
          description: `${r.name} ficará com ${afterSale}${r.unit ? " " + r.unit : ""} (mínimo: ${r.stock_min}). Considere repor.`,
        });
      }
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.key === `${r.kind}:${r.id}`);
      if (existing) {
        return prev.map((c) =>
          c.key === existing.key ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, {
        key: `${r.kind}:${r.id}`,
        kind: r.kind,
        product_id: r.kind === "produto" ? r.id : null,
        service_id: r.kind === "servico" ? r.id : null,
        name: r.name,
        qty: 1,
        unit_price: r.price,
        stock: r.stock,
        stock_min: r.stock_min,
      }];
    });
    setSearch("");
    setResults([]);
    searchRef.current?.focus();
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((c) => {
        if (c.key !== key) return [c];
        const q = c.qty + delta;
        return q <= 0 ? [] : [{ ...c, qty: q }];
      })
    );
  }
  function setItemPrice(key: string, price: number) {
    setCart((prev) => prev.map((c) => (c.key === key ? { ...c, unit_price: price } : c)));
  }
  function removeItem(key: string) {
    setCart((prev) => prev.filter((c) => c.key !== key));
  }

  const subtotal = useMemo(
    () => cart.reduce((s, c) => s + c.qty * c.unit_price, 0),
    [cart]
  );
  const discountNum = Math.max(0, discount);
  const total = Math.max(0, subtotal - discountNum);

  /* ─────── checkout ─────── */
  const paid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments]);
  const remaining = Math.max(0, total - paid);
  const change = Math.max(0, paid - total);

  function openCheckout() {
    if (cart.length === 0) {
      toast({ title: "Carrinho vazio", variant: "destructive" });
      return;
    }
    // Pré-popula 1 pagamento em dinheiro com o total
    setPayments([{ id: crypto.randomUUID(), method: "dinheiro", amount: total }]);
    setCheckoutOpen(true);
  }

  function addPayment() {
    setPayments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), method: "dinheiro", amount: remaining },
    ]);
  }
  function updatePayment(id: string, patch: Partial<Payment>) {
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePayment(id: string) {
    setPayments((prev) => prev.filter((p) => p.id !== id));
  }

  /* Garante um cliente "Consumidor Final" se nenhum foi escolhido */
  async function resolveCustomerId(): Promise<string | null> {
    if (customerId) return customerId;
    if (!companyId) return null;
    // procura existente
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("company_id", companyId)
      .eq("name", "Consumidor Final")
      .maybeSingle();
    if (existing) return (existing as any).id;
    // cria
    const { data: created } = await supabase
      .from("customers")
      .insert({ company_id: companyId, name: "Consumidor Final", person_type: "PF" } as any)
      .select("id")
      .single();
    return (created as any)?.id || null;
  }

  async function finishSale() {
    if (!companyId || !user?.id || !session) return;
    if (Math.abs(paid - total) > 0.01 && paid < total) {
      toast({ title: "Pagamento insuficiente", description: `Falta ${formatBRL(remaining)}`, variant: "destructive" });
      return;
    }
    setFinishing(true);
    try {
      const custId = await resolveCustomerId();
      if (!custId) throw new Error("Não foi possível resolver o cliente.");

      // 1) cria venda como 'aprovado' (passa por 'faturado' no passo 4 pra baixar estoque
      //    e termina em 'entregue' no passo 5, pois venda rápida é entrega no balcão)
      const { data: sale, error: saleErr } = await supabase
        .from("sales" as any)
        .insert({
          company_id: companyId,
          customer_id: custId,
          seller_id: user.id,
          status: "aprovado",
          issue_date: new Date().toISOString().slice(0, 10),
          subtotal,
          discount: discountNum,
          freight: 0,
          total,
          cash_session_id: session.id,
          source: "pdv",
        } as any)
        .select("id, number")
        .single();
      if (saleErr || !sale) throw new Error(saleErr?.message || "Erro ao criar venda");
      const saleId = (sale as any).id;

      // 2) itens
      const itemsPayload = cart.map((c, i) => ({
        sale_id: saleId,
        product_id: c.product_id,
        service_id: c.service_id,
        description: c.name,
        qty: c.qty,
        unit_price: c.unit_price,
        discount: 0,
        position: i,
      }));
      const { error: itemsErr } = await supabase.from("sale_items" as any).insert(itemsPayload as any);
      if (itemsErr) throw new Error(itemsErr.message);

      // 3) pagamentos
      const paysPayload = payments
        .filter((p) => p.amount > 0)
        .map((p) => ({
          sale_id: saleId,
          method: p.method,
          status: "pago",
          amount: p.amount,
          paid_at: new Date().toISOString(),
        }));
      if (paysPayload.length) {
        const { error: payErr } = await supabase.from("sale_payments" as any).insert(paysPayload as any);
        if (payErr) throw new Error(payErr.message);
      }

      // 4) marca como faturado → dispara a baixa de estoque
      //    (o trigger trg_sale_inventory só baixa estoque na transição p/ 'faturado')
      const { error: updErr } = await supabase
        .from("sales" as any)
        .update({ status: "faturado" } as any)
        .eq("id", saleId);
      if (updErr) throw new Error(updErr.message);

      // 5) venda rápida = entrega imediata no balcão → marca como 'entregue'
      const { error: deliverErr } = await supabase
        .from("sales" as any)
        .update({
          status: "entregue",
          delivery_date: new Date().toISOString().slice(0, 10),
        } as any)
        .eq("id", saleId);
      if (deliverErr) throw new Error(deliverErr.message);

      toast({
        title: "Venda concluída! 🎉",
        description: `Venda #${String((sale as any).number).padStart(6, "0")} — ${formatBRL(total)}`,
      });

      // reset
      setCart([]);
      setDiscount(0);
      setCustomerId(null);
      setPayments([]);
      setCheckoutOpen(false);
      onSold();
      searchRef.current?.focus();
    } catch (e: any) {
      toast({ title: "Erro ao finalizar", description: e?.message, variant: "destructive" });
    } finally {
      setFinishing(false);
    }
  }

  /* ════════ RENDER ════════ */
  if (loadingSession) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  // Sem caixa aberto → abre o caixa AQUI MESMO (sem trocar de aba)
  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-4 rounded-xl border bg-card p-6 text-center space-y-4">
        <div className="h-14 w-14 rounded-full bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center mx-auto">
          <Lock className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Abra o caixa pra vender</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Informe o fundo de troco e comece a registrar vendas.
          </p>
        </div>
        <div className="space-y-1.5 text-left">
          <Label htmlFor="qs-open-amount" className="text-xs">Fundo de troco (R$)</Label>
          <Input
            id="qs-open-amount"
            inputMode="decimal"
            placeholder="0,00"
            value={openAmount}
            onChange={(e) => setOpenAmount(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleOpenCash(); }}
          />
        </div>
        <Button className="w-full h-11" onClick={handleOpenCash} disabled={openingCash}>
          {openingCash
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <CheckCircle2 className="h-4 w-4 mr-2" />}
          Abrir caixa e vender
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
      {/* ─────── ESQUERDA: busca + resultados ─────── */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            autoFocus
            placeholder="Buscar produto ou serviço (nome, SKU, código de barras)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (results.length === 0) {
                if (e.key === "Escape") setSearch("");
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelIdx((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[selIdx] || results[0];
                if (r) addToCart(r);
              } else if (e.key === "Escape") {
                setSearch("");
              }
            }}
            className="pl-9 h-11"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {results.length > 0 && (
          <div className="rounded-lg border bg-card divide-y max-h-[420px] overflow-y-auto">
            {results.map((r, idx) => (
              <button
                key={`${r.kind}:${r.id}`}
                type="button"
                onClick={() => addToCart(r)}
                onMouseEnter={() => setSelIdx(idx)}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 transition ${
                  idx === selIdx ? "bg-blue-500/15 ring-1 ring-inset ring-blue-500/30" : "hover:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`h-8 w-8 rounded flex items-center justify-center shrink-0 ${
                    r.kind === "produto" ? "bg-blue-500/15 text-blue-300" : "bg-sky-500/15 text-sky-300"
                  }`}>
                    {r.kind === "produto" ? <Package className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.sku && <span className="font-mono">{r.sku}</span>}
                      {r.kind === "produto" && r.stock != null && (
                        <span className={r.stock <= 0 ? "text-rose-400 ml-2" : "ml-2"}>
                          estoque: {r.stock}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="font-mono font-semibold text-sm shrink-0">{formatBRL(r.price)}</span>
              </button>
            ))}
          </div>
        )}

        {search && !searching && results.length === 0 && (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Nada encontrado pra "{search}".
          </div>
        )}

        {!search && cart.length === 0 && (
          <div className="rounded-lg border border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
            <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
            Busque um produto pra começar a venda.
          </div>
        )}
      </div>

      {/* ─────── DIREITA: carrinho ─────── */}
      <div className="rounded-lg border bg-card flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" /> Carrinho
          </span>
          <Badge variant="secondary" className="text-xs">{cart.length} item(ns)</Badge>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[380px]">
          {cart.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Carrinho vazio</div>
          ) : (
            <div className="divide-y">
              {cart.map((c) => (
                <div key={c.key} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      {c.kind === "produto" && c.stock != null && c.qty > c.stock && (
                        <div className="text-[10px] text-amber-400">⚠ qtd acima do estoque ({c.stock})</div>
                      )}
                    </div>
                    <button onClick={() => removeItem(c.key)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(c.key, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center text-sm font-semibold">{c.qty}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQty(c.key, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">R$</span>
                      <MoneyInput
                        value={c.unit_price}
                        onChange={(v) => setItemPrice(c.key, v)}
                        className="h-7 w-20 text-right text-sm"
                      />
                    </div>
                    <span className="font-mono font-semibold text-sm w-24 text-right">
                      {formatBRL(c.qty * c.unit_price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totais */}
        <div className="border-t p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono">{formatBRL(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Desconto</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">R$</span>
              <MoneyInput
                value={discount}
                onChange={setDiscount}
                className="h-7 w-24 text-right text-sm"
              />
            </div>
          </div>
          <div className="flex justify-between text-lg font-bold pt-1 border-t">
            <span>Total</span>
            <span className="font-mono text-emerald-400">{formatBRL(total)}</span>
          </div>
          <Button
            id="pdv-finalizar"
            className="w-full h-11 text-base"
            onClick={openCheckout}
            disabled={cart.length === 0}
          >
            <CheckCircle2 className="h-5 w-5 mr-2" /> Finalizar venda
            <kbd className="ml-2 text-[10px] font-mono bg-white/15 rounded px-1.5 py-0.5">F2</kbd>
          </Button>
        </div>
      </div>

      {/* Legenda de atalhos */}
      <div className="lg:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground/70">Atalhos:</span>
        <span><kbd className="font-mono bg-muted px-1 rounded">↑↓</kbd> navegar resultados</span>
        <span><kbd className="font-mono bg-muted px-1 rounded">Enter</kbd> adicionar ao carrinho</span>
        <span><kbd className="font-mono bg-muted px-1 rounded">F2</kbd> finalizar / concluir</span>
        <span><kbd className="font-mono bg-muted px-1 rounded">Esc</kbd> limpar busca / fechar</span>
      </div>

      {/* ─────── CHECKOUT DIALOG ─────── */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" /> Finalizar venda
            </DialogTitle>
            <DialogDescription>
              Total a receber: <strong className="text-foreground">{formatBRL(total)}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Cliente */}
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente <span className="text-muted-foreground">(opcional)</span></Label>
              <CustomerCombobox
                value={customerId}
                onChange={(id) => setCustomerId(id)}
                placeholder="Consumidor Final"
              />
            </div>

            {/* Pagamentos */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Formas de pagamento</Label>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={addPayment}>
                  <Plus className="h-3 w-3 mr-1" /> Adicionar
                </Button>
              </div>
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <select
                      value={p.method}
                      onChange={(e) => updatePayment(p.id, { method: e.target.value as PayMethod })}
                      className="h-9 rounded-md border bg-background px-2 text-sm flex-1"
                    >
                      {(Object.keys(PAY_LABELS) as PayMethod[]).map((m) => (
                        <option key={m} value={m}>{PAY_LABELS[m]}</option>
                      ))}
                    </select>
                    <MoneyInput
                      value={p.amount}
                      onChange={(v) => updatePayment(p.id, { amount: v })}
                      className="h-9 w-28 text-right"
                    />
                    {payments.length > 1 && (
                      <button onClick={() => removePayment(p.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Resumo */}
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono">{formatBRL(total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pago</span><span className="font-mono">{formatBRL(paid)}</span></div>
              {remaining > 0.01 && (
                <div className="flex justify-between text-amber-400 font-semibold">
                  <span>Falta</span><span className="font-mono">{formatBRL(remaining)}</span>
                </div>
              )}
              {change > 0.01 && (
                <div className="flex justify-between text-emerald-400 font-semibold">
                  <span>Troco</span><span className="font-mono">{formatBRL(change)}</span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Cancelar</Button>
            <Button id="pdv-concluir" onClick={finishSale} disabled={finishing || remaining > 0.01}>
              {finishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Concluir venda
              <kbd className="ml-2 text-[10px] font-mono bg-white/15 rounded px-1.5 py-0.5">F2</kbd>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Re-export de ícones usados só aqui (evita warning de import não-usado) */
export { Banknote, CreditCard, Smartphone };
