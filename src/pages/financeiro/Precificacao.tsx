import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calculator, Loader2, Pencil, Search, Save, Info, AlertTriangle,
  CheckCircle2, CircleDashed, TrendingDown, Wand2,
} from "lucide-react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/formatters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import MoneyInput from "@/components/MoneyInput";
import AddonUpsell from "@/components/addons/AddonUpsell";

/* ───────────────────────── tipos ───────────────────────── */

interface Product {
  id: string;
  name: string;
  sku: string | null;
  cost_price: number;   // reais
  sale_price: number;   // reais
  stock_qty: number;
}

interface Settings {
  target_margin_pct: number;
  volume_mode: "auto" | "manual";
  volume_window_days: 30 | 60 | 90;
  manual_monthly_volume: number;
  fixed_cost_share_pct: number;
}

const DEFAULT_SETTINGS: Settings = {
  target_margin_pct: 30,
  volume_mode: "auto",
  volume_window_days: 30,
  manual_monthly_volume: 0,
  fixed_cost_share_pct: 100,
};

type Status = "sem_custo" | "prejuizo" | "abaixo" | "ok";

interface Computed {
  product: Product;
  rateio: number;       // reais por unidade
  breakEven: number;    // custo + rateio
  suggested: number;    // break-even / (1 - margem)
  marginPct: number | null; // (preço - breakEven) / preço
  qtySold: number;
  status: Status;
}

const STATUS_META: Record<Status, { label: string; cls: string; order: number }> = {
  prejuizo:  { label: "Prejuízo",       cls: "bg-rose-500/10 text-rose-500",      order: 0 },
  abaixo:    { label: "Abaixo da meta", cls: "bg-amber-500/10 text-amber-500",    order: 1 },
  ok:        { label: "Na meta",        cls: "bg-emerald-500/10 text-emerald-500", order: 2 },
  sem_custo: { label: "Sem custo",      cls: "bg-muted text-muted-foreground",    order: 3 },
};

