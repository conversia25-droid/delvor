-- =====================================================================
-- ADD-ON FINANCEIRO — Fase A (parte 2: seed + backfill)
-- Cria categorias padrão de despesa pra cada empresa e trigger pra
-- popular automaticamente ao criar uma company nova.
-- Isolado da parte 1 pra não desfazer as tabelas caso o backfill
-- estoure em alguma empresa.
-- =====================================================================

create or replace function public.seed_default_expense_categories(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.expense_categories (company_id, name, kind)
  values
    (p_company, 'Aluguel',       'despesa'),
    (p_company, 'Energia',       'despesa'),
    (p_company, 'Água',          'despesa'),
    (p_company, 'Internet',      'despesa'),
    (p_company, 'Telefone',      'despesa'),
    (p_company, 'Salário',       'despesa'),
    (p_company, 'Pró-labore',    'despesa'),
    (p_company, 'Contador',      'despesa'),
    (p_company, 'Marketing',     'despesa'),
    (p_company, 'Manutenção',    'despesa'),
    (p_company, 'Impostos',      'despesa'),
    (p_company, 'Fornecedor',    'despesa'),
    (p_company, 'Outros',        'despesa')
  on conflict (company_id, name) do nothing;
end;
$$;

-- Backfill: aplica as categorias padrão pra toda company já existente.
do $$
declare
  c record;
begin
  for c in select id from public.companies loop
    perform public.seed_default_expense_categories(c.id);
  end loop;
end $$;

-- Trigger: quando uma nova company é criada, semeia as categorias padrão.
create or replace function public.on_company_created_seed_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_expense_categories(new.id);
  return new;
end;
$$;

drop trigger if exists trg_company_seed_finance on public.companies;
create trigger trg_company_seed_finance
  after insert on public.companies
  for each row execute function public.on_company_created_seed_finance();
