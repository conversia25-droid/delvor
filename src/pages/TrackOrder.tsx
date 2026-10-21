import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search, Loader2, Wrench, PackageSearch, Clock, ShieldCheck, ArrowLeft, FileText,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL } from "@/lib/formatters";

/* ──────────────────────────────────────────────────────────────────
   Status — rótulos voltados ao cliente (mais amigáveis que os internos)
─────────────────────────────────────────────────────────────────── */
interface StatusInfo { label: string; solid: string; dot: string }

const STATUS: Record<string, StatusInfo> = {
  aberta:               { label: "Recebida",                 solid: "bg-sky-600",     dot: "bg-sky-500" },
  diagnostico:          { label: "Em análise",               solid: "bg-sky-600",     dot: "bg-sky-500" },
  aguardando_aprovacao: { label: "Aguardando sua aprovação", solid: "bg-amber-600",   dot: "bg-amber-500" },
  aguardando_peca:      { label: "Aguardando peça",          solid: "bg-amber-600",   dot: "bg-amber-500" },
  em_execucao:          { label: "Em execução",              solid: "bg-blue-600",  dot: "bg-blue-500" },
  concluida:            { label: "Pronto para retirada",     solid: "bg-emerald-600", dot: "bg-emerald-500" },
  entregue:             { label: "Entregue",                 solid: "bg-emerald-600", dot: "bg-emerald-500" },
  faturada:             { label: "Finalizada",               solid: "bg-emerald-600", dot: "bg-emerald-500" },
  cancelada:            { label: "Cancelada",                solid: "bg-rose-600",    dot: "bg-rose-500" },
};
function statusInfo(s: string | null | undefined): StatusInfo {
  return (s && STATUS[s]) || { label: s || "Atualização", solid: "bg-zinc-600", dot: "bg-zinc-500" };
}

