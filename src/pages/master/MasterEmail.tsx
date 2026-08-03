import { useEffect, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mail, Send, Loader2, CheckCircle2, XCircle, RefreshCcw, Clock, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  sendEmail, listEmailLogs, buildSimpleEmailHtml, type EmailLog,
} from "@/lib/email";

const DEFAULT_HTML = `<!doctype html>
<html><body>
  <h2>Email de teste</h2>
  <p>Olá! Este é um email de teste enviado via Edge Function do CRM.</p>
  <p>Se você está vendo isso na sua caixa, o pipeline está funcionando.</p>
  <hr>
  <p style="color:#888;font-size:12px">Enviado em ${new Date().toLocaleString("pt-BR")}</p>
</body></html>`;

function statusBadge(s: EmailLog["status"]) {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    pending: { cls: "bg-zinc-500/15 text-zinc-700 ring-zinc-500/30", icon: Clock, label: "Pendente" },
    sending: { cls: "bg-amber-500/15 text-amber-700 ring-amber-500/30", icon: Loader2, label: "Enviando" },
    sent: { cls: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30", icon: CheckCircle2, label: "Enviado" },
    failed: { cls: "bg-red-500/15 text-red-700 ring-red-500/30", icon: XCircle, label: "Falhou" },
  };
  const c = map[s] || map.pending;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${c.cls}`}>
      <Icon className={`h-3 w-3 ${s === "sending" ? "animate-spin" : ""}`} />
      {c.label}
    </span>
  );
}

export default function MasterEmail() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [to, setTo] = useState<string>(user?.email || "");
  const [subject, setSubject] = useState("[Teste] Pipeline de email do CRM");
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  useEffect(() => {
    void loadLogs();
  }, []);

  async function loadLogs() {
    setLoadingLogs(true);
    try {
      const list = await listEmailLogs(undefined, 50);
      setLogs(list);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function handleSendTest() {
    if (!to.trim()) {
      toast({ title: "Informe um destinatário", variant: "destructive" });
      return;
    }
    setSending(true);
    setLastResult(null);
    try {
      const r = await sendEmail({
        to: to.trim(),
        subject: subject.trim() || "(sem assunto)",
        html,
        context_type: "test",
      });
      setLastResult({ ok: r.ok, message: r.message || (r.ok ? "Enviado!" : r.error) });
      if (r.ok) {
        toast({ title: "Email enviado", description: `Verifique a caixa de ${to}` });
      } else {
        toast({
          title: "Falha ao enviar",
          description: r.message || r.error || "Veja detalhes no card de status.",
          variant: "destructive",
        });
      }
      // Recarrega logs após 1s pra dar tempo do INSERT propagar
      setTimeout(() => { void loadLogs(); }, 1000);
    } finally {
      setSending(false);
    }
  }

  function loadHtmlExample(kind: "simple" | "boleto") {
    if (kind === "simple") {
      setSubject("[Teste] Email simples padronizado");
      setHtml(buildSimpleEmailHtml({
        title: "Bem-vindo!",
        greeting: "Olá Cliente,",
        body: "<p>Este é um exemplo de email padronizado do CRM.</p><p>Você pode usar este formato como base pra qualquer comunicação.</p>",
        ctaText: "Acessar painel",
        ctaUrl: "https://app.zapcompany.com.br",
        footer: "Este email foi enviado automaticamente. Não responda.",
      }));
    } else if (kind === "boleto") {
      setSubject("Seu boleto chegou - Vencimento em 5 dias");
      setHtml(buildSimpleEmailHtml({
        title: "Boleto disponível",
        greeting: "Olá Dr. Cliente,",
        body: `<p>Segue o boleto referente à <strong>mensalidade de abril/2026</strong>.</p>
               <p><strong>Valor:</strong> R$ 350,00<br><strong>Vencimento:</strong> 04/05/2026</p>
               <p>Pague pelo link abaixo, copie o código de barras ou use o QR PIX.</p>`,
        ctaText: "📄 Visualizar boleto",
        ctaUrl: "https://www.asaas.com/c/exemplo",
        footer: "Em caso de dúvidas, responda este email ou nos chame no WhatsApp.",
      }));
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Email Transacional</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline de envio de emails (boletos, lembretes, notificações) via Edge Function + Zoho SMTP.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Teste de envio */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4" />
              Testar envio
            </CardTitle>
            <CardDescription>
              Mande um email de teste pra validar que SMTP, DNS e Edge Function estão OK.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="to">Para</Label>
              <Input id="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="seuemail@exemplo.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="subject">Assunto</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <button type="button" onClick={() => loadHtmlExample("simple")} className="text-primary hover:underline">
                ✨ Carregar exemplo padronizado
              </button>
              <span className="text-muted-foreground">·</span>
              <button type="button" onClick={() => loadHtmlExample("boleto")} className="text-primary hover:underline">
                📄 Carregar exemplo de boleto
              </button>
            </div>

            <div className="space-y-1">
              <Label htmlFor="html">HTML</Label>
              <Textarea
                id="html"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleSendTest} disabled={sending || !to.trim()}>
                {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar teste
              </Button>
              {lastResult && (
                <span className={`text-xs ${lastResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {lastResult.ok ? "✓" : "✗"} {lastResult.message}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Status da configuração */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
            <CardDescription>Pré-requisitos pra envio funcionar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Edge Runtime ativo</p>
                <p className="text-xs text-muted-foreground">Container <code>edge-runtime</code> rodando no Supabase self-hosted.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Variáveis de ambiente</p>
                <p className="text-xs text-muted-foreground">
                  Configure <code>ZOHO_SMTP_*</code> em <code>supabase/.env</code> e reinicie o edge runtime.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Deploy da função</p>
                <p className="text-xs text-muted-foreground">
                  Rode <code>supabase functions deploy send-email</code> uma vez (e a cada update do código).
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">SQL <code>email_logs</code></p>
                <p className="text-xs text-muted-foreground">
                  Rode <code>supabase/sql/email_logs.sql</code> no SQL Editor.
                </p>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-muted-foreground italic">
              ✓ Os checks acima são manuais. Faça o teste de envio acima — se chegar, todos os 4 estão OK.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Histórico (últimos 50)</CardTitle>
            <CardDescription>Todos os envios feitos pelo CRM (pipeline send-email).</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadLogs} disabled={loadingLogs}>
            {loadingLogs ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[400px]">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhum email enviado ainda.
              </div>
            ) : (
              <div className="space-y-1.5">
                {logs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 p-2.5 rounded border hover:bg-muted/30">
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusBadge(log.status)}
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("pt-BR")}
                      </span>
                      {log.context_type && (
                        <Badge variant="outline" className="text-[10px] h-5">{log.context_type}</Badge>
                      )}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Para:</span> <span className="font-mono text-xs">{log.to_emails.join(", ")}</span>
                    </div>
                    <div className="text-sm font-semibold truncate">{log.subject}</div>
                    {log.error_message && (
                      <div className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded">
                        ⚠ {log.error_message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
