import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Smartphone,
  Trash2,
  Star,
  Loader2,
  RefreshCw,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  Send,
  X,
  Edit2,
  Link2,
  ShieldAlert,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  createInstance,
  connectInstance,
  fetchInstanceInfo,
  deleteInstance,
  sendText,
  companyIdToInstanceName,
  type InstanceState,
} from "@/lib/evolution";
import { pickWhatsapp } from "@/lib/whatsapp";

export type WppInstanceStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "waiting_qr"
  | "warning_qr"
  | "closed";

export interface WppInstance {
  id: string;
  company_id: string;
  instance_name: string;       // ID na Evolution (único globalmente)
  label: string | null;        // apelido amigável
  status: WppInstanceStatus;
  connected_phone: string | null;
  connected_name: string | null;
  is_default: boolean;
  last_synced_at: string | null;
  created_at: string;
}

const STATE_TO_STATUS: Record<InstanceState, WppInstanceStatus> = {
  open: "connected",
  connecting: "waiting_qr",
  close: "disconnected",
  unknown: "disconnected",
};

const STATUS_PRIORITY: Record<WppInstanceStatus, number> = {
  connected: 1,
  connecting: 2,
  waiting_qr: 2,
  warning_qr: 2,
  disconnected: 3,
  closed: 3,
  error: 4,
};

const STATUS_LABEL: Record<WppInstanceStatus, string> = {
  connected: "Conectado",
  connecting: "Conectando",
  waiting_qr: "Aguardando QR",
  warning_qr: "QR expirando",
  disconnected: "Desconectado",
  closed: "Fechado",
  error: "Erro",
};

const STATUS_DOT: Record<WppInstanceStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  waiting_qr: "bg-amber-500",
  warning_qr: "bg-amber-500",
  disconnected: "bg-rose-500",
  closed: "bg-rose-500",
  error: "bg-rose-600",
};

