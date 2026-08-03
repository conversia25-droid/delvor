import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  MessageSquare,
  RefreshCcw,
  Wifi,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  getYCloudSettings,
  saveYCloudSettings,
  testYCloudConnection,
  type YCloudEnv,
} from "@/lib/ycloud";

export default function MasterYCloud() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<"idle" | "ok" | "error">("idle");
  const [connMessage, setConnMessage] = useState<string>("");

  const [apiKey, setApiKey] = useState("");
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [n8nUrl, setN8nUrl] = useState("");
  const [n8nProxyUrl, setN8nProxyUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [secretDirty, setSecretDirty] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const [env, setEnv] = useState<YCloudEnv>("production");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getYCloudSettings();
        setApiKey(s.apiKey);
        setN8nUrl(s.n8nWebhookUrl);
        setN8nProxyUrl(s.n8nProxyUrl);
        setSecret(s.sharedSecret);
        setEnv(s.env);
        setUpdatedAt(s.updatedAt);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await saveYCloudSettings({
        apiKey,
        n8nWebhookUrl: n8nUrl.trim(),
        n8nProxyUrl: n8nProxyUrl.trim(),
        sharedSecret: secret,
        env,
      });
      setApiKeyDirty(false);
      setSecretDirty(false);
      setConnStatus("idle");
      setConnMessage("");
      toast({ title: "Configurações salvas", description: "YCloud atualizado com sucesso." });
      const s = await getYCloudSettings();
      setUpdatedAt(s.updatedAt);
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setConnStatus("idle");
    setConnMessage("");
    try {
      const r = await testYCloudConnection();
      setConnStatus(r.ok ? "ok" : "error");
      setConnMessage(r.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">YCloud (WhatsApp oficial)</h1>
          <p className="text-sm text-muted-foreground">
            Configure a API oficial do WhatsApp via YCloud, integrada pelo seu n8n self-hosted.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Credenciais e integração
          </CardTitle>
          <CardDescription>
            A chave do YCloud e o webhook do n8n são usados para enviar mensagens e receber eventos.
            Só super admins enxergam estes campos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="ycloud-api-key">API Key do YCloud</Label>
                <div className="relative">
                  <Input
                    id="ycloud-api-key"
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setApiKeyDirty(true); }}
                    placeholder="cole aqui a chave gerada no painel YCloud"
                    autoComplete="off"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-70 hover:opacity-100"
                    aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Fica salva no Supabase protegida por RLS (só super admin lê/edita).
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ycloud-n8n-url">Webhook URL do n8n (inbound)</Label>
                <Input
                  id="ycloud-n8n-url"
                  type="url"
                  value={n8nUrl}
                  onChange={(e) => setN8nUrl(e.target.value)}
                  placeholder="https://n8n.seudominio.com/webhook/ycloud"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Recebe eventos do YCloud (mensagens, status). Cadastre essa URL no painel YCloud.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ycloud-n8n-proxy-url">Webhook URL do n8n (proxy)</Label>
                <Input
                  id="ycloud-n8n-proxy-url"
                  type="url"
                  value={n8nProxyUrl}
                  onChange={(e) => setN8nProxyUrl(e.target.value)}
                  placeholder="https://n8n.seudominio.com/webhook/ycloud-proxy"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Usado pelas empresas para chamar a API YCloud (buscar números, enviar mensagem).
                  Importe o fluxo <code>n8n-ycloud-proxy.json</code> e cole a URL aqui.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ycloud-secret">Shared Secret</Label>
                <div className="relative">
                  <Input
                    id="ycloud-secret"
                    type={showSecret ? "text" : "password"}
                    value={secret}
                    onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }}
                    placeholder="token compartilhado entre CRM e n8n"
                    autoComplete="off"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-70 hover:opacity-100"
                    aria-label={showSecret ? "Ocultar secret" : "Mostrar secret"}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Enviado no header <code>Authorization: Bearer &lt;secret&gt;</code>. Valide no n8n antes de processar.
                </p>
              </div>

              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="ycloud-env">Ambiente</Label>
                <select
                  id="ycloud-env"
                  value={env}
                  onChange={(e) => setEnv(e.target.value as YCloudEnv)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="production">Produção</option>
                  <option value="sandbox">Sandbox</option>
                </select>
              </div>

              {updatedAt ? (
                <p className="text-[11px] text-muted-foreground">
                  Última atualização: {new Date(updatedAt).toLocaleString("pt-BR")}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Salvar
                </Button>
                <Button variant="outline" onClick={handleTest} disabled={testing || !n8nUrl || !secret}>
                  {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                  Testar conexão
                </Button>
                {connStatus === "ok" ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {connMessage}
                  </Badge>
                ) : connStatus === "error" ? (
                  <Badge className="border-rose-500/30 bg-rose-500/15 text-rose-300">
                    <X className="mr-1 h-3.5 w-3.5" /> {connMessage}
                  </Badge>
                ) : null}
                {(apiKeyDirty || secretDirty) ? (
                  <span className="text-[11px] text-amber-300/80 flex items-center gap-1">
                    <RefreshCcw className="h-3 w-3" /> alterações não salvas
                  </span>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Próximos passos</CardTitle>
          <CardDescription>
            Esta tela é só o alicerce. A integração completa é feita em etapas.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. <span className="text-foreground">Alicerce (feito)</span> — credenciais YCloud + webhook n8n salvos.</p>
          <p>2. <span className="text-foreground">n8n inbound</span> — fluxo que recebe eventos do YCloud e grava mensagens no Supabase.</p>
          <p>3. <span className="text-foreground">Configuração por empresa</span> — admin da empresa cadastra o número WhatsApp dele ligado ao YCloud.</p>
          <p>4. <span className="text-foreground">Templates</span> — tela para criar e submeter templates para aprovação da Meta.</p>
        </CardContent>
      </Card>
    </div>
  );
}
