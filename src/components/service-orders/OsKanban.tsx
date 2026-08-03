import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { Wrench, AlertTriangle, Clock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import type { OsPriority, OsStatus, ServiceOrder } from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";
import { Badge } from "@/components/ui/badge";

type OsWithCustomer = ServiceOrder & {
  customers?: { name: string; trade_name: string | null } | null;
};

interface OsKanbanProps {
  items: OsWithCustomer[];
  onChange?: () => void;
}

/** Colunas exibidas no Kanban (faturada e cancelada ficam ocultas pra não poluir). */
const COLUMNS: OsStatus[] = [
  "aberta",
  "diagnostico",
  "aguardando_aprovacao",
  "aguardando_peca",
  "em_execucao",
  "concluida",
  "entregue",
];

const PRIORITY_TONE: Record<OsPriority, string> = {
  baixa:   "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  normal:  "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  alta:    "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  urgente: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

function Card({ os }: { os: OsWithCustomer }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: os.id,
    data: { os },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const isOverdue = !!os.due_at && new Date(os.due_at) < new Date()
    && !["concluida", "entregue", "faturada", "cancelada"].includes(os.status);
  // Data mostrada no card: prioriza prazo (deadline), senão visita agendada
  const displayDate = os.due_at || os.scheduled_at;
  const displayLabel = os.due_at ? "Prazo" : "Visita";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group rounded-md border bg-card p-3 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? "opacity-50 ring-2 ring-blue-500" : "hover:border-blue-500/50"
      }`}
    >
      <Link
        to={`/service-orders/${os.id}`}
        onClick={(e) => isDragging && e.preventDefault()}
        className="block"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
          <span className="font-mono">#{String(os.number).padStart(6, "0")}</span>
          <Badge className={`${PRIORITY_TONE[os.priority]} ring-1 text-[10px]`}>
            {os.priority}
          </Badge>
        </div>
        <div className="text-sm font-medium truncate">{os.customers?.name || "—"}</div>
        {os.reported_issue && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{os.reported_issue}</div>
        )}
        <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            {isOverdue && (
              <span className="inline-flex items-center text-amber-400">
                <AlertTriangle className="h-3 w-3 mr-0.5" /> atraso
              </span>
            )}
            {displayDate && (
              <span
                className={`inline-flex items-center ${isOverdue ? "text-rose-400 font-medium" : ""}`}
                title={displayLabel}
              >
                <Clock className="h-3 w-3 mr-0.5" />
                {new Date(displayDate).toLocaleDateString("pt-BR")}
              </span>
            )}
          </span>
          {os.total > 0 && <span className="font-mono">{os.total.toFixed(0)}</span>}
        </div>
      </Link>
    </div>
  );
}

function Column({ status, items }: { status: OsStatus; items: OsWithCustomer[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = OS_STATUS_LABELS[status];

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border ${
        isOver ? "border-blue-500 bg-blue-500/5" : "bg-card"
      } min-w-[260px] max-w-[280px] flex-shrink-0`}
    >
      <div className="p-3 border-b sticky top-0 bg-inherit z-10">
        <div className="flex items-center justify-between">
          <Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
      </div>
      <div className="p-2 space-y-2 flex-1 max-h-[calc(100vh-300px)] overflow-y-auto">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            <Wrench className="h-4 w-4 mx-auto mb-1 opacity-50" />
            vazio
          </div>
        )}
        {items.map((os) => <Card key={os.id} os={os} />)}
      </div>
    </div>
  );
}

export default function OsKanban({ items, onChange }: OsKanbanProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const grouped = useMemo(() => {
    const m: Record<OsStatus, OsWithCustomer[]> = {
      aberta: [], diagnostico: [], aguardando_aprovacao: [], aguardando_peca: [],
      em_execucao: [], concluida: [], entregue: [], faturada: [], cancelada: [],
    };
    for (const os of items) {
      if (m[os.status]) m[os.status].push(os);
    }
    return m;
  }, [items]);

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const newStatus = over.id as OsStatus;
    const os = (active.data.current?.os as OsWithCustomer) || null;
    if (!os || os.status === newStatus) return;

    // Update otimista no banco
    const { error } = await supabase
      .from("service_orders" as any)
      .update({ status: newStatus })
      .eq("id", os.id);

    if (error) {
      toast({ title: "Erro ao mover", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `OS #${String(os.number).padStart(6, "0")} → ${OS_STATUS_LABELS[newStatus].label}` });
    onChange?.();
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((s) => <Column key={s} status={s} items={grouped[s]} />)}
      </div>
    </DndContext>
  );
}
