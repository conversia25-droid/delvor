/**
 * FollowupTab
 *
 * Aba de Follow-up do InfinityBotSheet. Permite agendar mensagens automáticas
 * datadas para o lead atual. Quando a data chega, um worker (n8n cron) lê a
 * tabela scheduled_messages e envia via Evolution API.
 *
 * Recursos:
 *  - Data/hora picker
 *  - Atalhos: +1h, +3h, amanhã 9h, +1 semana
 *  - Lista de follow-ups pendentes (com botão cancelar)
 *  - Lista de enviados (histórico)
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Calendar, Clock, Send, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  companyId: string | null;
  leadId: string | null;
  remoteJid: string;
  instanceId?: string | null;
  userId: string | null;
  leadDisplay: string;
}

type ScheduledMessage = {
  id: string;
  message: string;
  scheduled_for: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
};

/* Helpers de data */
function toLocalInputValue(d: Date): string {
  // YYYY-MM-DDTHH:MM no fuso local (formato pro <input type="datetime-local">)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeUntil(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "agora";
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `em ${h}h`;
  const d = Math.floor(h / 24);
  return `em ${d}d`;
}

export default function FollowupTab({
  companyId,
  leadId,
  remoteJid,
  instanceId,
  userId,
  leadDisplay,
}: Props) {
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(false);

  /* ───── Carrega follow-ups deste lead ───── */
  async function loadItems() {
    if (!leadId || !companyId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("scheduled_messages")
        .select("id, message, scheduled_for, status, sent_at, error_message, created_at")
        .eq("lead_id", leadId)
        .eq("company_id", companyId)
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      setItems((data || []) as ScheduledMessage[]);
    } catch (e: any) {
      console.error("loadItems error:", e);
      toast({ title: "Erro ao carregar follow-ups", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, [leadId, companyId]);

  /* ───── Atalhos rápidos de data ───── */
  function setQuick(deltaMs: number) {
    const d = new Date(Date.now() + deltaMs);
    setScheduledFor(toLocalInputValue(d));
  }
  function setTomorrow9h() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    setScheduledFor(toLocalInputValue(d));
  }

  /* ───── Salva novo follow-up ───── */
  async function handleSave() {
    if (!message.trim()) {
      toast({ title: "Escreva a mensagem", variant: "destructive" });
      return;
    }
    if (!scheduledFor) {
      toast({ title: "Escolha a data e hora", variant: "destructive" });
      return;
    }
    const when = new Date(scheduledFor);
    if (when.getTime() < Date.now()) {
      toast({ title: "A data tem que ser no futuro", variant: "destructive" });
      return;
    }
    if (!companyId || !leadId || !remoteJid) {
      toast({ title: "Lead inválido", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("scheduled_messages").insert({
        company_id: companyId,
        lead_id: leadId,
        remote_jid: remoteJid,
        instance_id: instanceId || null,
        created_by_user_id: userId,
        message: message.trim(),
        scheduled_for: when.toISOString(),
        status: "pending",
      });
      if (error) throw error;
      toast({
        title: "Follow-up agendado!",
        description: `Será enviado ${timeUntil(when.toISOString())}.`,
      });
      setMessage("");
      setScheduledFor("");
      await loadItems();
    } catch (e: any) {
      toast({ title: "Erro ao agendar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ───── Cancela follow-up pendente ───── */
  async function handleCancel(id: string) {
    if (!confirm("Cancelar este follow-up?")) return;
    try {
      const { error } = await supabase
        .from("scheduled_messages")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Follow-up cancelado." });
      await loadItems();
    } catch (e: any) {
      toast({ title: "Erro ao cancelar", description: e.message, variant: "destructive" });
    }
  }

  const pending = items.filter((i) => i.status === "pending");
  const history = items.filter((i) => i.status !== "pending");

  return (
    <div className="space-y-4 pb-4">
      {/* Form de agendamento */}
      <div className="rounded-xl border bg-card/30 p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="h-4 w-4 text-primary" />
          Agendar follow-up
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Quando enviar
          </label>
          <Input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            min={toLocalInputValue(new Date())}
            className="h-9 text-sm"
          />
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setQuick(60 * 60 * 1000)}
            >
              +1 hora
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setQuick(3 * 60 * 60 * 1000)}
            >
              +3 horas
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={setTomorrow9h}
            >
              Amanhã 9h
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setQuick(7 * 24 * 60 * 60 * 1000)}
            >
              +1 semana
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Mensagem
          </label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Olá ${(leadDisplay || "").split(" ")[0] || ""}, passando pra saber se conseguiu...`}
            rows={4}
            className="text-sm resize-none"
            maxLength={1500}
          />
          <div className="text-[10px] text-muted-foreground text-right">
            {message.length}/1500
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || !message.trim() || !scheduledFor}
          size="sm"
          className="w-full"
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              Agendando...
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5 mr-2" />
              Agendar follow-up
            </>
          )}
        </Button>
      </div>

      {/* Pendentes */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-amber-600" />
          Pendentes
          {pending.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {pending.length}
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground py-2">Carregando...</div>
        ) : pending.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            Nenhum follow-up agendado pra esse lead.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((it) => (
              <div
                key={it.id}
                className="rounded-lg border bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/50 p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="h-3 w-3 text-amber-600" />
                    <span className="font-medium">{fmtDateTime(it.scheduled_for)}</span>
                    <span className="text-muted-foreground">({timeUntil(it.scheduled_for)})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancel(it.id)}
                    className="h-6 w-6 rounded grid place-items-center text-muted-foreground hover:bg-background hover:text-red-600"
                    title="Cancelar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">{it.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Histórico */}
      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">Histórico</div>
          <div className="space-y-2">
            {history.slice(0, 10).map((it) => {
              const isOk = it.status === "sent";
              const isCancelled = it.status === "cancelled";
              return (
                <div
                  key={it.id}
                  className="rounded-lg border bg-background/50 p-3 opacity-80"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      {isOk ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Enviado
                          </span>
                          <span className="text-muted-foreground">
                            {it.sent_at ? fmtDateTime(it.sent_at) : fmtDateTime(it.scheduled_for)}
                          </span>
                        </>
                      ) : isCancelled ? (
                        <>
                          <X className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground font-medium">Cancelado</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3 w-3 text-red-600" />
                          <span className="text-red-700 dark:text-red-400 font-medium">Falhou</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-xs whitespace-pre-wrap break-words text-muted-foreground line-clamp-3">
                    {it.message}
                  </div>
                  {it.error_message && (
                    <div className="text-[10px] text-red-600 mt-1">{it.error_message}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
