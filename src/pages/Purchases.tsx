import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Truck,
  RefreshCw,
  PackageOpen,
  FileText,
  FileUp,
  TrendingDown,
  CheckCircle2,
} from "lucide-react";

import NfeImportDialog from "@/components/purchases/NfeImportDialog";

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

import type { Purchase, PurchaseStatus } from "@/types/delvor";
import { PURCHASE_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDateBR } from "@/lib/formatters";

type PurchaseRow = Purchase & {
  suppliers?: { name: string } | null;
};

export default function Purchases() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const navigate = useNavigate();

  const [items, setItems] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | PurchaseStatus>("all");

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("purchases" as any)
      .select("*, suppliers ( name )")
      .eq("company_id", companyId)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar compras", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as any[]) ?? []);
  }
  useEffect(() => { load(); }, [companyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      if (filterStatus !== "all" && p.status !== filterStatus) return false;
      if (!q) return true;
      const blob = [
        String(p.number),
        p.suppliers?.name,
        p.invoice_key,
        p.notes,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [items, search, filterStatus]);

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const open = items.filter((p) => p.status === "rascunho" || p.status === "pedido").length;
    const monthReceived = items.filter((p) =>
      p.status === "recebida"
      && p.receive_date
      && new Date(p.receive_date) >= monthStart
    );
    const monthSpend = monthReceived.reduce((s, p) => s + (p.total || 0), 0);
    const totalSpend = items
      .filter((p) => p.status === "recebida")
      .reduce((s, p) => s + (p.total || 0), 0);

    return {
      open,
      receivedMonthCount: monthReceived.length,
      monthSpend,
      totalSpend,
    };
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Truck className="h-7 w-7" /> Compras
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Entrada de mercadoria de fornecedores. Receber dispara entrada automática no estoque.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4 mr-2" /> Importar NF-e
          </Button>
          <Button onClick={() => navigate("/purchases/new")}>
            <Plus className="h-4 w-4 mr-2" /> Nova compra
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" /> Em aberto</div>
          <div className="text-2xl font-bold mt-1">{stats.open}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><PackageOpen className="h-3 w-3" /> Recebidas no mês</div>
          <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.receivedMonthCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Gasto no mês</div>
          <div className="text-2xl font-bold mt-1">{formatBRL(stats.monthSpend)}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Gasto total</div>
          <div className="text-2xl font-bold mt-1">{formatBRL(stats.totalSpend)}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número, fornecedor, NF..." className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{PURCHASE_STATUS_LABELS[s].label}</SelectItem>
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
              <TableHead>Fornecedor</TableHead>
              <TableHead className="w-40">NF</TableHead>
              <TableHead className="w-32">Emissão</TableHead>
              <TableHead className="w-32">Recebimento</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-32 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  Nenhuma compra. <Link to="/purchases/new" className="underline ml-1">Criar a primeira</Link>
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map((p) => {
              const meta = PURCHASE_STATUS_LABELS[p.status];
              return (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => navigate(`/purchases/${p.id}`)}
                >
                  <TableCell className="font-mono text-sm">#{String(p.number).padStart(6, "0")}</TableCell>
                  <TableCell className="font-medium">{p.suppliers?.name || "—"}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[160px]" title={p.invoice_key || undefined}>
                    {p.invoice_key || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateBR(p.issue_date)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.receive_date ? new Date(p.receive_date).toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatBRL(p.total)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <NfeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(id) => navigate(`/purchases/${id}`)}
      />
    </div>
  );
}
