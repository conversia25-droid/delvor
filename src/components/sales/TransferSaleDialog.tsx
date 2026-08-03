import { useEffect, useState } from "react";
import { ArrowRight, UserCog, Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

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

interface TransferSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string;
  currentSellerId: string | null;
  currentSellerName?: string | null;
  onTransferred?: (newSellerId: string) => void;
}

export default function TransferSaleDialog({
  open,
  onOpenChange,
  saleId,
  currentSellerId,
  currentSellerName,
  onTransferred,
}: TransferSaleDialogProps) {
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // Vendedores elegíveis: vendedor, admin, gerente, user (legado)
  useEffect(() => {
    if (!open || !user?.company_id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
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
          const ok = rs.some((r) =>
            ["vendedor", "admin", "gerente", "super_admin", "user"].includes(r)
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
  }, [open, user?.company_id]);

  async function transfer() {
    if (!target) {
      toast({ title: "Selecione o novo vendedor", variant: "destructive" });
      return;
    }
    if (target === currentSellerId) {
      toast({ title: "Selecione um vendedor diferente", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("transfer_sale" as any, {
      p_sale_id: saleId,
      p_new_seller: target,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Erro ao transferir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Venda transferida", description: "Registro adicionado ao log de auditoria." });
    onOpenChange(false);
    onTransferred?.(target);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" /> Transferir venda
          </DialogTitle>
          <DialogDescription>
            A venda passa a pertencer ao novo vendedor (que receberá comissão e relatórios).
            A transferência fica registrada no log de auditoria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">De:</span>
            <span className="font-medium">{currentSellerName || "—"}</span>
            <ArrowRight className="h-4 w-4 mx-1 text-muted-foreground" />
            <span className="text-muted-foreground">Para:</span>
            <span className="font-medium">
              {target ? team.find((t) => t.id === target)?.nome : "—"}
            </span>
          </div>

          <div>
            <Label>Novo vendedor *</Label>
            {loading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando equipe...
              </div>
            ) : (
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger><SelectValue placeholder="Selecionar vendedor..." /></SelectTrigger>
                <SelectContent>
                  {team
                    .filter((t) => t.id !== currentSellerId)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nome} {t.role && t.role !== "vendedor" ? <span className="text-xs text-muted-foreground ml-1">({t.role})</span> : null}
                      </SelectItem>
                    ))}
                  {team.filter((t) => t.id !== currentSellerId).length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground text-center">
                      Nenhum outro vendedor cadastrado.
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
              placeholder='Ex: "Cliente passou para a carteira da Maria"'
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
