-- =====================================================================
-- ADD-ON FINANCEIRO — Precificação / Margem de produtos
--
-- 1. financial_settings: parâmetros da calculadora por empresa
--    (margem alvo, modo de volume, parcela das fixas absorvida por produto)
-- 2. RPC get_product_sales_volume: agrega qtd vendida por produto numa
--    janela de dias. SECURITY DEFINER porque o papel 'financeiro' não
--    passa na policy sales_select (só admin/gerente/vendedor dono) — e
--    agregar no banco é mais leve do que puxar sale_items pro navegador.
-- 3. RPC set_product_pricing: deixa admin/gerente/financeiro editar SÓ
--    cost_price/sale_price sem abrir a policy products_write inteira
--    (RLS autoriza a linha, não a coluna).
-- =====================================================================

-- ───────── 1. Parâmetros da calculadora ─────────
create table if not exists public.financial_settings (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  -- margem alvo SOBRE O PREÇO DE VENDA (lucro ÷ preço). 30 = de cada R$100 vendidos, R$30 é lucro.
  target_margin_pct     numeric(5,2) not null default 30
                        check (target_margin_pct >= 0 and target_margin_pct < 100),
  -- 'auto' = usa vendas faturadas/entregues da janela; 'manual' = usa manual_monthly_volume
  volume_mode           text not null default 'auto' check (volume_mode in ('auto','manual')),
  volume_window_days    integer not null default 30 check (volume_window_days in (30, 60, 90)),
  manual_monthly_volume integer not null default 0 check (manual_monthly_volume >= 0),
  -- % das despesas fixas que os PRODUTOS precisam absorver. Empresa que vive
  -- 60% de serviço (OS) e 40% de produto coloca 40 — senão o rateio por
  -- unidade fica inflado e todo produto parece dar prejuízo.
  fixed_cost_share_pct  numeric(5,2) not null default 100
                        check (fixed_cost_share_pct between 0 and 100),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.financial_settings enable row level security;

drop policy if exists "fs_select" on public.financial_settings;
create policy "fs_select" on public.financial_settings for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "fs_write" on public.financial_settings;
create policy "fs_write" on public.financial_settings for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));

drop trigger if exists trg_touch_financial_settings on public.financial_settings;
create trigger trg_touch_financial_settings
  before update on public.financial_settings
  for each row execute function public.touch_updated_at();


-- ───────── 2. Volume vendido por produto ─────────
-- Conta só vendas faturadas/entregues, não arquivadas, com issue_date na janela.
create or replace function public.get_product_sales_volume(p_days integer default 30)
returns table (product_id uuid, qty_sold numeric, revenue numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if v_company_id is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar volume de vendas' using errcode = '42501';
  end if;

  return query
    select si.product_id,
           coalesce(sum(si.qty), 0)::numeric   as qty_sold,
           coalesce(sum(si.total), 0)::numeric as revenue
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
     where s.company_id = v_company_id
       and s.hidden_at is null
       and s.status in ('faturado', 'entregue')
       and s.issue_date >= (current_date - make_interval(days => greatest(p_days, 1)))
       and si.product_id is not null
     group by si.product_id;
end;
$$;

grant execute on function public.get_product_sales_volume(integer) to authenticated;


-- ───────── 3. Edição de custo/preço restrita a 2 colunas ─────────
create or replace function public.set_product_pricing(
  p_product_id uuid,
  p_cost_price numeric default null,
  p_sale_price numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if v_company_id is null or not public.has_financial_access() then
    raise exception 'Sem permissão para alterar preços' using errcode = '42501';
  end if;
  if p_cost_price is not null and p_cost_price < 0 then
    raise exception 'Custo não pode ser negativo';
  end if;
  if p_sale_price is not null and p_sale_price < 0 then
    raise exception 'Preço não pode ser negativo';
  end if;

  update public.products
     set cost_price = coalesce(p_cost_price, cost_price),
         sale_price = coalesce(p_sale_price, sale_price),
         updated_at = now()
   where id = p_product_id
     and company_id = v_company_id;

  if not found then
    raise exception 'Produto não encontrado nesta empresa' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.set_product_pricing(uuid, numeric, numeric) to authenticated;
