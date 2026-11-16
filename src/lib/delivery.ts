/* Expedição + entregas/coletas com motoqueiro (migration 72).
   Idêntico nos dois repos. */
import { supabase } from "@/integrations/supabase/client";
import { sendWhatsApp } from "@/lib/whatsapp";

const db = supabase as any;

export type TaskKind = "entrega" | "coleta";
export type TaskStage = "separar" | "pronto" | "atribuida" | "em_rota" | "concluida" | "falhou" | "cancelada" | "retirada";

export const STAGE_LABEL: Record<TaskStage, string> = {
  separar: "A separar",
  pronto: "Pronto",
  atribuida: "Com o motoqueiro",
  em_rota: "Saiu",
  concluida: "Concluída",
  falhou: "Não deu",
  cancelada: "Cancelada",
  retirada: "Retirado no balcão",
};
export const KIND_LABEL: Record<TaskKind, string> = { entrega: "Entrega", coleta: "Coleta" };
export const COLLECT_METHODS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "cartao_debito", label: "Cartão débito" },
  { value: "cartao_credito", label: "Cartão crédito" },
];

export type Courier = {
  id: string; company_id: string; name: string; whatsapp: string | null;
  fee_delivery: number; fee_pickup: number; active: boolean; notes: string | null; access_token: string;
};

export type DeliveryTask = {
  id: string; company_id: string; kind: TaskKind; stage: TaskStage;
  sale_id: string | null; service_order_id: string | null; customer_id: string | null;
  customer_name: string | null; phone: string | null; address: string | null; address_notes: string | null;
  due_date: string | null; collect_amount: number; courier_id: string | null; fee: number;
  assigned_at: string | null; started_at: string | null; done_at: string | null;
  received_by: string | null; collected_amount: number | null; collected_method: string | null;
  fail_reason: string | null; notes: string | null; settlement_id: string | null; created_at: string;
  /* preenchidos no carregamento */
  ref?: string | null;
};

export const MISSING_DELIVERY_MSG = "A expedição precisa da atualização do banco (migration 72).";
export function isMissingDelivery(err: { code?: string; message?: string } | null | undefined) {
  if (!err) return false;
  return ["42P01", "PGRST205", "PGRST202", "42883"].includes(err.code || "") || /delivery_tasks|couriers|does not exist|could not find/i.test(err.message || "");
}

const num = (v: unknown) => Number(v || 0);

export async function listCouriers(companyId: string, onlyActive = false): Promise<{ data: Courier[]; error: any }> {
  let q = db.from("couriers").select("*").eq("company_id", companyId).order("name");
  if (onlyActive) q = q.eq("active", true);
  const { data, error } = await q;
  return { data: ((data as any[]) || []).map((c) => ({ ...c, fee_delivery: num(c.fee_delivery), fee_pickup: num(c.fee_pickup) })), error };
}

export async function saveCourier(c: Partial<Courier> & { company_id: string; name: string }) {
  const payload = {
    company_id: c.company_id, name: c.name.trim(), whatsapp: c.whatsapp?.replace(/\D/g, "") || null,
    fee_delivery: c.fee_delivery ?? 0, fee_pickup: c.fee_pickup ?? 0, active: c.active ?? true, notes: c.notes?.trim() || null,
  };
  const { error } = c.id
    ? await db.from("couriers").update(payload).eq("id", c.id)
    : await db.from("couriers").insert(payload);
  return { error: error?.message ?? null };
}

/** Tarefas da empresa (abertas + finalizadas desde `doneSince`), com "Venda 000123"/"OS 000045". */
export async function listTasks(companyId: string, doneSince: string): Promise<{ data: DeliveryTask[]; error: any }> {
  const { data, error } = await db
    .from("delivery_tasks")
    .select("*, sales(number), service_orders(number)")
    .eq("company_id", companyId)
    .or(`stage.in.(separar,pronto,atribuida,em_rota),done_at.gte.${doneSince},and(stage.eq.cancelada,updated_at.gte.${doneSince}),and(stage.eq.retirada,updated_at.gte.${doneSince})`)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return { data: [], error };
  return {
    data: ((data as any[]) || []).map((t) => ({
      ...t,
      collect_amount: num(t.collect_amount), fee: num(t.fee),
      collected_amount: t.collected_amount == null ? null : num(t.collected_amount),
      due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
      ref: t.sales?.number != null ? `Venda ${String(t.sales.number).padStart(6, "0")}`
         : t.service_orders?.number != null ? `OS ${String(t.service_orders.number).padStart(6, "0")}` : null,
    })),
    error: null,
  };
}