function pct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1).replace(".", ",")}%`;
}

/* ───────────────────────── célula editável ───────────────────────── */

function EditableMoney({
  value, onCommit, disabled,
}: { value: number; onCommit: (v: number) => Promise<void>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  async function commit() {
    if (draft === value) { setEditing(false); return; }
    setBusy(true);
    try { await onCommit(draft); } finally { setBusy(false); setEditing(false); }
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-1 font-mono text-xs hover:text-blue-500 disabled:opacity-50"
        title="Clique pra editar"
      >
        {formatBRL(value)}
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <MoneyInput
        autoFocus
        className="h-8 w-28 text-xs"
        value={draft}
        onChange={setDraft}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        disabled={busy}
      />
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
    </div>
  );
}

/* ───────────────────────── página ───────────────────────── */

export default function FinanceiroPrecificacao() {
  const { user } = useAuth();
  const { toast } = useToast();
  const addon = useAddon("financeiro");
  const companyId = user?.company_id ?? null;

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [fixedTotal, setFixedTotal] = useState(0); // reais/mês (todas as fixas ativas)
  const [volumeByProduct, setVolumeByProduct] = useState<Map<string, number>>(new Map());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [detail, setDetail] = useState<Computed | null>(null);
  const [applying, setApplying] = useState(false);

  /* ---------- carga ---------- */
  const loadVolume = useCallback(async (days: number) => {
    const { data, error } = await supabase.rpc("get_product_sales_volume", { p_days: days } as any);
    if (error) {
      toast({ title: "Erro ao calcular volume", description: error.message, variant: "destructive" });
      return new Map<string, number>();
    }
    const m = new Map<string, number>();
    ((data as any[]) ?? []).forEach((r) => m.set(r.product_id, Number(r.qty_sold) || 0));
    return m;
  }, [toast]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [prodRes, fixRes, setRes] = await Promise.all([
      supabase.from("products")
        .select("id, name, sku, cost_price, sale_price, stock_qty")
        .eq("company_id", companyId)
        .eq("active", true)
        .is("hidden_at", null)
        .order("name"),
      supabase.from("fixed_expenses")
        .select("amount_cents")
        .eq("company_id", companyId)
        .eq("active", true),
      supabase.from("financial_settings")
        .select("target_margin_pct, volume_mode, volume_window_days, manual_monthly_volume, fixed_cost_share_pct")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);
    if (prodRes.error || fixRes.error || setRes.error) {
      toast({
        title: "Erro ao carregar",
        description: prodRes.error?.message || fixRes.error?.message || setRes.error?.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setProducts(((prodRes.data as any[]) ?? []).map((p) => ({
      id: p.id, name: p.name, sku: p.sku,
      cost_price: Number(p.cost_price) || 0,
      sale_price: Number(p.sale_price) || 0,
      stock_qty: Number(p.stock_qty) || 0,
    })));
    setFixedTotal(((fixRes.data as any[]) ?? []).reduce((s, r) => s + Number(r.amount_cents || 0), 0) / 100);

    const s: Settings = setRes.data
      ? {
          target_margin_pct: Number((setRes.data as any).target_margin_pct),
          volume_mode: (setRes.data as any).volume_mode,
          volume_window_days: Number((setRes.data as any).volume_window_days) as 30 | 60 | 90,
          manual_monthly_volume: Number((setRes.data as any).manual_monthly_volume),
          fixed_cost_share_pct: Number((setRes.data as any).fixed_cost_share_pct),
        }
      : DEFAULT_SETTINGS;
    setSettings(s);
    setSavedSettings(s);
    setVolumeByProduct(await loadVolume(s.volume_window_days));
    setLoading(false);
  }, [companyId, toast, loadVolume]);

  useEffect(() => { if (addon.active) void load(); }, [addon.active, load]);

  // Trocar a janela recarrega só o volume (sem recarregar a página inteira)
  useEffect(() => {
    if (!addon.active || loading) return;
    if (settings.volume_window_days === savedSettings.volume_window_days) return;
    void loadVolume(settings.volume_window_days).then(setVolumeByProduct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.volume_window_days]);

  /* ---------- cálculo ---------- */
  const autoMonthlyVolume = useMemo(() => {
    let total = 0;
    volumeByProduct.forEach((q) => { total += q; });
    return total / (settings.volume_window_days / 30);
  }, [volumeByProduct, settings.volume_window_days]);

  const monthlyVolume = settings.volume_mode === "auto" ? autoMonthlyVolume : settings.manual_monthly_volume;
  const fixedShare = fixedTotal * (settings.fixed_cost_share_pct / 100);
  const rateio = monthlyVolume > 0 ? fixedShare / monthlyVolume : 0;
  const marginFactor = 1 - settings.target_margin_pct / 100;

  const computed: Computed[] = useMemo(() => {
    const windowFactor = settings.volume_window_days / 30;
    return products.map((p) => {
      const breakEven = p.cost_price + rateio;
      const suggested = marginFactor > 0 ? breakEven / marginFactor : breakEven;
      const marginPct = p.sale_price > 0 ? ((p.sale_price - breakEven) / p.sale_price) * 100 : null;
      let status: Status;
      if (p.cost_price <= 0) status = "sem_custo";
      else if (p.sale_price < breakEven) status = "prejuizo";
      else if (p.sale_price < suggested) status = "abaixo";
      else status = "ok";
      return {
        product: p, rateio, breakEven, suggested, marginPct,
        qtySold: (volumeByProduct.get(p.id) ?? 0) / windowFactor,
        status,
      };
    });
  }, [products, rateio, marginFactor, volumeByProduct, settings.volume_window_days]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return computed
      .filter((c) => statusFilter === "all" || c.status === statusFilter)
      .filter((c) => !q || c.product.name.toLowerCase().includes(q) || (c.product.sku ?? "").toLowerCase().includes(q))
      .sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.product.name.localeCompare(b.product.name));
  }, [computed, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { prejuizo: 0, abaixo: 0, ok: 0, sem_custo: 0 };
    computed.forEach((x) => { c[x.status] += 1; });
    return c;
  }, [computed]);

  /* ---------- ações ---------- */
  async function saveSettings() {
    if (!companyId) return;
    setSavingSettings(true);
    const { error } = await supabase.from("financial_settings").upsert(
      { company_id: companyId, ...settings } as any,
      { onConflict: "company_id" },
    );
    if (error) {
      toast({ title: "Erro ao salvar parâmetros", description: error.message, variant: "destructive" });
    } else {
      setSavedSettings(settings);
      toast({ title: "Parâmetros salvos" });
    }
    setSavingSettings(false);
  }

  async function setPricing(productId: string, patch: { cost?: number; sale?: number }) {
    const { error } = await supabase.rpc("set_product_pricing", {
      p_product_id: productId,
      p_cost_price: patch.cost ?? null,
      p_sale_price: patch.sale ?? null,
    } as any);
    if (error) {
      toast({ title: "Erro ao salvar preço", description: error.message, variant: "destructive" });
      return;
    }
    setProducts((prev) => prev.map((p) => p.id === productId
      ? { ...p, cost_price: patch.cost ?? p.cost_price, sale_price: patch.sale ?? p.sale_price }
      : p));
  }

  async function applySuggested(c: Computed) {
    setApplying(true);
    const rounded = Math.ceil(c.suggested * 100) / 100;
    await setPricing(c.product.id, { sale: rounded });
    setApplying(false);
    setDetail(null);
    toast({ title: "Preço atualizado", description: `${c.product.name} → ${formatBRL(rounded)}` });
  }

  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  /* ---------- render ---------- */
  if (addon.loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;
  }
  if (!addon.active) return <AddonUpsell code="financeiro" />;

  // Volume automático zerado ou muito baixo (< 10 un/mês) deixa o rateio irreal
  // (1 unidade carregando as fixas inteiras) — avisa e manda pro manual.
  const LOW_VOLUME = 10;
  const volumeWarning = settings.volume_mode === "auto" && !loading && autoMonthlyVolume < LOW_VOLUME;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Calculator className="h-6 w-6 text-blue-500" /> Precificação & Margem
        </h1>
        <p className="text-sm text-muted-foreground">
          Quanto cada produto precisa custar pra pagar as contas e ainda sobrar a margem que você quer.
        </p>
      </div>

      {/* Parâmetros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Parâmetros da conta</CardTitle>
          <CardDescription>
            Ajuste e veja a tabela recalcular na hora. Clique em salvar pra guardar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <Label>Margem alvo (%)</Label>
              <Input
                type="number" min={0} max={99} step={1}
                value={settings.target_margin_pct}
                onChange={(e) => setSettings((s) => ({ ...s, target_margin_pct: Math.min(99, Math.max(0, Number(e.target.value) || 0)) }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">Sobre o preço de venda: 30% = de cada R$ 100 vendidos, R$ 30 é lucro.</p>
            </div>

            <div>
              <Label>Volume mensal</Label>
              <Select
                value={settings.volume_mode}
                onValueChange={(v) => setSettings((s) => ({ ...s, volume_mode: v as "auto" | "manual" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automático (pelas vendas)</SelectItem>
                  <SelectItem value="manual">Informar manualmente</SelectItem>
                </SelectContent>
              </Select>
              {settings.volume_mode === "auto" ? (
                <Select
                  value={String(settings.volume_window_days)}
                  onValueChange={(v) => setSettings((s) => ({ ...s, volume_window_days: Number(v) as 30 | 60 | 90 }))}
                >
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="60">Últimos 60 dias (média/mês)</SelectItem>
                    <SelectItem value="90">Últimos 90 dias (média/mês)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="mt-2"
                  type="number" min={0} step={1}
                  placeholder="unidades por mês"
                  value={settings.manual_monthly_volume || ""}
                  onChange={(e) => setSettings((s) => ({ ...s, manual_monthly_volume: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                />
              )}
            </div>

            <div>
              <Label>Parcela das fixas nos produtos (%)</Label>
              <Input
                type="number" min={0} max={100} step={5}
                value={settings.fixed_cost_share_pct}
                onChange={(e) => setSettings((s) => ({ ...s, fixed_cost_share_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Se metade do seu faturamento é serviço (OS), coloque 50 — senão as fixas caem inteiras em cima dos produtos.
              </p>
            </div>

            <div className="flex items-end">
              <Button onClick={() => void saveSettings()} disabled={!settingsDirty || savingSettings} className="w-full">
                {savingSettings ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar parâmetros
              </Button>
            </div>
          </div>

          {volumeWarning && (
            <div className="mt-4 rounded-md bg-amber-500/10 ring-1 ring-amber-500/30 px-3 py-2.5 text-sm text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {autoMonthlyVolume === 0
                  ? <>Nenhuma venda faturada/entregue nos últimos {settings.volume_window_days} dias — sem volume não dá pra ratear as fixas.</>
                  : <>Só <strong>{Math.round(autoMonthlyVolume)} un/mês</strong> de vendas faturadas/entregues nos últimos {settings.volume_window_days} dias — com tão pouco volume, cada unidade carrega quase todas as fixas e o rateio de <strong>{formatBRL(rateio)}</strong> fica irreal.</>}
                {" "}Troque pra <strong>Informar manualmente</strong> e digite quantas unidades você vende de verdade por mês.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Fixas absorvidas / mês</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatBRL(fixedShare)}</p>
            <p className="text-xs text-muted-foreground">{settings.fixed_cost_share_pct}% de {formatBRL(fixedTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Volume mensal</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{Math.round(monthlyVolume).toLocaleString("pt-BR")} <span className="text-sm font-normal text-muted-foreground">un</span></p>
            <p className="text-xs text-muted-foreground">{settings.volume_mode === "auto" ? `média dos últimos ${settings.volume_window_days} dias` : "informado manualmente"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Rateio por unidade</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatBRL(rateio)}</p>
            <p className="text-xs text-muted-foreground">fixas ÷ volume — entra em cada produto</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Situação</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-rose-500 flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> {counts.prejuizo} no prejuízo</p>
            <p className="text-amber-500">{counts.abaixo} abaixo da meta</p>
            <p className="text-muted-foreground">{counts.sem_custo} sem custo informado</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Produtos</CardTitle>
              <CardDescription>Clique no custo ou no preço pra editar. Clique no nome pra ver a conta.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8 w-56" placeholder="Buscar produto ou SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="prejuizo">Prejuízo</SelectItem>
                  <SelectItem value="abaixo">Abaixo da meta</SelectItem>
                  <SelectItem value="ok">Na meta</SelectItem>
                  <SelectItem value="sem_custo">Sem custo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Rateio</TableHead>
                  <TableHead className="text-right">Mín. viável</TableHead>
                  <TableHead className="text-right">Preço atual</TableHead>
                  <TableHead className="text-right">Margem real</TableHead>
                  <TableHead className="text-right">Sugerido</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : visible.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Nenhum produto.</TableCell></TableRow>
                ) : visible.map((c) => {
                  const meta = STATUS_META[c.status];
                  return (
                    <TableRow key={c.product.id}>
                      <TableCell>
                        <button type="button" className="text-left hover:text-blue-500" onClick={() => setDetail(c)}>
                          <span className="font-medium">{c.product.name}</span>
                          {c.product.sku && <span className="ml-2 text-xs text-muted-foreground">{c.product.sku}</span>}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <EditableMoney value={c.product.cost_price} onCommit={(v) => setPricing(c.product.id, { cost: v })} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatBRL(c.rateio)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{c.status === "sem_custo" ? "—" : formatBRL(c.breakEven)}</TableCell>
                      <TableCell className="text-right">
                        <EditableMoney value={c.product.sale_price} onCommit={(v) => setPricing(c.product.id, { sale: v })} />
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${c.marginPct !== null && c.marginPct < 0 ? "text-rose-500" : ""}`}>
                        {c.status === "sem_custo" ? "—" : pct(c.marginPct)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{c.status === "sem_custo" ? "—" : formatBRL(c.suggested)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${meta.cls}`}>
                          {c.status === "ok" ? <CheckCircle2 className="h-3 w-3" />
                            : c.status === "sem_custo" ? <CircleDashed className="h-3 w-3" />
                            : <AlertTriangle className="h-3 w-3" />}
                          {meta.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detalhe — "a conta" */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.product.name}</DialogTitle>
                <DialogDescription>
                  Como chegamos no preço sugerido.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-md border font-mono text-sm">
                <Row label="Custo do produto" value={formatBRL(detail.product.cost_price)} />
                <Row
                  label={`Rateio de fixas (${formatBRL(fixedShare)} ÷ ${Math.round(monthlyVolume)} un/mês)`}
                  value={`+ ${formatBRL(detail.rateio)}`}
                />
                <Row label="Mínimo viável (margem zero)" value={formatBRL(detail.breakEven)} strong />
                <Row
                  label={`Margem alvo de ${settings.target_margin_pct}% sobre o preço`}
                  value={`÷ ${marginFactor.toFixed(2).replace(".", ",")}`}
                />
                <Row label="Preço sugerido" value={formatBRL(detail.suggested)} strong accent />
                <div className="border-t px-3 py-2 flex justify-between text-xs text-muted-foreground">
                  <span>Preço atual: {formatBRL(detail.product.sale_price)}</span>
                  <span>Margem real: {pct(detail.marginPct)}</span>
                </div>
              </div>

              <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground flex gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Volume</strong> é quantas unidades (de todos os produtos) você vende por mês. As despesas fixas
                  são divididas por esse número — quanto mais você vende, menos cada unidade precisa carregar de aluguel,
                  salário etc. Este produto vendeu ~{Math.round(detail.qtySold)} un/mês na janela escolhida.
                </span>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
                <Button
                  disabled={applying || detail.status === "sem_custo"}
                  onClick={() => void applySuggested(detail)}
                >
                  {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                  Aplicar preço sugerido
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-3 py-2 border-b last:border-b-0 ${strong ? "font-semibold" : ""} ${accent ? "text-blue-500" : ""}`}>
      <span className="font-sans text-xs text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
