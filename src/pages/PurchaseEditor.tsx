import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Send,
  XCircle,
  Loader2,
  Truck,
  PackageOpen,
  AlertTriangle,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MoneyInput from "@/components/MoneyInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { Product, Purchase, PurchaseStatus, Supplier } from "@/types/delvor";
import { PURCHASE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";
import SupplierCombobox from "@/components/purchases/SupplierCombobox";
import AddPurchaseItemDialog from "@/components/purchases/AddPurchaseItemDialog";

type ItemDraft = {
  id?: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  qty: number;
  unit_cost: number;
};

function parseNum(v: string | number): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function fmt(n: number) { return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function PurchaseEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id || id === "new";

  // Header
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [status, setStatus] = useState<PurchaseStatus>("rascunho");
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [receiveDate, setReceiveDate] = useState<string>("");
  const [invoiceKey, setInvoiceKey] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<ItemDraft[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [actioning, setActioning] = useState<null | "place" | "receive" | "cancel">(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  /* =========================================================
     LOAD compra existente
  ========================================================= */
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const [pr, ir] = await Promise.all([
        supabase.from("purchases" as any).select("*").eq("id", id).maybeSingle(),
        supabase
          .from("purchase_items" as any)
          .select("*, products ( name, sku )")
          .eq("purchase_id", id),
      ]);
      if (cancelled) return;
      if (pr.error || !pr.data) {
        toast({ title: "Compra não encontrada", variant: "destructive" });
        navigate("/purchases");
        return;
      }
      const p = pr.data as Purchase;
      setPurchase(p);
      setSupplierId(p.supplier_id);
      setStatus(p.status);
      setIssueDate(p.issue_date ? p.issue_date.slice(0, 10) : "");
      setReceiveDate(p.receive_date ? p.receive_date.slice(0, 10) : "");
      setInvoiceKey(p.invoice_key || "");
      setNotes(p.notes || "");
      setItems(((ir.data as any[]) ?? []).map((i: any) => ({
        id: i.id,
        product_id: i.product_id,
        product_name: i.products?.name || "—",
        product_sku: i.products?.sku || null,
        qty: Number(i.qty),
        unit_cost: Number(i.unit_cost),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew, navigate]);

  // Cliente atual (mostra nome no badge)
  useEffect(() => {
    if (!supplierId) { setSupplier(null); return; }
    if (supplier?.id === supplierId) return;
    supabase.from("suppliers" as any).select("*").eq("id", supplierId).maybeSingle()
      .then(({ data }) => setSupplier((data as any) || null));
  }, [supplierId]);

  /* =========================================================
     TOTAL computado
  ========================================================= */
  const total = useMemo(
    () => items.reduce((s, it) => s + (it.qty * it.unit_cost), 0),
    [items]
  );

  const editable = status === "rascunho" || status === "pedido";

  /* =========================================================
     ITENS
  ========================================================= */
  function pickProduct(p: Product) {
    setItems((arr) => {
      // se já tem o produto, soma 1 na qty
      const existing = arr.findIndex((it) => it.product_id === p.id);
      if (existing >= 0) {
        return arr.map((it, i) => i === existing ? { ...it, qty: it.qty + 1 } : it);
      }
      return [
        ...arr,
        {
          product_id: p.id,
          product_name: [p.name, p.brand, p.model].filter(Boolean).join(" "),
          product_sku: p.sku,
          qty: 1,
          unit_cost: p.cost_price || 0,
        },
      ];
    });
  }
  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((arr) => {
      const it = arr[idx];
      if (it.id) setRemovedItemIds((r) => [...r, it.id!]);
      return arr.filter((_, i) => i !== idx);
    });
  }

  /* =========================================================
     SAVE / TRANSIÇÕES
  ========================================================= */
  async function persist(opts?: { newStatus?: PurchaseStatus }) {
    if (!user?.company_id) return null;
    if (!supplierId) {
      toast({ title: "Selecione um fornecedor", variant: "destructive" });
      return null;
    }
    if (items.length === 0) {
      toast({ title: "Adicione pelo menos um item", variant: "destructive" });
      return null;
    }

    setSaving(true);
    const newStatus = opts?.newStatus || status;

    const headerPayload: any = {
      company_id: user.company_id,
      supplier_id: supplierId,
      status: newStatus,
      issue_date: issueDate || null,
      receive_date: receiveDate || null,
      invoice_key: invoiceKey.trim() || null,
      notes: notes.trim() || null,
      user_id: user.id,
    };

    let pid = purchase?.id;

    if (isNew && !pid) {
      const { data, error } = await supabase.from("purchases" as any).insert(headerPayload).select().single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Erro ao salvar", description: error?.message, variant: "destructive" });
        return null;
      }
      pid = (data as any).id;
      setPurchase(data as any);
    } else {
      const { error } = await supabase.from("purchases" as any).update(headerPayload).eq("id", pid!);
      if (error) {
        setSaving(false);
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        return null;
      }
    }

    if (removedItemIds.length) {
      await supabase.from("purchase_items" as any).delete().in("id", removedItemIds);
      setRemovedItemIds([]);
    }
    for (const it of items) {
      const itPayload: any = {
        purchase_id: pid,
        product_id: it.product_id,
        qty: it.qty,
        unit_cost: it.unit_cost,
      };
      if (it.id) {
        await supabase.from("purchase_items" as any).update(itPayload).eq("id", it.id);
      } else {
        const { data } = await supabase.from("purchase_items" as any).insert(itPayload).select("id").single();
        if (data) it.id = (data as any).id;
      }
    }

    setSaving(false);
    setStatus(newStatus);
    if (isNew && pid) {
      navigate(`/purchases/${pid}`, { replace: true });
    }
    return pid;
  }

  async function handleSave() {
    const pid = await persist();
    if (pid) toast({ title: "Salvo" });
  }

  async function handlePlaceOrder() {
    setActioning("place");
    const pid = await persist({ newStatus: "pedido" });
    setActioning(null);
    if (pid) toast({ title: "Pedido enviado", description: "Aguardando recebimento da mercadoria." });
  }

  async function handleReceive() {
    setActioning("receive");
    if (!receiveDate) setReceiveDate(new Date().toISOString().slice(0, 10));
    const pid = await persist({ newStatus: "recebida" });
    setActioning(null);
    setConfirmReceive(false);
    if (pid) toast({
      title: "Mercadoria recebida",
      description: "Estoque atualizado automaticamente (entrada + custo do produto).",
    });
  }

  async function handleCancel() {
    setActioning("cancel");
    const pid = await persist({ newStatus: "cancelada" });
    setActioning(null);
    setConfirmCancel(false);
    if (pid) toast({ title: "Compra cancelada" });
  }

  /* =========================================================
     RENDER
  ========================================================= */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando compra...
      </div>
    );
  }

  const statusBadge = PURCHASE_STATUS_LABELS[status];

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/purchases"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Truck className="h-6 w-6" />
              {isNew && !purchase ? "Nova compra" : `Compra #${String(purchase?.number ?? "—").padStart(6, "0")}`}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={`${statusBadge.tone} ring-1`}>{statusBadge.label}</Badge>
              {supplier && (
                <span className="text-xs text-muted-foreground">
                  Fornecedor: <span className="text-foreground">{supplier.name}</span>
                </span>
              )}
              {purchase?.created_at && (
                <span className="text-xs text-muted-foreground">
                  Criada em {new Date(purchase.created_at).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
            </Button>
          )}

          {status === "rascunho" && !isNew && (
            <Button onClick={handlePlaceOrder} disabled={!!actioning} className="bg-blue-600 hover:bg-blue-700 text-white">
              {actioning === "place" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Marcar como pedido
            </Button>
          )}

          {(status === "rascunho" || status === "pedido") && !isNew && (
            <Button onClick={() => setConfirmReceive(true)} disabled={!!actioning} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <PackageOpen className="h-4 w-4 mr-1" /> Receber mercadoria
            </Button>
          )}

          {(status === "rascunho" || status === "pedido") && !isNew && (
            <Button variant="outline" onClick={() => setConfirmCancel(true)} className="text-rose-500 hover:text-rose-600 border-rose-500/30">
              <XCircle className="h-4 w-4 mr-1" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* CARD DE INFOS */}
      <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <Label>Fornecedor *</Label>
          <SupplierCombobox value={supplierId} onChange={setSupplierId} disabled={!editable} />
        </div>
        <div>
          <Label>Data emissão NF</Label>
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!editable} />
        </div>
        <div>
          <Label>Data recebimento</Label>
          <Input
            type="date"
            value={receiveDate}
            onChange={(e) => setReceiveDate(e.target.value)}
            disabled={!editable}
            placeholder="(automático ao receber)"
          />
        </div>
        <div>
          <Label>Chave/Nº NF</Label>
          <Input
            value={invoiceKey}
            onChange={(e) => setInvoiceKey(e.target.value)}
            disabled={!editable}
            placeholder="44 dígitos ou número"
          />
        </div>
      </div>

      {/* ITENS */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Itens da compra</h2>
          {editable && (
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar produto
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="w-28">SKU</TableHead>
              <TableHead className="w-24 text-right">Qtd</TableHead>
              <TableHead className="w-32 text-right">Custo unit.</TableHead>
              <TableHead className="w-32 text-right">Total</TableHead>
              {editable && <TableHead className="w-12"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={editable ? 7 : 6} className="text-center py-10 text-muted-foreground">
                  Nenhum item. {editable && "Clique em \"Adicionar produto\"."}
                </TableCell>
              </TableRow>
            )}
            {items.map((it, idx) => (
              <TableRow key={it.id || `new-${idx}`}>
                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="font-medium">{it.product_name}</TableCell>
                <TableCell className="font-mono text-xs">{it.product_sku || "—"}</TableCell>
                <TableCell>
                  <Input
                    value={String(it.qty)}
                    onChange={(e) => updateItem(idx, { qty: parseNum(e.target.value) })}
                    disabled={!editable}
                    inputMode="decimal"
                    className="h-8 text-right"
                  />
                </TableCell>
                <TableCell>
                  <MoneyInput
                    value={it.unit_cost}
                    onChange={(v) => updateItem(idx, { unit_cost: v })}
                    disabled={!editable}
                    className="h-8 text-right font-mono"
                  />
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  {formatBRL(it.qty * it.unit_cost)}
                </TableCell>
                {editable && (
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* TOTAL + OBSERVAÇÕES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border bg-card p-4">
          <Label>Observações</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
        </div>
        <div className="rounded-lg border bg-card p-4 h-fit">
          <div className="text-xs text-muted-foreground">Total da compra</div>
          <div className="text-3xl font-bold font-mono mt-1">{formatBRL(total)}</div>
          <div className="text-xs text-muted-foreground mt-2">
            {items.length} {items.length === 1 ? "item" : "itens"}
          </div>
        </div>
      </div>

      {status === "recebida" && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Mercadoria já recebida. Os itens foram lançados no estoque e o custo de cada produto foi atualizado.
            Não é mais possível editar.
          </span>
        </div>
      )}

      <AddPurchaseItemDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        supplierId={supplierId}
        onPick={pickProduct}
      />

      {/* Confirmar recebimento */}
      <AlertDialog open={confirmReceive} onOpenChange={setConfirmReceive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar recebimento da mercadoria?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai lançar <b>{items.length} {items.length === 1 ? "item" : "itens"}</b> no estoque (entradas registradas no histórico)
              e atualizar o custo unitário de cada produto pra refletir esta compra.
              <br /><br />
              Isso <b>não pode ser desfeito</b> sem ajuste manual no estoque depois. Confirme só quando os produtos estiverem fisicamente recebidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actioning}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleReceive}
              disabled={!!actioning}
            >
              {actioning === "receive" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PackageOpen className="h-4 w-4 mr-1" />}
              Confirmar recebimento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelar compra */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar compra?</AlertDialogTitle>
            <AlertDialogDescription>
              A compra fica registrada como cancelada. Não há impacto no estoque (ainda não foi recebida).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700 text-white" onClick={handleCancel}>
              Cancelar compra
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!editable && status !== "recebida" && status !== "cancelada" && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          Esta compra não pode mais ser editada.
        </div>
      )}
    </div>
  );
}
