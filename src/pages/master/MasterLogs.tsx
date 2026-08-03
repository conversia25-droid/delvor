import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, Search, ShieldAlert, ShieldCheck, TerminalSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type MasterLogRow = {
  id: string;
  created_at: string;
  level: "info" | "warning" | "error" | "critical";
  category: string;
  source: string;
  event_type: string;
  message: string;
  company_id: string | null;
  admin_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

function levelMeta(level?: string | null) {
  switch ((level || "").toLowerCase()) {
    case "critical":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "error":
      return "bg-orange-500/15 text-orange-300 border-orange-500/30";
    case "warning":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default:
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  }
}

export default function MasterLogs() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MasterLogRow[]>([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [selectedLog, setSelectedLog] = useState<MasterLogRow | null>(null);

  async function loadLogs() {
    setLoading(true);
    const { data, error } = await supabase
      .from("master_logs" as any)
      .select("id,created_at,level,category,source,event_type,message,company_id,admin_user_id,entity_type,entity_id,status,metadata")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      toast({
        title: "Erro ao carregar logs",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setRows(((data || []) as MasterLogRow[]));
    setLoading(false);
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [
        row.message,
        row.event_type,
        row.source,
        row.category,
        row.status || "",
        row.company_id || "",
        row.entity_type || "",
        row.entity_id || "",
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !term || haystack.includes(term);
      const matchesLevel = level === "all" || row.level === level;
      const matchesCategory = category === "all" || row.category === category;
      return matchesSearch && matchesLevel && matchesCategory;
    });
  }, [rows, search, level, category]);

  const counters = useMemo(() => ({
    total: rows.length,
    errors: rows.filter((row) => row.level === "error" || row.level === "critical").length,
    warnings: rows.filter((row) => row.level === "warning").length,
    auth: rows.filter((row) => row.category === "auth").length,
  }), [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Painel Master</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Logs do sistema</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Auditoria rápida do painel master. Aqui você acompanha login, logout, falhas e eventos relevantes.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadLogs()} className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800">
          <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-blue-300" /> Total</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{counters.total}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-orange-300" /> Erros</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold text-orange-300">{counters.errors}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-300" /> Warnings</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold text-amber-300">{counters.warnings}</p></CardContent></Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Auth</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold text-emerald-300">{counters.auth}</p></CardContent></Card>
      </div>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="h-4 w-4 text-blue-300" /> Filtros</CardTitle>
          <CardDescription className="text-slate-400">Filtre por nível, categoria ou pesquise por evento e mensagem.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr,180px,220px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por mensagem, evento, origem ou status"
            className="border-slate-700 bg-slate-950"
          />
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="border-slate-700 bg-slate-950"><SelectValue placeholder="Nível" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os níveis</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="border-slate-700 bg-slate-950"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              <SelectItem value="auth">Auth</SelectItem>
              <SelectItem value="audit">Audit</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="integration">Integration</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TerminalSquare className="h-4 w-4 text-blue-300" /> Eventos recentes</CardTitle>
            <CardDescription className="text-slate-400">Últimos 300 registros do master_logs.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[680px] pr-3">
              <div className="space-y-3">
                {loading ? <p className="text-sm text-slate-400">Carregando logs...</p> : null}
                {!loading && !filteredRows.length ? <p className="text-sm text-slate-400">Nenhum log encontrado.</p> : null}
                {filteredRows.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => setSelectedLog(row)}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-left transition hover:border-blue-500/40 hover:bg-slate-950"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={levelMeta(row.level)}>{row.level}</Badge>
                          <Badge variant="outline">{row.category}</Badge>
                          <Badge variant="secondary">{row.source}</Badge>
                          {row.status ? <Badge variant="outline">{row.status}</Badge> : null}
                        </div>
                        <p className="mt-3 font-medium text-white">{row.message}</p>
                        <p className="mt-1 text-sm text-slate-400">evento: {row.event_type}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDateTime(row.created_at)}</p>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>{row.company_id ? `empresa: ${row.company_id}` : "sem empresa"}</p>
                        <p>{row.entity_type ? `${row.entity_type}: ${row.entity_id || "—"}` : "sem entidade"}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle>Detalhes do log</CardTitle>
            <CardDescription className="text-slate-400">Clique em um evento para ver os campos completos.</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedLog ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-sm text-slate-400">
                Selecione um log à esquerda para inspecionar metadata, status e entidade relacionada.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge className={levelMeta(selectedLog.level)}>{selectedLog.level}</Badge>
                    <Badge variant="outline">{selectedLog.category}</Badge>
                    <Badge variant="secondary">{selectedLog.source}</Badge>
                    {selectedLog.status ? <Badge variant="outline">{selectedLog.status}</Badge> : null}
                  </div>
                  <p className="mt-3 text-lg font-semibold text-white">{selectedLog.message}</p>
                  <p className="mt-2 text-sm text-slate-400">evento: {selectedLog.event_type}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(selectedLog.created_at)}</p>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-slate-500">company_id</p><p className="mt-1 break-all text-slate-100">{selectedLog.company_id || "—"}</p></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-slate-500">admin_user_id</p><p className="mt-1 break-all text-slate-100">{selectedLog.admin_user_id || "—"}</p></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-slate-500">entity_type</p><p className="mt-1 break-all text-slate-100">{selectedLog.entity_type || "—"}</p></div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-slate-500">entity_id</p><p className="mt-1 break-all text-slate-100">{selectedLog.entity_id || "—"}</p></div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-sm font-medium text-white">Metadata</p>
                  <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
{JSON.stringify(selectedLog.metadata || {}, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
