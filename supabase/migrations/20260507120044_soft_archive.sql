-- =====================================================================
-- Soft archive — permite esconder dados antigos sem apagar.
-- Uso: painel master arquiva vendas/produtos/OS/compras de uma empresa
-- com base numa data de corte. Restauração é setar hidden_at = null.
--
-- As listagens filtram por hidden_at is null. Consultas de detalhe
-- (venda individual, item vendido em relatório) mantêm o registro.
-- =====================================================================

alter table public.sales
  add column if not exists hidden_at timestamptz;

alter table public.products
  add column if not exists hidden_at timestamptz;

alter table public.service_orders
  add column if not exists hidden_at timestamptz;

alter table public.purchases
  add column if not exists hidden_at timestamptz;

create index if not exists sales_hidden_at_idx          on public.sales(hidden_at);
create index if not exists products_hidden_at_idx       on public.products(hidden_at);
create index if not exists service_orders_hidden_at_idx on public.service_orders(hidden_at);
create index if not exists purchases_hidden_at_idx      on public.purchases(hidden_at);
