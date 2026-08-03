-- =====================================================================
-- OSManager — Views úteis e seed inicial
-- =====================================================================

-- View: estoque baixo
create or replace view public.v_low_stock as
  select p.*, p.stock_min - p.stock_qty as deficit
    from public.products p
   where p.active = true
     and p.stock_min is not null
     and p.stock_qty < p.stock_min;

-- View: KPIs do dashboard (por empresa)
create or replace view public.v_dashboard_kpis as
  select
    c.id as company_id,
    (select count(*) from public.customers x where x.company_id = c.id and x.active) as customers_active,
    (select count(*) from public.service_orders o
        where o.company_id = c.id
          and o.status not in ('entregue','faturada','cancelada')) as os_open,
    (select count(*) from public.service_orders o
        where o.company_id = c.id and o.status = 'aguardando_peca') as os_waiting_part,
    (select count(*) from public.products p where p.company_id = c.id and p.stock_qty < coalesce(p.stock_min,0)) as products_low_stock,
    (select coalesce(sum(s.total),0) from public.sales s
        where s.company_id = c.id
          and s.status in ('faturado','entregue')
          and s.issue_date >= date_trunc('month', current_date)) as revenue_month
  from public.companies c;

-- ---------------------------------------------------------------------
-- SEED de demonstração — descomente para popular após criar 1 empresa
-- ---------------------------------------------------------------------
/*
-- exemplo: depois de criar sua company, pegue o id e rode:
--   insert categorias e serviços padrão
do $seed$
declare cid uuid;
begin
  select id into cid from public.companies limit 1;
  if cid is null then
    raise notice 'Nenhuma company cadastrada. Crie uma antes.';
    return;
  end if;

  insert into public.product_categories(company_id, name) values
    (cid,'Toner'), (cid,'Cartucho'), (cid,'Cilindro/Fusor'),
    (cid,'Cabo'), (cid,'Periférico'), (cid,'Impressora'), (cid,'Multifuncional')
  on conflict do nothing;

  insert into public.services_catalog(company_id, code, name, default_price, default_duration_min) values
    (cid,'LIMP', 'Limpeza geral de impressora',     120.00, 60),
    (cid,'RECG', 'Recarga de toner',                 80.00, 30),
    (cid,'INST', 'Instalação de impressora em rede', 150.00, 60),
    (cid,'MANT', 'Manutenção preventiva',            200.00, 90),
    (cid,'LOC',  'Locação mensal',                   150.00, 0)
  on conflict do nothing;
end
$seed$;
*/