/** Tarefas finalizadas e ainda não acertadas de um motoqueiro. */
export async function listUnsettled(courierId: string): Promise<DeliveryTask[]> {
  const { data } = await db
    .from("delivery_tasks")
    .select("*, sales(number), service_orders(number)")
    .eq("courier_id", courierId)
    .is("settlement_id", null)
    .in("stage", ["concluida", "falhou"])
    .order("done_at");
  return ((data as any[]) || []).map((t) => ({
    ...t, fee: num(t.fee), collect_amount: num(t.collect_amount),
    collected_amount: t.collected_amount == null ? null : num(t.collected_amount),
    ref: t.sales?.number != null ? `Venda ${String(t.sales.number).padStart(6, "0")}`
       : t.service_orders?.number != null ? `OS ${String(t.service_orders.number).padStart(6, "0")}` : null,
  }));
}

/** Endereço do cadastro do cliente numa linha só. */
export function customerAddress(c: any): string {
  if (!c) return "";
  return [
    c.street && c.number ? `${c.street}, ${c.number}` : c.street,
    c.complement, c.district,
    c.city && c.state ? `${c.city}/${c.state}` : c.city,
  ].filter(Boolean).join(" — ");
}

/** Cria a tarefa a partir de uma venda ou OS (puxa cliente, telefone, endereço e valor a cobrar). */
export async function createTaskFrom(opts: {
  companyId: string; kind: TaskKind; saleId?: string | null; serviceOrderId?: string | null;
  stage?: TaskStage; dueDate?: string | null; collectAmount?: number | null; address?: string | null; notes?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  let customerId: string | null = null;
  let collect = opts.collectAmount ?? null;
  let osAddress: string | null = null;
  if (opts.saleId) {
    const { data: s } = await db.from("sales").select("customer_id").eq("id", opts.saleId).maybeSingle();
    customerId = s?.customer_id ?? null;
    if (collect == null) {
      const { data: pays } = await db.from("sale_payments").select("amount, status").eq("sale_id", opts.saleId).in("status", ["pendente", "parcial"]);
      collect = ((pays as any[]) || []).reduce((t, p) => t + num(p.amount), 0);
    }
  } else if (opts.serviceOrderId) {
    const { data: o } = await db.from("service_orders").select("customer_id, delivery_address").eq("id", opts.serviceOrderId).maybeSingle();
    customerId = o?.customer_id ?? null;
    osAddress = o?.delivery_address ?? null;
  }
  const { data: c } = customerId
    ? await db.from("customers").select("name, whatsapp, phone, street, number, complement, district, city, state").eq("id", customerId).maybeSingle()
    : { data: null };
  const { data, error } = await db.from("delivery_tasks").insert({
    company_id: opts.companyId, kind: opts.kind,
    sale_id: opts.saleId || null, service_order_id: opts.serviceOrderId || null, customer_id: customerId,
    customer_name: c?.name ?? null, phone: c?.whatsapp || c?.phone || null,
    address: opts.address || osAddress || customerAddress(c) || null,
    stage: opts.stage || (opts.kind === "coleta" ? "pronto" : "separar"),
    due_date: opts.dueDate || null, collect_amount: Math.max(0, collect ?? 0), notes: opts.notes || null,
  }).select("id").single();
  if (error) return { id: null, error: isMissingDelivery(error) ? MISSING_DELIVERY_MSG : error.message };
  return { id: data?.id ?? null, error: null };
}

export async function updateTask(id: string, patch: Partial<DeliveryTask>) {
  const { error } = await db.from("delivery_tasks").update(patch).eq("id", id);
  return { error: error?.message ?? null };
}

export function courierLink(token: string) {
  return `${window.location.origin}/entregador?t=${token}`;
}
export function mapsLink(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Mensagem do alerta pro motoqueiro: uma linha por tarefa + link dele. */
export function courierMessage(courier: Courier, tasks: DeliveryTask[], company?: string | null) {
  const lines = tasks.map((t, i) => {
    const what = `${KIND_LABEL[t.kind]}${t.ref ? ` · ${t.ref}` : ""}`;
    const cobrar = t.kind === "entrega" && t.collect_amount > 0 ? `\n   💰 Cobrar ${brl(t.collect_amount)}` : "";
    const end = t.address ? `\n   📍 ${t.address}${t.address_notes ? ` (${t.address_notes})` : ""}\n   ${mapsLink(t.address)}` : "";
    const tel = t.phone ? `\n   📞 ${t.phone}` : "";
    return `${i + 1}. ${what} — ${t.customer_name || "cliente"}${end}${tel}${cobrar}`;
  });
  return [
    `Olá, ${courier.name.split(" ")[0]}! ${tasks.length > 1 ? `${tasks.length} novas tarefas` : "Nova tarefa"}${company ? ` da ${company}` : ""}:`,
    "",
    ...lines,
    "",
    `Marque como entregue/coletado por aqui: ${courierLink(courier.access_token)}`,
  ].join("\n");
}

/** Atribui as tarefas ao motoqueiro (com a taxa dele) e manda o alerta no WhatsApp. */
export async function assignTasks(opts: {
  companyId: string; companyName?: string | null; userId?: string | null; courier: Courier; tasks: DeliveryTask[];
}): Promise<{ error: string | null; sent: boolean; channel?: string }> {
  const now = new Date().toISOString();
  for (const t of opts.tasks) {
    const { error } = await db.from("delivery_tasks").update({
      courier_id: opts.courier.id, stage: "atribuida", assigned_at: now,
      fee: t.kind === "coleta" ? opts.courier.fee_pickup : opts.courier.fee_delivery,
    }).eq("id", t.id);
    if (error) return { error: error.message, sent: false };
  }
  if (!opts.courier.whatsapp) return { error: null, sent: false };
  const r = await sendWhatsApp(opts.courier.whatsapp, courierMessage(opts.courier, opts.tasks, opts.companyName), {
    companyId: opts.companyId, userId: opts.userId,
  });
  return { error: null, sent: r.ok, channel: r.mode };
}

export async function settleCourier(courierId: string, taskIds: string[], notes?: string | null) {
  const { data, error } = await db.rpc("settle_courier", { p_courier: courierId, p_tasks: taskIds, p_notes: notes || null });
  return { id: (data as string) ?? null, error: error ? (isMissingDelivery(error) ? MISSING_DELIVERY_MSG : error.message) : null };
}

/* ---------- link público do motoqueiro ---------- */
export type CourierView = {
  courier: { name: string }; company: string | null;
  tasks: (Pick<DeliveryTask, "id" | "kind" | "stage" | "customer_name" | "phone" | "address" | "address_notes" | "due_date" | "collect_amount" | "notes" | "done_at" | "collected_amount" | "collected_method"> & { ref: string | null; items: string | null })[];
};
export async function fetchCourierView(token: string): Promise<{ data: CourierView | null; error: string | null }> {
  const { data, error } = await db.rpc("courier_tasks_by_token", { p_token: token });
  if (error) return { data: null, error: error.message };
  return { data: (data as CourierView) ?? null, error: null };
}
export async function courierAction(token: string, taskId: string, action: "saiu" | "concluida" | "falhou", extra: {
  collected?: number | null; method?: string | null; receivedBy?: string | null; reason?: string | null;
} = {}) {
  const { error } = await db.rpc("courier_update_task", {
    p_token: token, p_task: taskId, p_action: action,
    p_collected: extra.collected ?? null, p_method: extra.method ?? null,
    p_received_by: extra.receivedBy ?? null, p_reason: extra.reason ?? null,
  });
  return { error: error?.message ?? null };
}
