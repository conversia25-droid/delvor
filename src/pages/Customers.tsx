import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Users,
  Building2,
  User as UserIcon,
  MessageSquare,
  Pencil,
  Trash2,
  RefreshCw,
  Wrench,
  ExternalLink,
  Loader2,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { ensureLeadFromCustomer } from "@/lib/leads";
import MiniBars from "@/components/charts/MiniBars";
import { lookupCnpj, CNPJ_ERROR_MESSAGES } from "@/lib/cnpjLookup";
import PhoneInput from "@/components/PhoneInput";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Customer, PersonType } from "@/types/delvor";
import {
  fetchAddressByCep,
  formatCep,
  formatDocument,
  formatPhone,
  maskCep,
  maskDocument,
  maskPhone,
  phoneToJid,
} from "@/lib/formatters";

/* ====================================================================
   FORM STATE
==================================================================== */
type FormState = {
  id?: string;
  person_type: PersonType;
  name: string;
  trade_name: string;
  document: string;
  state_reg: string;   // Inscrição Estadual (IE) — só PJ
  muni_reg: string;    // Inscrição Municipal (IM) — só PJ
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

function customerToForm(c: Customer): FormState {
  return {
    id: c.id,
    person_type: c.person_type,
    name: c.name || "",
    trade_name: c.trade_name || "",
    document: formatDocument(c.document),
    state_reg: (c as any).state_reg || "",
    muni_reg: (c as any).muni_reg || "",
    email: c.email || "",
    phone: formatPhone(c.phone),
    whatsapp: formatPhone(c.whatsapp),
    zipcode: formatCep(c.zipcode),
    street: c.street || "",
    number: c.number || "",
    complement: c.complement || "",
    district: c.district || "",
    city: c.city || "",
    state: c.state || "",
    notes: c.notes || "",
    source: c.source || "",
    active: c.active,
    is_internal: !!c.is_internal,
  };
}

/* ====================================================================
   PÁGINA
==================================================================== */
export default function Customers() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const navigate = useNavigate();
  const { canManageInternalCustomers } = usePermissions();

  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | PersonType>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);
  // Quando o DELETE bate no FK (cliente tem vendas/OS), abro esse dialog
  // secundário oferecendo "desativar" em vez de excluir.
  const [cannotDelete, setCannotDelete] = useState<Customer | null>(null);

  /** Busca dados na Receita ao sair do campo CNPJ (só pra PJ). Preenche
   *  só campos vazios pra não sobrescrever digitação manual. */
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

  /* ============== LOAD ============== */
  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("customers" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      toast({
        title: "Erro ao carregar clientes",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setItems((data as any[]) ?? []);
  }

  useEffect(() => {
    load();
  }, [companyId]);

  /* ============== FILTRO ============== */
  /* Resumo da carteira: novos no mês, com WhatsApp, bloqueados e entrada por mês. */
  const summary = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    const keys = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const perMonth = new Map<string, number>();
    let newMonth = 0, withWa = 0, blocked = 0, pj = 0;
    for (const c of items as any[]) {
      const k = String(c.created_at || "").slice(0, 7);
      perMonth.set(k, (perMonth.get(k) || 0) + 1);
      if (k === monthKey) newMonth++;
      if (c.whatsapp || c.remote_jid) withWa++;
      if (c.blocked) blocked++;
      if (c.person_type === "PJ") pj++;
    }
    return {
      total: items.length, newMonth, withWa, blocked, pj,
      chart: keys.map((k) => ({
        key: k,
        label: `${MES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`,
        detail: `${MES[Number(k.slice(5, 7)) - 1]} de ${k.slice(0, 4)}`,
        value: perMonth.get(k) || 0,
      })),
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((c) => {
      // Cliente interno: vendedor/técnico não vê (não é cliente comercial real)
      if (c.is_internal && !canManageInternalCustomers) return false;
      if (filterType !== "all" && c.person_type !== filterType) return false;
      if (!q) return true;
      const blob = [
        c.name,
        c.trade_name,
        c.document,
        c.email,
        c.phone,
        c.whatsapp,
        c.city,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterType]);

  /* ============== HANDLERS ============== */
  function openNew() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(c: Customer) {
    setForm(customerToForm(c));
    setDialogOpen(true);
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
    if (!companyId) return;
    if (!form.name.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);

    const docDigits = form.document.replace(/\D+/g, "") || null;
    const wppDigits = form.whatsapp.replace(/\D+/g, "") || null;

    const payload: any = {
      company_id: companyId,
      person_type: form.person_type,
      name: form.name.trim(),
      trade_name: form.trade_name.trim() || null,
      document: docDigits,
      // IE/IM só fazem sentido pra PJ — em PF, manda null
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

    let resp;
    if (form.id) {
      resp = await supabase
        .from("customers" as any)
        .update(payload)
        .eq("id", form.id);
    } else {
      resp = await supabase.from("customers" as any).insert(payload);
    }

    setSaving(false);
    if (resp.error) {
      toast({
        title: "Erro ao salvar",
        description: resp.error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: form.id ? "Cliente atualizado" : "Cliente cadastrado" });
    setDialogOpen(false);
    load();
  }

  async function doDelete(c: Customer) {
    const { error } = await supabase
      .from("customers" as any)
      .delete()
      .eq("id", c.id);
    if (error) {
      // Postgres 23503 = foreign_key_violation. Ex: cliente tem vendas, OS,
      // locações. Não dá pra apagar sem apagar o histórico junto. Oferecemos
      // desativar em vez de mostrar o erro cru do banco pro usuário.
      const isFk = (error as any).code === "23503" || /foreign key/i.test(error.message || "");
      if (isFk) {
        setConfirmDelete(null);
        setCannotDelete(c);
        return;
      }
      toast({
        title: "Erro ao excluir",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Cliente excluído" });
    setConfirmDelete(null);
    load();
  }

  async function doDeactivate(c: Customer) {
    const { error } = await supabase
      .from("customers" as any)
      .update({ active: false })
      .eq("id", c.id);
    if (error) {
      toast({ title: "Erro ao desativar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Cliente desativado",
      description: "Fica oculto nas listagens padrão. O histórico permanece intacto.",
    });
    setCannotDelete(null);
    load();
  }

  /* ============== RENDER ============== */
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Clientes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastro de pessoas físicas e jurídicas. Vincule equipamentos para
            abrir OS mais rápido.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" /> Novo cliente
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {form.id ? "Editar cliente" : "Novo cliente"}
                </DialogTitle>
                <DialogDescription>
                  Preencha os dados de identificação, contato e endereço.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                {/* Tipo de pessoa */}
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
                      {cnpjLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-700 dark:text-blue-400" />}
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
                      {form.person_type === "PJ"
                        ? "Razão social *"
                        : "Nome completo *"}
                    </Label>
                    <Input
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder={
                        form.person_type === "PJ"
                          ? "Empresa Exemplo Ltda."
                          : "João da Silva"
                      }
                    />
                  </div>
                  {form.person_type === "PJ" && (
                    <div className="md:col-span-2">
                      <Label>Nome fantasia</Label>
                      <Input
                        value={form.trade_name}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, trade_name: e.target.value }))
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Inscrição Estadual + Municipal (só PJ) */}
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
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
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
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          zipcode: maskCep(e.target.value),
                        }))
                      }
                      onBlur={handleCepBlur}
                      placeholder="00000-000"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Label>Logradouro</Label>
                    <Input
                      value={form.street}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, street: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Número</Label>
                    <Input
                      value={form.number}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, number: e.target.value }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Complemento</Label>
                    <Input
                      value={form.complement}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, complement: e.target.value }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Bairro</Label>
                    <Input
                      value={form.district}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, district: e.target.value }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Cidade</Label>
                    <Input
                      value={form.city}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, city: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>UF</Label>
                    <Input
                      value={form.state}
                      maxLength={2}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          state: e.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </div>
                </div>

                {/* Origem + Notas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Origem</Label>
                    <Input
                      value={form.source}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, source: e.target.value }))
                      }
                      placeholder="Indicação, site, instagram..."
                    />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select
                      value={form.active ? "1" : "0"}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, active: v === "1" }))
                      }
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

                {/* Cliente interno — só admin/gerente vê e marca */}
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
                        <div className="font-medium text-amber-700 dark:text-amber-300">Cliente interno (ativos da empresa)</div>
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
                    onChange={(e) =>
                      setForm((f) => ({ ...f, notes: e.target.value }))
                    }
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Resumo da carteira */}
      {summary.total > 0 && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[10px] border bg-card p-4">
              <div className="text-xs text-muted-foreground">Clientes cadastrados</div>
              <div className="text-2xl font-semibold tracking-tight mt-1">{summary.total.toLocaleString("pt-BR")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{summary.pj} PJ · {summary.total - summary.pj} PF</div>
            </div>
            <div className="rounded-[10px] border bg-card p-4">
              <div className="text-xs text-muted-foreground">Novos no mês</div>
              <div className="text-2xl font-semibold tracking-tight mt-1">{summary.newMonth}</div>
            </div>
            <div className="rounded-[10px] border bg-card p-4">
              <div className="text-xs text-muted-foreground">Com WhatsApp</div>
              <div className="text-2xl font-semibold tracking-tight mt-1">{summary.withWa}</div>
              <div className="mt-1 text-xs text-muted-foreground">{Math.round((summary.withWa / summary.total) * 100)}% da carteira</div>
            </div>
            <div className="rounded-[10px] border bg-card p-4">
              <div className="text-xs text-muted-foreground">Bloqueados</div>
              <div className="text-2xl font-semibold tracking-tight mt-1">{summary.blocked}</div>
              <div className="mt-1 text-xs text-muted-foreground">{summary.blocked ? "inadimplência ou outro motivo" : "nenhum"}</div>
            </div>
          </div>
          <MiniBars
            title="Clientes novos por mês"
            sub="últimos 6 meses"
            data={summary.chart}
            format={(v) => v.toLocaleString("pt-BR")}
            height={176}
            showValues
            empty="Nenhum cliente novo nos últimos 6 meses."
          />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, CNPJ/CPF, e-mail, telefone, cidade..."
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={(v: any) => setFilterType(v)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="PJ">Apenas PJ</SelectItem>
            <SelectItem value="PF">Apenas PF</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">
          {filtered.length} de {items.length}
        </Badge>
      </div>

      {/* Tabela */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>CNPJ / CPF</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Cidade / UF</TableHead>
              <TableHead className="w-44 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className={c.active ? "" : "opacity-50"}
                >
                  <TableCell>
                    {c.person_type === "PJ" ? (
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5">
                        {c.name}
                        {c.is_internal && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30 text-[10px] py-0">
                            Interno
                          </Badge>
                        )}
                      </span>
                      {c.trade_name && (
                        <span className="text-xs text-muted-foreground">
                          {c.trade_name}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDocument(c.document)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-xs">
                      {c.email && <span>{c.email}</span>}
                      {c.phone && <span>{formatPhone(c.phone)}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.city ? `${c.city}${c.state ? "/" + c.state : ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(`/customers/${c.id}`)}
                        title="Ver detalhes / equipamentos / OS"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      {c.remote_jid && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Abrir conversa no WhatsApp"
                          onClick={async () => {
                            // Resolve o lead existente (ou cria) antes de navegar —
                            // assim a URL já sai como /chat?leadId=X e abre o lead certo,
                            // sem flash de "contato novo" no inbox.
                            if (companyId) {
                              const r = await ensureLeadFromCustomer({ companyId, customerId: c.id });
                              if (r.ok && r.leadId) { navigate(`/chat?leadId=${r.leadId}`); return; }
                              if (r.ok && r.jid)    { navigate(`/chat?jid=${encodeURIComponent(r.jid)}`); return; }
                            }
                            navigate(`/chat?jid=${encodeURIComponent(c.remote_jid!)}`);
                          }}
                        >
                          <MessageSquare className="h-4 w-4 text-emerald-500" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(`/service-orders/new?customer=${c.id}`)}
                        title="Abrir nova OS"
                      >
                        <Wrench className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(c)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDelete(c)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {/* Confirm delete */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o cliente <b>{confirmDelete?.name}</b> e todos os
              equipamentos vinculados. Não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cannot delete: FK barrou porque cliente tem vendas/OS/locações.
          Oferece desativar (soft delete) em vez de mostrar erro cru. */}
      <AlertDialog
        open={!!cannotDelete}
        onOpenChange={(o) => !o && setCannotDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Não é possível excluir</AlertDialogTitle>
            <AlertDialogDescription>
              <b>{cannotDelete?.name}</b> tem vendas, ordens de serviço ou
              locações vinculadas — excluir apagaria esse histórico junto.
              <br /><br />
              Você pode <b>desativar</b> o cliente: ele fica oculto nas
              listagens padrão, mas o histórico permanece intacto e recuperável.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => cannotDelete && doDeactivate(cannotDelete)}
            >
              Desativar cliente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
