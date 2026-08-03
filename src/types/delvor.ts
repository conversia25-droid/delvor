/**
 * Tipos do domínio Delvor.
 *
 * Esses tipos espelham o schema dos arquivos `supabase/setup/*.sql`.
 * Quando você (re)gerar o `integrations/supabase/types.ts` via
 * `supabase gen types typescript --project-id <id>`, esses ficam intactos.
 */

export type PersonType = "PF" | "PJ";
export type EquipmentStatus = "ativo" | "manutencao" | "baixado" | "locacao";
export type ProductType =
  | "equipamento"
  | "suprimento"
  | "peca"
  | "acessorio"
  | "servico_avulso";
export type StockMoveType =
  | "entrada"
  | "saida"
  | "ajuste"
  | "transferencia"
  | "reserva"
  | "baixa_os"
  | "baixa_venda";
export type PurchaseStatus =
  | "rascunho"
  | "pedido"
  | "recebida"
  | "cancelada";
export type SaleStatus =
  | "orcamento"
  | "aprovado"
  | "faturado"
  | "entregue"
  | "cancelado"
  | "perdido";
export type PaymentMethod =
  | "dinheiro"
  | "pix"
  | "boleto"
  | "cartao_credito"
  | "cartao_debito"
  | "credito_avista"
  | "credito_parcelado"
  | "transferencia"
  | "crediario"
  | "outro";
export type PaymentStatus =
  | "pendente"
  | "pago"
  | "parcial"
  | "cancelado"
  | "estornado";
export type OsStatus =
  | "aberta"
  | "diagnostico"
  | "aguardando_aprovacao"
  | "aguardando_peca"
  | "em_execucao"
  | "concluida"
  | "entregue"
  | "faturada"
  | "cancelada";
export type OsPriority = "baixa" | "normal" | "alta" | "urgente";
export type OsOrigin =
  | "balcao"
  | "visita"
  | "remoto"
  | "whatsapp"
  | "telefone"
  | "email"
  | "outro";
export type OsItemKind = "peca" | "servico";

