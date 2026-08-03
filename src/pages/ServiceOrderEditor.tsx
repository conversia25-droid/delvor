import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  MessageSquare,
  FileDown,
  Wrench,
  Loader2,
  CheckCircle2,
  Boxes,
  ListChecks,
  History,
  Paperclip,
  XCircle,
  ShoppingCart,
  Pencil,
  AlertTriangle,
  UserCog,
  Lock,
  ChevronDown,
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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

import type {
  Customer,
  CustomerEquipment,
  OsItemKind,
  OsOrigin,
  OsPriority,
  OsStatus,
  ServiceOrder,
  ServiceOrderItem,
} from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

import { formatBRL } from "@/lib/formatters";
import { notifyTechnicianAboutOS } from "@/lib/notifyTechnicianOS";
import { notifyCustomerAboutOSStatus, isAutoNotifyStatus } from "@/lib/notifyCustomerOSStatus";
import { ensureLeadFromCustomer } from "@/lib/leads";
import { generateOsPdf } from "@/lib/osPdf";
import { imageToDataUrl, loadCompanyHeader } from "@/lib/companyInfo";

import CustomerCombobox from "@/components/sales/CustomerCombobox";
import AddItemDialog, { type PickedItem } from "@/components/sales/AddItemDialog";
import EquipmentCombobox from "@/components/service-orders/EquipmentCombobox";
import EquipmentFormDialog from "@/components/service-orders/EquipmentFormDialog";
import OsAttachments from "@/components/service-orders/OsAttachments";
import OsHistory from "@/components/service-orders/OsHistory";
import OsStatusTransitionDialog from "@/components/service-orders/OsStatusTransitionDialog";
import TransferOsDialog from "@/components/service-orders/TransferOsDialog";
import { openWhatsApp, pickWhatsapp } from "@/lib/whatsapp";
import { usePermissions } from "@/hooks/usePermissions";

type ItemDraft = {
  id?: string;
  kind: OsItemKind;
  product_id: string | null;
  service_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount: number;
  consumed: boolean;
  position: number;
};

