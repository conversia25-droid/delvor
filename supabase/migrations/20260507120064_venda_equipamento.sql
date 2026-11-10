-- =====================================================================
-- 64 — Equipamento na venda
-- Venda com serviço (ex.: upgrade de PC) passa a apontar o equipamento do
-- cliente, que sai no PDF. Coluna opcional: venda sem serviço fica nula.
-- =====================================================================

alter table public.sales
  add column if not exists equipment_id uuid references public.customer_equipments(id) on delete set null;

create index if not exists sales_equipment_idx on public.sales(equipment_id) where equipment_id is not null;
