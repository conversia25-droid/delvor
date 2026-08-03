import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Send,
  CheckCircle,
  XCircle,
  FileDown,
  MessageSquare,
  Loader2,
  CreditCard,
  UserCog,
  CheckCircle2,
  RotateCcw,
  Printer,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type {
  Customer,
  PaymentMethod,
  PaymentStatus,
  Sale,
  SaleItem,
  SalePayment,
  SaleStatus,
} from "@/types/delvor";
import { SALE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, phoneToJid } from "@/lib/formatters";
import CustomerCombobox from "@/components/sales/CustomerCombobox";
import AddItemDialog, { type PickedItem } from "@/components/sales/AddItemDialog";
import TransferSaleDialog from "@/components/sales/TransferSaleDialog";
import { generateSalePdf } from "@/lib/salePdf";
import { imageToDataUrl, loadCompanyHeader } from "@/lib/companyInfo";
import { getOpenSession } from "@/lib/cashRegister";
import { usePermissions } from "@/hooks/usePermissions";

type ItemDraft = {
  /** id no banco (se já gravado) */
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
  paid_at: string | null;   // timestamptz — quando virou "pago"
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
  { value: "cartao_credito",    label: "Cartão crédito (legado)" },
  { value: "outro",             label: "Outro" },
];

const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: "pendente",  label: "Pendente" },
  { value: "pago",      label: "Pago" },
  { value: "parcial",   label: "Parcial" },
  { value: "cancelado", label: "Cancelado" },
  { value: "estornado", label: "Estornado" },
];

