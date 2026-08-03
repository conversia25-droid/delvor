/**
 * Detalhe de OS no mobile — foco no que o técnico faz no dia-a-dia.
 *
 * Hierarquia visual:
 *  1. Header sticky: voltar + número + status + WhatsApp
 *  2. Cliente (nome + telefone) + Equipamento (compacto)
 *  3. Defeito relatado (somente leitura — quem abriu escreveu)
 *  4. Galeria de fotos (scroll horizontal) + botão "Tirar foto"
 *  5. Diagnóstico + Solução (textareas editáveis com auto-save)
 *  6. Sticky bottom: botões grandes pra avançar status
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  Phone,
  Camera,
  Wrench,
  ChevronRight,
  Check,
  Image as ImageIcon,
  Package,
  ShoppingBag,
  Plus,
  Trash2,
  Search,
  X,
  ListChecks,
  Receipt,
} from "lucide-react";

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

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "@/components/ui/use-toast";
import { uploadFile } from "@/lib/uploadImage";
import { openWhatsApp, pickWhatsapp } from "@/lib/whatsapp";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ImageLightbox from "@/components/ImageLightbox";
import MobileItemPickerSheet from "@/components/mobile/MobileItemPickerSheet";

import type {
  ServiceOrder,
  ServiceOrderAttachment,
  Customer,
  CustomerEquipment,
  OsStatus,
  OsItemKind,
  Product,
  ServiceCatalogItem,
} from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";

/**
 * Próximo status sugerido — botão grande no rodapé.
 * Mantém o fluxo natural do técnico: pega → diagnostica → executa → concluída.
 *
 * Importante: técnico NÃO entrega nem fatura — isso é fluxo do vendedor/admin
 * no desktop. A entrega pressupõe que o cliente já pagou (faturamento), o que
 * o técnico não consegue fazer no mobile. Por isso "concluída" é a parada
 * final pra ele — daqui em diante quem assume é o vendedor.
 */
const NEXT_STATUS: Partial<Record<OsStatus, { value: OsStatus; label: string; tone: string }>> = {
  aberta:               { value: "diagnostico",  label: "Iniciar diagnóstico", tone: "bg-blue-600 hover:bg-blue-700" },
  diagnostico:          { value: "em_execucao",  label: "Começar execução",    tone: "bg-blue-600 hover:bg-blue-700" },
  aguardando_aprovacao: { value: "em_execucao",  label: "Aprovado — executar", tone: "bg-emerald-600 hover:bg-emerald-700" },
  aguardando_peca:      { value: "em_execucao",  label: "Peça chegou — executar", tone: "bg-emerald-600 hover:bg-emerald-700" },
  em_execucao:          { value: "concluida",    label: "Marcar como concluída", tone: "bg-emerald-600 hover:bg-emerald-700" },
  // concluida: NÃO tem próximo — a partir daqui é o vendedor que fatura.
};

/**
 * Transições válidas no APP MOBILE (técnico). Versão restrita do que o
 * desktop permite — sem "entregue" e "faturada", que dependem de outro perfil.
 *
 * Diferença vs. desktop:
 *  - concluida → SÓ pode voltar pra em_execucao (técnico errou e quer retomar).
 *    Não pode marcar como entregue. Entrega depende de faturamento, que é
 *    responsabilidade do vendedor.
 *  - entregue / faturada → sem transições no mobile.
 */
function allowedTransitions(s: OsStatus): OsStatus[] {
  switch (s) {
    case "aberta":               return ["diagnostico", "em_execucao", "cancelada"];
    case "diagnostico":          return ["aguardando_aprovacao", "aguardando_peca", "em_execucao", "cancelada"];
    case "aguardando_aprovacao": return ["em_execucao", "aguardando_peca", "cancelada"];
    case "aguardando_peca":      return ["em_execucao", "cancelada"];
    case "em_execucao":          return ["concluida", "aguardando_peca", "cancelada"];
    case "concluida":            return ["em_execucao"];  // só dá pra voltar; vendedor faz o resto no desktop
    case "entregue":             return [];
    case "faturada":             return [];
    case "cancelada":            return [];
  }
}

/** Linha de item da OS, mesmo shape usado no ServiceOrderEditor. */
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

