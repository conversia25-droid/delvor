import { useEffect, useState } from "react";
import { ArrowRight, UserCog, Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { notifyTechnicianAboutOS } from "@/lib/notifyTechnicianOS";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TeamUser = { id: string; nome: string; role?: string | null };

interface TransferOsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceOrderId: string;
  currentTechnicianId: string | null;
  currentTechnicianName?: string | null;
  onTransferred?: (newTechnicianId: string) => void;
}

export default function TransferOsDialog({
  open,
  onOpenChange,
  serviceOrderId,
  currentTechnicianId,
  currentTechnicianName,
  onTransferred,
}: TransferOsDialogProps) {
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // Carrega técnicos disponíveis (qualquer profile da empresa que tenha role tecnico,
  // OU admin/gerente — quem pode receber/atender uma OS)
  useEffect(() => {
    if (!open || !user?.company_id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Pega profiles da empresa
      const { data: profiles } = await supabase
        .from("profiles" as any)
        .select("id, nome")
        .eq("company_id", user.company_id)
        .order("nome");

      const ids = (profiles as any[] | null)?.map((p) => p.id) ?? [];
      const { data: roles } = await supabase
        .from("user_roles" as any)
        .select("user_id, role")
        .in("user_id", ids);

      const roleMap = new Map<string, string[]>();
      ((roles as any[]) ?? []).forEach((r) => {
        const arr = roleMap.get(r.user_id) || [];
        arr.push(r.role);
        roleMap.set(r.user_id, arr);
      });

      const eligible: TeamUser[] = ((profiles as any[]) ?? [])
        .map((p) => {
          const rs = roleMap.get(p.id) || ["user"];
          // técnicos, admins e gerentes podem receber OS
          const ok = rs.some((r) =>
            ["tecnico", "admin", "gerente", "super_admin"].includes(r)
          );
          return ok ? { id: p.id, nome: p.nome, role: rs[0] } : null;
        })
        .filter(Boolean) as TeamUser[];

      if (cancelled) return;
      setTeam(eligible);
      setTarget("");
      setReason("");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, user?.company_id, currentTechnicianId]);

  async function transfer() {
    if (!target) {
      toast({ title: "Selecione o novo responsável", variant: "destructive" });
      return;
    }
    if (target === currentTechnicianId) {
      toast({ title: "Selecione um técnico diferente", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("transfer_service_order" as any, {
      p_os_id: serviceOrderId,
      p_new_technician: target,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Erro ao transferir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "OS transferida", description: "Registro adicionado à timeline." });
    onOpenChange(false);
    onTransferred?.(target);

    // Notifica novo técnico via WhatsApp (background)
    if (user?.company_id) {
      notifyTechnicianAboutOS({
        osId: serviceOrderId,
        companyId: user.company_id,
        userId: user.id,
        reason: "transferred",
      })
        .then((r) => {
          if (r.ok) {
            toast({
              title: "Técnico notificado",
              description: "Mensagem enviada via WhatsApp.",
            });
          } else if (r.reason && !["disabled_by_company", "no_technician", "technician_no_whatsapp"].includes(r.reason)) {
            console.warn("notifyTechnicianAboutOS (transfer):", r.reason);
          }
        })
        .catch((e) => console.warn("notifyTechnicianAboutOS error:", e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" /> Transferir OS
          </DialogTitle>
          <DialogDescription>
            A transferência fica registrada na timeline da OS com data, autor e motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">De:</span>
            <span className="font-medium">{currentTechnicianName || "Não atribuído"}</span>
            <ArrowRight className="h-4 w-4 mx-1 text-muted-foreground" />
            <span className="text-muted-foreground">Para:</span>
            <span className="font-medium">
              {target ? team.find((t) => t.id === target)?.nome : "—"}
            </span>
          </div>

          <div>
            <Label>Novo responsável *</Label>
            {loading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando equipe...
              </div>
            ) : (
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder="Selecionar técnico..." /></SelectTrigger>
                <SelectContent>
                  {team
                    .filter((t) => t.id !== currentTechnicianId)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nome} {t.role && t.role !== "tecnico" ? <span className="text-xs text-muted-foreground ml-1">({t.role})</span> : null}
                      </SelectItem>
                    ))}
                  {team.filter((t) => t.id !== currentTechnicianId).length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground text-center">
                      Nenhum outro técnico cadastrado.
                    </div>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Motivo (opcional)</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='Ex: "Maria está com mais carga hoje", "Tem mais experiência neste modelo"...'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={transfer} disabled={busy || !target}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <UserCog className="h-4 w-4 mr-1" />}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