function parseNum(v: string | number): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function fmt(n: number) { return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function SaleEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isNew = !id || id === "new";
  // Se a URL bate /orcamentos/new, esse editor cria um orçamento em vez de
  // venda direta. Só influencia o status INICIAL — depois de criar, a rota
  // volta a ser /sales/:id (o editor edita qualquer sale por id).
  const isOrcamentoNew = isNew && location.pathname.startsWith("/orcamentos");

  // Header
  const [sale, setSale] = useState<Sale | null>(null);
  // Pré-seleção do cliente via query param — vem, por exemplo, da tela do
  // cliente ("Nova Venda") ou de link direto. Só aplica em venda nova.
  const initialCustomerId = isNew ? searchParams.get("customer") : null;
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  // Default do status:
  //  - /orcamentos/new → "orcamento" (proposta pro cliente, sem obrigação)
  //  - /sales/new      → "aprovado"  (venda já ativa, pula direto pra faturamento)
  //  - editando venda existente → sobrescrito quando a linha carrega
  const [status, setStatus] = useState<SaleStatus>(isOrcamentoNew ? "orcamento" : "aprovado");
  const [discount, setDiscount] = useState(0);
  const [freight, setFreight] = useState(0);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const [items, setItems] = useState<ItemDraft[]>([]);
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);
  const [removedPaymentIds, setRemovedPaymentIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [actioning, setActioning] = useState<null | "approve" | "invoice" | "cancel" | "deliver">(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [sellerName, setSellerName] = useState<string>("");

  // Vendedor da venda. Default = usuário logado, mas admin/gerente pode trocar
  // pra atribuir a venda a outro vendedor (típico: admin atende no balcão
  // mas a comissão e o histórico vão pro vendedor real).
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [team, setTeam] = useState<Array<{ id: string; nome: string }>>([]);

  const perms = usePermissions();
  const canPickSeller = perms.isManager;  // admin ou gerente

  // Inicializa selectedSellerId com o user logado quando é venda nova
  useEffect(() => {
    if (isNew && user?.id && !selectedSellerId) setSelectedSellerId(user.id);
  }, [isNew, user?.id, selectedSellerId]);

  // Carrega lista de vendedores (admin/gerente/vendedor) — só pra quem pode trocar
  useEffect(() => {
    if (!canPickSeller || !user?.company_id) return;
    let cancelled = false;
    (async () => {
      // Pega profiles da empresa que tenham role de vendedor/gerente/admin
      const { data: profiles } = await supabase
        .from("profiles" as any)
        .select("id, nome")
        .eq("company_id", user.company_id)
        .order("nome");
      if (cancelled || !profiles) return;
      const ids = (profiles as any[]).map((p) => p.id);
      const { data: roles } = await supabase
        .from("user_roles" as any)
        .select("user_id, role")
        .in("user_id", ids)
        .in("role", ["admin", "gerente", "vendedor"]);
      const eligible = new Set(((roles as any[]) ?? []).map((r) => r.user_id));
      const list = (profiles as any[])
        .filter((p) => eligible.has(p.id))
        .map((p) => ({ id: p.id, nome: p.nome }));
      setTeam(list);
    })();
    return () => { cancelled = true; };
  }, [canPickSeller, user?.company_id]);

  /* =========================================================
     LOAD venda existente
  ========================================================= */
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const [sr, ir, pr] = await Promise.all([
        supabase.from("sales" as any).select("*").eq("id", id).maybeSingle(),
        supabase.from("sale_items" as any).select("*").eq("sale_id", id).order("position"),
        supabase.from("sale_payments" as any).select("*").eq("sale_id", id).order("due_date", { nullsFirst: false }),
      ]);
      if (cancelled) return;
      if (sr.error || !sr.data) {
        toast({ title: "Venda não encontrada", variant: "destructive" });
        navigate("/sales");
        return;
      }
      const s = sr.data as Sale;
      setSale(s);
      // Resolve nome do vendedor pra mostrar no header e no dialog de transferência
      if (s.seller_id) {
        supabase.from("profiles" as any).select("nome").eq("id", s.seller_id).maybeSingle()
          .then(({ data }) => setSellerName((data as any)?.nome || ""));
      }
      setSelectedSellerId(s.seller_id);
      setCustomerId(s.customer_id);
      setIssueDate(s.issue_date.slice(0, 10));
      setDeliveryDate(s.delivery_date ? s.delivery_date.slice(0, 10) : "");
      setStatus(s.status);
      setDiscount(s.discount || 0);
      setFreight(s.freight || 0);
      setPaymentTerms(s.payment_terms || "");
      setNotes(s.notes || "");
      setInternalNotes(s.internal_notes || "");
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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew, navigate]);

  // Carrega o cliente atual (pra mostrar nome no header e usar no PDF/whatsapp)
  useEffect(() => {
    if (!customerId) { setCustomer(null); return; }
    if (customer?.id === customerId) return;
    supabase.from("customers" as any).select("*").eq("id", customerId).maybeSingle()
      .then(({ data }) => setCustomer((data as any) || null));
  }, [customerId]);

  /* =========================================================
     TOTAIS computados
  ========================================================= */
  const subtotal = useMemo(
    () => items.reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0),
    [items]
  );
  const total = Math.max(0, subtotal - (discount || 0) + (freight || 0));

  const isOwner = !!user && sale?.seller_id === user.id;
  const canEdit = (status === "orcamento" || status === "aprovado") && (perms.isManager || isOwner || isNew);
  const editable = canEdit;
  // Pagamentos podem ser atualizados mesmo depois de faturar/entregar
  // (fluxo legítimo: cliente leva o produto hoje e paga depois). Só bloqueia
  // edição quando a venda foi cancelada.
  const canEditPayments = (perms.isManager || isOwner || isNew) && status !== "cancelado";

  /* =========================================================
     ITENS — handlers
  ========================================================= */
  function pickItem(picked: PickedItem) {
    if (picked.kind === "product") {
      const p = picked.product;
      // Alerta de estoque: quanto sobra depois de vender essa qtd (soma o que já
      // está no formulário desse mesmo produto + a unidade que estamos adicionando).
      if (p.stock_qty != null) {
        const alreadyInSale = items
          .filter((it) => it.product_id === p.id)
          .reduce((sum, it) => sum + Number(it.qty || 0), 0);
        const afterSale = Number(p.stock_qty) - (alreadyInSale + 1);
        if (afterSale < 0) {
          toast({
            title: "Estoque insuficiente",
            description: `${p.name} — disponível: ${p.stock_qty}${p.unit ? " " + p.unit : ""}`,
            variant: "destructive",
          });
        } else if (p.stock_min != null && p.stock_min > 0 && afterSale <= p.stock_min) {
          toast({
            title: "⚠️ Estoque no limite",
            description: `${p.name} ficará com ${afterSale}${p.unit ? " " + p.unit : ""} (mínimo: ${p.stock_min}). Considere repor.`,
          });
        }
      }
      setItems((arr) => [
        ...arr,
        {
          product_id: p.id,
          service_id: null,
          description: [p.name, p.brand, p.model].filter(Boolean).join(" "),
          qty: 1,
          unit_price: p.sale_price || 0,
          discount: 0,
          position: arr.length,
        },
      ]);
    } else {
      const s = picked.service;
      setItems((arr) => [
        ...arr,
        {
          product_id: null,
          service_id: s.id,
          description: s.name,
          qty: 1,
          unit_price: s.default_price || 0,
          discount: 0,
          position: arr.length,
        },
      ]);
    }
  }

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((arr) => {
      const it = arr[idx];
      if (it.id) setRemovedItemIds((r) => [...r, it.id!]);
      return arr.filter((_, i) => i !== idx).map((x, i) => ({ ...x, position: i }));
    });
  }

  /* =========================================================
     PAGAMENTOS — handlers
  ========================================================= */
  function addPayment() {
    const remaining = Math.max(0, total - payments.reduce((s, p) => s + p.amount, 0));
    setPayments((arr) => [...arr, { method: "pix", status: "pendente", amount: remaining, due_date: null, paid_at: null, notes: null }]);
  }

  /** Adiciona pagamento com método pré-selecionado a partir dos quick buttons.
   *  Pra "credito_parcelado", abre o dialog de parcelas em vez de criar 1 linha. */
  function addPaymentWithMethod(method: PaymentMethod) {
    if (method === "credito_parcelado") {
      setInstallMethod(method);
      setInstallDialogOpen(true);
      return;
    }
    const remaining = Math.max(0, total - payments.reduce((s, p) => s + p.amount, 0));
    const amount = remaining > 0 ? remaining : total;
    // Pra métodos à vista (dinheiro/pix/crédito à vista/débito) já marca como pago hoje
    const isImmediate = ["dinheiro", "pix", "credito_avista", "cartao_debito"].includes(method);
    setPayments((arr) => [...arr, {
      method,
      status: isImmediate ? "pago" : "pendente",
      amount,
      due_date: isImmediate ? new Date().toISOString().slice(0, 10) : null,
      paid_at: isImmediate ? new Date().toISOString() : null,
      notes: null,
    }]);
  }

  // Diálogo de parcelamento — cria N parcelas distribuindo o valor restante
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installCount, setInstallCount] = useState(2);
  const [installMethod, setInstallMethod] = useState<PaymentMethod>("credito_parcelado");
  const [installFirstDate, setInstallFirstDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [installInterval, setInstallInterval] = useState(30);

  const remainingForInstall = useMemo(
    () => Math.max(0, total - payments.reduce((s, p) => s + p.amount, 0)),
    [total, payments],
  );

  function generateInstallments() {
    if (remainingForInstall <= 0) {
      toast({ title: "Sem valor restante pra parcelar", variant: "destructive" });
      return;
    }
    if (installCount < 1 || installCount > 60) {
      toast({ title: "Quantidade inválida (1-60)", variant: "destructive" });
      return;
    }
    // Divide o valor; última parcela absorve o resto do arredondamento
    const per = Math.round((remainingForInstall / installCount) * 100) / 100;
    const last = +(remainingForInstall - per * (installCount - 1)).toFixed(2);
    const base = new Date(installFirstDate + "T12:00");

    const novas: PaymentDraft[] = [];
    for (let i = 0; i < installCount; i++) {
      const due = new Date(base);
      due.setDate(due.getDate() + i * installInterval);
      novas.push({
        method: installMethod,
        status: "pendente",
        amount: i === installCount - 1 ? last : per,
        due_date: due.toISOString().slice(0, 10),
        paid_at: null,
        notes: `Parcela ${i + 1}/${installCount}`,
      });
    }
    setPayments((arr) => [...arr, ...novas]);
    setInstallDialogOpen(false);
    toast({ title: `${installCount} parcelas adicionadas`, description: `R$ ${per.toFixed(2).replace(".", ",")} cada` });
  }

  /* =========================================================
     ATALHOS DE TECLADO
     Ctrl+S = salvar · F2 = adicionar item · F3 = adicionar parcela
  ========================================================= */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        document.getElementById("sale-save-btn")?.click();
      } else if (e.key === "F2") {
        e.preventDefault();
        document.getElementById("sale-additem-btn")?.click();
      } else if (e.key === "F3") {
        e.preventDefault();
        document.getElementById("sale-addparcel-btn")?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function updatePayment(idx: number, patch: Partial<PaymentDraft>) {
    setPayments((arr) => arr.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removePayment(idx: number) {
    setPayments((arr) => {
      const p = arr[idx];
      if (p.id) setRemovedPaymentIds((r) => [...r, p.id!]);
      return arr.filter((_, i) => i !== idx);
    });
  }

  /* =========================================================
     SAVE
  ========================================================= */
  async function persist(opts?: { newStatus?: SaleStatus }) {
    if (!user?.company_id) return null;

    // Modo "só pagamentos": venda já fechada (faturada/entregue) — só atualiza
    // os pagamentos sem mexer em header/items (que ficam imutáveis nesse estado).
    // EXCEÇÃO: quando há uma transição de status pedida explicitamente
    // (Aprovar / Faturar / Marcar entregue / Cancelar) o header PRECISA atualizar.
    const paymentsOnly = !editable && canEditPayments && !!sale?.id && !opts?.newStatus;

    if (!paymentsOnly) {
      if (!customerId) {
        toast({ title: "Selecione um cliente", variant: "destructive" });
        return null;
      }
      if (items.length === 0) {
        toast({ title: "Adicione pelo menos um item", variant: "destructive" });
        return null;
      }
    }

    setSaving(true);
    const newStatus = opts?.newStatus || status;

    let saleId = sale?.id;

    if (!paymentsOnly) {
      const headerPayload: any = {
        company_id: user.company_id,
        customer_id: customerId,
        seller_id: selectedSellerId || user.id,
        status: newStatus,
        issue_date: issueDate,
        delivery_date: deliveryDate || null,
        subtotal,
        discount,
        freight,
        total,
        payment_terms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
        internal_notes: internalNotes.trim() || null,
        remote_jid: customer?.remote_jid || null,
        source: "manual",
      };

      // Amarra a venda no caixa aberto do VENDEDOR — em 2 momentos:
      //  1. CREATE (INSERT) — captura caixa que estava aberto na criação
      //  2. UPDATE — se ainda não tem cash_session_id (porque foi criada
      //     sem caixa aberto e agora o caixa foi aberto), tenta amarrar.
      //     Isso cobre o fluxo: cria orçamento → abre caixa → fatura/entrega.
      const sellerForCash = selectedSellerId || user.id;
      const needsCashBinding = !sale?.cash_session_id;
      if (needsCashBinding) {
        const openCash = await getOpenSession(sellerForCash);
        if (openCash) {
          headerPayload.cash_session_id = openCash.id;
        }
      }

      if (isNew && !saleId) {
        const { data, error } = await supabase.from("sales" as any).insert(headerPayload).select().single();
        if (error || !data) {
          setSaving(false);
          toast({ title: "Erro ao salvar", description: error?.message, variant: "destructive" });
          return null;
        }
        saleId = (data as any).id;
        setSale(data as any);
      } else {
        const { error } = await supabase.from("sales" as any).update(headerPayload).eq("id", saleId!);
        if (error) {
          setSaving(false);
          toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
          return null;
        }
      }

      // Itens: deletar removidos, upsert dos restantes
      if (removedItemIds.length) {
        await supabase.from("sale_items" as any).delete().in("id", removedItemIds);
        setRemovedItemIds([]);
      }
    }
    if (!paymentsOnly) {
      for (const [i, it] of items.entries()) {
        const itPayload: any = {
          sale_id: saleId,
          product_id: it.product_id,
          service_id: it.service_id,
          description: it.description,
          qty: it.qty,
          unit_price: it.unit_price,
          discount: it.discount,
          position: i,
        };
        if (it.id) {
          await supabase.from("sale_items" as any).update(itPayload).eq("id", it.id);
        } else {
          const { data } = await supabase.from("sale_items" as any).insert(itPayload).select("id").single();
          if (data) it.id = (data as any).id;
        }
      }
    }

    // Pagamentos
    if (removedPaymentIds.length) {
      await supabase.from("sale_payments" as any).delete().in("id", removedPaymentIds);
      setRemovedPaymentIds([]);
    }
    for (const p of payments) {
      // Sincroniza paid_at com o status: pago → carimba agora se ainda não tinha;
      // pendente/atrasado/estornado → zera o paid_at.
      const paidAt = p.status === "pago"
        ? (p.paid_at || new Date().toISOString())
        : null;
      const pPayload: any = {
        sale_id: saleId,
        method: p.method,
        status: p.status,
        amount: p.amount,
        due_date: p.due_date,
        paid_at: paidAt,
        notes: p.notes,
      };
      if (p.id) {
        await supabase.from("sale_payments" as any).update(pPayload).eq("id", p.id);
      } else {
        const { data } = await supabase.from("sale_payments" as any).insert(pPayload).select("id").single();
        if (data) p.id = (data as any).id;
      }
      p.paid_at = paidAt;  // reflete no draft pra UI não ficar dessincronizada
    }

    setSaving(false);
    setStatus(newStatus);
    if (isNew && saleId) {
      navigate(`/sales/${saleId}`, { replace: true });
    }
    return saleId;
  }

  async function handleSave() {
    const sid = await persist();
    if (sid) toast({ title: "Salvo" });
  }

  async function handleApprove() {
    setActioning("approve");
    const sid = await persist({ newStatus: "aprovado" });
    setActioning(null);
    if (sid) toast({ title: "Pedido aprovado" });
  }

  async function handleInvoice() {
    setActioning("invoice");
    const sid = await persist({ newStatus: "faturado" });
    setActioning(null);
    if (sid) toast({ title: "Pedido faturado", description: "Estoque foi baixado automaticamente." });
  }

  async function handleDeliver() {
    setActioning("deliver");
    const sid = await persist({ newStatus: "entregue" });
    setActioning(null);
    if (sid) toast({ title: "Pedido entregue" });
  }

  async function handleCancel() {
    setActioning("cancel");
    const sid = await persist({ newStatus: "cancelado" });
    setActioning(null);
    setConfirmCancel(false);
    if (sid) toast({ title: "Venda cancelada" });
  }

  /* =========================================================
     PDF
  ========================================================= */
  async function handlePdf(mode: "download" | "print" = "download") {
    const sid = sale?.id || (await persist());
    if (!sid || !user?.company_id) return;
    // Recarrega tudo pra garantir que numeração e itens estão consistentes
    const [sr, ir, pr, company] = await Promise.all([
      supabase.from("sales" as any).select("*").eq("id", sid).single(),
      supabase.from("sale_items" as any).select("*").eq("sale_id", sid).order("position"),
      supabase.from("sale_payments" as any).select("*").eq("sale_id", sid).order("due_date", { nullsFirst: false }),
      loadCompanyHeader(user.company_id),
    ]);
    if (sr.error || !sr.data) {
      toast({ title: "Erro ao carregar venda pra PDF", variant: "destructive" });
      return;
    }
    const logoData = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;
    generateSalePdf({
      sale: sr.data as any,
      customer,
      items: (ir.data as any[]) ?? [],
      payments: (pr.data as any[]) ?? [],
      company,
      companyLogoDataUrl: logoData,
      companyName: user?.company_name || "Delvor",
      sellerName: sellerName || user?.nome,
      output: mode,
    });
  }

  /* =========================================================
     RENDER
  ========================================================= */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando venda...
      </div>
    );
  }

  const statusBadge = SALE_STATUS_LABELS[status];

  return (
    <div className="space-y-6">
      {/* ============== HEADER ============== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to={status === "orcamento" ? "/orcamentos" : "/sales"}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {isNew && !sale ? "Nova venda" : `Venda #${String(sale?.number ?? "—").padStart(6, "0")}`}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={`${statusBadge.tone} ring-1`}>{statusBadge.label}</Badge>
              {sellerName && (
                <span className="text-xs text-muted-foreground">
                  Vendedor: <span className="text-foreground">{sellerName}</span>
                </span>
              )}
              {sale?.created_at && (
                <span className="text-xs text-muted-foreground">
                  Criado em {new Date(sale.created_at).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {customer?.remote_jid && (
            <Button variant="outline" asChild>
              <Link to={`/chat?jid=${encodeURIComponent(customer.remote_jid)}`}>
                <MessageSquare className="h-4 w-4 mr-1 text-emerald-500" /> WhatsApp
              </Link>
            </Button>
          )}
          {!isNew && (
            <>
              <Button variant="outline" onClick={() => handlePdf("download")} title="Baixar PDF">
                <FileDown className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button variant="outline" onClick={() => handlePdf("print")} title="Abrir e imprimir direto">
                <Printer className="h-4 w-4 mr-1" /> Imprimir
              </Button>
            </>
          )}

          {/* Transferir venda — vendedor dono ou admin/gerente */}
          {!isNew && sale && (perms.isManager || isOwner) && status !== "cancelado" && (
            <Button variant="outline" onClick={() => setTransferOpen(true)} title="Transferir venda para outro vendedor">
              <UserCog className="h-4 w-4 mr-1" /> Transferir
            </Button>
          )}

          {(editable || canEditPayments) && (
            <Button id="sale-save-btn" variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
              <kbd className="ml-2 text-[10px] font-mono bg-muted rounded px-1.5 py-0.5">Ctrl+S</kbd>
            </Button>
          )}

          {status === "orcamento" && !isNew && (
            <Button onClick={handleApprove} disabled={!!actioning} className="bg-blue-600 hover:bg-blue-700 text-white">
              {actioning === "approve" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Aprovar orçamento
            </Button>
          )}
          {status === "aprovado" && (
            <Button onClick={handleInvoice} disabled={!!actioning} className="bg-teal-600 hover:bg-teal-700 text-white">
              {actioning === "invoice" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Faturar
            </Button>
          )}
          {status === "faturado" && (
            <Button onClick={handleDeliver} disabled={!!actioning} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {actioning === "deliver" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Marcar entregue
            </Button>
          )}
          {(status === "orcamento" || status === "aprovado") && !isNew && (
            <Button variant="outline" onClick={() => setConfirmCancel(true)} className="text-rose-500 hover:text-rose-600 border-rose-500/30">
              <XCircle className="h-4 w-4 mr-1" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* ============== CLIENTE / VENDEDOR / DATAS ============== */}
      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1.2fr_1fr_1fr] gap-3">
          <div>
            <Label>Cliente *</Label>
            <CustomerCombobox
              value={customerId}
              onChange={(id) => setCustomerId(id)}
              disabled={!editable}
              createMode="full"
            />
          </div>
          <div>
            <Label>Vendedor</Label>
            {canPickSeller ? (
              <Select
                value={selectedSellerId || ""}
                onValueChange={(v) => setSelectedSellerId(v)}
                disabled={!editable}
              >
                <SelectTrigger><SelectValue placeholder="Escolha o vendedor" /></SelectTrigger>
                <SelectContent>
                  {team.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={sellerName || (selectedSellerId === user?.id ? (user as any)?.nome || "Você" : "—")}
                disabled
              />
            )}
          </div>
          <div>
            <Label>Data emissão</Label>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!editable} />
          </div>
          <div>
            <Label>Data entrega</Label>
            <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} disabled={!editable} />
          </div>
        </div>
      </div>

      {/* ============== ITENS ============== */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Itens</h2>
          {editable && (
            <Button id="sale-additem-btn" onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar item
              <kbd className="ml-2 text-[10px] font-mono bg-white/15 rounded px-1.5 py-0.5">F2</kbd>
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-20 text-right">Qtd</TableHead>
              <TableHead className="w-32 text-right">Unitário</TableHead>
              <TableHead className="w-32 text-right">Desconto</TableHead>
              <TableHead className="w-32 text-right">Total</TableHead>
              {editable && <TableHead className="w-12"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={editable ? 7 : 6} className="text-center py-10 text-muted-foreground">
                  Nenhum item. {editable && "Clique em \"Adicionar item\" pra começar."}
                </TableCell>
              </TableRow>
            )}
            {items.map((it, idx) => {
              const lineTotal = it.qty * it.unit_price - (it.discount || 0);
              return (
                <TableRow key={it.id || `new-${idx}`}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <Input
                      value={it.description}
                      onChange={(e) => updateItem(idx, { description: e.target.value })}
                      disabled={!editable}
                      className="h-8"
                    />
                  </TableCell>
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
                      value={it.unit_price}
                      onChange={(v) => updateItem(idx, { unit_price: v })}
                      disabled={!editable}
                      className="h-8 text-right font-mono"
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      value={it.discount || 0}
                      onChange={(v) => updateItem(idx, { discount: v })}
                      disabled={!editable}
                      className="h-8 text-right font-mono"
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">{formatBRL(lineTotal)}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ============== TOTAIS + OBSERVAÇÕES ============== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Pagamentos
              </h2>
              {payments.length > 0 && (
                <span className="text-xs text-muted-foreground font-mono">
                  {payments.length} parcela{payments.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {payments.length === 0 && (
              <div className="py-4 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Nenhum pagamento cadastrado.</p>
                {editable && (
                  <Button id="sale-addparcel-btn" size="sm" onClick={addPayment}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar pagamento
                    <kbd className="ml-2 text-[10px] font-mono bg-white/15 rounded px-1.5 py-0.5">F3</kbd>
                  </Button>
                )}
              </div>
            )}
            {/* Header de colunas — só aparece quando tem parcela cadastrada */}
            {payments.length > 0 && (
              <div className="hidden md:grid grid-cols-[2rem_1.6fr_1fr_1fr_1fr_auto] gap-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                <div></div>
                <div>Método</div>
                <div>Vencimento</div>
                <div className="text-right">Valor</div>
                <div>Status</div>
                <div className="w-[88px]"></div>
              </div>
            )}
            {payments.map((p, idx) => (
              <div key={p.id || `pn-${idx}`} className="grid grid-cols-1 md:grid-cols-[2rem_1.6fr_1fr_1fr_1fr_auto] gap-2 items-center">
                <div className="hidden md:flex items-center justify-center h-9 text-xs font-mono text-muted-foreground">
                  {idx + 1}
                </div>
                <div>
                  <Label className="text-xs md:hidden">Método</Label>
                  <Select
                    value={p.method}
                    onValueChange={(v: PaymentMethod) => {
                      // Se escolheu "Crédito parcelado" numa parcela existente,
                      // remove esta linha e abre o dialog de parcelas — é mais útil
                      // que ter uma linha solta de "credito_parcelado".
                      if (v === "credito_parcelado") {
                        // Remove a linha atual (sem marcar como removida no banco se for nova)
                        setPayments((arr) => arr.filter((_, i) => i !== idx));
                        if (p.id) setRemovedPaymentIds((r) => [...r, p.id!]);
                        setInstallMethod("credito_parcelado");
                        setInstallDialogOpen(true);
                        return;
                      }
                      // Se mudou pra um método à vista, já marca como pago
                      const isImmediate = ["dinheiro", "pix", "credito_avista", "cartao_debito"].includes(v);
                      updatePayment(idx, {
                        method: v,
                        ...(isImmediate && p.status === "pendente"
                          ? { status: "pago", paid_at: new Date().toISOString(), due_date: p.due_date || new Date().toISOString().slice(0, 10) }
                          : {}),
                      });
                    }}
                    disabled={!editable}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs md:hidden">Vencimento</Label>
                  <Input type="date" className="h-9" value={p.due_date || ""} onChange={(e) => updatePayment(idx, { due_date: e.target.value || null })} disabled={!editable} />
                </div>
                <div>
                  <Label className="text-xs md:hidden">Valor</Label>
                  <MoneyInput className="h-9 text-right font-mono" value={p.amount} onChange={(v) => updatePayment(idx, { amount: v })} disabled={!editable} />
                </div>
                <div>
                  <Label className="text-xs md:hidden">Status</Label>
                  <Select value={p.status} onValueChange={(v: PaymentStatus) => updatePayment(idx, { status: v })} disabled={!canEditPayments}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 justify-end">
                  {/* Toggle rápido pendente ↔ pago — funciona mesmo com venda faturada */}
                  {canEditPayments && p.status === "pendente" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => updatePayment(idx, { status: "pago", paid_at: new Date().toISOString() })}
                      title="Marcar como pago"
                      className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  )}
                  {canEditPayments && p.status === "pago" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => updatePayment(idx, { status: "pendente", paid_at: null })}
                      title="Reabrir (marcar como pendente)"
                      className="text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  {editable && (
                    <Button variant="ghost" size="icon" onClick={() => removePayment(idx)} title="Remover">
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {editable && payments.length > 0 && (
              <div className="flex gap-2 flex-wrap pt-2 border-t border-border/40">
                <Button variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
                  <CreditCard className="h-3.5 w-3.5 mr-1.5" /> Parcelar restante
                </Button>
                <Button id="sale-addparcel-btn" variant="ghost" size="sm" onClick={addPayment}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar parcela
                  <kbd className="ml-2 text-[10px] font-mono bg-muted rounded px-1.5 py-0.5">F3</kbd>
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Condições de pagamento</Label>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} disabled={!editable} placeholder="Ex: 30/60/90" />
            </div>
            <div className="md:col-span-2">
              <Label>Observações (aparece no PDF)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
            </div>
            <div className="md:col-span-2">
              <Label>Notas internas (não aparece no PDF)</Label>
              <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} disabled={!editable} />
            </div>
          </div>
        </div>

        {/* Totais à direita */}
        <div className="rounded-lg border bg-card p-4 space-y-3 h-fit lg:sticky lg:top-4">
          <h2 className="font-semibold">Totais</h2>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono">{formatBRL(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-muted-foreground">Desconto geral</span>
            <MoneyInput value={discount} onChange={setDiscount} disabled={!editable} className="h-7 w-28 text-right font-mono" />
          </div>
          <div className="flex justify-between text-sm items-center">
            <span className="text-muted-foreground">Frete</span>
            <MoneyInput value={freight} onChange={setFreight} disabled={!editable} className="h-7 w-28 text-right font-mono" />
          </div>
          <div className="border-t pt-3 flex justify-between text-lg font-bold">
            <span>TOTAL</span>
            <span className="font-mono">{formatBRL(total)}</span>
          </div>
        </div>
      </div>

      <AddItemDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={pickItem} />

      {/* Dialog de parcelamento — divide o valor restante em N parcelas */}
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Parcelar venda
            </DialogTitle>
            <DialogDescription>
              Divide o valor restante em N parcelas. Cria automaticamente as linhas de pagamento.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">Quantidade de parcelas</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {[2, 3, 4, 5, 6, 10, 12].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={installCount === n ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-2.5"
                    onClick={() => setInstallCount(n)}
                  >
                    {n}x
                  </Button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={installCount}
                  onChange={(e) => setInstallCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                  className="h-8 w-16 text-center"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Método</Label>
              <Select value={installMethod} onValueChange={(v: PaymentMethod) => setInstallMethod(v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Vencimento 1ª parcela</Label>
                <Input type="date" className="h-9" value={installFirstDate} onChange={(e) => setInstallFirstDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Intervalo entre parcelas (dias)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="h-9"
                  value={installInterval}
                  onChange={(e) => setInstallInterval(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
                />
              </div>
            </div>

            <div className="rounded-md bg-muted/40 p-2.5 text-sm">
              <div className="font-medium">Preview</div>
              {remainingForInstall > 0 ? (
                <div className="text-muted-foreground text-xs mt-0.5">
                  {installCount}× de <span className="font-mono text-foreground">
                    R$ {(remainingForInstall / installCount).toFixed(2).replace(".", ",")}
                  </span> · primeira em <span className="text-foreground">{installFirstDate.split("-").reverse().join("/")}</span> · cada {installInterval} dias
                </div>
              ) : (
                <div className="text-rose-400 text-xs mt-0.5">Não há valor restante (todas as parcelas já cobrem o total).</div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>Cancelar</Button>
            <Button onClick={generateInstallments} disabled={remainingForInstall <= 0}>
              Adicionar {installCount} parcelas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sale && (
        <TransferSaleDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          saleId={sale.id}
          currentSellerId={sale.seller_id}
          currentSellerName={sellerName}
          onTransferred={(newId) => {
            setSale((cur) => cur ? { ...cur, seller_id: newId } : cur);
            // recarrega nome do novo vendedor
            supabase.from("profiles" as any).select("nome").eq("id", newId).maybeSingle()
              .then(({ data }) => setSellerName((data as any)?.nome || ""));
          }}
        />
      )}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar venda?</AlertDialogTitle>
            <AlertDialogDescription>
              A venda fica registrada como <b>cancelada</b> mas continua no histórico. Estoque não é afetado se ainda não foi faturada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700 text-white" onClick={handleCancel}>
              Cancelar venda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
