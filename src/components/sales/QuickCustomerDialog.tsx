import { useEffect, useState } from "react";
import { Building2, User as UserIcon, Loader2 } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Customer, PersonType } from "@/types/delvor";
import { maskDocument, phoneToJid } from "@/lib/formatters";
import { lookupCnpj, CNPJ_ERROR_MESSAGES } from "@/lib/cnpjLookup";
import PhoneInput from "@/components/PhoneInput";

interface QuickCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nome inicial — se o user digitou no combobox antes de clicar "+ Novo". */
  initialName?: string;
  /** Chamado com o cliente recém-criado pra que o combobox o selecione. */
  onCreated?: (customer: Customer) => void;
}

/**
 * Versão simplificada do formulário de cliente, pra cadastro rápido
 * dentro de fluxos como "criar venda/OS/locação". Tem só os campos
 * essenciais; o usuário pode ir em /customers depois pra completar
 * o cadastro (endereço, observações, equipamentos, etc).
 */
export default function QuickCustomerDialog({
  open, onOpenChange, initialName, onCreated,
}: QuickCustomerDialogProps) {
  const { user } = useAuth();
  const [personType, setPersonType] = useState<PersonType>("PJ");
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);

  async function handleCnpjBlur() {
    if (personType !== "PJ") return;
    const digits = document.replace(/\D+/g, "");
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
    if (!name) setName(d.razao_social);
    toast({
      title: d.razao_social,
      description: `Situação: ${d.situacao_cadastral}${d.nome_fantasia ? ` • ${d.nome_fantasia}` : ""}`,
    });
  }
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPersonType("PJ");
    setName(initialName || "");
    setDocument("");
    setPhone("");
    setEmail("");
  }, [open, initialName]);

  async function save() {
    if (!user?.company_id) return;
    if (!name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const phoneDigits = phone.replace(/\D+/g, "") || null;
    const payload: any = {
      company_id: user.company_id,
      person_type: personType,
      name: name.trim(),
      document: document.replace(/\D+/g, "") || null,
      phone: phoneDigits,
      whatsapp: phoneDigits,
      remote_jid: phoneToJid(phoneDigits),
      email: email.trim() || null,
      active: true,
      is_internal: false,
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
    // Entrega o cliente ao pai (combobox) ANTES de fechar o dialog.
    onCreated?.(data as any);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar novo cliente</DialogTitle>
          <DialogDescription>
            Cadastro rápido. Você pode completar o endereço e outras informações em <b>Clientes</b> depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={personType} onValueChange={(v: PersonType) => { setPersonType(v); setDocument(""); }}>
                <SelectTrigger>
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {personType === "PJ"
                        ? <Building2 className="h-3.5 w-3.5" />
                        : <UserIcon className="h-3.5 w-3.5" />}
                      {personType === "PJ" ? "Pessoa Jurídica" : "Pessoa Física"}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PJ">
                    <span className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" /> Pessoa Jurídica
                    </span>
                  </SelectItem>
                  <SelectItem value="PF">
                    <span className="flex items-center gap-2">
                      <UserIcon className="h-3.5 w-3.5" /> Pessoa Física
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1.5">
                {personType === "PJ" ? "CNPJ" : "CPF"}
                {cnpjLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-700 dark:text-blue-400" />}
              </Label>
              <Input
                value={document}
                onChange={(e) => setDocument(maskDocument(e.target.value, personType))}
                onBlur={handleCnpjBlur}
                placeholder={personType === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"}
              />
            </div>
          </div>

          <div>
            <Label>{personType === "PJ" ? "Razão social *" : "Nome completo *"}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={personType === "PJ" ? "Empresa Exemplo Ltda." : "João da Silva"}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Telefone / WhatsApp</Label>
              <PhoneInput
                value={phone}
                onChange={(v) => setPhone(v)}
                placeholder="(11) 90000-0000"
              />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
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
