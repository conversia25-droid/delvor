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
-- 7) RAMO AUTO ESCOLA — empresa demo + dados + USUÁRIO DE TESTE (local)
-- =====================================================================
-- Empresa demo do ramo auto_escola
insert into public.companies (id, name, cnpj, email, active, vertical)
values (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Auto Escola Pilotto (Demo)',
  '11.111.111/0001-11',
  'demo@autoescola.local',
  true,
  'auto_escola'
) on conflict (id) do update set vertical = 'auto_escola';

-- Alunos de exemplo
insert into public.students (id, company_id, name, cpf, phone, category_goal) values
  ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-000000000002','Maria Oliveira Souza','041.882.117-30','(11) 90000-0001','B'),
  ('00000000-0000-0000-0000-0000000a0002','00000000-0000-0000-0000-000000000002','João Pedro Santos','128.554.902-11','(11) 90000-0002','A'),
  ('00000000-0000-0000-0000-0000000a0003','00000000-0000-0000-0000-000000000002','Ana Beatriz Lima','093.771.640-58','(11) 90000-0003','AB'),
  ('00000000-0000-0000-0000-0000000a0004','00000000-0000-0000-0000-000000000002','Bruno Ferreira','200.318.475-96','(11) 90000-0004','D'),
  ('00000000-0000-0000-0000-0000000a0005','00000000-0000-0000-0000-000000000002','Camila Rodrigues','315.007.228-40','(11) 90000-0005','B'),
  ('00000000-0000-0000-0000-0000000a0006','00000000-0000-0000-0000-000000000002','Thiago Nunes','087.446.913-72','(11) 90000-0006','AB')
on conflict (id) do nothing;

-- Matrículas de exemplo (espalhadas pelo kanban)
insert into public.enrollments (company_id, student_id, category, status, completed_theory_hours, completed_practice_hours, price) values
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000a0001','B','matriculado',0,0,1200),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000a0003','AB','aulas_teoricas',28,0,1500),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000a0002','A','prova_teorica',45,0,900),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000a0004','D','aulas_praticas',45,8,1800),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000a0005','B','aulas_praticas',45,14,1200),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000a0006','AB','aprovado',45,20,1500)
on conflict do nothing;

-- Usuário de teste (login: autoescola@teste.local / senha: autoescola123)
do $$
declare
  v_uid     uuid := '00000000-0000-0000-0000-0000000000aa';
  v_company uuid := '00000000-0000-0000-0000-000000000002';
  v_email   text := 'autoescola@teste.local';
begin
  if not exists (select 1 from auth.users where id = v_uid) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, crypt('autoescola123', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome','Ricardo Pilotto'), now(), now()
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', now(), now(), now()
    );
  end if;

  -- handle_new_user já criou o profile; bootstrap_first_user pode tê-lo vinculado
  -- à demo de assistência. Força o vínculo à AUTO ESCOLA e o papel de admin.
  update public.profiles
     set company_id = v_company, nome = 'Ricardo Pilotto', email = v_email
   where id = v_uid;

  delete from public.user_roles where user_id = v_uid;
  insert into public.user_roles (user_id, role, company_id)
  values (v_uid, 'admin'::public.app_role, v_company)
  on conflict do nothing;
end $$;

-- =====================================================================
-- USE:
--   ASSISTÊNCIA TÉCNICA:
--     1) Faça signup pela tela /login com qualquer email/senha
--     2) O trigger te vincula à empresa "OSManager Demo" como admin
--
--   AUTO ESCOLA (usuário pronto pra testar):
--     • Email: autoescola@teste.local
--     • Senha: autoescola123
--     • Abre já no ramo Auto Escola (menu Alunos / Matrículas)
-- =====================================================================
