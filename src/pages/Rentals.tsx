import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus, Search, Repeat, RefreshCw, Boxes, Receipt, Calendar, AlertTriangle,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import type { RentalContract, RentalStatus } from "@/types/delvor";
import { RENTAL_STATUS_LABELS } from "@/types/delvor";
import { formatBRL } from "@/lib/formatters";

type ContractRow = RentalContract & {
  customers?: { name: string } | null;
  /** Calculado: total de equipamentos ativos */
  itemCount?: number;
  /** Calculado: soma das mensalidades */
  monthlyTotal?: number;
};

export default function Rentals() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const navigate = useNavigate();

  const [items, setItems] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | RentalStatus>("all");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    // Pega contratos + itens (pra contar e somar)
    const { data, error } = await supabase
      .from("rental_contracts" as any)
      .select("*, customers ( name ), rental_contract_items ( monthly_value )")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar contratos", description: error.message, variant: "destructive" });
      return;
    }
    const rows: ContractRow[] = ((data as any[]) ?? []).map((c: any) => {
      const arr: any[] = c.rental_contract_items || [];
      return {
        ...c,
        itemCount: arr.length,
        monthlyTotal: arr.reduce((s, it) => s + Number(it.monthly_value || 0), 0),
      };
    });
    setItems(rows);
  }
  useEffect(() => { load(); }, [companyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((c) => {
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (!q) return true;
      const blob = [String(c.number), c.customers?.name, c.notes]
        .filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterStatus]);

  const stats = useMemo(() => {
    const ativos = items.filter((c) => c.status === "ativo");
    const recurringRevenue = ativos.reduce((s, c) => s + (c.monthlyTotal || 0), 0);
    const totalEquip = ativos.reduce((s, c) => s + (c.itemCount || 0), 0);

    // Próximos vencimentos (próximos 7 dias considerando billing_day)
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const upcoming = ativos.filter((c) => {
      const next = nextDueDate(c.billing_day);
      return next >= today && next <= in7;
    }).length;

    return { activeCount: ativos.length, recurringRevenue, totalEquip, upcoming };
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Repeat className="h-7 w-7" /> Locações
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Contratos de aluguel mensal de equipamentos. Gere fatura mensal manualmente quando estiver pronto.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => navigate("/rentals/new")}>
            <Plus className="h-4 w-4 mr-2" /> Novo contrato
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Repeat className="h-3 w-3" /> Contratos ativos</div>
          <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.activeCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Boxes className="h-3 w-3" /> Equipamentos locados</div>
          <div className="text-2xl font-bold mt-1">{stats.totalEquip}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Receipt className="h-3 w-3" /> Receita recorrente</div>
          <div className="text-2xl font-bold mt-1">{formatBRL(stats.recurringRevenue)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">por mês (sem excedentes)</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Vencem em 7 dias</div>
          <div className={`text-2xl font-bold mt-1 ${stats.upcoming > 0 ? "text-amber-400" : ""}`}>{stats.upcoming}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número, cliente..." className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(RENTAL_STATUS_LABELS) as RentalStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{RENTAL_STATUS_LABELS[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-xs">{filtered.length} de {items.length}</Badge>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Número</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-24 text-center">Equip.</TableHead>
              <TableHead className="w-32 text-right">Mensalidade</TableHead>
              <TableHead className="w-32">Início</TableHead>
              <TableHead className="w-32">Próx. vencimento</TableHead>
              <TableHead className="w-32">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  Nenhum contrato. <Link to="/rentals/new" className="underline ml-1">Criar o primeiro</Link>
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map((c) => {
              const meta = RENTAL_STATUS_LABELS[c.status];
              const next = nextDueDate(c.billing_day);
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const in3 = new Date(today); in3.setDate(in3.getDate() + 3);
              const dueSoon = c.status === "ativo" && next >= today && next <= in3;
              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => navigate(`/rentals/${c.id}`)}
                >
                  <TableCell className="font-mono text-sm">#{String(c.number).padStart(6, "0")}</TableCell>
                  <TableCell className="font-medium">{c.customers?.name || "—"}</TableCell>
                  <TableCell className="text-center font-mono">{c.itemCount ?? 0}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatBRL(c.monthlyTotal || 0)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(c.start_date).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.status === "ativo" ? (
                      <span className={dueSoon ? "text-amber-400 font-medium inline-flex items-center gap-1" : ""}>
                        {dueSoon && <AlertTriangle className="h-3 w-3" />}
                        {next.toLocaleDateString("pt-BR")}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Calcula o próximo vencimento a partir do dia configurado. */
function nextDueDate(billingDay: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = Math.min(28, Math.max(1, billingDay || 1));
  const candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return candidate;
}
