-- =====================================================================
-- DELVOR — SQL pendente (tudo junto) — 10/11/2026
-- Projeto: wggvhxtfeucntdunhocn
-- Abrir em: https://supabase.com/dashboard/project/wggvhxtfeucntdunhocn/sql/new
--
-- O banco do ar JÁ TEM da 56 à 66 (conferido em 10/11). Aqui vai só o que falta:
--   47  ramo da empresa (companies.vertical)
--   48  auto escola (alunos, instrutores, veículos, matrículas, aulas, exames)
--   67  despesa fixa "a partir de"
--   59  bucket privado dos anexos do financeiro (por último: é a parte que
--       mais costuma falhar; se o bucket já existir, só atualiza)
--
-- Tudo aqui pode rodar mais de uma vez sem estragar nada.
-- O Studio roda o arquivo inteiro numa transação: se der erro em qualquer
-- ponto, NADA é aplicado. Confira o resultado da consulta no final.
-- =====================================================================

-- ───────── TRAVA: só roda no banco do Delvor ─────────
do $$ begin
  if to_regclass('public.sales') is null
     or to_regclass('public.fixed_expenses') is null
     or to_regclass('public.finance_periods') is null then
    raise exception 'TRAVA: este SQL é do Delvor (projeto wggvhxtfeucntdunhocn). Banco errado — nada foi alterado.';
  end if;
end $$;


-- ##################################################################
-- 20260507120047_company_vertical
-- ##################################################################
-- =====================================================================
-- Delvor — Ramo da empresa (multi-vertical)
-- Cada empresa (tenant) pertence a um ramo. A UI, o menu e a terminologia
-- se adaptam a partir deste campo. Empresas existentes = assistência técnica.
-- =====================================================================

do $$ begin
  create type public.company_vertical as enum
    ('assistencia_tecnica','auto_escola','deposito_construcao');
exception when duplicate_object then null; end $$;

alter table public.companies
  add column if not exists vertical public.company_vertical
  not null default 'assistencia_tecnica';


-- ##################################################################
-- 20260507120048_auto_escola
-- ##################################################################
-- =====================================================================
-- Delvor — Ramo Auto Escola (CFC)
-- Tabelas: students, instructors, vehicles, enrollments, lessons, exams
-- Padrão: company_id + RLS por current_company_id(), trigger updated_at.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STUDENTS (Alunos)
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  cpf           text,
  rg            text,
  birthdate     date,
  photo_url     text,
  email         text,
  phone         text,
  whatsapp      text,
  remote_jid    text,
  zipcode text, street text, number text, complement text,
  district text, city text, state text, country text default 'BR',
  renach        text,
  category_goal text,
  is_renewal    boolean not null default false,
  notes         text,
  tags          text[] default '{}',
  active        boolean not null default true,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, cpf)
);
create index if not exists students_company_idx on public.students(company_id);

-- ---------------------------------------------------------------------
-- INSTRUCTORS (Instrutores)
-- ---------------------------------------------------------------------
create table if not exists public.instructors (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null,
  name          text not null,
  cpf           text,
  credential    text,
  categories    text[] default '{}',
  phone         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists instructors_company_idx on public.instructors(company_id);

-- ---------------------------------------------------------------------
-- VEHICLES (Frota)
-- ---------------------------------------------------------------------
create table if not exists public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  plate         text not null,
  model         text,
  brand         text,
  year          integer,
  category      text,
  status        text not null default 'ativo',
  next_maintenance_at date,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, plate)
);
create index if not exists vehicles_company_idx on public.vehicles(company_id);

-- ---------------------------------------------------------------------
-- ENROLLMENTS (Matrículas) — fluxo em kanban
-- ---------------------------------------------------------------------
do $$ begin
  create type public.enrollment_status as enum
    ('matriculado','aulas_teoricas','prova_teorica','aulas_praticas',
     'prova_pratica','aprovado','reprovado','cancelado');
exception when duplicate_object then null; end $$;

create table if not exists public.enrollments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        bigserial,
  student_id    uuid not null references public.students(id) on delete restrict,
  category      text not null,
  status        public.enrollment_status not null default 'matriculado',
  required_theory_hours    integer default 45,
  required_practice_hours  integer default 20,
  completed_theory_hours   integer not null default 0,
  completed_practice_hours integer not null default 0,
  price         numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  sale_id       uuid references public.sales(id) on delete set null,
  enrolled_at   date not null default current_date,
  finished_at   date,
  internal_notes text,
  remote_jid    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists enrollments_company_idx on public.enrollments(company_id);