function parseNum(v: string | number): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function MobileOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = usePermissions();
  const canSeePricing = perms.canSeePricing;

  const [loading, setLoading] = useState(true);
  const [os, setOs] = useState<ServiceOrder | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipment, setEquipment] = useState<CustomerEquipment | null>(null);
  const [photos, setPhotos] = useState<ServiceOrderAttachment[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [solution, setSolution] = useState("");
  const [savingText, setSavingText] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);

  // Sheets
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  /* ─────── LOAD ─────── */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: o } = await supabase
        .from("service_orders" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (!o) {
        toast({ title: "OS não encontrada", variant: "destructive" });
        navigate("/m/orders");
        return;
      }
      const ord = o as ServiceOrder;
      setOs(ord);
      setDiagnosis(ord.diagnosis || "");
      setSolution(ord.solution || "");

      // Cliente, equipamento, fotos, items em paralelo
      const [cr, er, ar, ir] = await Promise.all([
        ord.customer_id
          ? supabase.from("customers" as any).select("*").eq("id", ord.customer_id).maybeSingle()
          : Promise.resolve({ data: null }),
        ord.equipment_id
          ? supabase.from("customer_equipments" as any).select("*").eq("id", ord.equipment_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("service_order_attachments" as any)
          .select("*")
          .eq("service_order_id", ord.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_order_items" as any)
          .select("*")
          .eq("service_order_id", ord.id)
          .order("position"),
      ]);
      if (cancelled) return;
      setCustomer((cr.data as any) || null);
      setEquipment((er.data as any) || null);
      setPhotos(((ar.data as any[]) ?? []).filter((a: any) => a.mime_type?.startsWith("image/")));
      setItems(
        ((ir.data as any[]) ?? []).map((i: any) => ({
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
        }))
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  /* ─────── AUTO-SAVE diagnóstico/solução ─────── */
  function scheduleSave(field: "diagnosis" | "solution", value: string) {
    if (!os) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSavingText(true);
      const { error } = await supabase
        .from("service_orders" as any)
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq("id", os.id);
      setSavingText(false);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        return;
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1200);
    }, 800);
  }

  /* ─────── TIRAR / ENVIAR FOTO ─────── */
  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file || !os || !user?.company_id) return;
    setUploading(true);
    try {
      const up = await uploadFile(file);
      if (!up.ok) {
        toast({ title: "Erro no upload", description: up.error, variant: "destructive" });
        return;
      }
      // Decide o kind automaticamente: se a OS ainda tá em status de entrada,
      // é foto_entrada; senão, foto_saida.
      const kind = ["aberta", "diagnostico"].includes(os.status) ? "foto_entrada" : "foto_saida";
      const { data: inserted, error: insErr } = await supabase
        .from("service_order_attachments" as any)
        .insert({
          service_order_id: os.id,
          file_name: file.name,
          file_url: up.url,
          mime_type: file.type || null,
          size_bytes: file.size,
          kind,
          uploaded_by: user.id,
        })
        .select("*")
        .single();
      if (insErr) throw insErr;
      // Otimista: já adiciona na lista sem refetch
      if (inserted) setPhotos((arr) => [inserted as any, ...arr]);
      toast({ title: "Foto enviada" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  /* ─────── MUDAR STATUS (qualquer transição válida) ─────── */
  async function changeStatus(target: OsStatus) {
    if (!os || target === os.status) return;
    setUpdatingStatus(true);
    const { error } = await supabase
      .from("service_orders" as any)
      .update({
        status: target,
        updated_at: new Date().toISOString(),
      })
      .eq("id", os.id);
    setUpdatingStatus(false);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    setOs({ ...os, status: target });
    setStatusSheetOpen(false);
    toast({ title: `OS marcada como "${OS_STATUS_LABELS[target]?.label}"` });
  }
  // Conveniência pro sticky bottom — chama o próximo sugerido.
  async function advanceStatus() {
    if (!os) return;
    const next = NEXT_STATUS[os.status];
    if (next) await changeStatus(next.value);
  }

  /* ─────── ITEMS (peças / serviços) ─────── */
  // Total geral (peças + serviços). Só faz sentido pra quem vê preço.
  const itemsTotal = useMemo(
    () => items.reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0),
    [items]
  );

  /**
   * Recalcula `parts_total`, `labor_total` e `total` no banco a partir de
   * uma lista de itens (precisa receber por argumento porque setState é
   * assíncrono — não dá pra confiar no `items` do escopo logo após mexer).
   * Sem isso, a linha da OS na lista (e relatórios) fica com R$ 0,00.
   */
  async function recalcOsTotals(currentItems: ItemDraft[]) {
    if (!os) return;
    const partsTotal = currentItems
      .filter((it) => it.kind === "peca")
      .reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0);
    const laborTotal = currentItems
      .filter((it) => it.kind === "servico")
      .reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0);
    const total = Math.max(0, partsTotal + laborTotal - (os.discount || 0));
    const { error } = await supabase
      .from("service_orders" as any)
      .update({
        parts_total: partsTotal,
        labor_total: laborTotal,
        total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", os.id);
    if (error) {
      console.warn("Erro ao recalcular totais da OS:", error.message);
      return;
    }
    setOs((prev) =>
      prev ? { ...prev, parts_total: partsTotal, labor_total: laborTotal, total } : prev
    );
  }

  /**
   * Insere um item novo (produto ou serviço escolhido no picker).
   * Persiste no banco imediatamente — mobile = sem botão "Salvar tudo".
   */
  async function addItem(picked: { kind: "peca" | "servico"; data: Product | ServiceCatalogItem }) {
    if (!os) return;
    const lastPos = items.length > 0 ? items[items.length - 1].position : 0;
    const position = lastPos + 1;
    const isPart = picked.kind === "peca";
    const product = isPart ? (picked.data as Product) : null;
    const service = !isPart ? (picked.data as ServiceCatalogItem) : null;

    const payload: any = {
      service_order_id: os.id,
      kind: picked.kind,
      product_id: product?.id ?? null,
      service_id: service?.id ?? null,
      description: product?.name || service?.name || "",
      qty: 1,
      unit_price: Number(product?.sale_price ?? service?.default_price ?? 0),
      discount: 0,
      consumed: false,
      position,
    };

    const { data, error } = await supabase
      .from("service_order_items" as any)
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      toast({ title: "Erro ao adicionar", description: error.message, variant: "destructive" });
      return;
    }
    const row = data as any;
    const newItem: ItemDraft = {
      id: row.id,
      kind: row.kind,
      product_id: row.product_id,
      service_id: row.service_id,
      description: row.description,
      qty: Number(row.qty),
      unit_price: Number(row.unit_price),
      discount: Number(row.discount),
      consumed: row.consumed,
      position: row.position,
    };
    const newItems = [...items, newItem];
    setItems(newItems);
    setItemPickerOpen(false);
    // Recalcula totais da OS no banco — senão a linha fica com R$ 0,00 na lista
    void recalcOsTotals(newItems);
    toast({ title: `${isPart ? "Peça" : "Serviço"} adicionado` });
  }

  /** Salva alterações de um item (qty, valor, descrição). */
  async function saveItem(idx: number, patch: Partial<ItemDraft>) {
    const it = items[idx];
    if (!it?.id) {
      // Item ainda sem ID (caso de adição offline) — só atualiza o state
      const newItems = items.map((x, i) => (i === idx ? { ...x, ...patch } : x));
      setItems(newItems);
      void recalcOsTotals(newItems);
      return;
    }
    const next = { ...it, ...patch };
    const newItems = items.map((x, i) => (i === idx ? next : x));
    // Otimista: atualiza UI primeiro
    setItems(newItems);
    const { error } = await supabase
      .from("service_order_items" as any)
      .update({
        description: next.description,
        qty: next.qty,
        unit_price: next.unit_price,
        discount: next.discount,
      })
      .eq("id", it.id);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    // Atualiza totais da OS no banco também
    void recalcOsTotals(newItems);
  }

  /** Remove um item da OS — apaga do banco. */
  async function removeItem(idx: number) {
    const it = items[idx];
    if (!it) return;
    if (it.id) {
      const { error } = await supabase.from("service_order_items" as any).delete().eq("id", it.id);
      if (error) {
        toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
        return;
      }
    }
    const newItems = items.filter((_, i) => i !== idx);
    setItems(newItems);
    setEditingItemIdx(null);
    void recalcOsTotals(newItems);
    toast({ title: "Item removido" });
  }

  /* ─────── CONVERSÃO EM VENDA ─────── */
  /**
   * Cria uma venda nova a partir desta OS:
   *  - sale com seller_id = técnico+vendedor atual
   *  - sale_items copiados dos service_order_items
   *  - OS marcada como "faturada" e vinculada via sale_id
   *  - Estoque é dado baixa automática (trigger no banco)
   *  - Notas da venda trazem só o "SERVIÇOS EXECUTADOS" — defeito relatado
   *    fica só na OS.
   *
   * Pós-conversão, navega pro editor mobile da venda pra ajustar pagamentos.
   */
  async function convertToSale() {
    if (!os || !user?.company_id || !os.customer_id) return;
    setConverting(true);

    const osNumber = String(os.number ?? "").padStart(6, "0");
    const notesParts: string[] = [`Gerada a partir da OS #${osNumber}`];
    if (solution.trim()) {
      notesParts.push("");
      notesParts.push("SERVIÇOS EXECUTADOS:");
      notesParts.push(solution.trim());
    }
    const saleNotes = notesParts.join("\n");

    // Calcula totais a partir dos items locais (já refletem o estado da OS)
    const subtotal = items.reduce((s, it) => s + (it.qty * it.unit_price - (it.discount || 0)), 0);
    const total = Math.max(0, subtotal - (os.discount || 0));

    const { data: sale, error: saleErr } = await supabase.from("sales" as any).insert({
      company_id: user.company_id,
      customer_id: os.customer_id,
      seller_id: user.id,
      status: "aprovado",
      issue_date: new Date().toISOString().slice(0, 10),
      subtotal,
      discount: os.discount || 0,
      freight: 0,
      total,
      notes: saleNotes,
      remote_jid: customer?.remote_jid || null,
      source: "os",
    }).select().single();

    if (saleErr || !sale) {
      setConverting(false);
      toast({ title: "Erro ao criar venda", description: saleErr?.message, variant: "destructive" });
      return;
    }
    const saleId = (sale as any).id;

    // Copia items pra sale_items
    for (const [i, it] of items.entries()) {
      await supabase.from("sale_items" as any).insert({
        sale_id: saleId,
        product_id: it.product_id,
        service_id: it.service_id,
        description: it.description,
        qty: it.qty,
        unit_price: it.unit_price,
        discount: it.discount,
        position: i,
      });
    }

    // Vincula e fecha a OS
    await supabase.from("service_orders" as any).update({
      sale_id: saleId,
      status: "faturada",
    }).eq("id", os.id);

    setOs({ ...os, status: "faturada" as OsStatus });
    setConvertConfirmOpen(false);
    setConverting(false);
    toast({ title: "Venda criada", description: "OS marcada como faturada." });
    // Navega pro editor mobile da venda pra ajustar pagamentos
    navigate(`/m/sales/${saleId}`);
  }

  /* ─────── WHATSAPP / TELEFONE ─────── */
  function openWa() {
    if (!customer) return;
    const wa = pickWhatsapp({
      whatsapp: customer.whatsapp,
      phone: customer.phone,
      remote_jid: customer.remote_jid,
    });
    if (!wa) {
      toast({ title: "Cliente sem WhatsApp cadastrado", variant: "destructive" });
      return;
    }
    const msg = `Olá ${customer.name?.split(" ")[0] || ""}, sou ${user?.nome || "o técnico"} — sobre a OS #${String(os?.number).padStart(6, "0")}…`;
    openWhatsApp(wa, msg);
  }

  function callPhone() {
    const tel = customer?.phone || customer?.whatsapp;
    if (!tel) {
      toast({ title: "Cliente sem telefone", variant: "destructive" });
      return;
    }
    window.location.href = `tel:${tel.replace(/\D/g, "")}`;
  }

  /* ─────── RENDER ─────── */
  if (loading || !os) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando OS...
      </div>
    );
  }

  const statusMeta = OS_STATUS_LABELS[os.status];
  const next = NEXT_STATUS[os.status];
  const closed = ["faturada", "cancelada"].includes(os.status);
  const equipLabel = equipment
    ? [equipment.brand, equipment.model].filter(Boolean).join(" ") || equipment.serial_number || "Equipamento"
    : null;

  // Pode converter em venda?
  //   - Tem permissão (não é técnico puro — vendedor passa)
  //   - Status concluida ou entregue (OS pronta pra faturar)
  //   - Tem item lançado (total > 0)
  //   - É manager OU abriu a OS OU é o técnico atribuído
  const isOwnerOrTech =
    !!user &&
    (os.opened_by === user.id || os.technician_id === user.id);
  const canConvert =
    perms.canConvertOsToSale &&
    ["concluida", "entregue"].includes(os.status) &&
    itemsTotal > 0 &&
    (perms.isManager || isOwnerOrTech);

  return (
    <div className="max-w-2xl mx-auto pb-32">
      {/* HEADER STICKY */}
      <div className="sticky top-14 z-20 bg-background/95 backdrop-blur border-b border-border/60 px-3 py-2 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/m/orders")} className="h-9 w-9">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">OS #{String(os.number).padStart(6, "0")}</div>
          {statusMeta && (
            // Badge clicável → abre status sheet com todas as transições válidas.
            // Tem chevron pra deixar óbvio que é interativo.
            <button
              onClick={() => !closed && setStatusSheetOpen(true)}
              disabled={closed}
              className="inline-flex items-center gap-1 mt-0.5 disabled:opacity-70"
            >
              <Badge className={`${statusMeta.tone} ring-1 text-[10px] px-1.5 py-0`}>
                {statusMeta.label}
              </Badge>
              {!closed && <ChevronRight className="h-3 w-3 text-muted-foreground rotate-90" />}
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
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Cliente
          </div>
          <div className="font-semibold">{customer?.name || "—"}</div>
          {customer && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openWa}
                className="flex-1 h-10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                <MessageSquare className="h-4 w-4 mr-1.5" /> WhatsApp
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={callPhone}
                className="flex-1 h-10 text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
              >
                <Phone className="h-4 w-4 mr-1.5" /> Ligar
              </Button>
            </div>
          )}
        </section>

        {/* EQUIPAMENTO */}
        {equipLabel && (
          <section className="rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Equipamento
            </div>
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="text-sm font-medium truncate">{equipLabel}</div>
            </div>
            {equipment?.serial_number && (
              <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                S/N: {equipment.serial_number}
              </div>
            )}
          </section>
        )}

        {/* DEFEITO RELATADO (read-only) */}
        {os.reported_issue && (
          <section className="rounded-xl border border-border/60 bg-amber-500/5 ring-1 ring-amber-500/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-amber-300/80 font-semibold mb-1">
              Defeito relatado
            </div>
            <div className="text-sm whitespace-pre-wrap">{os.reported_issue}</div>
          </section>
        )}

        {/* FOTOS */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Fotos do equipamento
            </div>
            <div className="text-[11px] text-muted-foreground">
              {photos.length} foto{photos.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 snap-x">
            {/* Botão de TIRAR FOTO — primeiro item */}
            {!closed && (
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={uploading}
                className="shrink-0 snap-start h-28 w-28 rounded-xl border-2 border-dashed border-blue-500/40 bg-blue-500/5 flex flex-col items-center justify-center gap-1 text-blue-300 active:bg-blue-500/15 transition disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <>
                    <Camera className="h-6 w-6" />
                    <span className="text-[11px] font-medium">Tirar foto</span>
                  </>
                )}
              </button>
            )}

            {photos.length === 0 && !uploading && (
              <div className="shrink-0 h-28 flex items-center text-xs text-muted-foreground">
                <ImageIcon className="h-4 w-4 mr-1.5" /> Nenhuma foto ainda
              </div>
            )}

            {photos.map((p) => (
              <button
                key={p.id}
                onClick={() => setViewer({ url: p.file_url, name: p.file_name })}
                className="shrink-0 snap-start h-28 w-28 rounded-xl border border-border/60 overflow-hidden bg-muted"
              >
                <img src={p.file_url} alt={p.file_name} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>

          {/* Input escondido — `capture="environment"` abre câmera traseira no celular */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoSelected}
          />
        </section>

        {/* DIAGNÓSTICO */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Diagnóstico
            </label>
            {savingText && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <Textarea
            value={diagnosis}
            onChange={(e) => {
              setDiagnosis(e.target.value);
              scheduleSave("diagnosis", e.target.value);
            }}
            placeholder="O que você encontrou? Causa, peças identificadas, observações..."
            className="min-h-[100px] text-sm"
            disabled={closed}
          />
        </section>

        {/* SOLUÇÃO */}
        <section className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Serviço executado
          </label>
          <Textarea
            value={solution}
            onChange={(e) => {
              setSolution(e.target.value);
              scheduleSave("solution", e.target.value);
            }}
            placeholder="O que foi feito pra resolver? Esta descrição vai sair no PDF da venda."
            className="min-h-[100px] text-sm"
            disabled={closed}
          />
        </section>

        {/* PEÇAS E SERVIÇOS */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Peças e serviços
            </div>
            <div className="text-[11px] text-muted-foreground">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-border/60 p-4 text-center">
              <Package className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground mb-3">
                Nenhuma peça ou serviço lançado.
              </p>
              {!closed && (
                <Button size="sm" variant="outline" onClick={() => setItemPickerOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" /> Adicionar
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 divide-y divide-border/40 overflow-hidden">
              {items.map((it, idx) => {
                const subtotal = it.qty * it.unit_price - (it.discount || 0);
                const isPart = it.kind === "peca";
                return (
                  <button
                    key={it.id || `tmp-${idx}`}
                    onClick={() => !closed && setEditingItemIdx(idx)}
                    disabled={closed}
                    className="w-full text-left p-3 active:bg-muted/30 transition flex items-center gap-3"
                  >
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isPart
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-sky-500/15 text-sky-300"
                      }`}
                    >
                      {isPart ? <Package className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.description}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <span>
                          {it.qty}× {canSeePricing ? formatBRL(it.unit_price) : "—"}
                        </span>
                        {it.discount > 0 && canSeePricing && (
                          <span className="text-rose-400">−{formatBRL(it.discount)}</span>
                        )}
                      </div>
                    </div>
                    {canSeePricing && (
                      <div className="text-sm font-mono font-semibold shrink-0">
                        {formatBRL(subtotal)}
                      </div>
                    )}
                  </button>
                );
              })}
              {/* Rodapé: total + botão adicionar */}
              <div className="p-3 bg-muted/20 flex items-center justify-between gap-2">
                {!closed && (
                  <Button size="sm" variant="outline" onClick={() => setItemPickerOpen(true)}>
                    <Plus className="h-4 w-4 mr-1.5" /> Adicionar
                  </Button>
                )}
                {canSeePricing && (
                  <div className="text-right ml-auto">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                    <div className="font-mono font-bold">{formatBRL(itemsTotal)}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* STICKY BOTTOM: avançar status, converter em venda, ou aviso */}
      {!closed && (next || os.status === "concluida" || canConvert) && (
        <div
          className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border/60 p-3"
          style={{ paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom, 0))` }}
        >
          <div className="max-w-2xl mx-auto space-y-2">
            {/* Botão de converter — só aparece pra quem é vendedor e a OS
                está em concluida/entregue com itens. Cor teal pra destacar
                de "avançar status" (violet/emerald). */}
            {canConvert && (
              <Button
                onClick={() => setConvertConfirmOpen(true)}
                disabled={converting || updatingStatus}
                className="w-full h-14 text-base font-semibold bg-teal-600 hover:bg-teal-700 text-white"
              >
                {converting ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <Receipt className="h-5 w-5 mr-1.5" />
                )}
                Converter em venda
              </Button>
            )}

            {/* Botão de avançar próximo status — se houver */}
            {next ? (
              <Button
                onClick={advanceStatus}
                disabled={updatingStatus || converting}
                variant={canConvert ? "outline" : "default"}
                className={`w-full h-14 text-base font-semibold ${canConvert ? "" : next.tone}`}
              >
                {updatingStatus ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <ChevronRight className="h-5 w-5 mr-1" />
                )}
                {next.label}
              </Button>
            ) : (
              // Status "concluida" + não pode converter (sem permissão de
              // vendedor): mostra card amigável explicando.
              !canConvert && os.status === "concluida" && (
                <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 p-3 text-center space-y-1">
                  <div className="flex items-center justify-center gap-2 text-emerald-300 font-semibold text-sm">
                    <Check className="h-4 w-4" /> Serviço concluído
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    O vendedor faz o faturamento e a entrega ao cliente.
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* DIALOG: confirmar conversão em venda */}
      <AlertDialog open={convertConfirmOpen} onOpenChange={setConvertConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Converter OS em venda?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai criar uma <b>nova venda</b> com todos os itens desta OS, marcar
              a OS como <b>faturada</b> e abrir o editor da venda pra você
              ajustar os pagamentos.
              {itemsTotal > 0 && (
                <span className="block mt-2 text-foreground font-mono font-semibold">
                  Total: {formatBRL(itemsTotal)}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void convertToSale(); }}
              disabled={converting}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              {converting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Receipt className="h-4 w-4 mr-2" />}
              Sim, converter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImageLightbox
        src={viewer?.url || null}
        caption={viewer?.name}
        onClose={() => setViewer(null)}
      />

      {/* ───── STATUS SHEET — todas as transições válidas ───── */}
      <Sheet open={statusSheetOpen} onOpenChange={setStatusSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[85vh]">
          <SheetHeader className="p-4 border-b">
            <SheetTitle>Mudar status da OS</SheetTitle>
          </SheetHeader>
          <div className="p-3 space-y-2 overflow-y-auto">
            <p className="text-xs text-muted-foreground px-1">
              Status atual: <b>{statusMeta?.label}</b>
            </p>
            {allowedTransitions(os.status).map((target) => {
              const meta = OS_STATUS_LABELS[target];
              if (!meta) return null;
              return (
                <button
                  key={target}
                  onClick={() => void changeStatus(target)}
                  disabled={updatingStatus}
                  className="w-full flex items-center gap-3 rounded-xl border border-border/60 p-3 active:bg-muted/30 transition disabled:opacity-50"
                >
                  <Badge className={`${meta.tone} ring-1 text-xs`}>{meta.label}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {STATUS_HINT[target] || ""}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
            {allowedTransitions(os.status).length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Esta OS está em estado final — nenhuma transição disponível.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ───── ITEM PICKER — adicionar peça/serviço ───── */}
      <MobileItemPickerSheet
        open={itemPickerOpen}
        onOpenChange={setItemPickerOpen}
        onPick={addItem}
        companyId={user?.company_id || null}
        showPricing={canSeePricing}
      />

      {/* ───── ITEM EDITOR — editar qty/valor/desc ou remover ───── */}
      <ItemEditorSheet
        open={editingItemIdx !== null}
        onOpenChange={(o) => !o && setEditingItemIdx(null)}
        item={editingItemIdx !== null ? items[editingItemIdx] : null}
        canSeePricing={canSeePricing}
        onSave={(patch) => {
          if (editingItemIdx !== null) void saveItem(editingItemIdx, patch);
          setEditingItemIdx(null);
        }}
        onRemove={() => editingItemIdx !== null && void removeItem(editingItemIdx)}
      />
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════
   STATUS — dica curta por status pra ajudar o técnico a escolher
═════════════════════════════════════════════════════════════════ */
const STATUS_HINT: Partial<Record<OsStatus, string>> = {
  diagnostico:          "Vou analisar",
  aguardando_aprovacao: "Esperando cliente",
  aguardando_peca:      "Esperando peça",
  em_execucao:          "Mão na massa",
  concluida:            "Terminei",
  entregue:             "Cliente pegou",
  cancelada:            "Não vou fazer",
};

/* ITEM PICKER agora vive em @/components/mobile/MobileItemPickerSheet
   (reutilizado por MobileSaleEditor também). */

/* ═════════════════════════════════════════════════════════════════
   ITEM EDITOR — sheet pra editar qty/valor/desc e remover
═════════════════════════════════════════════════════════════════ */
function ItemEditorSheet({
  open,
  onOpenChange,
  item,
  canSeePricing,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: ItemDraft | null;
  canSeePricing: boolean;
  onSave: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [description, setDescription] = useState("");

  // Sincroniza estado interno quando muda o item editado
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
          <SheetTitle className="flex items-center gap-2">
            {item.kind === "peca" ? (
              <><Package className="h-4 w-4 text-amber-400" /> Editar peça</>
            ) : (
              <><Wrench className="h-4 w-4 text-sky-400" /> Editar serviço</>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="p-4 space-y-3">
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Quantidade</Label>
              <Input
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-10 text-right font-mono"
              />
            </div>
            {canSeePricing && (
              <div>
                <Label className="text-xs">Valor unitário</Label>
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-10 text-right font-mono"
                />
              </div>
            )}
          </div>
          {canSeePricing && (
            <div>
              <Label className="text-xs">Desconto (opcional)</Label>
              <Input
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="h-10 text-right font-mono"
              />
            </div>
          )}

          {canSeePricing && (
            <div className="rounded-lg bg-muted/30 p-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Subtotal</span>
              <span className="font-mono font-bold">
                {formatBRL(parseNum(qty) * parseNum(price) - parseNum(discount))}
              </span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="lg"
              onClick={onRemove}
              className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4 mr-1.5" /> Remover
            </Button>
            <Button
              size="lg"
              className="flex-1"
              onClick={() =>
                onSave({
                  description,
                  qty: parseNum(qty),
                  unit_price: parseNum(price),
                  discount: parseNum(discount),
                })
              }
            >
              <Check className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
