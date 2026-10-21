/**
 * Agenda do técnico no mobile.
 *
 * Lista TODOS os compromissos (visitas + prazos) das OSs dele, agrupados
 * por dia. Não usa FullCalendar (a versão grid de calendar é horrível em
 * tela pequena) — listão vertical é mais natural pra polegar.
 *
 * Cada OS pode gerar até 2 eventos:
 *   - Um pelo `scheduled_at` (visita agendada)
 *   - Um pelo `due_at` (prazo de entrega)
 *
 * Filtra por `technician_id = user.id`. RLS reforça isso server-side.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  RefreshCw,
  Calendar,
  Clock,
  AlertCircle,
  Wrench,
  ChevronRight,
  Flag,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { ServiceOrder, OsStatus } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

type ScheduleEvent = {
  id: string; // chave única (osId + kind)
  osId: string;
  number: number;
  status: OsStatus;
  customer_name: string | null;
  equipment_label: string | null;
  kind: "visita" | "prazo";
  at: Date; // quando
};

const TERMINAL: OsStatus[] = ["entregue", "faturada", "cancelada"];

export default function MobileSchedule() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = true) {
    if (!user?.id || !user?.company_id) return;
    if (showSpinner) setLoading(true);
    else setRefreshing(true);

    // Pega OSs do técnico que tenham visita OU prazo definido
    const { data: osData, error } = await supabase
      .from("service_orders" as any)
      .select("*")
      .eq("company_id", user.company_id)
      .eq("technician_id", user.id)
      .or("scheduled_at.not.is.null,due_at.not.is.null")
      .order("scheduled_at", { ascending: true })
      .limit(500);

    if (error || !osData) {
      setEvents([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const list = osData as ServiceOrder[];

    // Joins paralelos pra cliente e equipamento
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

    const customerMap = new Map(((cr.data as any[]) ?? []).map((c: any) => [c.id, c.name]));
    const equipMap = new Map(
      ((er.data as any[]) ?? []).map((e: any) => [
        e.id,
        [e.brand, e.model].filter(Boolean).join(" ") || e.serial_number || "Equipamento",
      ])
    );

    // Constrói eventos: 1 ou 2 por OS (visita + prazo)
    const evs: ScheduleEvent[] = [];
    for (const o of list) {
      if (TERMINAL.includes(o.status)) continue; // ignora OSs já encerradas
      const customer_name = customerMap.get(o.customer_id || "") ?? null;
      const equipment_label = equipMap.get(o.equipment_id || "") ?? null;
      if (o.scheduled_at) {
        evs.push({
          id: `${o.id}-visita`,
          osId: o.id,
          number: o.number,
          status: o.status,
          customer_name,
          equipment_label,
          kind: "visita",
          at: new Date(o.scheduled_at),
        });
      }
      if (o.due_at) {
        evs.push({
          id: `${o.id}-prazo`,
          osId: o.id,
          number: o.number,
          status: o.status,
          customer_name,
          equipment_label,
          kind: "prazo",
          at: new Date(o.due_at),
        });
      }
    }
    evs.sort((a, b) => a.at.getTime() - b.at.getTime());
    setEvents(evs);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [user?.id, user?.company_id]);

  // Realtime: qualquer mudança em service_orders do técnico → reload leve
  useEffect(() => {
    if (!user?.id || !user?.company_id) return;
    const ch = supabase
      .channel(`mobile-schedule-${user.id}`)
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
  // Buckets de tempo: Atrasados / Hoje / Amanhã / Próx. 7 dias / Mais tarde
  const buckets = useMemo(() => {
    const now = new Date();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const today23 = new Date(); today23.setHours(23, 59, 59, 999);
    const tomorrow0 = new Date(today0); tomorrow0.setDate(tomorrow0.getDate() + 1);
    const tomorrow23 = new Date(today23); tomorrow23.setDate(tomorrow23.getDate() + 1);
    const in7 = new Date(today23); in7.setDate(in7.getDate() + 7);

    const atrasados: ScheduleEvent[] = [];
    const hoje: ScheduleEvent[] = [];
    const amanha: ScheduleEvent[] = [];
    const proximos: ScheduleEvent[] = [];
    const tarde: ScheduleEvent[] = [];

    for (const ev of events) {
      if (ev.at < today0) atrasados.push(ev);
      else if (ev.at <= today23) hoje.push(ev);
      else if (ev.at <= tomorrow23) amanha.push(ev);
      else if (ev.at <= in7) proximos.push(ev);
      else tarde.push(ev);
    }
    return { atrasados, hoje, amanha, proximos, tarde };
  }, [events]);

  /* ─────── RENDER ─────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando agenda...
      </div>
    );
  }

  const totalAtivos = events.length;

  return (
    <div className="px-3 py-3 space-y-4 max-w-2xl mx-auto pb-20">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Agenda</h1>
          <p className="text-xs text-muted-foreground">
            {totalAtivos} compromisso{totalAtivos !== 1 ? "s" : ""}
          </p>
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

      {totalAtivos === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
          Nenhum compromisso agendado.
        </div>
      )}

      {/* SEÇÕES */}
      <Section
        title="Atrasados"
        events={buckets.atrasados}
        tone="rose"
        onNavigate={(id) => navigate(`/m/orders/${id}`)}
      />
      <Section
        title="Hoje"
        events={buckets.hoje}
        tone="violet"
        onNavigate={(id) => navigate(`/m/orders/${id}`)}
      />
      <Section
        title="Amanhã"
        events={buckets.amanha}
        tone="sky"
        onNavigate={(id) => navigate(`/m/orders/${id}`)}
      />
      <Section
        title="Próximos 7 dias"
        events={buckets.proximos}
        tone="emerald"
        onNavigate={(id) => navigate(`/m/orders/${id}`)}
      />
      <Section
        title="Mais tarde"
        events={buckets.tarde}
        tone="zinc"
        onNavigate={(id) => navigate(`/m/orders/${id}`)}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────── */

