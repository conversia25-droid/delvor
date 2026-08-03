import { useEffect, useState } from "react";
import {
  MessageSquare,
  AlertTriangle,
  Info,
  Smartphone,
  CheckCircle2,
  Loader2,
  Settings as SettingsIcon,
  Star,
  ExternalLink,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { isEvolutionConfigured, getEvolutionConfig } from "@/lib/evolution";
import WhatsAppInstancesDialog, {
  type WppInstance,
} from "@/components/whatsapp/WhatsAppInstancesDialog";

export default function WhatsAppSettings() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const configured = isEvolutionConfigured();
  const cfg = getEvolutionConfig();

  const [instances, setInstances] = useState<WppInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("wpp_instances" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (!error) setInstances(((data as any[]) ?? []) as WppInstance[]);
  }
  useEffect(() => { load(); }, [companyId]);

  // Realtime: recarrega quando a lista muda
  useEffect(() => {
    if (!companyId) return;
    const ch = supabase
      .channel(`wpp_instances_summary_${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wpp_instances", filter: `company_id=eq.${companyId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  /* ─────── Estado: env não configurada ─────── */
  if (!configured) {
    return (
      <div className="space-y-4 max-w-2xl">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> WhatsApp
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte uma ou mais instâncias da Evolution API para envio automático.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="font-medium">Evolution API não configurada.</p>
              <p>Defina no env do EasyPanel e redeploy:</p>
              <pre className="bg-black/40 rounded p-2 text-xs leading-relaxed mt-1">
{`VITE_EVOLUTION_URL=https://sua-evolution.exemplo.com
VITE_EVOLUTION_API_KEY=sua-master-api-key`}
              </pre>
              <p className="text-xs">
                Sem isso, os botões "Enviar WhatsApp" continuam funcionando via <code className="bg-black/30 px-1 rounded">wa.me</code>.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const defaultInst = instances.find((i) => i.is_default);
  const connectedCount = instances.filter((i) => i.status === "connected").length;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> WhatsApp
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Múltiplas conexões: Suporte, Comercial, Cobrança... cada uma com seu QR.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <SettingsIcon className="h-4 w-4 mr-2" /> Gerenciar instâncias
        </Button>
      </div>

      {/* Resumo geral */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold mt-1">{instances.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Conectadas
          </div>
          <div className="text-2xl font-bold mt-1 text-emerald-400">{connectedCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-400" /> Pendentes
          </div>
          <div className="text-2xl font-bold mt-1 text-amber-300">{instances.length - connectedCount}</div>
        </div>
      </div>

      {/* Lista compacta */}
      <div className="rounded-lg border bg-card divide-y">
        {loading && (
          <div className="p-6 text-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
          </div>
        )}
        {!loading && instances.length === 0 && (
          <div className="p-6 text-center">
            <Smartphone className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Nenhuma instância cadastrada</p>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Clique em "Gerenciar instâncias" para criar a primeira.</p>
            <Button size="sm" onClick={() => setOpen(true)}>Criar agora</Button>
          </div>
        )}
        {!loading && instances.map((inst) => (
          <div key={inst.id} className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-2 w-2 rounded-full shrink-0
                ${inst.status === "connected" ? "bg-emerald-500"
                  : inst.status === "error" ? "bg-rose-600"
                  : ["disconnected", "closed"].includes(inst.status) ? "bg-rose-500"
                  : "bg-amber-500"}`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{inst.label || inst.instance_name}</span>
                  {inst.is_default && (
                    <Badge variant="secondary" className="text-[10px] h-4 gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-current" /> Padrão
                    </Badge>
                  )}
                </div>
                {inst.connected_phone && (
                  <div className="text-xs text-muted-foreground font-mono">+{inst.connected_phone}</div>
                )}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {inst.status === "connected" ? "Conectado"
                : inst.status === "waiting_qr" ? "Aguardando QR"
                : inst.status === "warning_qr" ? "QR expirando"
                : inst.status === "connecting" ? "Conectando"
                : inst.status === "error" ? "Erro"
                : "Desconectado"}
            </Badge>
          </div>
        ))}
      </div>

      {/* Padrão atual */}
      {defaultInst && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-blue-200/80">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p>
                <strong>Instância padrão:</strong> {defaultInst.label || defaultInst.instance_name}
                {defaultInst.status === "connected" ? " (ativa)" : ` (status: ${defaultInst.status})`}
              </p>
              <p>
                Botões "Enviar WhatsApp" do sistema usam esta instância por padrão.
                Se ela cair, o sistema volta pro <code className="bg-black/30 px-1 rounded">wa.me</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info técnica */}
      <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-3 w-3" />
          Servidor:{" "}
          <a href={cfg?.url} target="_blank" rel="noreferrer" className="font-mono underline inline-flex items-center gap-1">
            {cfg?.url} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Dialog principal */}
      <WhatsAppInstancesDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
