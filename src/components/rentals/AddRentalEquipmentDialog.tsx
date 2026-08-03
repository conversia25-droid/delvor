import { useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import EquipmentCombobox from "@/components/service-orders/EquipmentCombobox";
import EquipmentFormDialog from "@/components/service-orders/EquipmentFormDialog";
import type { CustomerEquipment } from "@/types/delvor";

interface AddRentalEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  customerId: string;
  onAdded?: () => void;
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function parseInt0(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v.replace(/\D+/g, ""), 10);
  return isNaN(n) ? null : n;
}

export default function AddRentalEquipmentDialog({
  open, onOpenChange, contractId, customerId, onAdded,
}: AddRentalEquipmentDialogProps) {
  const { user } = useAuth();
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<CustomerEquipment | null>(null);
  const [equipmentRefresh, setEquipmentRefresh] = useState(0);
  const [equipFormOpen, setEquipFormOpen] = useState(false);

  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [team, setTeam] = useState<{ id: string; nome: string }[]>([]);

  const [monthlyValue, setMonthlyValue] = useState("");
  const [hasFranchise, setHasFranchise] = useState(false);
  const [franchiseBw, setFranchiseBw] = useState("");
  const [overageBw, setOverageBw] = useState("");
  const [franchiseColor, setFranchiseColor] = useState("");
  const [overageColor, setOverageColor] = useState("");
  const [baselineBw, setBaselineBw] = useState("");
  const [baselineColor, setBaselineColor] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Carrega equipe quando abre (apenas técnicos / admins / gerentes podem ser responsáveis)
  useEffect(() => {
    if (!open || !user?.company_id) return;
    (async () => {
      const { data: profiles } = await supabase
        .from("profiles" as any)
        .select("id, nome")
        .eq("company_id", user.company_id)
        .order("nome");
      const ids = ((profiles as any[]) ?? []).map((p) => p.id);
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
      const eligible = ((profiles as any[]) ?? []).filter((p) => {
        const rs = roleMap.get(p.id) || ["user"];
        return rs.some((r) => ["tecnico", "admin", "gerente", "super_admin"].includes(r));
      });
      setTeam(eligible);
    })();
  }, [open, user?.company_id]);

  useEffect(() => {
    if (!open) return;
    setEquipmentId(null); setEquipment(null);
    setTechnicianId(null);
    setMonthlyValue(""); setHasFranchise(false);
    setFranchiseBw(""); setOverageBw("");
    setFranchiseColor(""); setOverageColor("");
    setBaselineBw(""); setBaselineColor("");
    setNotes("");
  }, [open]);

  // Quando equipamento muda, sugere baseline com os contadores atuais dele
  useEffect(() => {
    if (!equipment) return;
    if (equipment.current_counter_bw != null) setBaselineBw(String(equipment.current_counter_bw));
    if (equipment.current_counter_color != null) setBaselineColor(String(equipment.current_counter_color));
  }, [equipment]);

  async function save() {
    if (!equipmentId) {
      toast({ title: "Selecione o equipamento", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      contract_id: contractId,
      equipment_id: equipmentId,
      technician_id: technicianId,
      monthly_value: parseNum(monthlyValue),
      franchise_bw: hasFranchise ? parseInt0(franchiseBw) : null,
      overage_bw_unit_price: hasFranchise && franchiseBw ? parseNum(overageBw) : null,
      franchise_color: hasFranchise ? parseInt0(franchiseColor) : null,
      overage_color_unit_price: hasFranchise && franchiseColor ? parseNum(overageColor) : null,
      baseline_counter_bw: parseInt0(baselineBw),
      baseline_counter_color: parseInt0(baselineColor),
      notes: notes.trim() || null,
    };
    const { error } = await supabase.from("rental_contract_items" as any).insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao adicionar equipamento", description: error.message, variant: "destructive" });
      return;
    }
    // Marca equipamento como locação
    await supabase.from("customer_equipments" as any)
      .update({ is_rental: true, status: "locacao" })
      .eq("id", equipmentId);

    toast({ title: "Equipamento adicionado ao contrato" });
    onOpenChange(false);
    onAdded?.();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar equipamento ao contrato</DialogTitle>
            <DialogDescription>
              Define a mensalidade e (opcional) franquia + valor por página excedente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="flex items-center justify-between">
                Equipamento *
                <button type="button" className="text-[11px] text-emerald-500 hover:underline inline-flex items-center" onClick={() => setEquipFormOpen(true)}>
                  <Plus className="h-3 w-3 mr-0.5" /> novo
                </button>
              </Label>
              <EquipmentCombobox
                customerId={customerId}
                value={equipmentId}
                onChange={(id, eq) => { setEquipmentId(id); setEquipment(eq); }}
                onCreateRequested={() => setEquipFormOpen(true)}
                refreshKey={equipmentRefresh}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mensalidade (R$) *</Label>
                <Input
                  value={monthlyValue}
                  onChange={(e) => setMonthlyValue(e.target.value)}
                  placeholder="150,00"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label>Técnico responsável</Label>
                <Select
                  value={technicianId || "__none__"}
                  onValueChange={(v) => setTechnicianId(v === "__none__" ? null : v)}
                >
                  <SelectTrigger><SelectValue placeholder="Não atribuído" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Não atribuído</SelectItem>
                    {team.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Quem cuida desse equipamento (manutenção, leitura).
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <Label htmlFor="franchise-toggle" className="cursor-pointer">
                Cobrar excedente de páginas (impressoras)
              </Label>
              <Switch id="franchise-toggle" checked={hasFranchise} onCheckedChange={setHasFranchise} />
            </div>

            {hasFranchise && (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">
                  Deixe a franquia em branco se NÃO quiser cobrar pelo tipo (ex: só P&B sem color).
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Franquia P&B (págs/mês)</Label>
                    <Input
                      value={franchiseBw}
                      onChange={(e) => setFranchiseBw(e.target.value.replace(/\D+/g, ""))}
                      placeholder="1000"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <Label>R$ por excedente P&B</Label>
                    <Input
                      value={overageBw}
                      onChange={(e) => setOverageBw(e.target.value)}
                      placeholder="0,15"
                      inputMode="decimal"
                      disabled={!franchiseBw}
                    />
                  </div>
                  <div>
                    <Label>Franquia Color (págs/mês)</Label>
                    <Input
                      value={franchiseColor}
                      onChange={(e) => setFranchiseColor(e.target.value.replace(/\D+/g, ""))}
                      placeholder="0"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <Label>R$ por excedente Color</Label>
                    <Input
                      value={overageColor}
                      onChange={(e) => setOverageColor(e.target.value)}
                      placeholder="0,40"
                      inputMode="decimal"
                      disabled={!franchiseColor}
                    />
                  </div>
                </div>

                <Separator />

                <div className="text-xs text-muted-foreground">
                  Contadores no momento da assinatura (referência pra calcular o consumo).
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Contador inicial P&B</Label>
                    <Input
                      value={baselineBw}
                      onChange={(e) => setBaselineBw(e.target.value.replace(/\D+/g, ""))}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <Label>Contador inicial Color</Label>
                    <Input
                      value={baselineColor}
                      onChange={(e) => setBaselineColor(e.target.value.replace(/\D+/g, ""))}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EquipmentFormDialog
        open={equipFormOpen}
        onOpenChange={setEquipFormOpen}
        customerId={customerId}
        onSaved={(eq) => {
          setEquipmentId(eq.id);
          setEquipment(eq);
          setEquipmentRefresh((n) => n + 1);
          setEquipFormOpen(false);
        }}
      />
    </>
  );
}
