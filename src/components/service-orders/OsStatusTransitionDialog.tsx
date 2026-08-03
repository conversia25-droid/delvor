import { useEffect, useState } from "react";
import { MessageSquare, ArrowRight, Send } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

import type { Customer, OsStatus, ServiceOrder } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";
import { openWhatsApp, pickWhatsapp } from "@/lib/whatsapp";

interface OsStatusTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromStatus: OsStatus;
  toStatus: OsStatus;
  serviceOrder: ServiceOrder | null;
  customer: Customer | null;
  /** Chamado quando o usuário confirma. Recebe a mensagem digitada (opcional, mesmo se notify=false). */
  onConfirm: (opts: { notifyCustomer: boolean; message: string }) => Promise<void> | void;
  busy?: boolean;
}

/**
 * Dialog que aparece sempre que o user vai mudar status de uma OS.
 * Sugere mensagem WhatsApp pré-pronta e oferece o botão "Abrir WhatsApp".
 * Se ele confirmar com a opção marcada, abrimos o wa.me automaticamente.
 */
export default function OsStatusTransitionDialog({
  open,
  onOpenChange,
  fromStatus,
  toStatus,
  serviceOrder,
  customer,
  onConfirm,
  busy,
}: OsStatusTransitionDialogProps) {
  const fromMeta = OS_STATUS_LABELS[fromStatus];
  const toMeta = OS_STATUS_LABELS[toStatus];

  // Sugestões de mensagem por transição (cliente B2B, tom direto e respeitoso)
  function defaultMessage(): string {
    const num = serviceOrder ? `#${String(serviceOrder.number).padStart(6, "0")}` : "";
    // Primeiro nome do cliente (ex: "Eluany Silva" → "Eluany")
    const firstName = (customer?.name || "").trim().split(" ")[0] || "";
    const greet = firstName ? `Olá ${firstName}!` : "Olá!";
    switch (toStatus) {
      case "diagnostico":
        return `${greet} Estamos analisando o seu equipamento (OS ${num}). Em breve enviamos o diagnóstico.`;
      case "aguardando_aprovacao":
        return `${greet} Concluímos o diagnóstico da OS ${num} e enviamos o orçamento. Aguardamos sua aprovação para seguir.`;
      case "aguardando_peca":
        return `${greet} A OS ${num} está aguardando a chegada da peça necessária para o reparo. Avisaremos assim que estiver disponível.`;
      case "em_execucao":
        return `${greet} Iniciamos o serviço da OS ${num}. Já vamos finalizar e te aviso quando estiver pronto.`;
      case "concluida":
        return `${greet} Concluímos a OS ${num}. O equipamento já está pronto para retirada/entrega.`;
      case "entregue":
        return `${greet} A OS ${num} foi entregue. Agradecemos pela confiança! Qualquer dúvida sobre a garantia, é só nos chamar.`;
      case "cancelada":
        return `${greet} A OS ${num} foi cancelada conforme conversamos.`;
      case "faturada":
        return `${greet} A OS ${num} foi faturada. O recibo será enviado em seguida.`;
      default:
        return "";
    }
  }

  const [notify, setNotify] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setMessage(defaultMessage());
    // Sugere notificar quando a transição é "visível ao cliente"
    const visibleStatuses: OsStatus[] = [
      "diagnostico", "aguardando_aprovacao", "aguardando_peca",
      "em_execucao", "concluida", "entregue", "cancelada",
    ];
    setNotify(visibleStatuses.includes(toStatus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toStatus, customer?.name]);

  const phone = pickWhatsapp({
    whatsapp: customer?.whatsapp,
    phone: customer?.phone,
    remote_jid: customer?.remote_jid,
  });

  async function handleConfirm() {
    // O envio via WhatsApp é feito pelo executeTransition no ServiceOrderEditor,
    // que chama notifyCustomerAboutOSStatus via webhook dedicado.
    // Não abrimos mais wa.me aqui — fica 100% automático.
    await onConfirm({ notifyCustomer: notify && !!phone, message: message.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Mudar status da OS
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2 mt-1">
              <Badge className={`${fromMeta.tone} ring-1`}>{fromMeta.label}</Badge>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <Badge className={`${toMeta.tone} ring-1`}>{toMeta.label}</Badge>
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="notify-toggle" className="flex items-center gap-2 cursor-pointer">
                <MessageSquare className="h-4 w-4 text-emerald-500" />
                Notificar cliente por WhatsApp
              </Label>
              <Switch id="notify-toggle" checked={notify && !!phone} onCheckedChange={(v) => setNotify(v)} disabled={!phone} />
            </div>

            {!phone && (
              <div className="text-xs text-amber-400">
                Cliente sem telefone/WhatsApp cadastrado.
              </div>
            )}

            {notify && phone && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">Mensagem (opcional)</Label>
                  <Textarea
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Deixe vazio pra usar o template padrão do status. Variáveis: {nome}, {os}, {empresa}, {tecnico}"
                  />
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Envio automático via WhatsApp ao confirmar. Se vazio, usa template do status.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? "Salvando..." : (
              <>
                <Send className="h-4 w-4 mr-1" />
                Confirmar mudança{notify && phone ? " + WhatsApp" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