const PRIORITY_OPTS: { value: OsPriority; label: string; tone: string }[] = [
  { value: "baixa",   label: "Baixa",   tone: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  { value: "normal",  label: "Normal",  tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  { value: "alta",    label: "Alta",    tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  { value: "urgente", label: "Urgente", tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
];

const ORIGIN_OPTS: { value: OsOrigin; label: string }[] = [
  { value: "balcao",   label: "Balcão" },
  { value: "visita",   label: "Visita" },
  { value: "remoto",   label: "Atend. remoto" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telefone", label: "Telefone" },
  { value: "email",    label: "E-mail" },
  { value: "outro",    label: "Outro" },
];

/** Lista de transições válidas a partir de um status. */
function allowedTransitions(s: OsStatus): OsStatus[] {
  switch (s) {
    case "aberta":               return ["diagnostico", "em_execucao", "cancelada"];
    case "diagnostico":          return ["aguardando_aprovacao", "aguardando_peca", "em_execucao", "cancelada"];
    case "aguardando_aprovacao": return ["em_execucao", "aguardando_peca", "cancelada"];
    case "aguardando_peca":      return ["em_execucao", "cancelada"];
    case "em_execucao":          return ["concluida", "aguardando_peca", "cancelada"];
    case "concluida":            return ["entregue", "em_execucao"];
    case "entregue":             return ["faturada"];
    case "faturada":             return [];
    case "cancelada":            return [];
  }
}

function parseNum(v: string | number): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function fmt(n: number) { return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function ServiceOrderEditor() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id || id === "new";

  // Estado da OS
  const [os, setOs] = useState<ServiceOrder | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(search.get("customer"));
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<CustomerEquipment | null>(null);
  const [equipmentRefresh, setEquipmentRefresh] = useState(0);
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [status, setStatus] = useState<OsStatus>("aberta");
  const [priority, setPriority] = useState<OsPriority>("normal");
  const [origin, setOrigin] = useState<OsOrigin>("balcao");
  const [reportedIssue, setReportedIssue] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [solution, setSolution] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [pickupRequired, setPickupRequired] = useState(false);
  const [pickupAddress, setPickupAddress] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => search.get("scheduled_at") || "");
  const [dueAt, setDueAt] = useState(() => search.get("due_at") || "");
  const [warrantyDays, setWarrantyDays] = useState("90");
  const [discount, setDiscount] = useState(0);

  const [items, setItems] = useState<ItemDraft[]>([]);
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);

  const [team, setTeam] = useState<{ id: string; nome: string }[]>([]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [transitionTo, setTransitionTo] = useState<OsStatus | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  /* =========================================================
     LOAD OS existente
  ========================================================= */
  useEffect(() => {
    if (isNew) {
      // Reset completo dos estados quando o usuário navega DE uma OS existente
      // PARA `/service-orders/new` (botão "Nova OS para esse cliente").
      // Como o componente é o mesmo, React reusa a instância e o state
      // continuaria sujo com os dados da OS anterior se a gente não limpasse aqui.
      setOs(null);
      setCustomerId(search.get("customer"));
      setEquipmentId(search.get("equipment"));
      setEquipment(null);
      setTechnicianId(null);
      setStatus("aberta");
      setPriority("normal");
      setOrigin("balcao");
      setReportedIssue("");
      setDiagnosis("");
      setSolution("");
      setInternalNotes("");
      setPickupRequired(false);
      setPickupAddress("");
      setScheduledAt(search.get("scheduled_at") || "");
      setDueAt(search.get("due_at") || "");
      setWarrantyDays("90");
      setDiscount(0);
      setItems([]);
      setRemovedItemIds([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [or, ir] = await Promise.all([
        supabase.from("service_orders" as any).select("*").eq("id", id).maybeSingle(),
        supabase.from("service_order_items" as any).select("*").eq("service_order_id", id).order("position"),
      ]);
      if (cancelled) return;
      if (or.error || !or.data) {
        toast({ title: "OS não encontrada", variant: "destructive" });
        navigate("/service-orders");
        return;
      }
      const o = or.data as ServiceOrder;
      setOs(o);
      setCustomerId(o.customer_id);
      setEquipmentId(o.equipment_id);
      setTechnicianId(o.technician_id);
      setStatus(o.status);
      setPriority(o.priority);
      setOrigin(o.origin);
      setReportedIssue(o.reported_issue || "");
      setDiagnosis(o.diagnosis || "");
      setSolution(o.solution || "");
      setInternalNotes(o.internal_notes || "");
      setPickupRequired(o.pickup_required);
      setPickupAddress(o.pickup_address || "");
      setScheduledAt(o.scheduled_at ? o.scheduled_at.slice(0, 16) : "");
      setDueAt(o.due_at ? o.due_at.slice(0, 16) : "");
      setWarrantyDays(String(o.warranty_days ?? 90));
      setDiscount(o.discount || 0);
      setItems(((ir.data as any[]) ?? []).map((i: any) => ({
        id: i.id,
        kind: i.kind,
        product_id: i.product_id,
        service_id: i.service_id,
        description: i.description,
        qty: Number(i.qty),
        unit_price: Number(i.unit_price),
        discount: Number(i.discount),
        consumed: i.consumed,
        position: i.position,
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew, navigate]);

  // Cliente atual (mostra no header)
  useEffect(() => {
    if (!customerId) { setCustomer(null); return; }
    if (customer?.id === customerId) return;
    supabase.from("customers" as any).select("*").eq("id", customerId).maybeSingle()
      .then(({ data }) => setCustomer((data as any) || null));
  }, [customerId]);

  // Carrega equipe (para selecionar técnico)
  useEffect(() => {
    if (!user?.company_id) return;
    supabase.from("profiles" as any).select("id, nome").eq("company_id", user.company_id).order("nome")
      .then(({ data }) => setTeam(((data as any[]) ?? []) as any));
  }, [user?.company_id]);

  /* =========================================================
     TOTAIS computados
  ========================================================= */
  const partsTotal = useMemo(
    () => items.filter((i) => i.kind === "peca").reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0),
    [items]
  );
  const laborTotal = useMemo(
    () => items.filter((i) => i.kind === "servico").reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0),
    [items]
  );
  const total = Math.max(0, partsTotal + laborTotal - (discount || 0));

  const perms = usePermissions();
  const isOwnerOrTech = !!user && (os?.opened_by === user.id || os?.technician_id === user.id);
  const isManagerScope = perms.isManager;
  const closed = status === "faturada" || status === "cancelada";
  // Pode editar se é manager OU técnico atribuído OU quem abriu (e não está fechada).
  const editable = !closed && (isManagerScope || isOwnerOrTech || isNew);
  // Técnico puro não vê valores nem totais; quem vê (vendedor/gerente) edita conforme permissão de edição.
  const isPureTechnician = perms.isPureTechnician;
  const canSeePricing = perms.canSeePricing;
  const canEditPricing = editable && canSeePricing;
  // Conversão em venda: bloqueada para técnico puro (sem perm.canConvertOsToSale).
  // Quem pode:
  //   - Manager (admin/gerente) — qualquer OS
  //   - Quem ABRIU a OS — geralmente o vendedor que cadastrou
  //   - Técnico+vendedor ATRIBUÍDO — atendeu a OS, pode fechar a venda
  //     (típico: tec recebeu OS, fez o serviço, e como também é vendedor agora
  //      fatura pro cliente)
  const canConvert =
    perms.canConvertOsToSale &&
    (isManagerScope ||
      os?.opened_by === user?.id ||
      os?.technician_id === user?.id);

  /* =========================================================
     ITENS — handlers
  ========================================================= */
  function pickItem(picked: PickedItem) {
    if (picked.kind === "product") {
      const p = picked.product;
      // Alerta de estoque baixo — mesmo racional da venda: soma o que já está
      // na OS pra esse produto e checa se ficaria no ou abaixo do mínimo.
      if (p.stock_qty != null) {
        const alreadyInOs = items
          .filter((it) => it.product_id === p.id)
          .reduce((sum, it) => sum + Number(it.qty || 0), 0);
        const afterSale = Number(p.stock_qty) - (alreadyInOs + 1);
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
          kind: "peca",
          product_id: p.id,
          service_id: null,
          description: [p.name, p.brand, p.model].filter(Boolean).join(" "),
          qty: 1,
          unit_price: p.sale_price || 0,
          discount: 0,
          consumed: false,
          position: arr.length,
        },
      ]);
    } else {
      const s = picked.service;
      setItems((arr) => [
        ...arr,
        {
          kind: "servico",
          product_id: null,
          service_id: s.id,
          description: s.name,
          qty: 1,
          unit_price: s.default_price || 0,
          discount: 0,
          consumed: true, // serviço não tem estoque, marcar como "executado" é o default
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
     SAVE / TRANSIÇÕES
  ========================================================= */
  async function persist(opts?: { newStatus?: OsStatus }) {
    if (!user?.company_id) return null;
    if (!customerId) {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return null;
    }

    setSaving(true);
    const newStatus = opts?.newStatus || status;

    // Captura ANTES do save: era nova? técnico mudou?
    const wasNew = isNew && !os?.id;
    const prevTechnicianId = (os as any)?.technician_id ?? null;
    const technicianChanged = !wasNew && prevTechnicianId !== technicianId;

    const headerPayload: any = {
      company_id: user.company_id,
      customer_id: customerId,
      equipment_id: equipmentId,
      technician_id: technicianId,
      opened_by: os?.opened_by || user.id,
      status: newStatus,
      priority,
      origin,
      reported_issue: reportedIssue.trim() || null,
      diagnosis: diagnosis.trim() || null,
      solution: solution.trim() || null,
      internal_notes: internalNotes.trim() || null,
      pickup_required: pickupRequired,
      pickup_address: pickupAddress.trim() || null,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      warranty_days: parseInt(warrantyDays, 10) || 90,
      parts_total: partsTotal,
      labor_total: laborTotal,
      discount,
      total,
      remote_jid: customer?.remote_jid || null,
    };

    let osId = os?.id;

    if (isNew && !osId) {
      const { data, error } = await supabase.from("service_orders" as any).insert(headerPayload).select().single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Erro ao salvar", description: error?.message, variant: "destructive" });
        return null;
      }
      osId = (data as any).id;
      setOs(data as any);
    } else {
      const { error } = await supabase.from("service_orders" as any).update(headerPayload).eq("id", osId!);
      if (error) {
        setSaving(false);
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        return null;
      }
    }

    if (removedItemIds.length) {
      await supabase.from("service_order_items" as any).delete().in("id", removedItemIds);
      setRemovedItemIds([]);
    }
    for (const [i, it] of items.entries()) {
      const itPayload: any = {
        service_order_id: osId,
        kind: it.kind,
        product_id: it.product_id,
        service_id: it.service_id,
        description: it.description,
        qty: it.qty,
        unit_price: it.unit_price,
        discount: it.discount,
        consumed: it.consumed,
        position: i,
      };
      if (it.id) {
        await supabase.from("service_order_items" as any).update(itPayload).eq("id", it.id);
      } else {
        const { data } = await supabase.from("service_order_items" as any).insert(itPayload).select("id").single();
        if (data) it.id = (data as any).id;
      }
    }

    setSaving(false);
    setStatus(newStatus);
    if (isNew && osId) {
      navigate(`/service-orders/${osId}`, { replace: true });
    }

    // Notifica técnico via WhatsApp em background (não bloqueia o save)
    if (osId && technicianId && (wasNew || technicianChanged)) {
      const reason: "new" | "transferred" = wasNew ? "new" : "transferred";
      notifyTechnicianAboutOS({
        osId,
        companyId: user.company_id,
        userId: user.id,
        reason,
      })
        .then((r) => {
          if (r.ok) {
            toast({
              title: reason === "new" ? "Técnico notificado" : "Transferência notificada",
              description: "Mensagem enviada via WhatsApp.",
            });
          } else if (r.reason && r.reason !== "disabled_by_company" && r.reason !== "no_technician") {
            // Não polui o user com avisos de "técnico sem whatsapp" etc se a empresa desligou
            console.warn("notifyTechnicianAboutOS skipped:", r.reason);
          }
        })
        .catch((e) => console.warn("notifyTechnicianAboutOS error:", e));
    }

    return osId;
  }

  async function handleSave() {
    const oid = await persist();
    if (oid) toast({ title: "Salvo" });
  }

  async function executeTransition(target: OsStatus, opts: { notifyCustomer: boolean; message: string }) {
    setTransitionBusy(true);
    const oid = await persist({ newStatus: target });
    if (!oid) { setTransitionBusy(false); return; }
    if (opts.message.trim() && opts.notifyCustomer) {
      await supabase.from("service_order_history" as any).insert({
        service_order_id: oid,
        user_id: user?.id || null,
        message: opts.message.trim(),
        is_public: true,
      });
    }
    setTransitionBusy(false);
    setTransitionTo(null);
    toast({ title: `Status alterado para ${OS_STATUS_LABELS[target].label}` });

    // Notifica cliente via WhatsApp se:
    //  - user marcou "Notificar cliente" no dialog (manual), OU
    //  - status é "concluida"/"entregue" (AUTOMÁTICO sempre)
    const isAutoStatus = isAutoNotifyStatus(target);
    const shouldNotify = opts.notifyCustomer || isAutoStatus;

    if (shouldNotify && user?.company_id && oid) {
      notifyCustomerAboutOSStatus({
        osId: oid,
        companyId: user.company_id,
        newStatus: target as any,
        customMessage: opts.message.trim() || undefined,
        userId: user.id,
      })
        .then((r) => {
          if (r.ok) {
            toast({
              title: isAutoStatus ? "Cliente notificado automaticamente" : "Cliente notificado",
              description: "Mensagem enviada via WhatsApp.",
            });
          } else if (
            r.reason &&
            !["disabled_by_company", "customer_no_whatsapp", "no_webhook_configured"].includes(r.reason)
          ) {
            console.warn("notifyCustomerAboutOSStatus skipped:", r.reason);
          }
        })
        .catch((e) => console.warn("notifyCustomerAboutOSStatus error:", e));
    }
  }

  /* =========================================================
     CONVERSÃO EM VENDA
  ========================================================= */
  async function convertToSale() {
    if (!user?.company_id || !customerId) return;
    const sid = await persist();
    if (!sid) return;

    // Monta as observações da venda — só os SERVIÇOS EXECUTADOS, pra o cliente
    // ver no PDF impresso o que foi feito. Defeito relatado fica só na OS.
    const osNumber = String(os?.number ?? "").padStart(6, "0");
    const notesParts: string[] = [`Gerada a partir da OS #${osNumber}`];
    if (solution.trim()) {
      notesParts.push("");
      notesParts.push("SERVIÇOS EXECUTADOS:");
      notesParts.push(solution.trim());
    }
    const saleNotes = notesParts.join("\n");

    // Cria a venda já como faturada (dispara baixa de estoque automática via trigger)
    const { data: sale, error: saleErr } = await supabase.from("sales" as any).insert({
      company_id: user.company_id,
      customer_id: customerId,
      seller_id: user.id,
      status: "aprovado", // primeiro aprova
      issue_date: new Date().toISOString().slice(0, 10),
      subtotal: partsTotal + laborTotal,
      discount,
      freight: 0,
      total,
      notes: saleNotes,
      remote_jid: customer?.remote_jid || null,
      source: "os",
    }).select().single();

    if (saleErr || !sale) {
      toast({ title: "Erro ao criar venda", description: saleErr?.message, variant: "destructive" });
      return;
    }

    // Insere itens
    for (const [i, it] of items.entries()) {
      await supabase.from("sale_items" as any).insert({
        sale_id: (sale as any).id,
        product_id: it.product_id,
        service_id: it.service_id,
        description: it.description,
        qty: it.qty,
        unit_price: it.unit_price,
        discount: it.discount,
        position: i,
      });
    }

    // Vincula a venda à OS e marca OS como faturada
    await supabase.from("service_orders" as any).update({
      sale_id: (sale as any).id,
      status: "faturada",
    }).eq("id", sid);

    setStatus("faturada");
    setConfirmConvert(false);
    toast({
      title: "Venda criada",
      description: "OS marcada como faturada. Abrindo a venda...",
    });
    navigate(`/sales/${(sale as any).id}`);
  }

  /* =========================================================
     PDF
  ========================================================= */
  async function handlePdf() {
    const oid = os?.id || (await persist());
    if (!oid || !user?.company_id) return;
    const [or, ir, company] = await Promise.all([
      supabase.from("service_orders" as any).select("*").eq("id", oid).single(),
      supabase.from("service_order_items" as any).select("*").eq("service_order_id", oid).order("position"),
      loadCompanyHeader(user.company_id),
    ]);
    if (or.error || !or.data) {
      toast({ title: "Erro ao carregar OS para PDF", variant: "destructive" });
      return;
    }
    const logoData = company?.logo_url ? await imageToDataUrl(company.logo_url) : null;
    const techName = team.find((t) => t.id === technicianId)?.nome;
    generateOsPdf({
      os: or.data as any,
      customer,
      equipment,
      items: (ir.data as any[]) ?? [],
      company,
      companyLogoDataUrl: logoData,
      companyName: user?.company_name || "Delvor",
      technicianName: techName,
    });
  }

  /* =========================================================
     RENDER
  ========================================================= */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando OS...
      </div>
    );
  }

  const statusBadge = OS_STATUS_LABELS[status];
  const priorityBadge = PRIORITY_OPTS.find((p) => p.value === priority)!;
  const transitions = allowedTransitions(status);
  const phone = pickWhatsapp({
    whatsapp: customer?.whatsapp,
    phone: customer?.phone,
    remote_jid: customer?.remote_jid,
  });

  return (
    <div className="space-y-6">
      {/* ================= HEADER ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/service-orders"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wrench className="h-6 w-6" />
              {isNew && !os ? "Nova Ordem de Serviço" : `OS #${String(os?.number ?? "—").padStart(6, "0")}`}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={`${statusBadge.tone} ring-1`}>{statusBadge.label}</Badge>
              <Badge className={`${priorityBadge.tone} ring-1`}>{priorityBadge.label}</Badge>
              {os?.created_at && (
                <span className="text-xs text-muted-foreground">
                  Criada em {new Date(os.created_at).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {phone && (
            <Button
              variant="outline"
              onClick={async () => {
                // Garante que o lead existe com o nome do cliente antes de abrir
                if (customerId && user?.company_id) {
                  const r = await ensureLeadFromCustomer({
                    companyId: user.company_id,
                    customerId,
                  });
                  if (r.ok && r.jid) {
                    navigate(`/chat?jid=${encodeURIComponent(r.jid)}`);
                    return;
                  }
                }
                // Fallback: navega só com o phone
                navigate(`/chat?jid=${encodeURIComponent(phone)}`);
              }}
              title="Abrir conversa no inbox"
            >
              <MessageSquare className="h-4 w-4 mr-1 text-emerald-500" /> WhatsApp
            </Button>
          )}
          {!isNew && (
            <Button variant="outline" onClick={handlePdf}>
              <FileDown className="h-4 w-4 mr-1" /> PDF
            </Button>
          )}
          {!isNew && customerId && (
            <Button
              variant="outline"
              onClick={() => navigate(`/service-orders/new?customer=${customerId}`)}
              title="Abrir outra OS pra este cliente — útil pra um segundo equipamento"
            >
              <Plus className="h-4 w-4 mr-1" /> Nova OS deste cliente
            </Button>
          )}
          {editable && (
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
            </Button>
          )}

          {/* Botões de transição de status */}
          {transitions.length > 0 && !isNew && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                  Mudar status
                  <ChevronDown className="h-4 w-4 ml-1.5 opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Avançar para...</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {transitions.map((t) => {
                  const meta = OS_STATUS_LABELS[t];
                  return (
                    <DropdownMenuItem
                      key={t}
                      onClick={() => setTransitionTo(t)}
                      className="cursor-pointer"
                    >
                      <span className={`inline-block h-2 w-2 rounded-full mr-2 ${meta.tone.split(" ")[0]}`} />
                      {meta.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Transferir OS para outro técnico */}
          {!isNew && !closed && (isManagerScope || isOwnerOrTech) && (
            <Button variant="outline" onClick={() => setTransferOpen(true)} title="Transferir para outro técnico">
              <UserCog className="h-4 w-4 mr-1" /> Transferir
            </Button>
          )}

          {/* Converter em venda — só admin/gerente/vendedor que abriu */}
          {!isNew && (status === "concluida" || status === "entregue") && total > 0 && canConvert && (
            <Button onClick={() => setConfirmConvert(true)} className="bg-teal-600 hover:bg-teal-700 text-white">
              <ShoppingCart className="h-4 w-4 mr-1" /> Converter em Venda
            </Button>
          )}
        </div>
      </div>

      {/* Aviso se for técnico puro vendo apenas */}
      {isPureTechnician && !isNew && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-300 flex items-start gap-2">
          <Lock className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Modo técnico — você foca no que importa: diagnóstico, solução, peças usadas e anexos.
            Valores e cobrança são responsabilidade do vendedor/gerente.
          </span>
        </div>
      )}

      {/* ================= CLIENTE / EQUIPAMENTO / RESPONSÁVEIS ================= */}
      <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <Label>Cliente *</Label>
          <CustomerCombobox value={customerId} onChange={setCustomerId} disabled={!editable} />
        </div>
        <div>
          <Label className="flex items-center justify-between">
            Equipamento
            {customerId && editable && (
              <button type="button" className="text-[11px] text-emerald-500 hover:underline inline-flex items-center" onClick={() => { setEquipment(null); setEquipmentDialogOpen(true); }}>
                <Plus className="h-3 w-3 mr-0.5" /> novo
              </button>
            )}
          </Label>
          <EquipmentCombobox
            customerId={customerId}
            value={equipmentId}
            onChange={(eid, eq) => { setEquipmentId(eid); setEquipment(eq); }}
            onCreateRequested={() => { setEquipment(null); setEquipmentDialogOpen(true); }}
            disabled={!editable}
            refreshKey={equipmentRefresh}
          />
          {equipment && editable && (
            <button type="button" className="mt-1 text-[11px] text-muted-foreground hover:underline inline-flex items-center" onClick={() => setEquipmentDialogOpen(true)}>
              <Pencil className="h-3 w-3 mr-0.5" /> editar equipamento
            </button>
          )}
        </div>
        <div>
          <Label>Técnico responsável</Label>
          <Select value={technicianId || "__none__"} onValueChange={(v) => setTechnicianId(v === "__none__" ? null : v)} disabled={!editable}>
            <SelectTrigger><SelectValue placeholder="Não atribuído" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Não atribuído</SelectItem>
              {team.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Origem</Label>
          <Select value={origin} onValueChange={(v: OsOrigin) => setOrigin(v)} disabled={!editable}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORIGIN_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Prioridade</Label>
          <Select value={priority} onValueChange={(v: OsPriority) => setPriority(v)} disabled={!editable}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="flex items-center gap-1">
            Prazo de entrega
            <span className="text-[10px] text-muted-foreground font-normal">(deadline)</span>
          </Label>
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            disabled={!editable}
            title="Quando você prometeu entregar pro cliente. Se passar dessa data sem finalizar, a OS aparece como atrasada."
          />
        </div>
        <div>
          <Label className="flex items-center gap-1">
            Visita agendada
            <span className="text-[10px] text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={!editable}
            title="Quando o técnico vai ao cliente. Use só em atendimento em campo."
          />
        </div>
      </div>

      {/* ================= TABS ================= */}
      <Tabs defaultValue="diagnostico" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 max-w-2xl">
          <TabsTrigger value="diagnostico"><Wrench className="h-3 w-3 mr-1" /> Defeito/Diagnóstico</TabsTrigger>
          <TabsTrigger value="itens"><ListChecks className="h-3 w-3 mr-1" /> Peças & Serviços</TabsTrigger>
          <TabsTrigger value="anexos"><Paperclip className="h-3 w-3 mr-1" /> Anexos</TabsTrigger>
          <TabsTrigger value="timeline"><History className="h-3 w-3 mr-1" /> Timeline</TabsTrigger>
        </TabsList>

        {/* Diagnóstico */}
        <TabsContent value="diagnostico" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <Label>Defeito relatado pelo cliente</Label>
              <Textarea rows={3} value={reportedIssue} onChange={(e) => setReportedIssue(e.target.value)} disabled={!editable} placeholder="Cliente relatou que..." />
            </div>
            <div>
              <Label>Diagnóstico técnico</Label>
              <Textarea rows={3} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} disabled={!editable} placeholder="Após análise, identificamos que..." />
            </div>
            <div>
              <Label>Solução aplicada</Label>
              <Textarea rows={3} value={solution} onChange={(e) => setSolution(e.target.value)} disabled={!editable} placeholder="Realizado: ..." />
            </div>
            <div>
              <Label>Notas internas (não vão no PDF nem para o cliente)</Label>
              <Textarea rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} disabled={!editable} />
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1 flex items-center justify-between">
              <Label htmlFor="pickup">Coleta/Entrega externa</Label>
              <Switch id="pickup" checked={pickupRequired} onCheckedChange={setPickupRequired} disabled={!editable} />
            </div>
            {pickupRequired && (
              <div className="md:col-span-2">
                <Label>Endereço de coleta/entrega</Label>
                <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} disabled={!editable} placeholder="Endereço completo..." />
              </div>
            )}
            <div>
              <Label>Garantia (dias)</Label>
              <Input
                value={warrantyDays}
                onChange={(e) => setWarrantyDays(e.target.value.replace(/\D+/g, ""))}
                disabled={!editable}
                inputMode="numeric"
                placeholder="90"
              />
            </div>
          </div>
        </TabsContent>

        {/* Itens */}
        <TabsContent value="itens" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4" />
                <h2 className="font-semibold">Peças e serviços</h2>
              </div>
              {editable && (
                <Button onClick={() => setPickerOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-20">Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-20 text-right">Qtd</TableHead>
                  {canSeePricing && <TableHead className="w-32 text-right">Unitário</TableHead>}
                  {canSeePricing && <TableHead className="w-32 text-right">Total</TableHead>}
                  <TableHead className="w-28 text-center">Consumido</TableHead>
                  {editable && <TableHead className="w-12"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canSeePricing ? (editable ? 8 : 7) : (editable ? 6 : 5)} className="text-center py-10 text-muted-foreground">
                      Nenhum item. {editable && "Clique em \"Adicionar\" para incluir peças do estoque ou serviços."}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((it, idx) => {
                  const lineTotal = it.qty * it.unit_price - (it.discount || 0);
                  return (
                    <TableRow key={it.id || `new-${idx}`}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <Badge variant={it.kind === "peca" ? "default" : "secondary"}>
                          {it.kind === "peca" ? "Peça" : "Serviço"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Input value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} disabled={!editable} className="h-8" />
                      </TableCell>
                      <TableCell>
                        <Input value={String(it.qty)} onChange={(e) => updateItem(idx, { qty: parseNum(e.target.value) })} disabled={!editable} inputMode="decimal" className="h-8 text-right" />
                      </TableCell>
                      {canSeePricing && (
                        <TableCell>
                          <MoneyInput value={it.unit_price} onChange={(v) => updateItem(idx, { unit_price: v })} disabled={!canEditPricing} className="h-8 text-right font-mono" title={!canEditPricing ? "Apenas admin/gerente/vendedor pode alterar preços" : undefined} />
                        </TableCell>
                      )}
                      {canSeePricing && (
                        <TableCell className="text-right font-mono font-medium">{formatBRL(lineTotal)}</TableCell>
                      )}
                      <TableCell className="text-center">
                        {it.kind === "peca" ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch
                              checked={it.consumed}
                              onCheckedChange={(v) => updateItem(idx, { consumed: v })}
                              disabled={!editable}
                            />
                            {it.consumed && (
                              <span title="Já deu baixa no estoque ao salvar">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
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

          {/* Totais — escondidos pra técnico puro */}
          {canSeePricing && (
            <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Peças</div>
                <div className="text-lg font-mono">{formatBRL(partsTotal)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Mão de obra</div>
                <div className="text-lg font-mono">{formatBRL(laborTotal)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Desconto geral</div>
                <MoneyInput value={discount} onChange={setDiscount} disabled={!canEditPricing} className="h-8 text-right font-mono" />
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">TOTAL</div>
                <div className="text-2xl font-bold font-mono">{formatBRL(total)}</div>
              </div>
            </div>
          )}

          {items.some((i) => i.kind === "peca" && i.consumed && !i.id) && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Há peças marcadas como "consumidas" ainda não salvas. Ao clicar em <b>Salvar</b>,
                elas darão baixa automática no estoque.
              </span>
            </div>
          )}
        </TabsContent>

        {/* Anexos */}
        <TabsContent value="anexos" className="mt-4">
          <div className="rounded-lg border bg-card p-4">
            <OsAttachments serviceOrderId={os?.id || null} readOnly={!editable} />
          </div>
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-4">
          <div className="rounded-lg border bg-card p-4">
            <OsHistory
              serviceOrderId={os?.id || null}
              onNotifyCustomer={(msg) => {
                if (phone) openWhatsApp(phone, msg);
              }}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* ================= DIALOGS ================= */}
      <AddItemDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={pickItem} />

      <EquipmentFormDialog
        open={equipmentDialogOpen}
        onOpenChange={setEquipmentDialogOpen}
        customerId={customerId}
        equipment={equipment}
        onSaved={(eq) => {
          setEquipmentId(eq.id);
          setEquipment(eq);
          setEquipmentRefresh((n) => n + 1);
        }}
      />

      {os && (
        <TransferOsDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          serviceOrderId={os.id}
          currentTechnicianId={technicianId}
          currentTechnicianName={team.find((t) => t.id === technicianId)?.nome}
          onTransferred={(newId) => {
            setTechnicianId(newId);
            setOs((cur) => cur ? { ...cur, technician_id: newId } : cur);
          }}
        />
      )}

      {transitionTo && (
        <OsStatusTransitionDialog
          open={!!transitionTo}
          onOpenChange={(o) => !o && setTransitionTo(null)}
          fromStatus={status}
          toStatus={transitionTo}
          serviceOrder={os}
          customer={customer}
          busy={transitionBusy}
          onConfirm={(opts) => executeTransition(transitionTo, opts)}
        />
      )}

      <AlertDialog open={confirmConvert} onOpenChange={setConfirmConvert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Converter OS em Venda?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai criar uma <b>nova venda</b> com todos os itens desta OS, marcar a OS como <b>faturada</b> e abrir a venda em modo edição.
              {items.some((i) => i.kind === "peca" && !i.consumed) && (
                <span className="block mt-2 text-amber-400">
                  Atenção: há peças não consumidas — elas serão cobradas na venda mas não darão baixa no estoque pela OS.
                  Marque como consumidas antes se for o caso.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-teal-600 hover:bg-teal-700 text-white" onClick={convertToSale}>
              Criar venda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
