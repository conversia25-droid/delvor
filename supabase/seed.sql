-- =====================================================================
-- OSManager — Seed local (rodado automaticamente após `supabase db reset`)
-- =====================================================================
-- Cria:
--   • Empresa demo "OSManager Demo"
--   • Categorias e serviços padrão
--   • Trigger que vincula AUTOMATICAMENTE qualquer novo signup à empresa
--     demo como ADMIN — só pra ambiente local, descarta em produção.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) EMPRESA DEMO (idempotente)
-- ---------------------------------------------------------------------
insert into public.companies (id, name, cnpj, email, active)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'OSManager Demo',
  '00.000.000/0001-00',
  'demo@osmanager.local',
  true
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) CATEGORIAS PADRÃO
-- ---------------------------------------------------------------------
insert into public.product_categories (company_id, name)
select '00000000-0000-0000-0000-000000000001'::uuid, c
from unnest(array[
  'Toner','Cartucho','Cilindro/Fusor','Cabo','Periférico',
  'Impressora','Multifuncional','Scanner','Notebook','Acessório'
]) as c
on conflict (company_id, name) do nothing;

-- ---------------------------------------------------------------------
-- 3) SERVIÇOS PADRÃO
-- ---------------------------------------------------------------------
insert into public.services_catalog (company_id, code, name, default_price, default_duration_min)
values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'LIMP', 'Limpeza geral de impressora',     120.00, 60),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'RECG', 'Recarga de toner',                 80.00, 30),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'INST', 'Instalação de impressora em rede',150.00, 60),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'MANT', 'Manutenção preventiva',            200.00, 90),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'LOC',  'Locação mensal',                   150.00, 0),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'DIAG', 'Diagnóstico técnico',               80.00, 30),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'INSF', 'Configuração de software',         120.00, 60)
on conflict (company_id, code) do nothing;

-- ---------------------------------------------------------------------
-- 4) PRODUTOS DE EXEMPLO
-- ---------------------------------------------------------------------
insert into public.products (company_id, name, brand, model, type, sku, sale_price, cost_price, stock_qty, stock_min, unit)
values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Toner HP CF258A',         'HP',     'CF258A',  'suprimento', 'TN-CF258A',  389.00, 220.00, 5,  2, 'UN'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Toner Brother TN-1060',   'Brother','TN-1060', 'suprimento', 'TN-TN1060',  119.00,  68.00, 8,  3, 'UN'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Cartucho HP 664',         'HP',     '664',     'suprimento', 'CT-HP664',    79.00,  39.00, 12, 5, 'UN'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Impressora HP M428dw',    'HP',     'M428dw',  'equipamento','EQ-HPM428',  2890.00,2200.00, 2,  1, 'UN'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Multifuncional Epson L3250','Epson','L3250',  'equipamento','EQ-EPL3250', 1490.00,1100.00, 3,  1, 'UN'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Cabo USB AB 1,5m',        'Genérico','USBAB-1.5','acessorio','AC-USBAB',    19.90,   8.00, 30,10, 'UN'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Fusor HP M428',           'HP',     'RM2-1932','peca',       'PC-FUS428',  720.00, 480.00, 1,  1, 'UN')
on conflict (company_id, sku) do nothing;

-- ---------------------------------------------------------------------
-- 5) AUTO-ATRIBUIR primeiro usuário à empresa demo como ADMIN
--    (somente em ambiente local — não rodar em produção)
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_first_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  demo_company uuid := '00000000-0000-0000-0000-000000000001'::uuid;
begin
  -- Se o profile ainda não tem company, vincula à demo.
  if new.company_id is null then
    update public.profiles set company_id = demo_company where id = new.id;

    -- Garante role admin na empresa demo.
    insert into public.user_roles (user_id, role, company_id)
    values (new.id, 'admin'::public.app_role, demo_company)
    on conflict do nothing;

    -- Promove a super_admin se for o ÚNICO user do sistema (útil para acessar /master).
    if (select count(*) from public.profiles) = 1 then
      insert into public.user_roles (user_id, role, company_id)
      values (new.id, 'super_admin'::public.app_role, null)
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_bootstrap_first_user on public.profiles;
create trigger trg_bootstrap_first_user
  after insert on public.profiles
  for each row execute function public.bootstrap_first_user();

-- ---------------------------------------------------------------------
-- 6) STORAGE — buckets (caso o config.toml não tenha criado ainda)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('os-attachments','os-attachments', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('product-images','product-images', true) on conflict (id) do nothing;

-- =====================================================================
-- USE:
--   1) Faça signup pela tela /login do app com qualquer email/senha
--   2) O trigger vincula você automaticamente à empresa "OSManager Demo"
--      como admin + super_admin (se for o primeiro user)
--   3) Pronto — entra no sistema e vai para Clientes.
-- =====================================================================