export interface Customer {
  id: string;
  company_id: string;
  person_type: PersonType;
  name: string;
  trade_name: string | null;
  document: string | null;
  state_reg: string | null;
  muni_reg: string | null;
  birthdate: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  remote_jid: string | null;
  zipcode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  tags: string[] | null;
  source: string | null;
  active: boolean;
  blocked: boolean;
  block_reason: string | null;
  assigned_user_id: string | null;
  /** Cliente "interno" — representa a própria empresa para registrar
   *  equipamentos da casa atribuídos a técnicos. Não aparece no comercial. */
  is_internal: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerContact {
  id: string;
  company_id: string;
  customer_id: string;
  name: string;
  role_label: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  created_at: string;
}

export interface CustomerEquipment {
  id: string;
  company_id: string;
  customer_id: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  category: string | null;
  location: string | null;
  status: EquipmentStatus;
  purchase_date: string | null;
  warranty_until: string | null;
  is_rental: boolean;
  rental_value: number | null;
  rental_start: string | null;
  rental_end: string | null;
  contract_url: string | null;
  photo_url: string | null;
  current_counter_bw: number | null;
  current_counter_color: number | null;
  last_counter_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  company_id: string;
  category_id: string | null;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  contact_name: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierCategory {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
}

export interface ProductCategory {
  id: string;
  company_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  company_id: string;
  category_id: string | null;
  supplier_id: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  type: ProductType;
  description: string | null;
  image_url: string | null;
  cost_price: number;
  sale_price: number;
  tax_ncm: string | null;
  tax_cest: string | null;
  stock_qty: number;
  stock_min: number | null;
  stock_max: number | null;
  unit: string;
  compatibility: string[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  hidden_at: string | null;
}

export interface Purchase {
  id: string;
  company_id: string;
  supplier_id: string | null;
  number: number;
  invoice_key: string | null;
  status: PurchaseStatus;
  issue_date: string | null;
  receive_date: string | null;
  total: number;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  qty: number;
  unit_cost: number;
  total: number;
}

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, { label: string; tone: string }> = {
  rascunho:  { label: "Rascunho",  tone: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  pedido:    { label: "Pedido",    tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  recebida:  { label: "Recebida",  tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  cancelada: { label: "Cancelada", tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
};

export type RentalStatus = "ativo" | "suspenso" | "encerrado" | "cancelado";
export type RentalInvoiceStatus = "pendente" | "faturada" | "paga" | "cancelada";
export type MeterReadingSource = "visita" | "remoto" | "cliente_informou" | "tecnico";

export interface RentalContract {
  id: string;
  company_id: string;
  number: number;
  customer_id: string;
  /** Quem fechou o contrato — preenchido automaticamente. */
  seller_id: string | null;
  status: RentalStatus;
  start_date: string;
  end_date: string | null;
  billing_day: number;
  notes: string | null;
  contract_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RentalContractItem {
  id: string;
  contract_id: string;
  equipment_id: string;
  /** Técnico responsável por esse equipamento dentro do contrato. */
  technician_id: string | null;
  monthly_value: number;
  franchise_bw: number | null;
  overage_bw_unit_price: number | null;
  franchise_color: number | null;
  overage_color_unit_price: number | null;
  baseline_counter_bw: number | null;
  baseline_counter_color: number | null;
  notes: string | null;
  created_at: string;
}

export interface RentalMeterReading {
  id: string;
  contract_item_id: string;
  reading_date: string;
  counter_bw: number | null;
  counter_color: number | null;
  source: MeterReadingSource;
  user_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface RentalInvoice {
  id: string;
  company_id: string;
  contract_id: string;
  number: number;
  reference_month: string;
  due_date: string;
  base_total: number;
  overage_total: number;
  total: number;
  status: RentalInvoiceStatus;
  sale_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RentalInvoiceItem {
  id: string;
  invoice_id: string;
  contract_item_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
  kind: "mensalidade" | "excedente_bw" | "excedente_color" | "outro";
}

export const RENTAL_STATUS_LABELS: Record<RentalStatus, { label: string; tone: string }> = {
  ativo:      { label: "Ativo",      tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  suspenso:   { label: "Suspenso",   tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  encerrado:  { label: "Encerrado",  tone: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  cancelado:  { label: "Cancelado",  tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
};

export const RENTAL_INVOICE_STATUS_LABELS: Record<RentalInvoiceStatus, { label: string; tone: string }> = {
  pendente:   { label: "Pendente",   tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  faturada:   { label: "Faturada",   tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  paga:       { label: "Paga",       tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  cancelada:  { label: "Cancelada",  tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
};

export interface ServiceCatalogItem {
  id: string;
  company_id: string;
  code: string | null;
  name: string;
  description: string | null;
  default_price: number;
  default_duration_min: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  company_id: string;
  product_id: string;
  move_type: StockMoveType;
  qty: number;
  unit_cost: number | null;
  reference: string | null;
  ref_table: string | null;
  ref_id: string | null;
  user_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  company_id: string;
  number: number;
  customer_id: string;
  seller_id: string | null;
  status: SaleStatus;
  issue_date: string;
  approved_at: string | null;
  delivery_date: string | null;
  subtotal: number;
  discount: number;
  freight: number;
  total: number;
  notes: string | null;
  internal_notes: string | null;
  payment_terms: string | null;
  source: string | null;
  remote_jid: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  service_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount: number;
  total: number;
  position: number;
  created_at: string;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  asaas_charge_id: string | null;
  receipt_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface ServiceOrder {
  id: string;
  company_id: string;
  number: number;
  customer_id: string;
  equipment_id: string | null;
  technician_id: string | null;
  opened_by: string | null;
  status: OsStatus;
  priority: OsPriority;
  origin: OsOrigin;
  reported_issue: string | null;
  diagnosis: string | null;
  solution: string | null;
  internal_notes: string | null;
  pickup_required: boolean;
  pickup_address: string | null;
  delivery_address: string | null;
  /** Visita técnica agendada — quando o técnico vai ao cliente. */
  scheduled_at: string | null;
  /** Prazo de entrega prometido ao cliente — usado pra detectar atraso. */
  due_at: string | null;
  finished_at: string | null;
  delivered_at: string | null;
  warranty_days: number | null;
  warranty_until: string | null;
  parts_total: number;
  labor_total: number;
  discount: number;
  total: number;
  sale_id: string | null;
  remote_jid: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceOrderItem {
  id: string;
  service_order_id: string;
  kind: OsItemKind;
  product_id: string | null;
  service_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount: number;
  total: number;
  consumed: boolean;
  position: number;
  created_at: string;
}

export interface ServiceOrderHistoryEntry {
  id: string;
  service_order_id: string;
  user_id: string | null;
  from_status: OsStatus | null;
  to_status: OsStatus | null;
  message: string | null;
  is_public: boolean;
  created_at: string;
}

export interface ServiceOrderAttachment {
  id: string;
  service_order_id: string;
  file_name: string;
  file_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  kind: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Catálogo de status com cores e rótulos legíveis. */
export const OS_STATUS_LABELS: Record<OsStatus, { label: string; tone: string }> = {
  aberta:               { label: "Aberta",               tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  diagnostico:          { label: "Em diagnóstico",       tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  aguardando_aprovacao: { label: "Aguard. aprovação",    tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  aguardando_peca:      { label: "Aguard. peça",         tone: "bg-orange-500/15 text-orange-300 ring-orange-500/30" },
  em_execucao:          { label: "Em execução",          tone: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30" },
  concluida:            { label: "Concluída",            tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  entregue:             { label: "Entregue",             tone: "bg-emerald-600/20 text-emerald-200 ring-emerald-600/40" },
  faturada:             { label: "Faturada",             tone: "bg-teal-500/15 text-teal-300 ring-teal-500/30" },
  cancelada:            { label: "Cancelada",            tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
};

export const SALE_STATUS_LABELS: Record<SaleStatus, { label: string; tone: string }> = {
  orcamento: { label: "Orçamento", tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  aprovado:  { label: "Aprovado",  tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  faturado:  { label: "Faturado",  tone: "bg-teal-500/15 text-teal-300 ring-teal-500/30" },
  entregue:  { label: "Entregue",  tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  cancelado: { label: "Cancelado", tone: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
  perdido:   { label: "Perdido",   tone: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
};
