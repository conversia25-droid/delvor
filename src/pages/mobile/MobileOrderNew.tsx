/**
 * Criar nova OS pelo mobile (técnico ou vendedor no PWA).
 *
 * Versão mobile-first do fluxo desktop: campos essenciais só, sem itens/
 * peças aqui — quem cria abre a OS, depois entra no detalhe pra registrar
 * fotos, diagnóstico e peças. Isso mantém a criação rápida no balcão.
 *
 * Campos:
 *  - Cliente (obrigatório)
 *  - Equipamento (opcional — depende do cliente)
 *  - Defeito relatado
 *  - Origem (como o cliente chegou)
 *  - Prioridade
 *  - Prazo prometido (opcional)
 *
 * Ao salvar:
 *  - technician_id = self (o técnico cria a OS pra si mesmo por padrão;
 *    admin/gerente pode reatribuir depois no desktop)
 *  - opened_by = self
 *  - status = 'aberta'
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Wrench, Plus } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import CustomerCombobox from "@/components/sales/CustomerCombobox";
import EquipmentCombobox from "@/components/service-orders/EquipmentCombobox";
import EquipmentFormDialog from "@/components/service-orders/EquipmentFormDialog";
import type { OsOrigin, OsPriority } from "@/types/delvor";

const ORIGIN_OPTIONS: { value: OsOrigin; label: string }[] = [
  { value: "balcao",    label: "Balcão" },
  { value: "visita",    label: "Visita técnica" },
  { value: "remoto",    label: "Atendimento remoto" },
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "telefone",  label: "Telefone" },
  { value: "email",     label: "E-mail" },
  { value: "outro",     label: "Outro" },
];

const PRIORITY_OPTIONS: { value: OsPriority; label: string }[] = [
  { value: "baixa",   label: "Baixa" },
  { value: "normal",  label: "Normal" },
  { value: "alta",    label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

export default function MobileOrderNew() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [equipDialogOpen, setEquipDialogOpen] = useState(false);
  const [equipRefresh, setEquipRefresh] = useState(0);
  const [reportedIssue, setReportedIssue] = useState("");
  const [origin, setOrigin] = useState<OsOrigin>("balcao");
  const [priority, setPriority] = useState<OsPriority>("normal");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user?.company_id || !user?.id) return;
    if (!customerId) {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      company_id: user.company_id,
      customer_id: customerId,
      equipment_id: equipmentId,
      technician_id: user.id,   // técnico assume por padrão
      opened_by: user.id,
      status: "aberta",
      priority,
      origin,
      reported_issue: reportedIssue.trim() || null,
      due_at: dueAt || null,
    };
    const { data, error } = await supabase
      .from("service_orders" as any)
      .insert(payload)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao criar OS", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "OS criada" });
    navigate(`/m/orders/${(data as any).id}`, { replace: true });
  }

  return (
    <div className="min-h-full flex flex-col">
      {/* Header sticky */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/60 px-2 py-2 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <Wrench className="h-5 w-5 text-blue-700 dark:text-blue-400" />
          <h1 className="font-semibold">Nova OS</h1>
        </div>
      </header>

      <div className="p-3 space-y-4 max-w-2xl mx-auto w-full">
        {/* Cliente */}
        <section className="space-y-1.5">
          <Label className="text-xs">Cliente *</Label>
          <CustomerCombobox
            value={customerId}
            onChange={(id) => {
              setCustomerId(id);
              setEquipmentId(null); // trocar cliente zera o equipamento
            }}
            placeholder="Buscar cliente..."
          />
        </section>

        {/* Equipamento */}
        <section className="space-y-1.5">
          <Label className="text-xs">Equipamento (opcional)</Label>
          <EquipmentCombobox
            customerId={customerId}
            value={equipmentId}
            onChange={(id) => setEquipmentId(id)}
            onCreateRequested={() => setEquipDialogOpen(true)}
            refreshKey={equipRefresh}
            disabled={!customerId}
          />
          {!customerId && (
            <p className="text-[11px] text-muted-foreground">
              Selecione o cliente primeiro pra listar/cadastrar os equipamentos dele.
            </p>
          )}
        </section>

        {/* Defeito */}
        <section className="space-y-1.5">
          <Label className="text-xs">Defeito relatado</Label>
          <Textarea
            rows={4}
            placeholder="Ex: notebook não liga, tela piscando..."
            value={reportedIssue}
            onChange={(e) => setReportedIssue(e.target.value)}
          />
        </section>

        {/* Origem + Prioridade */}
        <div className="grid grid-cols-2 gap-3">
          <section className="space-y-1.5">
            <Label className="text-xs">Origem</Label>
            <Select value={origin} onValueChange={(v: OsOrigin) => setOrigin(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORIGIN_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
          <section className="space-y-1.5">
            <Label className="text-xs">Prioridade</Label>
            <Select value={priority} onValueChange={(v: OsPriority) => setPriority(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
        </div>

        {/* Prazo */}
        <section className="space-y-1.5">
          <Label className="text-xs">Prazo prometido (opcional)</Label>
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </section>
      </div>

      {/* Sticky bottom action */}
      <div
        className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-border/60 p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0))" }}
      >
        <div className="max-w-2xl mx-auto flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-12"
            onClick={() => navigate(-1)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={save}
            disabled={saving || !customerId}
          >
            {saving
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Plus className="h-4 w-4 mr-2" />}
            Criar OS
          </Button>
        </div>
      </div>

      {/* Dialog pra cadastrar equipamento novo do cliente selecionado */}
      {customerId && (
        <EquipmentFormDialog
          open={equipDialogOpen}
          onOpenChange={setEquipDialogOpen}
          customerId={customerId}
          equipment={null}
          onSaved={() => {
            setEquipDialogOpen(false);
            setEquipRefresh((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
