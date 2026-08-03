import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Wrench,
  RefreshCw,
  AlertTriangle,
  PackageOpen,
  CheckCircle2,
  LayoutGrid,
  Rows3,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { OsPriority, OsStatus, ServiceOrder } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";
import OsKanban from "@/components/service-orders/OsKanban";

type OsWithCustomer = ServiceOrder & {
  customers?: { name: string; trade_name: string | null } | null;
};

const PRIORITY_TONE: Record<OsPriority, string> = {
  baixa:   "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  normal:  "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  alta:    "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  urgente: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

export default function ServiceOrders() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const navigate = useNavigate();

  const [view, setView] = useState<"list" | "kanban">(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("os-view")) === "kanban" ? "kanban" : "list"
  );
  useEffect(() => { try { localStorage.setItem("os-view", view); } catch {} }, [view]);

  const [items, setItems] = useState<OsWithCustomer[]>([]);
  const [team, setTeam] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | OsStatus>("all");
  const [filterTechnician, setFilterTechnician] = useState<"all" | "unassigned" | string>("all");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("service_orders" as any)
      .select("*, customers ( name, trade_name )")
      .eq("company_id", companyId)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as any[]) ?? []);
  }
  useEffect(() => { load(); }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    supabase.from("profiles" as any).select("id, nome").eq("company_id", companyId).order("nome")
      .then(({ data }) => setTeam(((data as any[]) ?? []) as any));
  }, [companyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((o) => {
      if (filterStatus !== "all" && o.status !== filterStatus) return false;
      if (filterTechnician === "unassigned" && o.technician_id) return false;
      if (filterTechnician !== "all" && filterTechnician !== "unassigned" && o.technician_id !== filterTechnician) return false;
      if (!q) return true;
      const blob = [
        String(o.number),
        o.customers?.name,
        o.customers?.trade_name,
        o.reported_issue,
        o.diagnosis,
        o.solution,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterStatus, filterTechnician]);

  const stats = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const open = items.filter((o) => !["entregue", "faturada", "cancelada"].includes(o.status)).length;
    const waitingPart = items.filter((o) => o.status === "aguardando_peca").length;
    const overdue = items.filter((o) => o.due_at && new Date(o.due_at) < new Date()
      && !["concluida", "entregue", "faturada", "cancelada"].includes(o.status)).length;
    const finishedMonth = items.filter((o) => {
      if (o.status !== "entregue" && o.status !== "faturada") return false;
      // delivered_at pode estar vazio se a OS pulou direto para 'faturada'.
      // Cai pra finished_at / updated_at como fallback.
      const ref = o.delivered_at || o.finished_at || o.updated_at;
      return !!ref && new Date(ref) >= monthStart;
    }).length;
    return { open, waitingPart, overdue, finishedMonth };
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wrench className="h-7 w-7" /> Ordens de Serviço
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Acompanhe o ciclo da OS: aberta → diagnóstico → aguardando peça → execução → entrega → faturamento.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => navigate("/service-orders/new")}>
            <Plus className="h-4 w-4 mr-2" /> Nova OS
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">OS abertas</div>
          <div className="text-2xl font-bold mt-1">{stats.open}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><PackageOpen className="h-3 w-3" /> Aguardando peça</div>
          <div className="text-2xl font-bold mt-1 text-orange-400">{stats.waitingPart}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Em atraso</div>
          <div className="text-2xl font-bold mt-1 text-rose-400">{stats.overdue}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Concluídas no mês</div>
          <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.finishedMonth}</div>
        </div>
      </div>

      {/* Filtros + toggle de view */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número, cliente, defeito..." className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(OS_STATUS_LABELS) as OsStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{OS_STATUS_LABELS[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterTechnician} onValueChange={setFilterTechnician}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os técnicos</SelectItem>
            <SelectItem value="unassigned">Não atribuído</SelectItem>
            {team.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} de {items.length}</Badge>

        <Tabs value={view} onValueChange={(v: any) => setView(v)} className="ml-auto">
          <TabsList>
            <TabsTrigger value="list"><Rows3 className="h-4 w-4 mr-1" /> Lista</TabsTrigger>
            <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4 mr-1" /> Kanban</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "list" && (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Número</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="w-36">Defeito</TableHead>
                <TableHead className="w-36">Prazo / Visita</TableHead>
                <TableHead className="w-24">Prioridade</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-28 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    Nenhuma OS. <Link to="/service-orders/new" className="underline ml-1">Criar a primeira</Link>
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.map((o) => {
                const meta = OS_STATUS_LABELS[o.status];
                const isFinal = ["concluida", "entregue", "faturada", "cancelada"].includes(o.status);
                const overdue = !!o.due_at && new Date(o.due_at) < new Date() && !isFinal;
                return (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => navigate(`/service-orders/${o.id}`)}
                  >
                    <TableCell className="font-mono text-sm">#{String(o.number).padStart(6, "0")}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{o.customers?.name || "—"}</span>
                        {o.customers?.trade_name && (
                          <span className="text-xs text-muted-foreground">{o.customers.trade_name}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground line-clamp-2">{o.reported_issue || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col">
                        {o.due_at ? (
                          <span className={overdue ? "text-rose-400 font-medium" : ""} title="Prazo de entrega">
                            ⏰ {new Date(o.due_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                          </span>
                        ) : <span className="text-muted-foreground">sem prazo</span>}
                        {o.scheduled_at && (
                          <span className="text-muted-foreground" title="Visita agendada">
                            🚐 {new Date(o.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${PRIORITY_TONE[o.priority]} ring-1`}>{o.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatBRL(o.total)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {view === "kanban" && <OsKanban items={filtered} onChange={load} />}
    </div>
  );
}
