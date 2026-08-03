import { useEffect, useState } from "react";
import { History, MessageSquarePlus, Eye, EyeOff, Send } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import type { ServiceOrderHistoryEntry } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

interface OsHistoryProps {
  serviceOrderId: string | null;
  /** Se passar, mostra botão "Notificar cliente" no comentário público. */
  onNotifyCustomer?: (message: string) => void;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function OsHistory({ serviceOrderId, onNotifyCustomer }: OsHistoryProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<ServiceOrderHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [posting, setPosting] = useState(false);

  async function load() {
    if (!serviceOrderId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("service_order_history" as any)
      .select("*")
      .eq("service_order_id", serviceOrderId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao listar timeline", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as any[]) ?? []);
  }

  useEffect(() => { if (serviceOrderId) load(); }, [serviceOrderId]);

  async function postComment() {
    if (!serviceOrderId || !user) return;
    if (!comment.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("service_order_history" as any).insert({
      service_order_id: serviceOrderId,
      user_id: user.id,
      message: comment.trim(),
      is_public: isPublic,
    });
    setPosting(false);
    if (error) {
      toast({ title: "Erro ao postar", description: error.message, variant: "destructive" });
      return;
    }
    if (isPublic && onNotifyCustomer) {
      onNotifyCustomer(comment.trim());
    }
    setComment("");
    setIsPublic(false);
    load();
  }

  if (!serviceOrderId) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Salve a OS primeiro para registrar comentários.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Adicionar comentário */}
      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <MessageSquarePlus className="h-4 w-4" /> Adicionar comentário
        </div>
        <Textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anotação sobre o andamento, pedido de aprovação, observação técnica..."
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant={isPublic ? "default" : "outline"}
            size="sm"
            onClick={() => setIsPublic((v) => !v)}
            className={isPublic ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            title={isPublic ? "Visível ao cliente (pode ser enviado por WhatsApp)" : "Apenas interno"}
          >
            {isPublic ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
            {isPublic ? "Visível ao cliente" : "Interno"}
          </Button>
          <Button onClick={postComment} disabled={posting || !comment.trim()} size="sm">
            <Send className="h-3 w-3 mr-1" /> Postar
          </Button>
        </div>
      </div>

      {/* Timeline */}
      {loading && <div className="text-xs text-muted-foreground">Carregando...</div>}
      {!loading && items.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">Sem registros.</div>
      )}

      <ol className="relative border-l-2 border-border space-y-3 ml-2">
        {items.map((h) => {
          const isStatusChange = !!h.to_status;
          const fromMeta = h.from_status ? OS_STATUS_LABELS[h.from_status] : null;
          const toMeta = h.to_status ? OS_STATUS_LABELS[h.to_status] : null;
          return (
            <li key={h.id} className="ml-4 relative">
              <span className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full ring-2 ring-background ${
                isStatusChange ? "bg-blue-500" : h.is_public ? "bg-emerald-500" : "bg-muted-foreground"
              }`} />
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <History className="h-3 w-3" />
                {formatDateTime(h.created_at)}
                {h.is_public && !isStatusChange && (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                    Visível ao cliente
                  </Badge>
                )}
              </div>
              <div className="mt-1 text-sm">
                {isStatusChange && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {fromMeta && <Badge className={`${fromMeta.tone} ring-1`}>{fromMeta.label}</Badge>}
                    <span className="text-muted-foreground">→</span>
                    {toMeta && <Badge className={`${toMeta.tone} ring-1`}>{toMeta.label}</Badge>}
                  </div>
                )}
                {h.message && (
                  <p className={isStatusChange ? "text-muted-foreground text-xs mt-1" : ""}>{h.message}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