create index if not exists enrollments_student_idx  on public.enrollments(student_id);
create index if not exists enrollments_status_idx   on public.enrollments(status);

-- ---------------------------------------------------------------------
-- LESSONS (Aulas)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.lesson_type as enum ('teorica','pratica');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.lesson_status as enum ('agendada','concluida','faltou','cancelada');
exception when duplicate_object then null; end $$;

create table if not exists public.lessons (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  instructor_id uuid references public.instructors(id) on delete set null,
  vehicle_id    uuid references public.vehicles(id) on delete set null,
  type          public.lesson_type not null,
  status        public.lesson_status not null default 'agendada',
  scheduled_at  timestamptz not null,
  duration_min  integer not null default 50,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists lessons_company_idx    on public.lessons(company_id);
create index if not exists lessons_enrollment_idx on public.lessons(enrollment_id);
create index if not exists lessons_scheduled_idx  on public.lessons(scheduled_at);

-- ---------------------------------------------------------------------
-- EXAMS (Exames DETRAN)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.exam_kind as enum ('teorico','pratico');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.exam_result as enum ('agendado','aprovado','reprovado','remarcado');
exception when duplicate_object then null; end $$;

create table if not exists public.exams (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  kind          public.exam_kind not null,
  result        public.exam_result not null default 'agendado',
  scheduled_at  timestamptz,
  location      text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists exams_company_idx    on public.exams(company_id);
create index if not exists exams_enrollment_idx on public.exams(enrollment_id);

-- ---------------------------------------------------------------------
-- TRIGGERS updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['students','instructors','vehicles','enrollments','lessons','exams'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS (mesmo padrão do restante do schema)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['students','instructors','vehicles','enrollments','lessons','exams'] loop
    execute format('alter table public.%1$s enable row level security;', t);

    execute format($f$drop policy if exists "%1$s_select" on public.%1$s;$f$, t);
    execute format($f$create policy "%1$s_select" on public.%1$s for select
      using (company_id = public.current_company_id() or public.is_super_admin());$f$, t);

    execute format($f$drop policy if exists "%1$s_insert" on public.%1$s;$f$, t);
    execute format($f$create policy "%1$s_insert" on public.%1$s for insert
      with check (company_id = public.current_company_id() or public.is_super_admin());$f$, t);

    execute format($f$drop policy if exists "%1$s_update" on public.%1$s;$f$, t);
    execute format($f$create policy "%1$s_update" on public.%1$s for update
      using (company_id = public.current_company_id() or public.is_super_admin());$f$, t);

    execute format($f$drop policy if exists "%1$s_delete" on public.%1$s;$f$, t);
    execute format($f$create policy "%1$s_delete" on public.%1$s for delete
      using (company_id = public.current_company_id() or public.is_super_admin());$f$, t);
  end loop;
end $$;


-- ##################################################################
-- 20260507120067_fixas_inicio
-- ##################################################################
-- =====================================================================
-- 67 — Despesa fixa "a partir de"
-- (depende da 62: usa _finance_month_closed e a porta delvor.finance_rpc)
--
-- Antes: uma fixa criada hoje com vencimento dia 5 já nascia com a conta
-- deste mês vencida (dia 5 já passou), e a tela mostrava a fixa em todos
-- os meses anteriores como atrasada.
--
-- Regra nova: a primeira conta é o primeiro vencimento NA DATA DE INÍCIO
-- OU DEPOIS dela (starts_on). Ex.: começa 10/11, vence dia 5 → primeira
-- conta 05/12; vence dia 20 → 20/11. ends_on idem pelo vencimento.
-- Fixa sem starts_on continua como antes (vale desde sempre).
--
-- Ao mudar início/fim de uma fixa, as contas EM ABERTO que caíram fora do
-- período somem (pagas nunca são tocadas; mês fechado também não).
-- =====================================================================

create or replace function public._generate_fixed_payables(p_company uuid, p_month date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m     date := date_trunc('month', p_month)::date;
  v_cur   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_last  integer := extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer;
  v_n     integer;
begin
  if public._finance_month_closed(p_company, v_m) then return 0; end if;  -- mês fechado não ganha conta nova
  perform set_config('delvor.finance_rpc', '1', true);
  insert into public.payables (company_id, description, category_id, amount, due_date, status,
                               paid_at, paid_amount, source, source_id, month_ref)
  select fe.company_id, fe.name, fe.category_id, fe.amount_cents / 100.0,
         d.due,
         case when fep.id is not null then 'paga' else 'aberta' end,
         case when fep.id is not null then (fep.paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end,
         case when fep.id is not null then fep.amount_cents / 100.0 end,
         'fixa', fe.id, v_m
    from public.fixed_expenses fe
    cross join lateral (
      select make_date(extract(year from v_m)::integer, extract(month from v_m)::integer, least(fe.due_day, v_last)) as due
    ) d
    left join public.fixed_expense_payments fep
           on fep.fixed_expense_id = fe.id and fep.month_ref = v_m
   where fe.company_id = p_company
     and fe.active
     and fe.amount_cents > 0
     and (fe.starts_on is null or d.due >= fe.starts_on or fep.id is not null)
     and (fe.ends_on is null or d.due <= fe.ends_on or fep.id is not null)
     and (v_m >= v_cur or fep.id is not null)
  on conflict (source_id, month_ref) where source = 'fixa' do nothing;
  get diagnostics v_n = row_count;
  perform set_config('delvor.finance_rpc', '', true);
  return v_n;
end $$;

-- Mudou o período da fixa: tira as contas em aberto que ficaram fora dele.
create or replace function public.tg_fixed_period_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.starts_on is not distinct from old.starts_on and new.ends_on is not distinct from old.ends_on then
    return new;
  end if;
  perform set_config('delvor.finance_rpc', '1', true);
  delete from public.payables p
   where p.source = 'fixa'
     and p.source_id = new.id
     and p.status = 'aberta'
     and ((new.starts_on is not null and p.due_date < new.starts_on)
       or (new.ends_on   is not null and p.due_date > new.ends_on))
     and not public._finance_month_closed(p.company_id, p.month_ref);
  perform set_config('delvor.finance_rpc', '', true);
  return new;
end $$;

drop trigger if exists trg_fixed_period_cleanup on public.fixed_expenses;
create trigger trg_fixed_period_cleanup
  after update of starts_on, ends_on on public.fixed_expenses
  for each row execute function public.tg_fixed_period_cleanup();


-- ##################################################################
-- 20260507120059_finance_files_bucket
-- ##################################################################
-- =====================================================================
-- Bucket privado dos anexos do financeiro (boleto, comprovante, nota)
--
-- Separado da 58 de propósito: política de storage é a parte que mais
-- falha em ambiente diferente; se falhar aqui, a 58 continua aplicada.
--
-- Caminho do arquivo: <company_id>/<entity>/<entity_id>/<uuid>-<nome>
-- Acesso: só quem tem acesso ao financeiro e só na pasta da própria
-- empresa. Download sempre por URL assinada (bucket NÃO é público).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-files', 'finance-files', false, 15728640,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "finance_files_select" on storage.objects;
create policy "finance_files_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'finance-files'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.has_financial_access()
  );

drop policy if exists "finance_files_insert" on storage.objects;
create policy "finance_files_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'finance-files'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.has_financial_access()
  );

drop policy if exists "finance_files_delete" on storage.objects;
create policy "finance_files_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'finance-files'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.has_financial_access()
  );


-- ───────── CONFERÊNCIA (o Studio mostra só este resultado) ─────────
select 'companies.vertical (47)' as item,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='vertical') as ok
union all select 'auto escola (48)', to_regclass('public.students') is not null and to_regclass('public.exams') is not null
union all select 'fixas a partir de (67)', exists (select 1 from pg_trigger where tgname = 'trg_fixed_period_cleanup')
union all select 'bucket finance-files (59)', exists (select 1 from storage.buckets where id = 'finance-files')
union all select 'já no ar: fechamento (62)', to_regclass('public.finance_periods') is not null
union all select 'já no ar: empréstimos (63)', to_regclass('public.loans') is not null
union all select 'já no ar: equipamento na venda (64)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='equipment_id')
union all select 'já no ar: fix locação (65)', to_regprocedure('public.rental_is_technician(uuid)') is not null
union all select 'já no ar: apagar venda (66)', to_regprocedure('public.delete_sale(uuid)') is not null;
