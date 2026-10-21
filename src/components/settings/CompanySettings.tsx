import { useEffect, useState } from "react";
import { Building2, Save, Loader2, Image as ImageIcon } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import {
  fetchAddressByCep,
  formatCep,
  formatDocument,
  formatPhone,
  maskCep,
  maskDocument,
  maskPhone,
} from "@/lib/formatters";
import { lookupCnpj, CNPJ_ERROR_MESSAGES } from "@/lib/cnpjLookup";
import ImageUpload from "@/components/products/ImageUpload";

type CompanyForm = {
  name: string;
  cnpj: string;
  state_reg: string;   // Inscrição Estadual (IE)
  muni_reg: string;    // Inscrição Municipal (IM)
  email: string;
  phone: string;
  logo_url: string | null;
  zipcode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};

const EMPTY: CompanyForm = {
  name: "", cnpj: "", state_reg: "", muni_reg: "", email: "", phone: "", logo_url: null,
  zipcode: "", street: "", number: "", complement: "",
  district: "", city: "", state: "",
};

export default function CompanySettings() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [form, setForm] = useState<CompanyForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("companies" as any)
        .select("name, cnpj, state_reg, muni_reg, email, phone, logo_url, address")
        .eq("id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const c: any = data;
        const addr = c.address || {};
        setForm({
          name: c.name || "",
          cnpj: formatDocument(c.cnpj),
          state_reg: c.state_reg || "",
          muni_reg: c.muni_reg || "",
          email: c.email || "",
          phone: formatPhone(c.phone),
          logo_url: c.logo_url || null,
          zipcode: formatCep(addr.zipcode),
          street: addr.street || "",
          number: addr.number || "",
          complement: addr.complement || "",
          district: addr.district || "",
          city: addr.city || "",
          state: addr.state || "",
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

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

  /** Consulta CNPJ na BrasilAPI quando o campo perde o foco. Preenche
   *  só campos vazios pra não sobrescrever ajustes manuais. Razão social
   *  sempre vira a forma canônica da Receita. */
  async function handleCnpjBlur() {
    const digits = form.cnpj.replace(/\D+/g, "");
    if (digits.length !== 14) return;
    setCnpjLoading(true);
    const r = await lookupCnpj(digits);
    setCnpjLoading(false);
    if (!r.ok) {
      // Erro só vira toast se for algo "informativo" (não-encontrado, rate-limit, etc.)
      if (r.error !== "invalid_cnpj") {
        toast({ title: CNPJ_ERROR_MESSAGES[r.error], variant: "destructive" });
      }
      return;
    }
    const d = r.data;
    setForm((f) => ({
      ...f,
      name: d.razao_social || f.name,
      phone: f.phone || (d.ddd_telefone_1 ? maskPhone(d.ddd_telefone_1) : ""),
      email: f.email || d.email || "",
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

  async function save() {
    if (!companyId) return;
    if (!form.name.trim()) {
      toast({ title: "Informe a razão social", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      cnpj: form.cnpj.replace(/\D+/g, "") || null,
      state_reg: form.state_reg.trim() || null,
      muni_reg: form.muni_reg.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.replace(/\D+/g, "") || null,
      logo_url: form.logo_url,
      address: {
        zipcode: form.zipcode.replace(/\D+/g, "") || null,
        street: form.street.trim() || null,
        number: form.number.trim() || null,
        complement: form.complement.trim() || null,
        district: form.district.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
      },
    };
    const { error } = await supabase.from("companies" as any).update(payload).eq("id", companyId);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Dados da empresa atualizados" });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Bloco 1: Identificação */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          <h2 className="text-lg font-semibold">Identificação</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Esses dados aparecem no cabeçalho dos PDFs de OS e venda, e em mensagens enviadas ao cliente.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-6">
          <div>
            <Label className="mb-2 block flex items-center gap-1">
              <ImageIcon className="h-3 w-3" /> Logo
            </Label>
            <ImageUpload
              bucket="company-logos"
              folder={companyId || undefined}
              value={form.logo_url}
              onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))}
              placeholder="Logo da empresa (até 5MB)"
            />
          </div>

          <div className="space-y-3">
            <div>
              <Label>Razão social *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Empresa Exemplo Ltda." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1.5">
                  CNPJ
                  {cnpjLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-700 dark:text-blue-400" />}
                </Label>
                <Input
                  value={form.cnpj}
                  onChange={(e) => setForm((f) => ({ ...f, cnpj: maskDocument(e.target.value, "PJ") }))}
                  onBlur={handleCnpjBlur}
                  placeholder="00.000.000/0000-00"
                  title="Sai do campo (TAB ou clique fora) que ele busca os dados na Receita"
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))}
                  placeholder="(11) 0000-0000"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label>E-mail comercial</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="contato@empresa.com.br" />
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* Bloco 2: Endereço */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Endereço</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Aparece no rodapé dos PDFs.
        </p>

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
            <Input value={form.street} onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))} />
          </div>
          <div>
            <Label>Número</Label>
            <Input value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <Label>Complemento</Label>
            <Input value={form.complement} onChange={(e) => setForm((f) => ({ ...f, complement: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <Label>Bairro</Label>
            <Input value={form.district} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <Label>Cidade</Label>
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </div>
          <div>
            <Label>UF</Label>
            <Input
              value={form.state}
              maxLength={2}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Salvar dados da empresa
        </Button>
      </div>
    </div>
  );
}
