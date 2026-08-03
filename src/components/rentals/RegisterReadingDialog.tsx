import { useEffect, useState } from "react";
import { Gauge, Loader2 } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { CustomerEquipment, MeterReadingSource, RentalContractItem } from "@/types/delvor";

interface RegisterReadingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractItem: RentalContractItem | null;
  equipment: CustomerEquipment | null;
  onSaved?: () => void;
}

const SOURCE_OPTIONS: { value: MeterReadingSource; label: string }[] = [
  { value: "visita",            label: "Visita técnica" },
  { value: "remoto",            label: "Leitura remota" },
  { value: "cliente_informou",  label: "Cliente informou" },
  { value: "tecnico",           label: "Técnico (telefone/foto)" },
];

export default function RegisterReadingDialog({
  open, onOpenChange, contractItem, equipment, onSaved,
}: RegisterReadingDialogProps) {
  const { user } = useAuth();
  const [readingDate, setReadingDate] = useState<string>("");
  const [counterBw, setCounterBw] = useState("");
  const [counterColor, setCounterColor] = useState("");
  const [source, setSource] = useState<MeterReadingSource>("visita");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReadingDate(new Date().toISOString().slice(0, 10));
    setCounterBw(equipment?.current_counter_bw != null ? String(equipment.current_counter_bw) : "");
    setCounterColor(equipment?.current_counter_color != null ? String(equipment.current_counter_color) : "");
    setSource("visita");
    setNotes("");
  }, [open, equipment]);

  if (!contractItem) return null;

  async function save() {
    if (!contractItem) return;
    if (!counterBw && !counterColor) {
      toast({ title: "Informe ao menos um contador", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      contract_item_id: contractItem.id,
      reading_date: readingDate,
      counter_bw: counterBw ? parseInt(counterBw, 10) : null,
      counter_color: counterColor ? parseInt(counterColor, 10) : null,
      source,
      user_id: user?.id || null,
      notes: notes.trim() || null,
    };
    const { error } = await supabase.from("rental_meter_readings" as any).insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar leitura", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Leitura registrada" });
    onOpenChange(false);
    onSaved?.();
  }

  const lastBw = equipment?.current_counter_bw;
  const lastColor = equipment?.current_counter_color;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" /> Registrar leitura
          </DialogTitle>
          <DialogDescription>
            {equipment ? (
              <>
                {[equipment.brand, equipment.model].filter(Boolean).join(" ")}
                {equipment.serial_number && <span className="font-mono ml-1">SN {equipment.serial_number}</span>}
              </>
            ) : "Equipamento"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data da leitura</Label>
              <Input type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} />
            </div>
            <div>
              <Label>Origem</Label>
              <Select value={source} onValueChange={(v: MeterReadingSource) => setSource(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contador P&B</Label>
              <Input
                value={counterBw}
                onChange={(e) => setCounterBw(e.target.value.replace(/\D+/g, ""))}
                inputMode="numeric"
                placeholder={lastBw != null ? `> ${lastBw}` : "0"}
              />
              {lastBw != null && (
                <div className="text-[11px] text-muted-foreground mt-1">Última: {lastBw}</div>
              )}
            </div>
            <div>
              <Label>Contador Color</Label>
              <Input
                value={counterColor}
                onChange={(e) => setCounterColor(e.target.value.replace(/\D+/g, ""))}
                inputMode="numeric"
                placeholder={lastColor != null ? `> ${lastColor}` : "0"}
              />
              {lastColor != null && (
                <div className="text-[11px] text-muted-foreground mt-1">Última: {lastColor}</div>
              )}
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Gauge className="h-4 w-4 mr-1" />}
            Salvar leitura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
