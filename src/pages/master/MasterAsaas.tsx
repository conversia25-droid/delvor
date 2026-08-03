import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Wifi,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  createAsaasCustomer,
  createAsaasCharge,
  getAsaasSettings,
  saveAsaasSetting,
  testAsaasConnection,
  listAsaasCharges,
  type AsaasBillingType,
} from "@/lib/asaas";

interface CompanyRow {
  id: string;
  name: string;
  asaas_customer_id?: string | null;
  access_blocked?: boolean;
  free_access?: boolean;
}

interface ChargeRow {
  id: string;
  value: number;
  status: string;
  dueDate: string;
  billingType: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  pixQrCode?: { encodedImage: string; payload: string };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function statusBadge(status: string) {
  switch (status?.toUpperCase()) {
    case "RECEIVED":
    case "CONFIRMED":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
    case "PENDING":
      return "bg-sky-500/15 text-sky-200 border-sky-500/30";
    case "OVERDUE":
      return "bg-amber-500/15 text-amber-200 border-amber-500/30";
    case "REFUNDED":
    case "DELETED":
      return "bg-slate-500/15 text-slate-200 border-slate-500/30";
    default:
      return "bg-slate-500/15 text-slate-200 border-slate-500/30";
  }
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    PENDING: "Pendente",
    RECEIVED: "Recebido",
    CONFIRMED: "Confirmado",
    OVERDUE: "Vencido",
    REFUNDED: "Estornado",
    DELETED: "Cancelado",
    REFUND_REQUESTED: "Estorno solicitado",
  };
  return map[status?.toUpperCase()] || status || "—";
}

