import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Phone,
  Trash2,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  Key,
  RefreshCcw,
  Unplug,
  CheckCircle2,
  XCircle,
  ExternalLink,
  QrCode,
  Smartphone,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCompanyCredentials,
  saveCompanyCredentials,
  deleteCompanyCredentials,
  listPhoneNumbers,
  importPhoneNumbers,
  requestCoexistenceQr,
  getPhoneStatus,
  getYCloudUsage,
  type CompanyYCloudCredentials,
  type YCloudPhoneFromApi,
  type YCloudUsage,
} from "@/lib/ycloudCompany";

interface YCloudPhoneNumber {
  id: string;
  company_id: string;
  waba_id: string | null;
  phone_number_id: string;
  display_phone: string | null;
  verified_name: string | null;
  active: boolean;
  quality_rating: string | null;
  notes: string | null;
  coexistence_status?: "unlinked" | "pending" | "linked" | "failed" | null;
  coexistence_linked_at?: string | null;
  coexistence_pending_at?: string | null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Step = "loading" | "not_connected" | "connected";

export function WhatsAppOfficialInstances({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [step, setStep] = useState<Step>("loading");
  const [credentials, setCredentials] = useState<CompanyYCloudCredentials | null>(null);
  const [savedRows, setSavedRows] = useState<YCloudPhoneNumber[]>([]);

  // Connect form
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discoveredPhones, setDiscoveredPhones] = useState<YCloudPhoneFromApi[] | null>(null);
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState(false);

  // Connected state actions
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Uso (billing) do mês corrente
  const [usage, setUsage] = useState<YCloudUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState<boolean>(false);

  // QR / Coexistence Mode
  const [qrTarget, setQrTarget] = useState<YCloudPhoneNumber | null>(null);
  const [qrLoading, setQrLoading] = useState<boolean>(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrPolling, setQrPolling] = useState<boolean>(false);
  const [qrLinked, setQrLinked] = useState<boolean>(false);

  useEffect(() => {
    if (open && companyId) void loadState();
    if (!open) {
      setApiKeyInput("");
      setShowKey(false);
      setDiscoveredPhones(null);
      setSelectedImport(new Set());
    }
  }, [open, companyId]);

  async function loadState() {
    if (!companyId) return;
    setStep("loading");
    const creds = await getCompanyCredentials(companyId);
    setCredentials(creds);
    if (creds && creds.apiKey) {
      await Promise.all([fetchSavedRows(), fetchUsage()]);
      setStep("connected");
    } else {
      setSavedRows([]);
      setStep("not_connected");
    }
  }

  async function fetchUsage() {
    if (!companyId) return;
    setUsageLoading(true);
    try {
      const u = await getYCloudUsage(companyId);
      setUsage(u);
    } finally {
      setUsageLoading(false);
    }
  }

  async function fetchSavedRows() {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("ycloud_phone_numbers" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Erro ao carregar números:", error);
      return;
    }
    setSavedRows((data || []) as YCloudPhoneNumber[]);
  }

  async function handleTestAndDiscover() {
    const key = apiKeyInput.trim();
    if (!key) {
      toast({ title: "Informe a API key", variant: "destructive" });
      return;
    }
    setTesting(true);
    setDiscoveredPhones(null);
    setSelectedImport(new Set());
    try {
      const res = await listPhoneNumbers(key);
      if (!res.ok) {
        toast({
          title: "Falha ao conectar",
          description: res.message || res.error || "Verifique a API key.",
          variant: "destructive",
        });
        return;
      }
      const phones = res.phones || [];
      setDiscoveredPhones(phones);
      if (phones.length === 0) {
        toast({
          title: "Conectado, mas sem números",
          description: "A API key é válida, mas não há números WhatsApp cadastrados no YCloud ainda.",
        });
      } else {
        // Select all by default
        setSelectedImport(new Set(phones.map((p) => p.phone_number_id).filter(Boolean)));
        toast({
          title: "Conectado",
          description: `${phones.length} ${phones.length === 1 ? "número encontrado" : "números encontrados"}.`,
        });
      }
    } catch (e: any) {
      toast({
        title: "Erro",
        description: e?.message || "Falha ao testar.",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect() {
    if (!companyId) return;
    const key = apiKeyInput.trim();
    const phones = discoveredPhones || [];
    const selected = phones.filter((p) => selectedImport.has(p.phone_number_id));

    setConnecting(true);
    try {
      await saveCompanyCredentials(companyId, key, { ok: true });

      if (selected.length > 0) {
        const r = await importPhoneNumbers(companyId, selected);
        if (r.errors.length > 0) {
          toast({
            title: `Importado ${r.inserted}/${selected.length}`,
            description: r.errors.slice(0, 2).join("; "),
            variant: "destructive",
          });
        } else {
          toast({
            title: "Conectado",
            description: `${r.inserted} ${r.inserted === 1 ? "número importado" : "números importados"}.`,
          });
        }
      } else {
        toast({
          title: "Conectado",
          description: "Credenciais salvas. Importe números depois se quiser.",
        });
      }

      await loadState();
    } catch (e: any) {
      toast({
        title: "Erro",
        description: e?.message || "Falha ao salvar.",
        variant: "destructive",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleRefresh() {
    if (!companyId) return;
    setRefreshing(true);
    try {
      const res = await listPhoneNumbers();
      if (!res.ok) {
        toast({
          title: "Falha ao buscar",
          description: res.message || res.error || "Verifique a API key.",
          variant: "destructive",
        });
        return;
      }
      const phones = res.phones || [];
      if (phones.length === 0) {
        toast({ title: "Nenhum número no YCloud", description: "Lista vazia." });
        return;
      }
      const r = await importPhoneNumbers(companyId, phones);
      toast({
        title: "Atualizado",
        description: `${r.inserted} ${r.inserted === 1 ? "número sincronizado" : "números sincronizados"}.`,
      });
      await fetchSavedRows();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao atualizar.", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDisconnect() {
    if (!companyId) return;
    if (!confirm("Desconectar do YCloud? A API key será removida. Os números importados continuam no CRM.")) {
      return;
    }
    setDisconnecting(true);
    try {
      await deleteCompanyCredentials(companyId);
      toast({ title: "Desconectado", description: "API key removida." });
      await loadState();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao desconectar.", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleDeleteRow(id: string) {
    if (!confirm("Remover este número do CRM? (Ele continua no YCloud.)")) return;
    setDeletingId(id);
    try {
      const { error } = await supabase
        .from("ycloud_phone_numbers" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Removido" });
      await fetchSavedRows();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao remover.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(row: YCloudPhoneNumber) {
    try {
      const { error } = await supabase
        .from("ycloud_phone_numbers" as any)
        .update({ active: !row.active })
        .eq("id", row.id);
      if (error) throw error;
      await fetchSavedRows();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha.", variant: "destructive" });
    }
  }

  async function handleRequestQr(row: YCloudPhoneNumber) {
    setQrTarget(row);
    setQrLoading(true);
    setQrCode(null);
    setQrImageUrl(null);
    setQrError(null);
    setQrLinked(false);
    try {
      const r = await requestCoexistenceQr(row.phone_number_id);
      if (!r.ok) {
        setQrError(r.message || r.error || "Falha ao gerar QR Code.");
        return;
      }
      setQrCode(r.qr_code || null);
      setQrImageUrl(r.qr_image_url || null);
      // Atualiza status local pra "pending"
      await fetchSavedRows();
    } catch (e: any) {
      setQrError(e?.message || "Falha ao gerar QR Code.");
    } finally {
      setQrLoading(false);
    }
  }

  function closeQrModal() {
    setQrTarget(null);
    setQrCode(null);
    setQrImageUrl(null);
    setQrError(null);
    setQrLinked(false);
    setQrPolling(false);
  }

  // Polling do status enquanto o modal QR está aberto e ainda não pareou
  useEffect(() => {
    if (!qrTarget) return;
    if (qrLinked) return;
    if (qrError) return;

    let alive = true;
    setQrPolling(true);
    const interval = setInterval(async () => {
      if (!alive) return;
      try {
        const r = await getPhoneStatus(qrTarget.phone_number_id);
        if (!alive) return;
        if (r.ok && r.linked) {
          setQrLinked(true);
          setQrPolling(false);
          await fetchSavedRows();
          toast({
            title: "Conectado!",
            description: "O número foi pareado com sucesso via QR Code.",
          });
          // Fecha automaticamente após 2s
          setTimeout(() => { if (alive) closeQrModal(); }, 2000);
        }
      } catch {
        // silencia falhas individuais de polling
      }
    }, 3000); // poll a cada 3s

    return () => { alive = false; clearInterval(interval); setQrPolling(false); };
  }, [qrTarget, qrLinked, qrError]);

  function toggleSelected(id: string) {
    setSelectedImport((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function coexistenceBadge(status: YCloudPhoneNumber["coexistence_status"]) {
    if (!status || status === "unlinked") {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 bg-zinc-600/15 text-zinc-700 ring-zinc-500/30">
          <Smartphone className="h-2.5 w-2.5" /> Não pareado
        </span>
      );
    }
    if (status === "pending") {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 bg-amber-500/15 text-amber-700 ring-amber-500/30">
          <QrCode className="h-2.5 w-2.5" /> Aguardando QR
        </span>
      );
    }
    if (status === "linked") {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 bg-emerald-600/15 text-emerald-700 ring-emerald-500/30">
          <CheckCircle2 className="h-2.5 w-2.5" /> Pareado
        </span>
      );
    }
    if (status === "failed") {
      return (
        <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 bg-red-600/15 text-red-700 ring-red-500/30">
          <XCircle className="h-2.5 w-2.5" /> Falhou
        </span>
      );
    }
    return null;
  }

  function qualityBadge(q: string | null) {
    if (!q) return null;
    const map: Record<string, string> = {
      GREEN: "bg-emerald-600/15 text-emerald-700 ring-emerald-500/30",
      YELLOW: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
      RED: "bg-red-600/15 text-red-700 ring-red-500/30",
    };
    const cls = map[q.toUpperCase()] || "bg-zinc-600/15 text-zinc-700 ring-zinc-500/30";
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
        {q.toUpperCase()}
      </span>
    );
  }

  const hasDiscovered = discoveredPhones !== null && discoveredPhones.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-sky-600" />
            WhatsApp Business API (Oficial)
          </DialogTitle>
          <DialogDescription>
            Conecte a conta YCloud da sua empresa para usar o WhatsApp oficial.
          </DialogDescription>
        </DialogHeader>

        {step === "loading" && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Carregando…
          </div>
        )}

        {/* ──────────── NOT CONNECTED ──────────── */}
        {step === "not_connected" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-sky-50 border-sky-200 p-3 text-xs text-sky-900">
              <p className="font-semibold mb-1 flex items-center gap-1">
                <Key className="h-3.5 w-3.5" />
                Como conectar
              </p>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>
                  Crie uma conta em{" "}
                  <a
                    href="https://www.ycloud.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline inline-flex items-center gap-0.5"
                  >
                    ycloud.com
                    <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  (se ainda não tem).
                </li>
                <li>No painel YCloud, vá em <strong>Developer → API Keys</strong> e copie a chave.</li>
                <li>Cole abaixo e clique em "Testar e buscar números".</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ycloud-api-key">API key do YCloud</Label>
              <div className="relative">
                <Input
                  id="ycloud-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="cole aqui a API key do seu painel YCloud"
                  autoComplete="off"
                  className="pr-10"
                  disabled={testing || connecting}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-70 hover:opacity-100"
                  aria-label={showKey ? "Ocultar" : "Mostrar"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A chave fica salva no Supabase, protegida por RLS (só sua empresa acessa).
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleTestAndDiscover} disabled={testing || connecting || !apiKeyInput.trim()}>
                {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Testar e buscar números
              </Button>
            </div>

            {/* Discovered phones */}
            {discoveredPhones !== null && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2 mb-2">
                  {discoveredPhones.length > 0 ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-semibold">
                        {discoveredPhones.length} {discoveredPhones.length === 1 ? "número encontrado" : "números encontrados"}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Selecione quais importar
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span className="text-sm">Chave válida, mas nenhum número encontrado no YCloud.</span>
                    </>
                  )}
                </div>

                {hasDiscovered && (
                  <ScrollArea className="max-h-[220px] pr-2">
                    <div className="space-y-1.5">
                      {discoveredPhones!.map((p) => (
                        <label
                          key={p.phone_number_id}
                          className="flex items-start gap-2 p-2 rounded border bg-background cursor-pointer hover:bg-accent"
                        >
                          <Checkbox
                            checked={selectedImport.has(p.phone_number_id)}
                            onCheckedChange={() => toggleSelected(p.phone_number_id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm truncate">
                                {p.display_phone || p.phone_number_id}
                              </p>
                              {p.verified_name && (
                                <Badge variant="secondary" className="text-[10px] h-5">
                                  {p.verified_name}
                                </Badge>
                              )}
                              {qualityBadge(p.quality_rating)}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                              <code className="font-mono">{p.phone_number_id}</code>
                              {p.waba_id && <> · WABA: <code className="font-mono">{p.waba_id}</code></>}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                <div className="flex justify-end gap-2 mt-3">
                  <Button onClick={handleConnect} disabled={connecting}>
                    {connecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {hasDiscovered
                      ? `Conectar e importar ${selectedImport.size}`
                      : "Conectar mesmo assim"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ──────────── CONNECTED ──────────── */}
        {step === "connected" && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-900">Conectado ao YCloud</p>
                <p className="text-[11px] text-emerald-700">
                  API key salva
                  {credentials?.lastTestAt && ` · último teste em ${new Date(credentials.lastTestAt).toLocaleString("pt-BR")}`}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1" />}
                Buscar atualizações
              </Button>
            </div>

            {/* Uso do mês */}
            {usage && (
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Uso este mês ({new Date().toLocaleDateString("pt-BR", { month: "long" })})
                  </p>
                  <button
                    type="button"
                    onClick={fetchUsage}
                    disabled={usageLoading}
                    className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    title="Atualizar"
                  >
                    {usageLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                    Atualizar
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-[10px] text-muted-foreground">Recebidas</p>
                    <p className="text-lg font-bold">{usage.msgs_received}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-[10px] text-muted-foreground">Enviadas</p>
                    <p className="text-lg font-bold">{usage.msgs_sent}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-[10px] text-muted-foreground">Templates</p>
                    <p className="text-lg font-bold">{usage.templates_sent}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-[10px] text-muted-foreground">Contatos únicos</p>
                    <p className="text-lg font-bold">{usage.unique_contacts}</p>
                  </div>
                </div>

                {/* Barra de cota grátis (1000 service conversations/mês) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">
                      Cota grátis (atendimentos iniciados pelo cliente)
                    </span>
                    <span className="font-mono">
                      {usage.service_conversations}/{usage.service_quota_free}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        usage.service_quota_used_pct >= 90
                          ? "bg-red-500"
                          : usage.service_quota_used_pct >= 70
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, usage.service_quota_used_pct)}%` }}
                    />
                  </div>
                  {usage.service_quota_used_pct >= 90 && (
                    <p className="text-[10px] text-red-700 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Você está perto do limite grátis. Acima disso, cada conversation é cobrada.
                    </p>
                  )}
                </div>

                <p className="text-[10px] text-muted-foreground italic">
                  * Atendimentos = clientes únicos por dia. Templates abrem conversation paga separada.
                  Valores são aproximados — fatura oficial vem do YCloud.
                </p>
              </div>
            )}

            <ScrollArea className="max-h-[360px] pr-2">
              {savedRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum número importado.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clique em "Buscar atualizações" para importar do YCloud.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {savedRows.map((row) => (
                    <div
                      key={row.id}
                      className={`rounded-lg border p-3 flex items-start gap-3 ${
                        row.active ? "bg-background" : "bg-muted/40 opacity-70"
                      }`}
                    >
                      <div className="mt-0.5 rounded-full bg-sky-600/15 p-2">
                        <Phone className="h-4 w-4 text-sky-700" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">
                            {row.display_phone || row.phone_number_id}
                          </p>
                          {row.verified_name && (
                            <Badge variant="secondary" className="text-[10px] h-5">
                              {row.verified_name}
                            </Badge>
                          )}
                          {qualityBadge(row.quality_rating)}
                          {coexistenceBadge(row.coexistence_status)}
                          {!row.active && (
                            <Badge variant="outline" className="text-[10px] h-5">Inativo</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          <code className="font-mono">{row.phone_number_id}</code>
                          {row.waba_id && <> · WABA: <code className="font-mono">{row.waba_id}</code></>}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {row.coexistence_status !== "linked" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 gap-1 text-[11px]"
                            onClick={() => handleRequestQr(row)}
                            title="Parear via QR Code (Coexistence Mode)"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            QR
                          </Button>
                        )}
                        <Switch
                          checked={row.active}
                          onCheckedChange={() => handleToggleActive(row)}
                          aria-label="Ativo"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                          onClick={() => handleDeleteRow(row.id)}
                          disabled={deletingId === row.id}
                          aria-label="Remover"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex justify-end pt-1 border-t">
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Unplug className="h-3.5 w-3.5 mr-1" />
                )}
                Desconectar do YCloud
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      {/* ──────────── MODAL DO QR CODE (COEXISTENCE) ──────────── */}
      <Dialog open={!!qrTarget} onOpenChange={(v) => { if (!v) closeQrModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-sky-600" />
              Parear via QR Code
            </DialogTitle>
            <DialogDescription>
              {qrTarget?.display_phone || qrTarget?.phone_number_id}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {qrLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Gerando QR Code…</p>
              </div>
            )}

            {qrError && (
              <div className="rounded-lg border bg-red-50 border-red-200 p-3">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-900">
                    <p className="font-semibold">Falha ao gerar QR</p>
                    <p className="text-xs mt-0.5">{qrError}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => qrTarget && handleRequestQr(qrTarget)}
                >
                  <RefreshCcw className="h-3.5 w-3.5 mr-1" />
                  Tentar novamente
                </Button>
              </div>
            )}

            {qrLinked && (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="rounded-full bg-emerald-100 p-3 mb-3">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                </div>
                <p className="text-lg font-semibold text-emerald-900">Conectado!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  O número foi pareado com sucesso.
                </p>
              </div>
            )}

            {!qrLoading && !qrError && !qrLinked && (qrCode || qrImageUrl) && (
              <>
                <div className="flex flex-col items-center justify-center bg-white rounded-lg p-4 border">
                  {qrImageUrl ? (
                    <img
                      src={qrImageUrl}
                      alt="QR Code de pareamento"
                      className="w-56 h-56 object-contain"
                    />
                  ) : qrCode && qrCode.startsWith("data:image") ? (
                    <img
                      src={qrCode}
                      alt="QR Code de pareamento"
                      className="w-56 h-56 object-contain"
                    />
                  ) : qrCode ? (
                    // QR como string raw (precisa renderizar via lib qrcode)
                    // Por enquanto exibe a string crua + sugere renderização
                    <div className="text-[10px] font-mono break-all bg-muted/30 p-2 rounded max-w-full">
                      {qrCode}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border bg-sky-50 border-sky-200 p-3 text-xs text-sky-900 space-y-1">
                  <p className="font-semibold">Como escanear:</p>
                  <ol className="list-decimal ml-4 space-y-0.5">
                    <li>Abra o app <strong>WhatsApp Business</strong> no celular</li>
                    <li>Toque em <strong>Configurações → Aparelhos conectados</strong></li>
                    <li>Toque em <strong>Conectar um aparelho</strong></li>
                    <li>Escaneie o QR Code acima</li>
                  </ol>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  {qrPolling ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Aguardando você escanear…
                    </>
                  ) : (
                    <span>QR pronto. Escaneie no app WhatsApp Business.</span>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end pt-2 border-t">
              <Button size="sm" variant="ghost" onClick={closeQrModal}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
