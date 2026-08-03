import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import {
  Calendar as CalendarIcon,
  Wrench,
  Plus,
  RefreshCw,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import type { OsStatus, ServiceOrder } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";

type OsRow = ServiceOrder & {
  customers?: { name: string } | null;
};

/** Cores fixas por status (alinhadas ao donut do dashboard). */
const STATUS_COLOR: Record<OsStatus, string> = {
  aberta:                "#38bdf8",
  diagnostico:           "#a78bfa",
  aguardando_aprovacao:  "#facc15",
  aguardando_peca:       "#fb923c",
  em_execucao:           "#22d3ee",
  concluida:             "#4ade80",
  entregue:              "#2dd4bf",
  faturada:              "#14b8a6",
  cancelada:             "#f43f5e",
};

const TERMINAL: OsStatus[] = ["entregue", "faturada", "cancelada"];

export default function Schedule() {
  const { user } = useAuth();
  const perms = usePermissions();
  const companyId = user?.company_id;
  const navigate = useNavigate();
  const calendarRef = useRef<FullCalendar | null>(null);

  const [items, setItems] = useState<OsRow[]>([]);
  const [team, setTeam] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterTechnician, setFilterTechnician] = useState<"all" | "unassigned" | string>(
    perms.isPureTechnician ? user?.id || "all" : "all"
  );
  const [showDueDates, setShowDueDates] = useState(false);

  /* ===================== LOAD ===================== */
  async function load() {
    if (!companyId) return;
    setLoading(true);
    // Pega tudo que tem visita ou prazo (via OR). RLS já filtra pra técnico/vendedor.
    const { data, error } = await supabase
      .from("service_orders" as any)
      .select("*, customers ( name )")
      .eq("company_id", companyId)
      .or("scheduled_at.not.is.null,due_at.not.is.null")
      .order("scheduled_at", { ascending: true })
      .limit(1000);
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar agenda", description: error.message, variant: "destructive" });
      return;
    }
    setItems(((data as any[]) ?? []) as OsRow[]);
  }
  useEffect(() => { load(); }, [companyId]);

  // Carrega equipe (apenas pra admin/gerente filtrar)
  useEffect(() => {
    if (!companyId || !perms.isManager) return;
    supabase.from("profiles" as any).select("id, nome").eq("company_id", companyId).order("nome")
      .then(({ data }) => setTeam(((data as any[]) ?? []) as any));
  }, [companyId, perms.isManager]);

  /* ===================== EVENTOS PRO FULLCALENDAR ===================== */
  const events = useMemo(() => {
    const list: any[] = [];
    for (const o of items) {
      // Filtro técnico (admin/gerente)
      if (filterTechnician === "unassigned" && o.technician_id) continue;
      if (filterTechnician !== "all" && filterTechnician !== "unassigned"
          && o.technician_id !== filterTechnician) continue;

      const isFinal = TERMINAL.includes(o.status);
      const baseTitle = `#${String(o.number).padStart(4, "0")} • ${o.customers?.name || "—"}`;

      // Visita
      if (o.scheduled_at) {
        list.push({
          id: `visit-${o.id}`,
          title: `🚐 ${baseTitle}`,
          start: o.scheduled_at,
          backgroundColor: STATUS_COLOR[o.status],
          borderColor: STATUS_COLOR[o.status],
          textColor: isFinal ? "#1e293b" : "#0f172a",
          extendedProps: { os: o, kind: "visit" },
          editable: !isFinal && (perms.isManager || perms.isVendedor || perms.isTecnico),
        });
      }

      // Prazo (só se toggle)
      if (showDueDates && o.due_at) {
        const overdue = !isFinal && new Date(o.due_at) < new Date();
        list.push({
          id: `due-${o.id}`,
          title: `⏰ ${baseTitle}${overdue ? " (atrasada)" : ""}`,
          start: o.due_at,
          backgroundColor: overdue ? "#f43f5e" : STATUS_COLOR[o.status] + "55",
          borderColor: overdue ? "#f43f5e" : STATUS_COLOR[o.status],
          textColor: "#0f172a",
          extendedProps: { os: o, kind: "due" },
          editable: false, // prazo não arrasta — só visita reagenda
        });
      }
    }
    return list;
  }, [items, filterTechnician, showDueDates, perms]);

  /* ===================== DRAG-AND-DROP ===================== */
  async function handleEventDrop(info: any) {
    const { os, kind } = info.event.extendedProps as { os: OsRow; kind: "visit" | "due" };
    if (kind !== "visit") {
      info.revert();
      return;
    }
    const newDate: Date = info.event.start;
    const { error } = await supabase
      .from("service_orders" as any)
      .update({ scheduled_at: newDate.toISOString() })
      .eq("id", os.id);
    if (error) {
      toast({ title: "Erro ao reagendar", description: error.message, variant: "destructive" });
      info.revert();
      return;
    }
    toast({
      title: `OS #${String(os.number).padStart(6, "0")} reagendada`,
      description: newDate.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
    });
    load();
  }

  /* ===================== CLIQUES ===================== */
  function handleEventClick(info: any) {
    const os = (info.event.extendedProps as { os: OsRow }).os;
    navigate(`/service-orders/${os.id}`);
  }

  function handleDateSelect(info: any) {
    // Cria OS já com a visita preenchida na data clicada
    const dt = new Date(info.start);
    const localISO = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    navigate(`/service-orders/new?scheduled_at=${encodeURIComponent(localISO)}`);
  }

  /* ===================== STATS ===================== */
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);

    const visible = items.filter((o) => {
      if (filterTechnician === "unassigned" && o.technician_id) return false;
      if (filterTechnician !== "all" && filterTechnician !== "unassigned"
          && o.technician_id !== filterTechnician) return false;
      return true;
    });
    const todays = visible.filter((o) => {
      if (!o.scheduled_at) return false;
      const d = new Date(o.scheduled_at);
      return d >= today && d < tomorrow;
    });
    const week = visible.filter((o) => {
      if (!o.scheduled_at) return false;
      const d = new Date(o.scheduled_at);
      return d >= today && d < weekEnd;
    });
    const overdueDue = visible.filter((o) =>
      o.due_at && new Date(o.due_at) < new Date() && !TERMINAL.includes(o.status)
    );
    return { todayCount: todays.length, weekCount: week.length, overdueCount: overdueDue.length };
  }, [items, filterTechnician]);

  /* ===================== RENDER ===================== */
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CalendarIcon className="h-7 w-7" /> Agenda
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visitas técnicas agendadas. Arraste para reagendar, clique pra abrir a OS.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => navigate("/service-orders/new")}>
            <Plus className="h-4 w-4 mr-1" /> Nova OS
          </Button>
        </div>
      </div>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Visitas hoje</div>
          <div className="text-2xl font-bold mt-1 text-sky-400">{stats.todayCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Próximos 7 dias</div>
          <div className="text-2xl font-bold mt-1">{stats.weekCount}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">OS em atraso (prazo)</div>
          <div className={`text-2xl font-bold mt-1 ${stats.overdueCount > 0 ? "text-rose-400" : ""}`}>
            {stats.overdueCount}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        {perms.isManager && (
          <Select value={filterTechnician} onValueChange={setFilterTechnician}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os técnicos</SelectItem>
              <SelectItem value="unassigned">Não atribuído</SelectItem>
              {team.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Label htmlFor="show-due" className="text-xs cursor-pointer">
            Mostrar prazos (⏰)
          </Label>
          <Switch
            id="show-due"
            checked={showDueDates}
            onCheckedChange={setShowDueDates}
          />
        </div>

        <Badge variant="secondary" className="text-xs">
          {events.length} {events.length === 1 ? "evento" : "eventos"} no calendário
        </Badge>
      </div>

      {/* Calendário */}
      <div className="rounded-lg border bg-card p-3 fc-delvor">
        <FullCalendar
          ref={calendarRef as any}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          locale="pt-br"
          firstDay={0}
          allDaySlot={false}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          buttonText={{
            today: "hoje",
            month: "mês",
            week: "semana",
            day: "dia",
          }}
          slotMinTime="07:00:00"
          slotMaxTime="20:00:00"
          slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          height="auto"
          events={events}
          editable
          selectable
          selectMirror
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventDrop}
          select={handleDateSelect}
          nowIndicator
          weekends
          dayMaxEventRows={4}
        />
      </div>

      {loading && (
        <div className="text-xs text-muted-foreground text-center">Carregando...</div>
      )}

      {/* Estilos pra escurecer o FullCalendar com a paleta do app */}
      <style>{`
        .fc-delvor .fc {
          --fc-border-color: hsl(var(--border));
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: hsl(var(--muted) / 0.3);
          --fc-list-event-hover-bg-color: hsl(var(--muted) / 0.5);
          --fc-today-bg-color: hsl(var(--primary) / 0.08);
          color: hsl(var(--foreground));
        }
        .fc-delvor .fc .fc-button {
          background: hsl(var(--secondary));
          border-color: hsl(var(--border));
          color: hsl(var(--secondary-foreground));
          font-size: 0.85rem;
          padding: 0.25rem 0.6rem;
          text-transform: lowercase;
        }
        .fc-delvor .fc .fc-button:hover {
          background: hsl(var(--accent));
          border-color: hsl(var(--border));
        }
        .fc-delvor .fc .fc-button-primary:not(:disabled).fc-button-active,
        .fc-delvor .fc .fc-button-primary:not(:disabled):active {
          background: rgb(124, 58, 237);
          border-color: rgb(124, 58, 237);
          color: white;
        }
        .fc-delvor .fc .fc-toolbar-title {
          font-size: 1.1rem;
          font-weight: 600;
        }
        .fc-delvor .fc .fc-event {
          font-size: 0.75rem;
          padding: 1px 4px;
          cursor: pointer;
          border-radius: 4px;
        }
        .fc-delvor .fc .fc-col-header-cell-cushion,
        .fc-delvor .fc .fc-daygrid-day-number {
          color: hsl(var(--foreground));
          padding: 4px;
        }
        .fc-delvor .fc .fc-timegrid-slot-label-cushion,
        .fc-delvor .fc .fc-timegrid-axis-cushion {
          font-size: 0.7rem;
          color: hsl(var(--muted-foreground));
        }
      `}</style>
    </div>
  );
}
