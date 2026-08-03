import { useEffect, useState } from "react";
import { Loader2, Tags } from "lucide-react";

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

import type { ServiceCatalogItem } from "@/types/delvor";

interface QuickServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated?: (service: ServiceCatalogItem) => void;
}

function parseNum(v: string): number {
  const n = parseFloat((v || "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function QuickServiceDialog({
  open, onOpenChange, initialName, onCreated,
}: QuickServiceDialogProps) {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setName(initialName || "");
    setDescription("");
    setPrice("");
    setDuration("");
  }, [open, initialName]);

  async function save() {
    if (!user?.company_id) return;
    if (!name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      company_id: user.company_id,
      code: code.trim().toUpperCase() || null,
      name: name.trim(),
      description: description.trim() || null,
      default_price: parseNum(price),
      default_duration_min: duration ? parseInt(duration, 10) : null,
      active: true,
    };
    const { data, error } = await supabase
      .from("services_catalog" as any)
      .insert(payload)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao criar serviço", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Serviço cadastrado" });
    onOpenChange(false);
    onCreated?.(data as any);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" /> Cadastrar serviço
          </DialogTitle>
          <DialogDescription>
            Adiciona ao catálogo. Você pode editar em <b>Catálogo</b> depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Código</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="LIMP"
                maxLength={12}
              />
            </div>
            <div className="col-span-2">
              <Label>Nome *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Limpeza geral de impressora" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Preço base (R$)</Label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label>Duração média (min)</Label>
              <Input
                value={duration}
                onChange={(e) => setDuration(e.target.value.replace(/\D+/g, ""))}
                placeholder="60"
                inputMode="numeric"
              />
            </div>
          </div>

          <div>
            <Label>Descrição</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
