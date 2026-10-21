/**
 * Lista de OSs do técnico no mobile.
 *
 * Filtra automaticamente por `technician_id = user.id` — esta tela é pro
 * técnico ver SÓ as OSs dele. RLS no banco já garante isso server-side, mas
 * a gente filtra cliente-side também pra UX (gerente/admin que abrir esta
 * tela também vê só o que está atribuído pra ele — se quiser ver tudo, vai
 * pra versão desktop).
 *
 * Abas:
 *  • Hoje      — OSs com prazo até hoje OU prioridade alta/urgente sem prazo
 *  • Em aberto — tudo que não está concluído/cancelado
 *  • Histórico — últimos 7 dias de concluídas/entregues
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, Clock, ChevronRight, Wrench, RefreshCw, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import type { ServiceOrder, OsStatus, OsPriority } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

type OsRow = ServiceOrder & {
  customer_name?: string | null;
  equipment_label?: string | null;
};

const PRIORITY_TONE: Record<OsPriority, string> = {
  baixa:   "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  normal:  "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  alta:    "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  urgente: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30",
};

const ACTIVE_STATUSES: OsStatus[] = [
  "aberta",
  "diagnostico",
  "aguardando_aprovacao",
  "aguardando_peca",
  "em_execucao",
];
/**
 * Status onde a OS está sob trabalho do técnico — a bola está com ele.
 * Esses sempre caem na aba "Hoje". As paradas (aguardando_peca,
 * aguardando_aprovacao) ficam só em "Em aberto" pra não poluir a fila
 * do dia com coisa que depende de terceiro.
 */
const WORK_STATUSES: OsStatus[] = ["aberta", "diagnostico", "em_execucao"];
// Histórico inclui faturada também — quando o técnico+vendedor converte a
// OS em venda ela vira "faturada", e a OS DEVE continuar visível no
// histórico (senão some da tela e parece bug). Canceladas ficam fora —
// não são "trabalho realizado", são desistências.
const DONE_STATUSES: OsStatus[] = ["concluida", "entregue", "faturada"];

