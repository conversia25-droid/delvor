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
