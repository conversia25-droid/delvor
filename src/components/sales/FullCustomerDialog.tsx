import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
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

import type { Customer, PersonType } from "@/types/delvor";
import {
  fetchAddressByCep,
  maskCep,
  maskDocument,
  maskPhone,
  phoneToJid,
} from "@/lib/formatters";
import { lookupCnpj, CNPJ_ERROR_MESSAGES } from "@/lib/cnpjLookup";
import PhoneInput from "@/components/PhoneInput";

interface FullCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated?: (customer: Customer) => void;
}

type FormState = {
  person_type: PersonType;
  name: string;
  trade_name: string;
  document: string;
  state_reg: string;
  muni_reg: string;
  email: string;
  phone: string;
  whatsapp: string;
  zipcode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  notes: string;
  source: string;
  active: boolean;
  is_internal: boolean;
};

const EMPTY_FORM: FormState = {
  person_type: "PJ",
  name: "",
  trade_name: "",
  document: "",
  state_reg: "",
  muni_reg: "",
  email: "",
  phone: "",
  whatsapp: "",
  zipcode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  notes: "",
  source: "",
  active: true,
  is_internal: false,
};

export default function FullCustomerDialog({
  open, onOpenChange, initialName, onCreated,
}: FullCustomerDialogProps) {
  const { user } = useAuth();
  const { canManageInternalCustomers } = usePermissions();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_FORM, name: initialName || "" });
  }, [open, initialName]);

  async function handleCnpjBlur() {
    if (form.person_type !== "PJ") return;
    const digits = form.document.replace(/\D+/g, "");
    if (digits.length !== 14) return;
    setCnpjLoading(true);
    const r = await lookupCnpj(digits);
    setCnpjLoading(false);
    if (!r.ok) {
      if (r.error !== "invalid_cnpj") {
        toast({ title: CNPJ_ERROR_MESSAGES[r.error], variant: "destructive" });
      }
      return;
    }
    const d = r.data;
    setForm((f) => ({
      ...f,
      name: f.name || d.razao_social || "",
      trade_name: f.trade_name || d.nome_fantasia || "",
      email: f.email || d.email || "",
      phone: f.phone || (d.ddd_telefone_1 ? maskPhone(d.ddd_telefone_1) : ""),
      whatsapp: f.whatsapp || (d.ddd_telefone_1 ? maskPhone(d.ddd_telefone_1) : ""),
      zipcode: f.zipcode || (d.cep ? maskCep(d.cep) : ""),
      street: f.street || d.logradouro || "",
      number: f.number || d.numero || "",
      complement: f.complement || d.complemento || "",
      district: f.district || d.bairro || "",
      city: f.city || d.municipio || "",
      state: f.state || (d.uf || ""),
    }));
    toast({
      title: d.razao_social,
      description: `Situação: ${d.situacao_cadastral}${d.nome_fantasia ? ` • ${d.nome_fantasia}` : ""}`,
    });
  }

  async function handleCepBlur() {
    const found = await fetchAddressByCep(form.zipcode);
    if (!found) return;
    setForm((f) => ({
      ...f,
      street: found.street ?? f.street,
      district: found.district ?? f.district,
      city: found.city ?? f.city,
      state: found.state ?? f.state,
    }));
  }

  async function save() {
    if (!user?.company_id) return;
    if (!form.name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const docDigits = form.document.replace(/\D+/g, "") || null;
    const wppDigits = form.whatsapp.replace(/\D+/g, "") || null;

    const payload: any = {
      company_id: user.company_id,
      person_type: form.person_type,
      name: form.name.trim(),
      trade_name: form.trade_name.trim() || null,
      document: docDigits,
      state_reg: form.person_type === "PJ" ? (form.state_reg.trim() || null) : null,
      muni_reg:  form.person_type === "PJ" ? (form.muni_reg.trim()  || null) : null,
      email: form.email.trim() || null,
      phone: form.phone.replace(/\D+/g, "") || null,
      whatsapp: wppDigits,
      remote_jid: phoneToJid(wppDigits || form.phone),
      zipcode: form.zipcode.replace(/\D+/g, "") || null,
      street: form.street.trim() || null,
      number: form.number.trim() || null,
      complement: form.complement.trim() || null,
      district: form.district.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      notes: form.notes.trim() || null,
      source: form.source.trim() || null,
      active: form.active,
      is_internal: form.is_internal,
    };

    const { data, error } = await supabase
      .from("customers" as any)
      .insert(payload)
      .select()
      .single();
    setSaving(false);

    if (error || !data) {
      toast({ title: "Erro ao criar cliente", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Cliente cadastrado" });
    // Entrega o cliente ao pai (combobox) ANTES de fechar o dialog —
    // se fechar primeiro, algumas versões do Radix desmontam a árvore
    // e as atualizações de estado não propagam até o botão do combobox.
    onCreated?.(data as any);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>
            Preencha os dados de identificação, contato e endereço.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Tipo + documento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select
                value={form.person_type}
                onValueChange={(v: PersonType) =>
                  setForm((f) => ({ ...f, person_type: v, document: "" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                  <SelectItem value="PF">Pessoa Física</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1.5">
                {form.person_type === "PJ" ? "CNPJ" : "CPF"}
                {cnpjLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
              </Label>
              <Input
                value={form.document}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    document: maskDocument(e.target.value, f.person_type),
                  }))
                }
                onBlur={handleCnpjBlur}
                placeholder={
                  form.person_type === "PJ"
                    ? "00.000.000/0000-00"
                    : "000.000.000-00"
                }
                title={form.person_type === "PJ" ? "Sai do campo pra buscar dados na Receita" : undefined}
              />
            </div>
          </div>

          {/* Nome / fantasia */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>
                {form.person_type === "PJ" ? "Razão social *" : "Nome completo *"}
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={
                  form.person_type === "PJ"
                    ? "Empresa Exemplo Ltda."
                    : "João da Silva"
                }
                autoFocus
              />
            </div>
            {form.person_type === "PJ" && (
              <div className="md:col-span-2">
                <Label>Nome fantasia</Label>
                <Input
                  value={form.trade_name}
                  onChange={(e) => setForm((f) => ({ ...f, trade_name: e.target.value }))}
                />
              </div>
            )}
          </div>

          {/* IE + IM (só PJ) */}
          {form.person_type === "PJ" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1.5">
                  Inscrição Estadual
                  <span className="text-[10px] text-muted-foreground font-normal">(IE — opcional)</span>
                </Label>
                <Input
                  value={form.state_reg}
                  onChange={(e) => setForm((f) => ({ ...f, state_reg: e.target.value }))}
                  placeholder='000.000.000.000 ou "ISENTO"'
                />
              </div>
              <div>
                <Label className="flex items-center gap-1.5">
                  Inscrição Municipal
                  <span className="text-[10px] text-muted-foreground font-normal">(IM — opcional)</span>
                </Label>
                <Input
                  value={form.muni_reg}
                  onChange={(e) => setForm((f) => ({ ...f, muni_reg: e.target.value }))}
                  placeholder="00000000"
                />
              </div>
            </div>
          )}

          {/* Contato */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <PhoneInput
                value={form.phone}
                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                placeholder="(11) 0000-0000"
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <PhoneInput
                value={form.whatsapp}
                onChange={(v) => setForm((f) => ({ ...f, whatsapp: v }))}
                placeholder="(11) 90000-0000"
              />
            </div>
          </div>

          {/* Endereço */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2">
              <Label>CEP</Label>
              <Input
                value={form.zipcode}
                onChange={(e) => setForm((f) => ({ ...f, zipcode: maskCep(e.target.value) }))}
                onBlur={handleCepBlur}
                placeholder="00000-000"
              />
            </div>
            <div className="md:col-span-3">
              <Label>Logradouro</Label>
              <Input
                value={form.street}
                onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
              />
            </div>
            <div>
              <Label>Número</Label>
              <Input
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Complemento</Label>
              <Input
                value={form.complement}
                onChange={(e) => setForm((f) => ({ ...f, complement: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Bairro</Label>
              <Input
                value={form.district}
                onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Cidade</Label>
              <Input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div>
              <Label>UF</Label>
              <Input
                value={form.state}
                maxLength={2}
                onChange={(e) =>
                  setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))
                }
              />
            </div>
          </div>

          {/* Origem + Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Origem</Label>
              <Input
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="Indicação, site, instagram..."
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={form.active ? "1" : "0"}
                onValueChange={(v) => setForm((f) => ({ ...f, active: v === "1" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Ativo</SelectItem>
                  <SelectItem value="0">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {canManageInternalCustomers && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.is_internal}
                  onChange={(e) => setForm((f) => ({ ...f, is_internal: e.target.checked }))}
                />
                <div className="text-sm">
                  <div className="font-medium text-amber-300">Cliente interno (ativos da empresa)</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Use isso pra cadastrar a própria empresa como "cliente" para registrar
                    equipamentos internos e atribuir técnicos. Não aparece em vendas e
                    fica oculto pra vendedores.
                  </div>
                </div>
              </label>
            </div>
          )}

          <div>
            <Label>Observações</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
