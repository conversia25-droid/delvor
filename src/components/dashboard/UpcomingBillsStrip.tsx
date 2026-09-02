import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, CalendarDays,
  Check, CheckCircle2, ExternalLink, Loader2,
} from "lucide-react";
import { db as supabase } from "@/integrations/supabase/untyped";
import { useAuth } from "@/contexts/AuthContext";
import { useAddon } from "@/hooks/useAddon";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * "Previsão de caixa" no topo do Dashboard.
 *
 *  A PAGAR   — contas fixas ainda não pagas (Atrasadas / Hoje / Próximos 7 dias),
 *              com ✓ que marca como paga na hora. Cruza a virada do mês.
 *  A RECEBER — boletos/pix/crediário de vendas + faturas de locação com
 *              vencimento no mesmo recorte (RPC get_upcoming_receivables).
 *  Chips     — Hoje e Até 7 dias: entra / sai / saldo previsto.
 *
 * Só admin/financeiro, só com o add-on Financeiro ativo.
 */

type Bucket = "overdue" | "today" | "next7";

interface Fixed { id: string; name: string; amount_cents: number; due_day: number; }
interface Payment { fixed_expense_id: string; month_ref: string; }

interface Item {
  key: string;
  title: string;
  sub?: string;
  amountCents: number;
  dueDate: Date;
  bucket: Bucket;
  /** contas fixas: marcar paga */
  pay?: { fixedId: string; monthRef: string };
  /** recebíveis: abrir a venda/locação */
  href?: string;
}