export default function MobileOrdersList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"hoje" | "abertas" | "historico">("hoje");

  async function load(showSpinner = true) {
    if (!user?.id || !user?.company_id) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);

    // Busca OSs do técnico + nomes do cliente e equipamento em joins
    // separados (manter simples — sem nested select que muda muito o
    // shape do retorno dependendo do tipo de FK).
    const { data: osData, error } = await supabase
      .from("service_orders" as any)
      .select("*")
      .eq("company_id", user.company_id)
      .eq("technician_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error || !osData) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const list = osData as ServiceOrder[];
    const customerIds = Array.from(new Set(list.map((o) => o.customer_id).filter(Boolean))) as string[];
    const equipmentIds = Array.from(new Set(list.map((o) => o.equipment_id).filter(Boolean))) as string[];

    const [cr, er] = await Promise.all([
      customerIds.length
        ? supabase.from("customers" as any).select("id, name").in("id", customerIds)
        : Promise.resolve({ data: [] as any[] }),
      equipmentIds.length
        ? supabase.from("customer_equipments" as any).select("id, brand, model, serial_number").in("id", equipmentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Defensivo: se a query falhar (RLS, network), `data` vem null.
    // Sem o `?? []` o .map crasha a tela inteira — preferimos só perder
    // o label do cliente/equipamento e mostrar a OS sem ele.
    const customerMap = new Map(
      ((cr.data as any[]) ?? []).map((c: any) => [c.id, c.name])
    );
    const equipMap = new Map(
      ((er.data as any[]) ?? []).map((e: any) => [
        e.id,
        [e.brand, e.model].filter(Boolean).join(" ") || e.serial_number || "Equipamento",
      ])
    );

    setRows(
      list.map((o) => ({
        ...o,
        customer_name: customerMap.get(o.customer_id || "") ?? null,
        equipment_label: equipMap.get(o.equipment_id || "") ?? null,
      }))
    );
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [user?.id, user?.company_id]);

  // Realtime: nova OS atribuída pra mim OU mudança de status → recarrega
  // de leve sem mostrar spinner gigante.
  useEffect(() => {
    if (!user?.id || !user?.company_id) return;
    const ch = supabase
      .channel(`mobile-os-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_orders",
          filter: `technician_id=eq.${user.id}`,
        },
        () => void load(false)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user?.id, user?.company_id]);

  /* ─────── BUCKETS ─────── */
  const hojeStr = new Date().toISOString().slice(0, 10);
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const today23 = new Date();
  today23.setHours(23, 59, 59, 999);

  const hojeRows = useMemo(
    () =>
      rows.filter((o) => {
        if (!ACTIVE_STATUSES.includes(o.status)) return false;
        // 1) Atrasada sempre entra (precisa de ação)
        if (o.due_at && new Date(o.due_at) < today23) {
          // qualquer prazo até o fim de hoje conta como "pra hoje"
          // (inclui prazos atrasados de dias anteriores)
        }
        if (o.due_at && new Date(o.due_at) <= today23) return true;
        // 2) Urgente/alta sempre entra, independente de prazo
        if (o.priority === "urgente" || o.priority === "alta") return true;
        // 3) Status de trabalho ativo (a bola tá com o técnico) entra
        if (WORK_STATUSES.includes(o.status)) return true;
        // 4) Aguardando peça/aprovação sem prazo de hoje → fica só em "Em aberto"
        return false;
      }),
    [rows, hojeStr]
  );
  const abertasRows = useMemo(
    () => rows.filter((o) => ACTIVE_STATUSES.includes(o.status)),
    [rows]
  );
  const historicoRows = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return rows.filter(
      (o) => DONE_STATUSES.includes(o.status) && new Date(o.updated_at || o.created_at) >= cutoff
    );
  }, [rows]);

  return (
    <div className="px-3 py-3 space-y-3 max-w-2xl mx-auto">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Minhas OSs</h1>
          <p className="text-xs text-muted-foreground">{rows.length} no total</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void load(false)}
          disabled={refreshing}
          className="h-10 w-10"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* TABS */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid grid-cols-3 w-full h-11">
          <TabsTrigger value="hoje" className="text-xs">
            Hoje
            {hojeRows.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-rose-500/20 text-rose-700 dark:text-rose-300 rounded-full px-1.5 py-0.5">
                {hojeRows.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="abertas" className="text-xs">
            Em aberto
            {abertasRows.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-full px-1.5 py-0.5">
                {abertasRows.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="historico" className="text-xs">
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hoje" className="mt-3 space-y-2">
          {renderList(hojeRows, loading, navigate, "Sem OSs prioritárias pra hoje.")}
        </TabsContent>
        <TabsContent value="abertas" className="mt-3 space-y-2">
          {renderList(abertasRows, loading, navigate, "Nada em aberto. 🎉")}
        </TabsContent>
        <TabsContent value="historico" className="mt-3 space-y-2">
          {renderList(historicoRows, loading, navigate, "Nada concluído nos últimos 7 dias.")}
        </TabsContent>
      </Tabs>

      {/* FAB — criar OS. Posicionado acima da bottom nav (que ocupa ~4rem).
          Fixado no viewport pra ficar sempre acessível enquanto rola a lista. */}
      <button
        type="button"
        onClick={() => navigate("/m/orders/new")}
        aria-label="Nova OS"
        className="fixed right-4 z-40 h-14 w-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/40 active:scale-95 transition flex items-center justify-center"
        style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0))" }}
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}

function renderList(
  rows: OsRow[],
  loading: boolean,
  navigate: (path: string) => void,
  emptyMsg: string
) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando OSs...
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">{emptyMsg}</div>
    );
  }
  return rows.map((o) => <OsCard key={o.id} os={o} onClick={() => navigate(`/m/orders/${o.id}`)} />);
}

function OsCard({ os, onClick }: { os: OsRow; onClick: () => void }) {
  const statusMeta = OS_STATUS_LABELS[os.status];
  const overdue = !!(
    os.due_at &&
    new Date(os.due_at) < new Date() &&
    ACTIVE_STATUSES.includes(os.status)
  );

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/60 bg-card/60 active:bg-card/80 hover:border-blue-500/50 transition p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-muted-foreground">
            #{String(os.number).padStart(6, "0")}
          </span>
          {os.priority !== "normal" && (
            <Badge className={`${PRIORITY_TONE[os.priority]} ring-1 text-[10px] px-1.5 py-0`}>
              {os.priority.toUpperCase()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusMeta && (
            <Badge className={`${statusMeta.tone} ring-1 text-[10px] px-1.5 py-0`}>
              {statusMeta.label}
            </Badge>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="font-semibold text-sm truncate">{os.customer_name || "—"}</div>

      {os.equipment_label && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
          <Wrench className="h-3 w-3 shrink-0" /> {os.equipment_label}
        </div>
      )}

      {os.reported_issue && (
        <div className="text-xs text-muted-foreground line-clamp-2">"{os.reported_issue}"</div>
      )}

      {os.due_at && (
        <div
          className={`text-[11px] flex items-center gap-1.5 ${
            overdue ? "text-rose-700 dark:text-rose-400 font-semibold" : "text-muted-foreground"
          }`}
        >
          {overdue ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          Prazo: {new Date(os.due_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          {overdue && " — atrasada"}
        </div>
      )}
    </button>
  );
}