export default function MasterAsaas() {
  const { toast } = useToast();

  /* ── Settings ── */
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "ok" | "error">("idle");

  /* ── Companies ── */
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [search, setSearch] = useState("");

  /* ── Charges dialog ── */
  const [chargesCompany, setChargesCompany] = useState<CompanyRow | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  /* ── New charge dialog ── */
  const [newChargeCompany, setNewChargeCompany] = useState<CompanyRow | null>(null);
  const [chargeBillingType, setChargeBillingType] = useState<AsaasBillingType>("PIX");
  const [chargeValue, setChargeValue] = useState("");
  const [chargeDueDate, setChargeDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [chargeDesc, setChargeDesc] = useState("");
  const [creatingCharge, setCreatingCharge] = useState(false);

  /* ── Creating customer ── */
  const [creatingCustomer, setCreatingCustomer] = useState<string | null>(null);

  /* ─────────── Load settings ─────────── */
  useEffect(() => {
    void loadSettings();
    void loadCompanies();
  }, []);

  async function loadSettings() {
    setSettingsLoading(true);
    const settings = await getAsaasSettings();
    setApiKey(settings.apiKey || "");
    setApiKeyInput(settings.apiKey || "");
    setEnv((settings.env as "sandbox" | "production") || "sandbox");
    setSettingsLoading(false);
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      await saveAsaasSetting("asaas_api_key", apiKeyInput);
      await saveAsaasSetting("asaas_env", env);
      setApiKey(apiKeyInput);
      toast({ title: "Configurações salvas", description: "Chave Asaas atualizada com sucesso." });
      setConnectionStatus("idle");
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    }
    setSavingSettings(false);
  }

  async function testConnection() {
    setTestingConnection(true);
    try {
      await testAsaasConnection();
      setConnectionStatus("ok");
      toast({ title: "Conexão bem-sucedida!", description: "A API Asaas está respondendo corretamente." });
    } catch (err: any) {
      setConnectionStatus("error");
      toast({ title: "Erro de conexão", description: err.message, variant: "destructive" });
    }
    setTestingConnection(false);
  }

  /* ─────────── Load companies ─────────── */
  async function loadCompanies() {
    setCompaniesLoading(true);
    const { data, error } = await supabase
      .from("companies")
      .select("id,name,asaas_customer_id,access_blocked,free_access")
      .order("name", { ascending: true });

    if (error) {
      toast({ title: "Erro ao carregar empresas", description: error.message, variant: "destructive" });
    } else {
      setCompanies((data || []) as CompanyRow[]);
    }
    setCompaniesLoading(false);
  }

  /* ─────────── Create Asaas customer ─────────── */
  async function handleCreateCustomer(company: CompanyRow) {
    setCreatingCustomer(company.id);
    try {
      const result = await createAsaasCustomer({
        name: company.name,
        externalReference: company.id,
      });

      if (!result?.id) throw new Error("Resposta inesperada do Asaas");

      await supabase
        .from("companies")
        .update({ asaas_customer_id: result.id } as any)
        .eq("id", company.id);

      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, asaas_customer_id: result.id } : c))
      );

      toast({ title: "Cliente criado no Asaas", description: `ID: ${result.id}` });
    } catch (err: any) {
      toast({ title: "Erro ao criar cliente", description: err.message, variant: "destructive" });
    }
    setCreatingCustomer(null);
  }

  /* ─────────── Load charges ─────────── */
  async function openCharges(company: CompanyRow) {
    setChargesCompany(company);
    setChargesLoading(true);
    setCharges([]);
    try {
      const result = await listAsaasCharges(company.asaas_customer_id!);
      setCharges((result?.data || []) as ChargeRow[]);
    } catch (err: any) {
      toast({ title: "Erro ao carregar cobranças", description: err.message, variant: "destructive" });
    }
    setChargesLoading(false);
  }

  /* ─────────── Create charge ─────────── */
  async function handleCreateCharge() {
    if (!newChargeCompany?.asaas_customer_id) return;
    const value = parseFloat(chargeValue.replace(",", "."));
    if (!value || value <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    setCreatingCharge(true);
    try {
      const result = await createAsaasCharge({
        customer: newChargeCompany.asaas_customer_id,
        billingType: chargeBillingType,
        value,
        dueDate: chargeDueDate,
        description: chargeDesc || `Mensalidade ${newChargeCompany.name}`,
        externalReference: newChargeCompany.id,
      });

      if (!result?.id) throw new Error("Resposta inesperada do Asaas");

      // Salva a cobrança na tabela billing_invoices
      await supabase.from("billing_invoices" as any).insert({
        company_id: newChargeCompany.id,
        amount_cents: Math.round(value * 100),
        status: "open",
        due_date: chargeDueDate,
        payment_link: result.invoiceUrl || result.bankSlipUrl || null,
      } as any);

      toast({
        title: "Cobrança criada!",
        description: `${formatMoney(value)} via ${chargeBillingType} — vence ${chargeDueDate}`,
      });

      setNewChargeCompany(null);
      setChargeValue("");
      setChargeDesc("");
    } catch (err: any) {
      toast({ title: "Erro ao criar cobrança", description: err.message, variant: "destructive" });
    }
    setCreatingCharge(false);
  }

  const filtered = companies.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Asaas</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Integração de Cobrança</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Configure sua chave Asaas, crie clientes por empresa e gere cobranças via PIX ou boleto diretamente do painel master.
        </p>
      </div>

      {/* ── Settings Card ── */}
      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4 text-blue-300" /> Configuração da API</CardTitle>
          <CardDescription className="text-slate-400">
            Insira sua chave de API do Asaas. Encontre em <span className="text-blue-300">asaas.com → Integrações → Chave de API</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsLoading ? (
            <p className="text-sm text-slate-400">Carregando configurações...</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-[1fr,200px]">
                <div className="space-y-2">
                  <Label>Chave de API</Label>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="$aact_xxxxxxxxxxxxxxxxxxxxxxxx"
                      className="border-slate-700 bg-slate-950 pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Ambiente</Label>
                  <select
                    value={env}
                    onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}
                    className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
                  >
                    <option value="sandbox">Sandbox (testes)</option>
                    <option value="production">Produção</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void saveSettings()} disabled={savingSettings || !apiKeyInput}>
                  {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Salvar configurações
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void testConnection()}
                  disabled={testingConnection || !apiKey}
                >
                  {testingConnection ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wifi className="mr-2 h-4 w-4" />
                  )}
                  Testar conexão
                </Button>
                {connectionStatus === "ok" && (
                  <span className="flex items-center gap-1 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" /> Conexão OK
                  </span>
                )}
                {connectionStatus === "error" && (
                  <span className="flex items-center gap-1 text-sm text-red-300">
                    <AlertTriangle className="h-4 w-4" /> Falha na conexão
                  </span>
                )}
              </div>

              {env === "sandbox" && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <strong>Modo Sandbox:</strong> cobranças são simuladas. Mude para Produção quando estiver pronto para cobrar de verdade.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Companies ── */}
      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-blue-300" /> Empresas</CardTitle>
          <CardDescription className="text-slate-400">
            Crie clientes no Asaas para cada empresa e gere cobranças com 1 clique.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa..."
              className="border-slate-700 bg-slate-950"
            />
            <Button variant="outline" size="sm" onClick={() => void loadCompanies()}>
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="h-[520px] pr-3">
            <div className="space-y-3">
              {companiesLoading && <p className="text-sm text-slate-400">Carregando empresas...</p>}
              {!companiesLoading && !filtered.length && (
                <p className="text-sm text-slate-400">Nenhuma empresa encontrada.</p>
              )}
              {filtered.map((company) => (
                <div
                  key={company.id}
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-white">{company.name}</h3>
                        {company.access_blocked && !company.free_access && (
                          <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-xs text-red-200">
                            Bloqueada
                          </span>
                        )}
                        {company.free_access && (
                          <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-200">
                            Acesso gratuito
                          </span>
                        )}
                      </div>
                      {company.asaas_customer_id ? (
                        <p className="mt-1 text-xs text-slate-400">
                          Asaas ID: <code className="text-blue-300">{company.asaas_customer_id}</code>
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">Sem cliente no Asaas</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!company.asaas_customer_id ? (
                        <Button
                          size="sm"
                          onClick={() => void handleCreateCustomer(company)}
                          disabled={creatingCustomer === company.id || !apiKey}
                        >
                          {creatingCustomer === company.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          Criar cliente
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => {
                              setNewChargeCompany(company);
                              setChargeValue("");
                              setChargeDesc("");
                            }}
                            disabled={!apiKey}
                          >
                            <Send className="mr-2 h-4 w-4" />
                            Nova cobrança
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openCharges(company)}
                            disabled={!apiKey}
                          >
                            Ver cobranças
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── Charges list dialog ── */}
      <Dialog open={!!chargesCompany} onOpenChange={(o) => !o && setChargesCompany(null)}>
        <DialogContent className="max-w-2xl border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Cobranças — {chargesCompany?.name}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[420px] pr-3">
            {chargesLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
              </div>
            )}
            {!chargesLoading && !charges.length && (
              <p className="text-center text-sm text-slate-400 py-12">Nenhuma cobrança encontrada.</p>
            )}
            <div className="space-y-3">
              {charges.map((charge) => (
                <div key={charge.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">{formatMoney(charge.value)}</p>
                      <p className="text-xs text-slate-500">
                        {charge.billingType} · Vence {charge.dueDate}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${statusBadge(charge.status)}`}>
                      {statusLabel(charge.status)}
                    </span>
                  </div>
                  {(charge.invoiceUrl || charge.bankSlipUrl) && (
                    <div className="mt-3">
                      <Button asChild size="sm" variant="outline">
                        <a href={charge.invoiceUrl || charge.bankSlipUrl} target="_blank" rel="noreferrer">
                          Abrir link de pagamento
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargesCompany(null)}>
              <X className="mr-2 h-4 w-4" /> Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New charge dialog ── */}
      <Dialog open={!!newChargeCompany} onOpenChange={(o) => !o && setNewChargeCompany(null)}>
        <DialogContent className="max-w-md border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Nova cobrança — {newChargeCompany?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo de pagamento</Label>
              <select
                value={chargeBillingType}
                onChange={(e) => setChargeBillingType(e.target.value as AsaasBillingType)}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
              >
                <option value="PIX">PIX</option>
                <option value="BOLETO">Boleto</option>
                <option value="UNDEFINED">Qualquer (cliente escolhe)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="text"
                value={chargeValue}
                onChange={(e) => setChargeValue(e.target.value)}
                placeholder="Ex: 150,00"
                className="border-slate-700 bg-slate-950"
              />
            </div>
            <div className="space-y-2">
              <Label>Vencimento</Label>
              <Input
                type="date"
                value={chargeDueDate}
                onChange={(e) => setChargeDueDate(e.target.value)}
                className="border-slate-700 bg-slate-950"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                type="text"
                value={chargeDesc}
                onChange={(e) => setChargeDesc(e.target.value)}
                placeholder="Ex: Mensalidade abril/2026"
                className="border-slate-700 bg-slate-950"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewChargeCompany(null)}>Cancelar</Button>
            <Button onClick={() => void handleCreateCharge()} disabled={creatingCharge || !chargeValue}>
              {creatingCharge ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar cobrança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