const TRACKABLE_STATUSES: WppInstanceStatus[] = ["waiting_qr", "warning_qr", "disconnected", "closed"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function WhatsAppInstancesDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [items, setItems] = useState<WppInstance[]>([]);
  const [loading, setLoading] = useState(false);

  // criar
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // QR / conectar
  const [qrOpen, setQrOpen] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrInstanceId, setQrInstanceId] = useState<string | null>(null);
  const [qrSuccess, setQrSuccess] = useState(false);

  // teste
  const [testOpen, setTestOpen] = useState(false);
  const [testInstance, setTestInstance] = useState<WppInstance | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testText, setTestText] = useState("Olá! Esta é uma mensagem de teste do Delvor.");
  const [testSending, setTestSending] = useState(false);

  // renomear
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const pollRef = useRef<number | null>(null);
  const statusPollRef = useRef<number | null>(null);

  /* ────────────── LOAD ────────────── */
  async function load(silent = false) {
    if (!companyId) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from("wpp_instances" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (!silent) setLoading(false);
    if (error) {
      toast({ title: "Erro ao listar instâncias", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as any[]) ?? []);
  }

  useEffect(() => {
    if (open) load();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (statusPollRef.current) window.clearInterval(statusPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId]);

  /* ────────────── Realtime: reage a mudanças na tabela ────────────── */
  useEffect(() => {
    if (!open || !companyId) return;
    const channel = supabase
      .channel(`wpp_instances_${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wpp_instances",
          filter: `company_id=eq.${companyId}`,
        },
        () => { load(true); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, companyId]);

  /* ────────────── Polling do Evolution pras instâncias não conectadas ────────────── */
  useEffect(() => {
    if (!open) return;
    if (statusPollRef.current) window.clearInterval(statusPollRef.current);

    statusPollRef.current = window.setInterval(async () => {
      const candidates = items.filter((i) => TRACKABLE_STATUSES.includes(i.status));
      if (candidates.length === 0) return;
      for (const inst of candidates) {
        try {
          const info = await fetchInstanceInfo(inst.instance_name);
          const newStatus = STATE_TO_STATUS[info.state];
          if (newStatus !== inst.status) {
            await supabase
              .from("wpp_instances" as any)
              .update({
                status: newStatus,
                connected_phone: info.ownerJid ? info.ownerJid.split("@")[0] : null,
                connected_name: info.profileName || null,
                last_synced_at: new Date().toISOString(),
              } as any)
              .eq("id", inst.id);
          }
        } catch {
          /* silencia falhas individuais */
        }
      }
    }, 5000);
    return () => {
      if (statusPollRef.current) window.clearInterval(statusPollRef.current);
    };
  }, [open, items]);

  /* ────────────── ORDENAÇÃO ────────────── */
  const ordered = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
    });
  }, [items]);

  /* ────────────── CRIAR INSTÂNCIA ────────────── */
  async function handleCreateInstance() {
    if (!companyId) return;
    setCreating(true);
    try {
      // Gera um nome único pro Evolution (UUID curto + prefixo da empresa)
      const suffix = Math.random().toString(36).slice(2, 10);
      const instance_name = `${companyIdToInstanceName(companyId)}_${suffix}`;
      const label = newLabel.trim() || `Instância ${items.length + 1}`;

      // 1) Cria na Evolution
      await createInstance(instance_name);

      // 2) Insere no banco (trigger auto-promove se for a 1ª)
      const { data, error } = await supabase
        .from("wpp_instances" as any)
        .insert({
          company_id: companyId,
          instance_name,
          label,
          status: "waiting_qr",
        } as any)
        .select("*")
        .single();
      if (error) throw error;

      setCreateOpen(false);
      setNewLabel("");
      await load(true);

      // 3) Abre QR direto pra essa instância
      await openQrFor(data as WppInstance);
    } catch (e: any) {
      toast({ title: "Erro ao criar", description: e?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  /* ────────────── QR / CONECTAR ────────────── */
  async function openQrFor(inst: WppInstance) {
    setQrOpen(true);
    setQrInstanceId(inst.id);
    setQrLoading(true);
    setQrBase64(null);
    setQrSuccess(false);

    try {
      const r = await connectInstance(inst.instance_name);
      if (r.state === "open") {
        setQrSuccess(true);
        await syncInstance(inst);
        setTimeout(() => setQrOpen(false), 1500);
      } else if (r.base64) {
        setQrBase64(r.base64);
        startQrPolling(inst);
      } else {
        toast({ title: "Sem QR retornado", description: "Tente novamente.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setQrLoading(false);
    }
  }

  function startQrPolling(inst: WppInstance) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = window.setInterval(async () => {
      ticks++;
      try {
        const info = await fetchInstanceInfo(inst.instance_name);
        if (info.state === "open") {
          await syncInstance(inst, info);
          setQrSuccess(true);
          stopQrPolling();
          setTimeout(() => setQrOpen(false), 1500);
        }
      } catch { /* ignora */ }
      if (ticks > 36) { // ~3 min
        stopQrPolling();
        toast({ title: "QR expirado", description: "Tente novamente.", variant: "destructive" });
      }
    }, 5000);
  }

  function stopQrPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function syncInstance(inst: WppInstance, infoArg?: Awaited<ReturnType<typeof fetchInstanceInfo>>) {
    const info = infoArg || (await fetchInstanceInfo(inst.instance_name));
    await supabase
      .from("wpp_instances" as any)
      .update({
        status: STATE_TO_STATUS[info.state],
        connected_phone: info.ownerJid ? info.ownerJid.split("@")[0] : null,
        connected_name: info.profileName || null,
        last_synced_at: new Date().toISOString(),
      } as any)
      .eq("id", inst.id);
    await load(true);
  }

  /* ────────────── MARCAR COMO PADRÃO ────────────── */
  async function setAsDefault(inst: WppInstance) {
    if (inst.is_default) return;
    const { error } = await supabase
      .from("wpp_instances" as any)
      .update({ is_default: true } as any)
      .eq("id", inst.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Padrão definida", description: inst.label || inst.instance_name });
    await load(true);
  }

  /* ────────────── EXCLUIR ────────────── */
  async function handleDelete(inst: WppInstance) {
    if (!confirm(`Excluir a instância "${inst.label || inst.instance_name}"?\n\nEla também será removida do servidor Evolution.`)) return;

    try {
      // Apaga na Evolution
      await deleteInstance(inst.instance_name);
      // Apaga no banco (trigger promove outra se essa era a default)
      const { error } = await supabase
        .from("wpp_instances" as any)
        .delete()
        .eq("id", inst.id);
      if (error) throw error;
      toast({ title: "Excluída" });
      await load(true);
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e?.message, variant: "destructive" });
    }
  }

  /* ────────────── RENOMEAR ────────────── */
  async function handleRename(inst: WppInstance) {
    const v = renameVal.trim();
    if (!v) { setRenameId(null); return; }
    if (v === (inst.label || "")) { setRenameId(null); return; }
    const { error } = await supabase
      .from("wpp_instances" as any)
      .update({ label: v } as any)
      .eq("id", inst.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setRenameId(null);
    await load(true);
  }

  /* ────────────── REFRESH STATUS ────────────── */
  async function handleRefreshOne(inst: WppInstance) {
    try {
      await syncInstance(inst);
    } catch (e: any) {
      toast({ title: "Falha", description: e?.message, variant: "destructive" });
    }
  }

  /* ────────────── ENVIAR TESTE ────────────── */
  async function handleSendTest() {
    if (!testInstance) return;
    const phone = pickWhatsapp({ phone: testPhone });
    if (!phone) {
      toast({ title: "Telefone inválido", variant: "destructive" });
      return;
    }
    setTestSending(true);
    try {
      await sendText(testInstance.instance_name, phone, testText);
      toast({ title: "Mensagem enviada", description: `Para ${phone}` });
      setTestOpen(false);
    } catch (e: any) {
      toast({ title: "Falha", description: e?.message, variant: "destructive" });
    } finally {
      setTestSending(false);
    }
  }

  /* ────────────── VINCULAR INSTÂNCIA EXISTENTE ──────────────
     Multi-tenant friendly: o admin precisa digitar o nome EXATO da
     instância (não listamos do servidor pra não vazar instâncias de
     outras empresas). Bate na Evolution só pra validar que existe e
     pegar status/número conectado. */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linking, setLinking] = useState(false);

  async function handleLinkExisting() {
    if (!companyId) return;
    const name = linkName.trim();
    if (!name) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }

    // Já existe na tabela?
    if (items.some((i) => i.instance_name === name)) {
      toast({
        title: "Já vinculada",
        description: "Essa instância já está nessa empresa.",
        variant: "destructive",
      });
      return;
    }

    setLinking(true);
    try {
      // Valida no Evolution antes de gravar
      const info = await fetchInstanceInfo(name);
      if (info.state === "unknown") {
        toast({
          title: "Instância não encontrada",
          description: `O servidor Evolution não tem nenhuma instância chamada "${name}". Confira o nome exato.`,
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase.from("wpp_instances" as any).insert({
        company_id: companyId,
        instance_name: name,
        label: linkLabel.trim() || info.profileName || name,
        status: STATE_TO_STATUS[info.state],
        connected_phone: info.ownerJid ? info.ownerJid.split("@")[0] : null,
        connected_name: info.profileName || null,
        last_synced_at: new Date().toISOString(),
      } as any);
      if (error) throw error;

      setLinkOpen(false);
      setLinkName("");
      setLinkLabel("");
      toast({ title: "Vinculada", description: `${name} (${info.state})` });
      await load(true);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  }

  /* ────────────── RENDER ────────────── */
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" /> Instâncias de WhatsApp
            </DialogTitle>
            <DialogDescription>
              Gerencie múltiplas conexões de WhatsApp. A instância <strong>Padrão</strong> é usada para envios automáticos.
            </DialogDescription>
          </DialogHeader>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Button onClick={() => setCreateOpen(true)} disabled={creating}>
              <Plus className="h-4 w-4 mr-2" /> Nova instância
            </Button>
            <Button variant="outline" onClick={() => load()} disabled={loading} title="Recarregar lista">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Badge variant="secondary" className="ml-auto text-xs">{items.length} instância{items.length === 1 ? "" : "s"}</Badge>
          </div>

          {/* Lista */}
          <ScrollArea className="max-h-[55vh] pr-2">
            <div className="space-y-2">
              {loading && items.length === 0 && (
                <div className="border rounded-lg p-8 flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Carregando...
                </div>
              )}

              {!loading && items.length === 0 && (
                <div className="border rounded-lg p-8 flex flex-col items-center gap-3 text-center">
                  <Smartphone className="h-10 w-10 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Nenhuma instância ainda</p>
                    <p className="text-sm text-muted-foreground">Crie a primeira ou importe as do servidor Evolution.</p>
                  </div>
                </div>
              )}

              {ordered.map((inst) => {
                const trackable = TRACKABLE_STATUSES.includes(inst.status);
                const isRenaming = renameId === inst.id;
                return (
                  <div
                    key={inst.id}
                    className="rounded-lg border p-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between bg-card/50"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`rounded-full h-10 w-10 flex items-center justify-center shrink-0 mt-0.5
                        ${inst.status === "connected" ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" :
                          trackable ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30" :
                          "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30"}`}>
                        {inst.status === "connected" ? <CheckCircle2 className="h-5 w-5" />
                          : trackable ? <QrCode className="h-5 w-5" />
                          : <AlertTriangle className="h-5 w-5" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {isRenaming ? (
                            <Input
                              autoFocus
                              value={renameVal}
                              onChange={(e) => setRenameVal(e.target.value)}
                              onBlur={() => handleRename(inst)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRename(inst);
                                if (e.key === "Escape") setRenameId(null);
                              }}
                              className="h-7 w-[200px] text-sm"
                            />
                          ) : (
                            <button
                              type="button"
                              className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                              onClick={() => { setRenameId(inst.id); setRenameVal(inst.label || ""); }}
                              title="Clique para renomear"
                            >
                              {inst.label || "(sem apelido)"}
                              <Edit2 className="h-3 w-3 opacity-50" />
                            </button>
                          )}
                          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[inst.status]}`} />
                          <Badge variant="outline" className="text-[10px] h-5">{STATUS_LABEL[inst.status]}</Badge>
                          {inst.is_default && (
                            <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                              <Star className="h-2.5 w-2.5 fill-current" /> Padrão
                            </Badge>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground font-mono truncate" title={inst.instance_name}>
                          {inst.instance_name}
                        </div>
                        {inst.connected_phone && (
                          <div className="text-xs text-emerald-300 font-mono mt-0.5">
                            +{inst.connected_phone}
                            {inst.connected_name && <span className="text-muted-foreground"> · {inst.connected_name}</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 flex-wrap">
                      {trackable && (
                        <Button size="sm" variant="outline" onClick={() => openQrFor(inst)}>
                          <QrCode className="h-3.5 w-3.5 mr-1" /> Conectar
                        </Button>
                      )}
                      {inst.status === "connected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setTestInstance(inst); setTestOpen(true); }}
                          title="Enviar mensagem de teste"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleRefreshOne(inst)}
                        title="Atualizar status"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      {!inst.is_default && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setAsDefault(inst)}
                          title="Definir como padrão"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(inst)}
                        title="Excluir instância"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Dialog: criar nova instância */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova instância</DialogTitle>
            <DialogDescription>
              Dê um apelido para identificar essa conexão (ex: "Suporte", "Comercial").
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inst-label" className="text-xs">Apelido</Label>
              <Input
                id="inst-label"
                placeholder="Ex: Suporte Técnico"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateInstance(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateInstance} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar e abrir QR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: vincular instância existente */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" /> Vincular instância existente
            </DialogTitle>
            <DialogDescription>
              Use isto se você já criou a instância no painel do Evolution.
              Digite o nome <strong>exato</strong> como aparece lá.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 mb-2">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                <strong>Atenção em multi-empresa:</strong> só vincule instâncias que pertencem
                à sua empresa. A API do Evolution é compartilhada entre todos os clientes do
                servidor — vincular instância de outro cliente é uso indevido.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-name" className="text-xs">Nome da instância (Evolution)</Label>
              <Input
                id="link-name"
                placeholder="ex: atendimento-loja-x"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-label" className="text-xs">Apelido <span className="text-muted-foreground">(opcional)</span></Label>
              <Input
                id="link-label"
                placeholder="ex: Suporte"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button onClick={handleLinkExisting} disabled={linking || !linkName.trim()}>
              {linking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: QR code */}
      <Dialog open={qrOpen} onOpenChange={(o) => { setQrOpen(o); if (!o) stopQrPolling(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" /> Escaneie o QR Code
            </DialogTitle>
            <DialogDescription>
              No celular: WhatsApp → ⋮ → <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3 py-2">
            {qrLoading && (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm text-muted-foreground animate-pulse">Gerando QR...</p>
              </div>
            )}
            {!qrLoading && qrSuccess && (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="rounded-full bg-emerald-100/10 ring-1 ring-emerald-500/30 p-3">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                </div>
                <p className="font-semibold text-emerald-300">Conectado!</p>
                <p className="text-sm text-muted-foreground">Fechando...</p>
              </div>
            )}
            {!qrLoading && !qrSuccess && qrBase64 && (
              <>
                <img
                  src={qrBase64}
                  alt="QR Code"
                  className="rounded-lg border-4 border-white bg-white"
                  style={{ width: 280, height: 280 }}
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Aguardando leitura...
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setQrOpen(false); stopQrPolling(); }}>
              <X className="h-4 w-4 mr-1" /> Fechar
            </Button>
            {qrInstanceId && !qrSuccess && (
              <Button
                onClick={async () => {
                  const inst = items.find((i) => i.id === qrInstanceId);
                  if (inst) await openQrFor(inst);
                }}
                disabled={qrLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${qrLoading ? "animate-spin" : ""}`} /> Novo QR
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: enviar teste */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" /> Enviar teste — {testInstance?.label}
            </DialogTitle>
            <DialogDescription>
              Envia uma mensagem real pela instância selecionada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="test-phone" className="text-xs">Telefone destinatário</Label>
              <Input
                id="test-phone"
                placeholder="(11) 99999-9999"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-text" className="text-xs">Mensagem</Label>
              <Input
                id="test-text"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Cancelar</Button>
            <Button onClick={handleSendTest} disabled={testSending}>
              {testSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