const OVERDUE_LOOKBACK_DAYS = 90;

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function monthRef(y: number, m0: number) {
  const d = new Date(y, m0, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
/** Dia de vencimento "clampado" ao tamanho do mês (dia 31 em setembro → 30). */
function dueDateIn(y: number, m0: number, day: number) {
  const last = new Date(y, m0 + 1, 0).getDate();
  return new Date(y, m0, Math.min(day, last));
}
function ddmm(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function bucketFor(due: Date, today: Date, limit: Date): Bucket | null {
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  if (due <= limit) return "next7";
  return null;
}
const METHOD_LABEL: Record<string, string> = {
  boleto: "boleto", pix: "pix", crediario: "crediário", cartao_credito: "cartão",
  cartao_debito: "débito", transferencia: "transf.", dinheiro: "dinheiro", locacao: "locação", outro: "",
};

export default function UpcomingBillsStrip() {
  const { user } = useAuth();
  const perms = usePermissions();
  const addon = useAddon("financeiro");
  const { toast } = useToast();
  const companyId = user?.company_id ?? null;

  const [loading, setLoading] = useState(true);
  const [fixas, setFixas] = useState<Fixed[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [paying, setPaying] = useState<string | null>(null);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const limit = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + 7); return d; }, [today]);
  const thisRef = monthRef(today.getFullYear(), today.getMonth());
  const nextRef = monthRef(today.getFullYear(), today.getMonth() + 1);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const from = new Date(today); from.setDate(from.getDate() - OVERDUE_LOOKBACK_DAYS);
    const [fixRes, payRes, recRes] = await Promise.all([
      supabase.from("fixed_expenses")
        .select("id, name, amount_cents, due_day")
        .eq("company_id", companyId)
        .eq("active", true),
      supabase.from("fixed_expense_payments")
        .select("fixed_expense_id, month_ref")
        .eq("company_id", companyId)
        .in("month_ref", [thisRef, nextRef]),
      supabase.rpc("get_upcoming_receivables", { p_from: ymd(from), p_to: ymd(limit) }),
    ]);
    if (!fixRes.error) setFixas((fixRes.data as Fixed[]) ?? []);
    if (!payRes.error) setPayments((payRes.data as Payment[]) ?? []);
    if (!recRes.error) setReceivables((recRes.data as any[]) ?? []);
    setLoading(false);
  }, [companyId, thisRef, nextRef, today, limit]);

  useEffect(() => { if (addon.active) void load(); }, [addon.active, load]);

  /* ---------- a pagar (fixas) ---------- */
  const bills = useMemo<Item[]>(() => {
    const paid = new Set(payments.map((p) => `${p.fixed_expense_id}|${p.month_ref}`));
    const out: Item[] = [];
    for (const f of fixas) {
      for (const [y, m0, ref] of [
        [today.getFullYear(), today.getMonth(), thisRef],
        [today.getFullYear(), today.getMonth() + 1, nextRef],
      ] as const) {
        if (paid.has(`${f.id}|${ref}`)) continue;
        const due = dueDateIn(y, m0, f.due_day);
        const bucket = bucketFor(due, today, limit);
        if (!bucket) continue;
        if (bucket === "overdue" && ref !== thisRef) continue;
        out.push({
          key: `${f.id}|${ref}`, title: f.name, amountCents: f.amount_cents, dueDate: due, bucket,
          pay: { fixedId: f.id, monthRef: ref },
        });
      }
    }
    return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.title.localeCompare(b.title));
  }, [fixas, payments, today, limit, thisRef, nextRef]);

  /* ---------- a receber (vendas + locação) ---------- */
  const incomes = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const r of receivables) {
      const due = parseYmd(String(r.due_date));
      const bucket = bucketFor(due, today, limit);
      if (!bucket) continue;
      const method = METHOD_LABEL[String(r.method)] ?? String(r.method ?? "");
      out.push({
        key: `${r.source}|${r.id}`,
        title: r.customer_name || r.ref,
        sub: [r.ref, method, r.status === "parcial" ? "parcial" : ""].filter(Boolean).join(" · "),
        amountCents: Math.round(Number(r.amount || 0) * 100),
        dueDate: due, bucket,
        href: r.source === "rental" ? `/rentals/${r.link_id}` : `/sales/${r.link_id}`,
      });
    }
    return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.title.localeCompare(b.title));
  }, [receivables, today, limit]);

  const sum = (items: Item[], ...buckets: Bucket[]) =>
    items.filter((i) => buckets.includes(i.bucket)).reduce((s, i) => s + i.amountCents, 0);

  const chips = useMemo(() => ({
    today: { in: sum(incomes, "today"), out: sum(bills, "today") },
    week:  { in: sum(incomes, "today", "next7"), out: sum(bills, "today", "next7") },
  }), [incomes, bills]);

  async function markPaid(item: Item) {
    if (!companyId || !item.pay) return;
    setPaying(item.key);
    const { error } = await supabase.from("fixed_expense_payments").insert({
      company_id: companyId,
      fixed_expense_id: item.pay.fixedId,
      month_ref: item.pay.monthRef,
      paid_on: ymd(new Date()),
      amount_cents: item.amountCents,
    });
    if (error) {
      toast({ title: "Erro ao marcar como paga", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${item.title} paga` });
      setPayments((p) => [...p, { fixed_expense_id: item.pay!.fixedId, month_ref: item.pay!.monthRef }]);
    }
    setPaying(null);
  }

  if (!(perms.isAdmin || perms.isFinanceiro)) return null;
  if (addon.loading || !addon.active) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando previsão de caixa...
      </div>
    );
  }

  /* ---------- render helpers ---------- */
  const Group = ({ title, icon, items, tone }: {
    title: string; icon: React.ReactNode; items: Item[]; tone: "rose" | "amber" | "blue";
  }) => {
    const total = items.reduce((s, b) => s + b.amountCents, 0);
    const toneCls = tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500" : "text-blue-500";
    return (
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className={`text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 ${toneCls}`}>
            {icon} {title}
            {items.length > 0 && <span className="font-normal normal-case tracking-normal text-muted-foreground">({items.length})</span>}
          </span>
          {items.length > 0 && <span className="text-xs font-medium">{formatMoney(total)}</span>}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1">
            {items.map((b) => (
              <li key={b.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {b.href ? (
                    <Link to={b.href} className="hover:underline">{b.title}</Link>
                  ) : b.title}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {b.bucket === "today" ? "hoje" : ddmm(b.dueDate)}{b.sub ? ` · ${b.sub}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="font-mono text-xs">{formatMoney(b.amountCents)}</span>
                  {b.pay ? (
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6" title="Marcar como paga"
                      disabled={paying === b.key}
                      onClick={() => void markPaid(b)}
                    >
                      {paying === b.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                  ) : b.href ? (
                    <Button asChild variant="ghost" size="icon" className="h-6 w-6" title="Abrir">
                      <Link to={b.href}><ExternalLink className="h-3.5 w-3.5" /></Link>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const Chip = ({ label, inCents, outCents }: { label: string; inCents: number; outCents: number }) => {
    const net = inCents - outCents;
    return (
      <div className="rounded-md border px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{label}</span>
        <span className="text-emerald-500 flex items-center gap-0.5"><ArrowUpRight className="h-3 w-3" /> entra {formatMoney(inCents)}</span>
        <span className="text-rose-500 flex items-center gap-0.5"><ArrowDownRight className="h-3 w-3" /> sai {formatMoney(outCents)}</span>
        <span className={`font-semibold ${net < 0 ? "text-rose-500" : "text-emerald-500"}`}>saldo {net < 0 ? "−" : "+"}{formatMoney(Math.abs(net))}</span>
      </div>
    );
  };

  const Section = ({ label, items, tone }: { label: string; items: Item[]; tone: "pay" | "receive" }) => {
    const overdue = items.filter((i) => i.bucket === "overdue");
    const todayItems = items.filter((i) => i.bucket === "today");
    const next7 = items.filter((i) => i.bucket === "next7");
    if (items.length === 0) {
      return (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">{label}</p>
          <p className="text-sm text-emerald-500 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {tone === "pay" ? "Nada atrasado nem vencendo nos próximos 7 dias." : "Nenhum recebimento previsto nos próximos 7 dias."}
          </p>
        </div>
      );
    }
    return (
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">{label}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Group title={tone === "pay" ? "Atrasadas" : "Atrasados"} tone="rose" icon={<AlertTriangle className="h-3.5 w-3.5" />} items={overdue} />
          <Group title="Hoje" tone="amber" icon={<CalendarClock className="h-3.5 w-3.5" />} items={todayItems} />
          <Group title="Próximos 7 dias" tone="blue" icon={<CalendarDays className="h-3.5 w-3.5" />} items={next7} />
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold">Previsão de caixa</span>
          <div className="flex flex-wrap gap-2">
            <Chip label="Hoje" inCents={chips.today.in} outCents={chips.today.out} />
            <Chip label="Até 7 dias" inCents={chips.week.in} outCents={chips.week.out} />
          </div>
        </div>

        <Section label="A RECEBER — boletos, pix, crediário e locações" items={incomes} tone="receive" />
        <div className="border-t" />
        <Section label="A PAGAR — contas fixas" items={bills} tone="pay" />

        <div className="flex justify-end gap-4 text-xs text-muted-foreground">
          <Link to="/sales" className="hover:underline">Vendas</Link>
          <Link to="/financeiro/fixas" className="hover:underline">Contas fixas</Link>
        </div>
      </CardContent>
    </Card>
  );
}