const TONE_RING: Record<string, string> = {
  rose:    "ring-rose-500/30 bg-rose-500/5",
  violet:  "ring-blue-500/30 bg-blue-500/5",
  sky:     "ring-sky-500/30 bg-sky-500/5",
  emerald: "ring-emerald-500/30 bg-emerald-500/5",
  zinc:    "ring-zinc-500/30 bg-zinc-500/5",
};
const TONE_TEXT: Record<string, string> = {
  rose:    "text-rose-700 dark:text-rose-300",
  violet:  "text-blue-700 dark:text-blue-300",
  sky:     "text-sky-700 dark:text-sky-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  zinc:    "text-zinc-300",
};

function Section({
  title,
  events,
  tone,
  onNavigate,
}: {
  title: string;
  events: ScheduleEvent[];
  tone: string;
  onNavigate: (osId: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <h2 className={`text-xs uppercase tracking-wider font-semibold ${TONE_TEXT[tone]}`}>
          {title}
        </h2>
        <span className="text-[10px] text-muted-foreground">({events.length})</span>
      </div>
      <div className={`rounded-xl ring-1 ${TONE_RING[tone]} divide-y divide-border/40`}>
        {events.map((ev) => (
          <EventRow key={ev.id} ev={ev} onClick={() => onNavigate(ev.osId)} />
        ))}
      </div>
    </section>
  );
}

function EventRow({ ev, onClick }: { ev: ScheduleEvent; onClick: () => void }) {
  const status = OS_STATUS_LABELS[ev.status];
  const sameDay =
    ev.at.toDateString() === new Date().toDateString();
  const dateLabel = sameDay
    ? ev.at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : ev.at.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  const isVisita = ev.kind === "visita";

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 active:bg-muted/30 transition flex items-center gap-3"
    >
      {/* Bloco da esquerda: data/hora */}
      <div className="shrink-0 w-16 text-center">
        <div className="text-[10px] uppercase text-muted-foreground">
          {ev.at.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
        </div>
        <div className="text-sm font-mono font-semibold">
          {ev.at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      {/* Meio: cliente + equipamento + nº OS */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            className={`text-[10px] px-1.5 py-0 ring-1 ${
              isVisita
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
            }`}
          >
            {isVisita ? (
              <><Clock className="h-2.5 w-2.5 mr-0.5" /> Visita</>
            ) : (
              <><Flag className="h-2.5 w-2.5 mr-0.5" /> Prazo</>
            )}
          </Badge>
          <span className="text-[10px] font-mono text-muted-foreground">
            #{String(ev.number).padStart(6, "0")}
          </span>
        </div>
        <div className="font-semibold text-sm truncate">{ev.customer_name || "—"}</div>
        {ev.equipment_label && (
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
            <Wrench className="h-3 w-3 shrink-0" /> {ev.equipment_label}
          </div>
        )}
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}
