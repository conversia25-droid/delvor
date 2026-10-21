/**
 * Lista de vendas do vendedor no mobile.
 *
 * Mostra as vendas onde o usuário é seller (suas próprias) — admin/gerente
 * vê tudo, mas no mobile a UI vai foco no operacional do vendedor de campo.
 *
 * Abas:
 *  • Em aberto — orçamento + aprovado (a fechar)
 *  • Faturadas — pra acompanhar pagamentos
 *  • Tudo     — fallback
 *
 * Tap → abre o editor de venda mobile pra ajustar/faturar.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, RefreshCw, User, ChevronRight, ShoppingCart } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import type { Sale, SaleStatus } from "@/types/delvor";
import { SALE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDateBR } from "@/lib/formatters";

type SaleRow = Sale & { customer_name?: string | null };

const OPEN_STATUSES: SaleStatus[] = ["orcamento", "aprovado"];
const BILLED_STATUSES: SaleStatus[] = ["faturado", "entregue"];

export default function MobileSalesList() {
  const { user } = useAuth();
  const perms = usePermissions();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"abertas" | "faturadas" | "tudo">("abertas");

  async function load(showSpinner = true) {
    if (!user?.id || !user?.company_id) return;
    if (showSpinner) setLoading(true); else setRefreshing(true);

    // Vendedor vê as próprias vendas; admin/gerente vê todas
    let q = supabase
      .from("sales" as any)
      .select("*")
      .eq("company_id", user.company_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!perms.isManager) q = q.eq("seller_id", user.id);
    const { data: sales, error } = await q;

    if (error || !sales) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const list = sales as Sale[];
    const customerIds = Array.from(new Set(list.map((s) => s.customer_id).filter(Boolean))) as string[];
    const cr = customerIds.length
      ? await supabase.from("customers" as any).select("id, name").in("id", customerIds)
      : { data: [] as any[] };
    const customerMap = new Map(((cr.data as any[]) ?? []).map((c: any) => [c.id, c.name]));
    setRows(list.map((s) => ({ ...s, customer_name: customerMap.get(s.customer_id) ?? null })));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [user?.id, user?.company_id]);

  // Realtime: nova venda ou status alterado
  useEffect(() => {
    if (!user?.id || !user?.company_id) return;
    const ch = supabase
      .channel(`mobile-sales-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `company_id=eq.${user.company_id}` }, () => void load(false))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user?.id, user?.company_id]);

  /* ─────── BUCKETS ─────── */
  const abertas    = useMemo(() => rows.filter((r) => OPEN_STATUSES.includes(r.status)),   [rows]);
  const faturadas  = useMemo(() => rows.filter((r) => BILLED_STATUSES.includes(r.status)), [rows]);

  return (
    <div className="px-3 py-3 space-y-3 max-w-2xl mx-auto">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{perms.isManager ? "Vendas" : "Minhas vendas"}</h1>
          <p className="text-xs text-muted-foreground">{rows.length} no total</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => void load(false)} disabled={refreshing} className="h-10 w-10">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => navigate("/m/sales/new")} className="h-10">
            <Plus className="h-4 w-4 mr-1" /> Nova
          </Button>
        </div>
      </div>

      {/* TABS */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid grid-cols-3 w-full h-11">
          <TabsTrigger value="abertas" className="text-xs">
            Em aberto
            {abertas.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-full px-1.5 py-0.5">
                {abertas.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="faturadas" className="text-xs">
            Faturadas
            {faturadas.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-full px-1.5 py-0.5">
                {faturadas.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tudo" className="text-xs">Tudo</TabsTrigger>
        </TabsList>

        <TabsContent value="abertas" className="mt-3 space-y-2">
          {renderList(abertas, loading, navigate, "Nada em aberto.")}
        </TabsContent>
        <TabsContent value="faturadas" className="mt-3 space-y-2">
          {renderList(faturadas, loading, navigate, "Sem vendas faturadas ainda.")}
        </TabsContent>
        <TabsContent value="tudo" className="mt-3 space-y-2">
          {renderList(rows, loading, navigate, "Nenhuma venda.")}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function renderList(rows: SaleRow[], loading: boolean, navigate: (p: string) => void, empty: string) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando vendas...
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
        {empty}
      </div>
    );
  }
  return rows.map((s) => <SaleCard key={s.id} sale={s} onClick={() => navigate(`/m/sales/${s.id}`)} />);
}

function SaleCard({ sale, onClick }: { sale: SaleRow; onClick: () => void }) {
  const statusMeta = SALE_STATUS_LABELS[sale.status];
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/60 bg-card/60 active:bg-card/80 hover:border-blue-500/50 transition p-3 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-muted-foreground">#{String(sale.number).padStart(6, "0")}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusMeta && (
            <Badge className={`${statusMeta.tone} ring-1 text-[10px] px-1.5 py-0`}>{statusMeta.label}</Badge>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <div className="font-semibold text-sm truncate flex items-center gap-1.5">
        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {sale.customer_name || "—"}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatDateBR(sale.issue_date)}</span>
        <span className="font-mono font-semibold text-foreground">{formatBRL(sale.total)}</span>
      </div>
    </button>
  );
}
