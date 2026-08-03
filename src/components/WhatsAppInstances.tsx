import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  Smartphone,
  Trash2,
  Star,
  Loader2,
  RefreshCcw,
  QrCode,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface WppInstance {
  id: string;
  instance_name: string;
  instance_key: string;
  status: string;
  phone_number: number | null;
  created_at: string;
  company_id: string;
  is_default: boolean;
  default_funnel_id: string | null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FunnelOption = {
  id: string;
  name: string;
};

const TRACKABLE_STATUSES = ["WAITING_QR", "WARNING_QR", "DISCONNECTED", "CLOSED"];

const STATUS_PRIORITY: Record<string, number> = {
  CONNECTED: 1,
  WAITING_QR: 2,
  WARNING_QR: 2,
  DISCONNECTED: 3,
  CLOSED: 3,
  ERROR: 4,
};

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: "Conectado",
  WAITING_QR: "Aguardando QR",
  WARNING_QR: "QR expirando",
  DISCONNECTED: "Desconectado",
  CLOSED: "Fechado",
  ERROR: "Erro",
};

export function WhatsAppInstances({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [instances, setInstances] = useState<WppInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const [funnels, setFunnels] = useState<FunnelOption[]>([]);
  const [loadingFunnels, setLoadingFunnels] = useState(false);

  const [connectOpen, setConnectOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectedSuccess, setConnectedSuccess] = useState(false);
  const [watchingInstanceId, setWatchingInstanceId] = useState<string | null>(null);

  // Limite de instâncias do plano
  const [maxInstances, setMaxInstances] = useState<number | null>(null);
  const [selectedToKeep, setSelectedToKeep] = useState<Set<string>>(new Set());
  const [removingExcess, setRemovingExcess] = useState(false);

  const resetConnectState = () => {
    setQrLoading(false);
    setQrCode(null);
    setConnectedSuccess(false);
    setWatchingInstanceId(null);
  };

  useEffect(() => {
    if (!open || !companyId) return;
    void Promise.all([fetchInstances(), fetchFunnels(), fetchMaxInstances()]);
  }, [open, companyId]);

  const fetchMaxInstances = async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from("v_company_billing_summary" as any)
      .select("max_instances")
      .eq("company_id", companyId)
      .maybeSingle();
    setMaxInstances((data as any)?.max_instances ?? null);
  };

  useEffect(() => {
    if (!companyId || !open) return;

    const channel = supabase
      .channel(`instancias_company_${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instancias",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void fetchInstances(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, open]);

  const fetchInstances = async (showLoader = true) => {
    if (!companyId) return;

    try {
      if (showLoader) setLoadingInstances(true);

      const { data, error } = await supabase
        .from("instancias")
        .select("*,default_funnel_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setInstances(data || []);
    } catch (error) {
      console.error("Erro ao carregar instâncias:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar instâncias.",
        variant: "destructive",
      });
    } finally {
      if (showLoader) setLoadingInstances(false);
    }
  };

  const fetchFunnels = async () => {
    if (!companyId) return;

    try {
      setLoadingFunnels(true);

      const { data, error } = await supabase
        .from("funnels")
        .select("id,name")
        .eq("company_id", companyId)
        .order("name", { ascending: true });

      if (error) throw error;
      setFunnels((data as FunnelOption[]) || []);
    } catch (error) {
      console.warn("Não foi possível carregar funis:", error);
      setFunnels([]);
    } finally {
      setLoadingFunnels(false);
    }
  };

  const onConnected = () => {
    if (connectedSuccess) return;

    setConnectedSuccess(true);

    toast({
      title: "Conectado",
      description: "Instância conectada com sucesso.",
    });

    void fetchInstances(false);

    setTimeout(() => {
      setConnectOpen(false);
      resetConnectState();
    }, 2000);
  };

  useEffect(() => {
    if (!watchingInstanceId) return;

    const channel = supabase
      .channel(`watch_instance_${watchingInstanceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "instancias",
          filter: `id=eq.${watchingInstanceId}`,
        },
        (payload) => {
          const updated = payload.new as WppInstance;
          if (updated.status === "CONNECTED") {
            onConnected();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [watchingInstanceId, connectedSuccess]);

  useEffect(() => {
    if (!watchingInstanceId) return;

    const interval = setInterval(async () => {
      const { data, error } = await supabase
        .from("instancias")
        .select("status")
        .eq("id", watchingInstanceId)
        .single();

      if (!error && data?.status === "CONNECTED") {
        onConnected();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [watchingInstanceId, connectedSuccess]);

  const orderedInstances = useMemo(() => {
    return [...instances].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
    });
  }, [instances]);

  // Detecta excesso de instâncias
  const hasExcess = maxInstances !== null && instances.length > maxInstances;
  const excessCount = hasExcess ? instances.length - maxInstances : 0;

  // Reset seleção quando as instâncias mudam
  useEffect(() => {
    if (hasExcess) {
      setSelectedToKeep(new Set());
    }
  }, [hasExcess]);

  const toggleKeepInstance = (id: string) => {
    setSelectedToKeep(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size < maxInstances!) {
          next.add(id);
        }
      }
      return next;
    });
  };

  const confirmInstanceSelection = async () => {
    if (!companyId || !maxInstances) return;
    const toRemove = instances.filter(inst => !selectedToKeep.has(inst.id));

    const confirmMsg = `Você vai manter ${selectedToKeep.size} instância(s) e remover ${toRemove.length}:\n\n${toRemove.map(i => `❌ ${i.instance_name} (${i.phone_number ? `+${i.phone_number}` : "sem número"})`).join("\n")}\n\nConfirmar?`;
    if (!confirm(confirmMsg)) return;

    setRemovingExcess(true);
    try {
      for (const inst of toRemove) {
        // Remove do Evolution API
        try {
          await fetch("https://conversia-n8n.njuzo4.easypanel.host/webhook/delete-instance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instance_key: inst.instance_key, company_id: companyId }),
          });
        } catch (e) { console.warn("Webhook delete falhou para", inst.instance_key, e); }

        // Remove do banco
        await supabase.from("instancias").delete().eq("id", inst.id).eq("company_id", companyId);
      }

      // Se nenhuma das mantidas é default, define a primeira como default
      const keptInstances = instances.filter(i => selectedToKeep.has(i.id));
      const hasDefault = keptInstances.some(i => i.is_default);
      if (!hasDefault && keptInstances.length > 0) {
        await supabase.from("instancias").update({ is_default: false }).eq("company_id", companyId);
        await supabase.from("instancias").update({ is_default: true }).eq("id", keptInstances[0].id);
      }

      toast({ title: "Instâncias ajustadas", description: `${toRemove.length} instância(s) removida(s) com sucesso.` });
      await fetchInstances(false);
    } catch (err) {
      console.error("Erro ao remover instâncias excedentes:", err);
      toast({ title: "Erro", description: "Não foi possível remover todas as instâncias.", variant: "destructive" });
    } finally {
      setRemovingExcess(false);
    }
  };

  const openConnectionWatcher = async (instanceId: string) => {
    setConnectOpen(true);
    setQrLoading(true);
    setQrCode(null);
    setConnectedSuccess(false);
    setWatchingInstanceId(instanceId);

    setTimeout(() => {
      setQrLoading(false);
    }, 1200);
  };

  const updateDefaultFunnel = async (instanceId: string, funnelId: string | null) => {
    if (!companyId) return;

    const previous = instances;

    setInstances((prev) =>
      prev.map((instance) =>
        instance.id === instanceId ? { ...instance, default_funnel_id: funnelId } : instance
      )
    );

    const { error } = await supabase
      .from("instancias")
      .update({ default_funnel_id: funnelId })
      .eq("id", instanceId)
      .eq("company_id", companyId);

    if (error) {
      setInstances(previous);
      toast({
        title: "Erro",
        description: "Não foi possível salvar o funil padrão.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Salvo",
      description: funnelId ? "Funil padrão atualizado." : "Funil padrão removido.",
    });
  };

  const createInstance = async () => {
    if (!companyId) return;

    try {
      setCreatingInstance(true);
      setConnectOpen(true);
      setQrLoading(true);
      setQrCode(null);
      setConnectedSuccess(false);
      setWatchingInstanceId(null);

      const res = await fetch(
        "https://conversia-n8n.njuzo4.easypanel.host/webhook/create-instance",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: companyId }),
        }
      );

      if (!res.ok) {
        throw new Error(`Erro HTTP ao criar instância: ${res.status}`);
      }

      const data = await res.json();

      if (data?.qr_code) {
        setQrCode(data.qr_code);
      }

      setTimeout(async () => {
        try {
          const { data: inst, error } = await supabase
            .from("instancias")
            .select("id")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (error) {
            console.warn("Não foi possível identificar a instância criada:", error);
          }

          if (inst) {
            setWatchingInstanceId(inst.id);
          }
        } finally {
          setQrLoading(false);
          setCreatingInstance(false);
          void fetchInstances(false);
        }
      }, 1200);
    } catch (error) {
      console.error(error);
      toast({
        title: "Erro",
        description: "Erro ao criar instância.",
        variant: "destructive",
      });
      setConnectOpen(false);
      resetConnectState();
      setCreatingInstance(false);
    }
  };

  const setAsDefaultInstance = async (id: string) => {
    if (!companyId) return;

    const target = instances.find((instance) => instance.id === id);
    if (!target) return;

    try {
      setSettingDefaultId(id);

      const { error: clearError } = await supabase
        .from("instancias")
        .update({ is_default: false })
        .eq("company_id", companyId);

      if (clearError) throw clearError;

      const { error: setError } = await supabase
        .from("instancias")
        .update({ is_default: true })
        .eq("id", id)
        .eq("company_id", companyId);

      if (setError) throw setError;

      setInstances((prev) =>
        prev.map((instance) => ({
          ...instance,
          is_default: instance.id === id,
        }))
      );

      toast({
        title: "Instância padrão",
        description: `${target.instance_name} definida como padrão.`,
      });
    } catch (error) {
      console.error("Erro ao definir instância padrão:", error);
      toast({
        title: "Erro",
        description: "Não foi possível definir a instância padrão.",
        variant: "destructive",
      });
      void fetchInstances(false);
    } finally {
      setSettingDefaultId(null);
    }
  };

  const deleteInstance = async (id: string, instanceKey: string, isDefault: boolean) => {
    if (isDefault) {
      toast({
        title: "Ação bloqueada",
        description: "Remova o status de padrão antes de excluir esta instância.",
        variant: "destructive",
      });
      return;
    }

    if (!confirm("Deseja realmente excluir esta instância?")) return;

    try {
      setDeletingId(id);

      const webhookRes = await fetch(
        "https://conversia-n8n.njuzo4.easypanel.host/webhook/delete-instance",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instance_key: instanceKey,
            company_id: companyId,
          }),
        }
      );

      if (!webhookRes.ok) {
        throw new Error(`Webhook delete-instance respondeu ${webhookRes.status}`);
      }

      const { error } = await supabase
        .from("instancias")
        .delete()
        .eq("id", id)
        .eq("company_id", companyId);

      if (error) throw error;

      setInstances((prev) => prev.filter((instance) => instance.id !== id));

      toast({
        title: "Excluída",
        description: "Instância removida com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao excluir instância:", error);
      toast({
        title: "Erro",
        description: "Não foi possível excluir a instância.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const renderStatusDot = (status: string) => {
    const map: Record<string, string> = {
      CONNECTED: "bg-green-500",
      WAITING_QR: "bg-yellow-500",
      WARNING_QR: "bg-yellow-500",
      DISCONNECTED: "bg-red-500",
      CLOSED: "bg-red-500",
      ERROR: "bg-red-600",
    };

    return (
      <span
        title={STATUS_LABEL[status] ?? status}
        className={`h-3 w-3 rounded-full ${map[status] ?? "bg-gray-400"}`}
      />
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] lg:max-w-[1100px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>WhatsApp Lite</DialogTitle>
            <DialogDescription>Gerencie suas instâncias de WhatsApp.</DialogDescription>
          </DialogHeader>

          {/* OVERLAY DE SELEÇÃO FORÇADA */}
          {hasExcess && (
            <div className="border-2 border-amber-500 rounded-xl bg-amber-50 dark:bg-amber-950/30 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                    Seu plano permite apenas {maxInstances} instância{maxInstances! > 1 ? "s" : ""}
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    Você tem {instances.length} instâncias conectadas. Selecione {maxInstances} para manter e as demais serão desconectadas.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {orderedInstances.map((inst) => {
                  const isSelected = selectedToKeep.has(inst.id);
                  const canSelect = isSelected || selectedToKeep.size < maxInstances!;
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      disabled={!canSelect && !isSelected}
                      onClick={() => toggleKeepInstance(inst.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                        isSelected
                          ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                          : canSelect
                            ? "border-muted hover:border-primary/50 bg-background"
                            : "border-muted bg-muted/30 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? "border-green-500 bg-green-500 text-white" : "border-muted-foreground/30"
                      }`}>
                        {isSelected && <CheckCircle2 className="h-4 w-4" />}
                      </div>
                      <Smartphone className="h-4 w-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">
                          {inst.phone_number ? `+${inst.phone_number}` : inst.instance_name}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          {renderStatusDot(inst.status)}
                          <span className="text-xs text-muted-foreground">{STATUS_LABEL[inst.status] ?? inst.status}</span>
                          {inst.is_default && <Badge variant="secondary" className="text-[10px] h-4">Padrão</Badge>}
                        </div>
                      </div>
                      <span className={`text-xs font-medium ${isSelected ? "text-green-600" : "text-muted-foreground"}`}>
                        {isSelected ? "Manter" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted-foreground">
                  {selectedToKeep.size} de {maxInstances} selecionada{maxInstances! > 1 ? "s" : ""}
                </span>
                <Button
                  onClick={confirmInstanceSelection}
                  disabled={selectedToKeep.size !== maxInstances || removingExcess}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {removingExcess ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Removendo...</>
                  ) : (
                    `Confirmar seleção`
                  )}
                </Button>
              </div>
            </div>
          )}

          {!hasExcess && (
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchInstances()}
              disabled={loadingInstances || creatingInstance}
            >
              <RefreshCcw className={`h-4 w-4 mr-2 ${loadingInstances ? "animate-spin" : ""}`} />
              Atualizar
            </Button>

            <Button
              size="sm"
              onClick={createInstance}
              disabled={creatingInstance || qrLoading || (maxInstances !== null && instances.length >= maxInstances)}
              title={maxInstances !== null && instances.length >= maxInstances ? `Seu plano permite no máximo ${maxInstances} instância(s)` : ""}
            >
              {creatingInstance || qrLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Instância
                </>
              )}
            </Button>
          </div>
          )}

          {!hasExcess && (
          <ScrollArea className="h-[60vh] max-h-[520px] pr-2 mt-4">
            <div className="space-y-3">
              {loadingInstances && orderedInstances.length === 0 && (
                <div className="border rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="text-sm text-muted-foreground">Carregando instâncias...</p>
                </div>
              )}

              {!loadingInstances && orderedInstances.length === 0 && (
                <div className="border rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center">
                  <Smartphone className="h-10 w-10 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Nenhuma instância cadastrada</p>
                    <p className="text-sm text-muted-foreground">
                      Clique em <strong>Nova Instância</strong> para criar a primeira conexão.
                    </p>
                  </div>
                </div>
              )}

              {orderedInstances.map((inst) => {
                const canTrackConnection = TRACKABLE_STATUSES.includes(inst.status);
                const isDeleting = deletingId === inst.id;
                const isSettingDefault = settingDefaultId === inst.id;

                return (
                  <div
                    key={inst.id}
                    className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between p-4 border rounded-xl"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Smartphone className="h-5 w-5 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium break-all">
                            {inst.phone_number ? `+${inst.phone_number}` : inst.instance_name}
                          </span>
                          {renderStatusDot(inst.status)}
                          <Badge variant="outline" className="text-xs">
                            {STATUS_LABEL[inst.status] ?? inst.status}
                          </Badge>
                          {inst.is_default && (
                            <Badge variant="secondary" className="text-xs">
                              Padrão
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground mt-1 break-all">
                          Chave: {inst.instance_key}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Criado em {new Date(inst.created_at).toLocaleDateString("pt-BR")}
                        </p>

                        <div className="mt-3">
                          <p className="text-xs text-muted-foreground mb-1">
                            Funil padrão desta instância
                          </p>

                          <Select
                            value={inst.default_funnel_id ?? "__none__"}
                            onValueChange={(value) =>
                              updateDefaultFunnel(inst.id, value === "__none__" ? null : value)
                            }
                            disabled={loadingFunnels}
                          >
                            <SelectTrigger className="h-9 w-[240px] max-w-full">
                              <SelectValue placeholder="Selecionar funil" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                Nenhum (usar padrão do sistema)
                              </SelectItem>

                              {funnels.map((funnel) => (
                                <SelectItem key={funnel.id} value={funnel.id}>
                                  {funnel.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {canTrackConnection && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openConnectionWatcher(inst.id)}
                        >
                          <QrCode className="h-4 w-4 mr-2" />
                          Acompanhar conexão
                        </Button>
                      )}

                      {!inst.is_default && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setAsDefaultInstance(inst.id)}
                          disabled={!!settingDefaultId}
                        >
                          {isSettingDefault ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Star className="h-4 w-4" />
                          )}
                        </Button>
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => deleteInstance(inst.id, inst.instance_key, inst.is_default)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={connectOpen}
        onOpenChange={(value) => {
          setConnectOpen(value);
          if (!value) resetConnectState();
        }}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Conectar instância</DialogTitle>
            <DialogDescription>
              Aguarde a criação e leia o QR Code para conectar no WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center gap-4 py-6">
            {qrLoading && (
              <>
                <div className="h-12 w-12 rounded-full border-4 border-muted border-t-primary animate-spin" />
                <p className="text-sm text-muted-foreground animate-pulse">
                  Preparando conexão...
                </p>
              </>
            )}

            {!qrLoading && qrCode && !connectedSuccess && (
              <>
                <img src={qrCode} className="w-64 rounded-lg border shadow-sm" alt="QR Code" />
                <p className="text-sm text-muted-foreground animate-pulse text-center">
                  Aguardando leitura do QR Code...
                </p>
              </>
            )}

            {!qrLoading && !qrCode && !connectedSuccess && watchingInstanceId && (
              <p className="text-sm text-muted-foreground text-center">
                Acompanhando o status da instância. Assim que ela conectar, esta janela será fechada automaticamente.
              </p>
            )}

            {connectedSuccess && (
              <p className="text-sm font-medium text-green-600">
                ✅ Instância conectada com sucesso!
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
