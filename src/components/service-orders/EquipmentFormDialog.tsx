import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Upload, Loader2, Image as ImageIcon } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { uploadImage, IMAGE_ACCEPT } from "@/lib/uploadImage";
import ImageLightbox from "@/components/ImageLightbox";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

import type { CustomerEquipment, EquipmentStatus } from "@/types/delvor";

interface EquipmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
  equipment?: CustomerEquipment | null;
  /** Chamado com o equipamento criado/atualizado. */
  onSaved?: (equipment: CustomerEquipment) => void;
}

type FormState = {
  brand: string;
  model: string;
  serial_number: string;
  asset_tag: string;
  category: string;
  location: string;
  status: EquipmentStatus;
  notes: string;
  photo_url: string;
};

const EMPTY: FormState = {
  brand: "",
  model: "",
  serial_number: "",
  asset_tag: "",
  category: "Impressora",
  location: "",
  status: "ativo",
  notes: "",
  photo_url: "",
};

export default function EquipmentFormDialog({
  open,
  onOpenChange,
  customerId,
  equipment,
  onSaved,
}: EquipmentFormDialogProps) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carrega categorias já usadas nessa empresa pra sugerir no autocomplete.
  // A categoria continua sendo texto livre (não é FK), então categorias
  // "novas" nascem quando alguém salva um valor inédito.
  useEffect(() => {
    if (!open || !user?.company_id) return;
    (async () => {
      const { data } = await supabase
        .from("customer_equipments" as any)
        .select("category")
        .eq("company_id", user.company_id)
        .not("category", "is", null);
      const unique = Array.from(
        new Set(
          ((data as any[]) ?? [])
            .map((r) => (r.category as string | null)?.trim())
            .filter((c): c is string => !!c)
        )
      ).sort((a, b) => a.localeCompare(b, "pt-BR"));
      setCategories(unique);
    })();
  }, [open, user?.company_id]);

  async function handlePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    setUploading(true);
    const r = await uploadImage(file);
    setUploading(false);
    if (!r.ok) {
      toast({ title: "Erro no upload da foto", description: r.error, variant: "destructive" });
      return;
    }
    setForm((f) => ({ ...f, photo_url: r.url! }));
  }

  useEffect(() => {
    if (!open) return;
    if (equipment) {
      setForm({
        brand: equipment.brand || "",
        model: equipment.model || "",
        serial_number: equipment.serial_number || "",
        asset_tag: equipment.asset_tag || "",
        category: equipment.category || "Impressora",
        location: equipment.location || "",
        status: equipment.status,
        notes: equipment.notes || "",
        photo_url: equipment.photo_url || "",
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, equipment]);

  async function save() {
    if (!user?.company_id || !customerId) {
      toast({ title: "Selecione um cliente primeiro", variant: "destructive" });
      return;
    }
    if (!form.brand && !form.model) {
      toast({ title: "Informe ao menos marca ou modelo", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload: any = {
      company_id: user.company_id,
      customer_id: customerId,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      asset_tag: form.asset_tag.trim() || null,
      category: form.category.trim() || null,
      location: form.location.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
      photo_url: form.photo_url || null,
    };

    let resp;
    if (equipment?.id) {
      resp = await supabase.from("customer_equipments" as any).update(payload).eq("id", equipment.id).select().single();
    } else {
      resp = await supabase.from("customer_equipments" as any).insert(payload).select().single();
    }

    setSaving(false);
    if (resp.error || !resp.data) {
      toast({ title: "Erro ao salvar", description: resp.error?.message, variant: "destructive" });
      return;
    }
    toast({ title: equipment ? "Equipamento atualizado" : "Equipamento cadastrado" });
    onOpenChange(false);
    onSaved?.(resp.data as any);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{equipment ? "Editar equipamento" : "Novo equipamento"}</DialogTitle>
          <DialogDescription>
            Vinculado ao cliente. Use marca/modelo/série para identificar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* foto do equipamento */}
          <div>
            <Label>Foto do equipamento</Label>
            <div className="mt-1 flex items-center gap-3">
              {form.photo_url ? (
                <img
                  src={form.photo_url}
                  alt="Equipamento"
                  onClick={() => setViewingPhoto(true)}
                  title="Ver imagem"
                  className="h-20 w-20 rounded-md border object-cover cursor-zoom-in"
                />
              ) : (
                <div className="h-20 w-20 rounded-md border border-dashed flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading
                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    : <Upload className="h-3.5 w-3.5 mr-1" />}
                  {form.photo_url ? "Trocar foto" : "Enviar foto"}
                </Button>
                {form.photo_url && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, photo_url: "" }))}
                    className="text-xs text-muted-foreground hover:text-destructive text-left"
                  >
                    Remover foto
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={handlePhoto}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Marca</Label>
              <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="HP, Epson..." />
            </div>
            <div>
              <Label>Modelo</Label>
              <Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="M428dw" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nº de série</Label>
              <Input value={form.serial_number} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))} />
            </div>
            <div>
              <Label>Patrimônio</Label>
              <Input value={form.asset_tag} onChange={(e) => setForm((f) => ({ ...f, asset_tag: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Input
                list="equip-category-suggestions"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Escolha ou digite para criar"
              />
              {/* Autocomplete nativo: mostra as categorias já cadastradas
                  na empresa; digitar algo inédito vira uma categoria nova
                  ao salvar (categoria é texto livre no banco, não é FK). */}
              <datalist id="equip-category-suggestions">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {categories.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  {categories.length} categoria{categories.length > 1 ? "s" : ""} cadastrada{categories.length > 1 ? "s" : ""} — clique no campo pra ver.
                </div>
              )}
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v: EquipmentStatus) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="manutencao">Em manutenção</SelectItem>
                  <SelectItem value="locacao">Locação</SelectItem>
                  <SelectItem value="baixado">Baixado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Localização no cliente</Label>
            <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder='Ex: "Filial centro - Sala 2"' />
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>

        <ImageLightbox
          src={viewingPhoto ? form.photo_url : null}
          onClose={() => setViewingPhoto(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
