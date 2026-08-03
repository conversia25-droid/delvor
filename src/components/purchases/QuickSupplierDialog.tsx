import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";

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

import type { Supplier } from "@/types/delvor";
import { maskDocument, maskPhone } from "@/lib/formatters";
import { lookupCnpj, CNPJ_ERROR_MESSAGES } from "@/lib/cnpjLookup";

interface QuickSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated?: (supplier: Supplier) => void;
}

export default function QuickSupplierDialog({
  open, onOpenChange, initialName, onCreated,
}: QuickSupplierDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);

  async function handleCnpjBlur() {
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
    if (!phone && d.ddd_telefone_1) setPhone(maskPhone(d.ddd_telefone_1));
    if (!phone2 && d.ddd_telefone_2) setPhone2(maskPhone(d.ddd_telefone_2));
    if (!email && d.email) setEmail(d.email);
    toast({
      title: d.razao_social,
      description: `Situação: ${d.situacao_cadastral}${d.nome_fantasia ? ` • ${d.nome_fantasia}` : ""}`,
    });
  }
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName || "");
    setDocument(""); setPhone(""); setPhone2(""); setContactName(""); setEmail("");
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
      name: name.trim(),
      document: document.replace(/\D+/g, "") || null,
      phone: phone.replace(/\D+/g, "") || null,
      phone2: phone2.replace(/\D+/g, "") || null,
      contact_name: contactName.trim() || null,
      email: email.trim() || null,
      active: true,
    };
    const { data, error } = await supabase
      .from("suppliers" as any)
      .insert(payload)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Erro ao criar fornecedor", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fornecedor cadastrado" });
    onOpenChange(false);
    onCreated?.(data as any);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Cadastrar fornecedor
          </DialogTitle>
          <DialogDescription>
            Cadastro rápido. Você pode completar em <b>Fornecedores</b> depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Razão social *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5">
              CNPJ
              {cnpjLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
            </Label>
            <Input
              value={document}
              onChange={(e) => setDocument(maskDocument(e.target.value, "PJ"))}
              onBlur={handleCnpjBlur}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Telefone 1</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(11) 0000-0000"
              />
            </div>
            <div>
              <Label>Telefone 2</Label>
              <Input
                value={phone2}
                onChange={(e) => setPhone2(maskPhone(e.target.value))}
                placeholder="(11) 90000-0000"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contato (nome)</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
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