function fmtDateTime(d?: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function TrackOrder() {
  const [params] = useSearchParams();
  const token = params.get("t") || "";
  const prefilledOs = (params.get("os") || "").replace(/\D/g, "");

  const [numero, setNumero] = useState(prefilledOs);
  const [contato, setContato] = useState("");
  const [loading, setLoading] = useState(!!token); // se veio por link, já começa carregando
  const [result, setResult] = useState<any>(null);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  /* link com token → abre a OS direto, sem formulário */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("track_service_order_by_token" as any, {
        p_token: token,
      } as any);
      if (cancelled) return;
      setLoading(false);
      setSearched(true);
      if (error) {
        setErrorMsg("Não foi possível carregar a OS agora. Tente novamente em instantes.");
        return;
      }
      setResult(data || { found: false });
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(numero.replace(/\D/g, ""), 10);
    const contatoDigits = contato.replace(/\D/g, "");
    if (!num || contatoDigits.length < 6) {
      setErrorMsg("Informe o número da OS e um telefone ou CPF válido.");
      return;
    }
    setErrorMsg("");
    setLoading(true);
    const { data, error } = await supabase.rpc("track_service_order" as any, {
      p_number: num,
      p_contact: contato,
    } as any);
    setLoading(false);
    setSearched(true);
    if (error) {
      setErrorMsg("Não foi possível consultar agora. Tente novamente em instantes.");
      setResult(null);
      return;
    }
    setResult(data || { found: false });
  }

  const os = result?.found ? result.os : null;
  const items: any[] = result?.found ? (result.items || []) : [];
  const timeline: any[] = result?.found ? (result.timeline || []) : [];
  const cur = statusInfo(os?.status);
  const isAprovacao = os?.status === "aguardando_aprovacao";
  const notFound = searched && !loading && result && !result.found;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-10">
        {/* marca */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 mb-3">
            <Wrench className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Acompanhe sua Ordem de Serviço</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {token
              ? "Veja abaixo a situação da sua OS."
              : "Informe o número da OS e seu telefone para ver o andamento."}
          </p>
        </div>

        {/* formulário — só quando NÃO veio por link com token */}
        {!token && (
          <form onSubmit={consultar} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="os-num" className="text-xs">Número da OS</Label>
                <Input
                  id="os-num"
                  inputMode="numeric"
                  placeholder="Ex: 1234"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="os-contato" className="text-xs">Telefone ou CPF</Label>
                <Input
                  id="os-contato"
                  inputMode="tel"
                  placeholder="(00) 90000-0000"
                  value={contato}
                  onChange={(e) => setContato(e.target.value)}
                  autoFocus={!!prefilledOs}
                />
              </div>
            </div>
            {errorMsg && <p className="text-xs text-rose-700 dark:text-rose-400">{errorMsg}</p>}
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              Consultar
            </Button>
          </form>
        )}

        {/* carregando via link */}
        {token && loading && (
          <div className="rounded-xl border bg-card p-10 text-center">
            <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Carregando sua OS...</p>
          </div>
        )}

        {/* erro de carregamento (token) */}
        {token && !loading && errorMsg && (
          <div className="rounded-xl border bg-card p-6 text-center">
            <p className="text-sm text-rose-700 dark:text-rose-400">{errorMsg}</p>
          </div>
        )}

        {/* não encontrada */}
        {notFound && (
          <div className="mt-6 rounded-xl border bg-card p-6 text-center">
            <PackageSearch className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <p className="font-medium">OS não encontrada</p>
            <p className="text-sm text-muted-foreground mt-1">
              {token
                ? "Esse link pode estar incorreto ou expirado. Fale com a empresa."
                : "Confira o número da OS e o telefone/CPF cadastrado na empresa."}
            </p>
          </div>
        )}

        {/* resultado */}
        {os && (
          <div className="mt-6 space-y-4">
            {/* banner de status */}
            <div className={`rounded-xl p-5 text-center text-white ${cur.solid}`}>
              <div className="text-xs text-white/75">
                OS #{String(os.number).padStart(6, "0")}
              </div>
              <div className="text-2xl font-bold mt-1">{cur.label}</div>
              {os.company_name && (
                <div className="text-xs text-white/75 mt-1">Atendimento: {os.company_name}</div>
              )}
            </div>

            {/* orçamento / itens */}
            {items.length > 0 && (
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  {isAprovacao ? "Orçamento" : "Serviços e peças"}
                </div>
                <div className="divide-y">
                  {items.map((it, i) => {
                    const q = Number(it.qty || 0);
                    return (
                      <div key={i} className="px-4 py-2 flex justify-between gap-3 text-sm">
                        <span>{it.description}{q > 1 ? ` (${q}x)` : ""}</span>
                        <span className="font-mono shrink-0">{formatBRL(Number(it.total || 0))}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="px-4 py-2.5 border-t flex justify-between font-bold">
                  <span>Total</span>
                  <span className="font-mono">{formatBRL(Number(os.total || 0))}</span>
                </div>
                {isAprovacao && (
                  <div className="px-4 py-2.5 border-t bg-amber-500/10 text-xs">
                    Para <strong>aprovar</strong> o orçamento ou tirar dúvidas, responda a
                    mensagem no WhatsApp da empresa.
                  </div>
                )}
              </div>
            )}

            {/* detalhes */}
            <div className="rounded-xl border bg-card divide-y">
              {os.customer_name && <Row label="Cliente" value={os.customer_name} />}
              {os.equipment && (
                <Row
                  label="Equipamento"
                  value={os.equipment + (os.equipment_category ? ` · ${os.equipment_category}` : "")}
                />
              )}
              {os.reported_issue && <Row label="Defeito relatado" value={os.reported_issue} />}
              {fmtDateTime(os.created_at) && <Row label="Aberta em" value={fmtDateTime(os.created_at)!} />}
              {fmtDateTime(os.finished_at) && <Row label="Concluída em" value={fmtDateTime(os.finished_at)!} />}
              {fmtDateTime(os.delivered_at) && <Row label="Entregue em" value={fmtDateTime(os.delivered_at)!} />}
            </div>

            {/* garantia */}
            {os.warranty_until && (os.status === "entregue" || os.status === "faturada") && (
              <div className="rounded-xl border p-3 flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  Garantia até{" "}
                  <strong>{new Date(os.warranty_until + "T12:00").toLocaleDateString("pt-BR")}</strong>.
                </span>
              </div>
            )}

            {/* linha do tempo */}
            {timeline.length > 0 && (
              <div className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> Andamento
                </h3>
                <ol className="space-y-1">
                  {timeline.map((t, i) => {
                    const info = statusInfo(t.to_status);
                    const isLast = i === timeline.length - 1;
                    return (
                      <li key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`mt-1 h-2.5 w-2.5 rounded-full ${isLast ? info.dot : "bg-muted-foreground/40"}`} />
                          {i < timeline.length - 1 && <div className="w-px flex-1 bg-border" />}
                        </div>
                        <div className="pb-3">
                          <div className={`text-sm ${isLast ? "font-semibold" : "font-medium"}`}>
                            {info.label}
                          </div>
                          {t.message && (
                            <div className="text-xs text-muted-foreground">{t.message}</div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {fmtDateTime(t.created_at)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* rodapé */}
        <div className="mt-8 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Acesso da empresa
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5 flex flex-wrap justify-between gap-x-4 gap-y-0.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}
