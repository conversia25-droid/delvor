# Arquitetura Multi-Ramo — Delvor como plataforma vertical

> **Objetivo:** transformar o Delvor (hoje "assistência técnica") em uma **plataforma SaaS multi-ramo**, onde a mesma base de código serve diferentes segmentos — começando pela **Auto Escola**, com o **Depósito de Material de Construção** como próximo ramo.
>
> **Status:** documento de arquitetura para revisão. Nenhum código foi alterado ainda.
> **Data:** 2026-08-07

---

## 1. Princípios

1. **Um código, vários ramos.** Nada de forks. Uma empresa (`companies`) escolhe seu ramo e a UI, os módulos e a terminologia se adaptam.
2. **Reaproveitar o núcleo.** Multi-tenant (`company_id` + RLS), Auth, painel Master, billing Asaas, WhatsApp, Agenda, Kanban e geração de documentos **já existem** e servem a todos os ramos.
3. **Domínio novo é aditivo.** Cada ramo adiciona tabelas próprias — nunca altera destrutivamente o schema dos outros.
4. **Fiel às convenções atuais.** Enums via `do $$ begin ... exception when duplicate_object`, `company_id not null references companies on delete cascade`, índices por `company_id`, trigger `tg_set_updated_at`, RLS com `current_company_id()` / `is_super_admin()`.

---

## 2. A fundação: o conceito de `vertical`

### 2.1 Campo no tenant

```sql
-- migration: 20260507120047_company_vertical.sql
do $$ begin
  create type public.company_vertical as enum
    ('assistencia_tecnica','auto_escola','deposito_construcao');
exception when duplicate_object then null; end $$;

alter table public.companies
  add column if not exists vertical public.company_vertical
  not null default 'assistencia_tecnica';
```

> Todas as empresas de hoje continuam `assistencia_tecnica`. Zero quebra.

### 2.2 Config central dos ramos — `src/config/verticals.ts`

Fonte única de verdade sobre "o que cada ramo é". O menu, o dashboard e os textos leem daqui.

```ts
export type Vertical = 'assistencia_tecnica' | 'auto_escola' | 'deposito_construcao';

export interface VerticalConfig {
  id: Vertical;
  label: string;               // "Auto Escola"
  modules: string[];           // módulos ligados (chaves de nav)
  terms: Record<string, string>; // dicionário de terminologia
}

export const VERTICALS: Record<Vertical, VerticalConfig> = {
  assistencia_tecnica: {
    id: 'assistencia_tecnica',
    label: 'Assistência Técnica',
    modules: ['dashboard','customers','chat','service_orders','schedule',
              'pdv','orcamentos','rentals','products','services','suppliers',
              'purchases','reports','team','settings'],
    terms: { customer: 'Cliente', customers: 'Clientes', order: 'OS' },
  },
  auto_escola: {
    id: 'auto_escola',
    label: 'Auto Escola',
    modules: ['dashboard','students','chat','enrollments','lessons','schedule',
              'instructors','vehicles','exams','pdv','reports','team','settings'],
    terms: { customer: 'Aluno', customers: 'Alunos', order: 'Matrícula' },
  },
  deposito_construcao: {
    id: 'deposito_construcao',
    label: 'Depósito de Material',
    modules: ['dashboard','customers','chat','pdv','orcamentos','deliveries',
              'products','suppliers','purchases','reports','team','settings'],
    terms: { customer: 'Cliente', customers: 'Clientes', order: 'Pedido' },
  },
};
```

### 2.3 Terminologia — helper `useTerm()`

Mesma tela, palavra diferente por ramo. Sem duplicar componente.

```ts
// src/hooks/useVertical.ts
export function useVertical() {
  const { user } = useAuth();                 // company vem do profile
  const vertical = user?.company?.vertical ?? 'assistencia_tecnica';
  const cfg = VERTICALS[vertical];
  const t = (key: string) => cfg.terms[key] ?? key;
  const hasModule = (m: string) => cfg.modules.includes(m);
  return { vertical, cfg, t, hasModule };
}
```

> Requer expor `companies.vertical` no `AuthContext` (já carrega o profile → basta um join/segundo select da company).

### 2.4 Menu filtrado por ramo — `src/components/Sidebar.tsx`

Hoje o array `navigation` (Sidebar.tsx:53) filtra por `roles`. Adiciona-se uma chave `module` a cada item e filtra também por `hasModule()`:

```ts
const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Home, module: "dashboard", roles: [...] },
  { name: "Alunos",    href: "/students",  icon: GraduationCap, module: "students",     roles: [...] },
  { name: "OS",        href: "/service-orders", icon: Wrench, module: "service_orders", roles: [...] },
  // ...
];

// no render:
const visible = navigation.filter(i =>
  hasModule(i.module) && i.roles.some(r => hasRole(r))
);
```

**Resultado:** a auto escola vê "Alunos, Matrículas, Aulas, Instrutores, Frota, Exames"; a assistência vê "Clientes, OS, Locações, Estoque". Mesma Sidebar.

### 2.5 Rotas

As rotas de todos os ramos convivem no [App.tsx](../src/App.tsx). O acesso é barrado por `hasModule()` num wrapper (`<VerticalRoute module="students">`) que redireciona pra `/dashboard` se o ramo não tem aquele módulo — mesmo padrão do `ProtectedRoute`.

### 2.6 Painel Master

Ao criar/editar empresa em `MasterCompanies`, adicionar um **seletor de ramo** (`vertical`). É o único lugar onde o super_admin define o segmento do cliente.

---

## 3. Modelo de domínio — Auto Escola

Todas as tabelas seguem o padrão: `company_id not null references companies on delete cascade`, índice por `company_id`, trigger `tg_set_updated_at`, RLS por `current_company_id()`.

### 3.1 `students` (Alunos) — tabela nova

Decisão registrada: **tabela própria**, separada de `customers`, com campos do domínio DETRAN.

```sql
-- migration: 20260507120048_auto_escola_core.sql
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,

  -- Identificação
  name          text not null,
  cpf           text,
  rg            text,
  birthdate     date,
  photo_url     text,                         -- foto do aluno (Storage)

  -- Contato (espelha customers pra reaproveitar WhatsApp/chat)
  email         text,
  phone         text,
  whatsapp      text,
  remote_jid    text,

  -- Endereço
  zipcode text, street text, number text, complement text,
  district text, city text, state text, country text default 'BR',

  -- DETRAN
  renach        text,                         -- nº do processo (RENACH)
  category_goal text,                         -- categoria pretendida: A, B, AB, C, D, E...
  is_renewal    boolean not null default false, -- 1ª habilitação vs renovação/adição

  notes         text,
  tags          text[] default '{}',
  active        boolean not null default true,
  assigned_user_id uuid references public.profiles(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, cpf)
);
create index if not exists students_company_idx on public.students(company_id);
create index if not exists students_remote_jid_idx on public.students(remote_jid);
```

### 3.2 `instructors` (Instrutores)

```sql
create table if not exists public.instructors (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  profile_id    uuid references public.profiles(id) on delete set null, -- se for usuário do sistema
  name          text not null,
  cpf           text,
  credential    text,                         -- credencial DETRAN
  categories    text[] default '{}',          -- categorias que pode ensinar: {A,B}
  phone         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists instructors_company_idx on public.instructors(company_id);
```

### 3.3 `vehicles` (Frota)

```sql
create table if not exists public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  plate         text not null,
  model         text,
  brand         text,
  year          integer,
  category      text,                         -- categoria que atende: A (moto), B (carro)...
  status        text not null default 'ativo',-- ativo | manutencao | inativo
  next_maintenance_at date,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, plate)
);
create index if not exists vehicles_company_idx on public.vehicles(company_id);
```

### 3.4 `enrollments` (Matrículas) — o "coração", espelha `service_orders`

O fluxo da matrícula é um **kanban**, igual ao de OS. Reaproveita o componente de kanban existente.

```sql
do $$ begin
  create type public.enrollment_status as enum
    ('matriculado','aulas_teoricas','prova_teorica','aulas_praticas',
     'prova_pratica','aprovado','reprovado','cancelado');
exception when duplicate_object then null; end $$;

create table if not exists public.enrollments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        bigserial,                    -- nº humano da matrícula

  student_id    uuid not null references public.students(id) on delete restrict,
  category      text not null,                -- categoria desta matrícula (A, B, AB...)
  status        public.enrollment_status not null default 'matriculado',

  -- Carga horária exigida (varia por categoria/DETRAN)
  required_theory_hours    integer default 45,
  required_practice_hours  integer default 20,
  completed_theory_hours   integer not null default 0,   -- denormalizado (soma de lessons)
  completed_practice_hours integer not null default 0,

  -- Financeiro
  price         numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  sale_id       uuid references public.sales(id) on delete set null, -- parcelas via billing existente

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
```

### 3.5 `lessons` (Aulas) — plugam na Agenda existente

```sql
do $$ begin
  create type public.lesson_type as enum ('teorica','pratica');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lesson_status as enum
    ('agendada','concluida','faltou','cancelada');
exception when duplicate_object then null; end $$;

create table if not exists public.lessons (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  instructor_id uuid references public.instructors(id) on delete set null,
  vehicle_id    uuid references public.vehicles(id) on delete set null, -- só prática

  type          public.lesson_type not null,
  status        public.lesson_status not null default 'agendada',
  scheduled_at  timestamptz not null,
  duration_min  integer not null default 50,  -- duração (aula-relógio)
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists lessons_company_idx    on public.lessons(company_id);
create index if not exists lessons_enrollment_idx on public.lessons(enrollment_id);
create index if not exists lessons_scheduled_idx  on public.lessons(scheduled_at);
```

> Ao concluir uma aula (`status='concluida'`), um trigger soma `duration_min` em `enrollments.completed_*_hours` — o mesmo padrão de totais denormalizados que a OS já usa.

### 3.6 `exams` (Exames DETRAN)

```sql
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
  location      text,                         -- posto/DETRAN
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists exams_company_idx    on public.exams(company_id);
create index if not exists exams_enrollment_idx on public.exams(enrollment_id);
```

### 3.7 RLS (padrão para TODAS as tabelas acima)

```sql
alter table public.students enable row level security;

create policy students_select on public.students
  for select using (company_id = public.current_company_id() or public.is_super_admin());
create policy students_insert on public.students
  for insert with check (company_id = public.current_company_id() or public.is_super_admin());
create policy students_update on public.students
  for update using (company_id = public.current_company_id() or public.is_super_admin());
create policy students_delete on public.students
  for delete using (company_id = public.current_company_id() or public.is_super_admin());

-- repetir o bloco para instructors, vehicles, enrollments, lessons, exams
-- e trigger de updated_at:
drop trigger if exists trg_students_updated on public.students;
create trigger trg_students_updated before update on public.students
  for each row execute function public.tg_set_updated_at();
```

---

## 4. Telas (páginas React)

| Rota | Página | Espelha |
|---|---|---|
| `/students` | Lista de alunos + CRUD | `Customers.tsx` |
| `/students/:id` | Ficha do aluno + matrículas | `CustomerDetail.tsx` |
| `/enrollments` | **Kanban** de matrículas por status | `ServiceOrders.tsx` (kanban) |
| `/enrollments/:id` | Editor de matrícula (aulas, exames, financeiro, progresso) | `ServiceOrderEditor.tsx` |
| `/lessons` ou `/schedule` | Agenda de aulas (instrutor + veículo) | `Schedule.tsx` (FullCalendar) |
| `/instructors` | Instrutores (CRUD) | `Team.tsx` / `Suppliers.tsx` |
| `/vehicles` | Frota (CRUD) | `Products.tsx` |
| `/exams` | Exames DETRAN | novo, simples |

Cada página reutiliza os primitives shadcn (`components/ui`) e o padrão de data-fetch com `@tanstack/react-query` + `supabase-js` já usado no projeto.

---

## 5. Mapa de reaproveitamento

| Recurso | Origem | Como serve a Auto Escola |
|---|---|---|
| Multi-tenant + RLS | `core.sql` | idêntico — só `company_id` |
| Kanban | `ServiceOrders.tsx` | fluxo da matrícula |
| Agenda / FullCalendar | `Schedule.tsx` | aulas teóricas/práticas |
| Billing / parcelas | Asaas + `sales` | mensalidades |
| WhatsApp | Evolution/YCloud | lembrete de aula, cobrança |
| Documentos | `docxtemplater` / `jsPDF` | contrato de matrícula |
| Painel Master | `pages/master` | vender o SaaS pra auto escolas |
| PDV | `PDV.tsx` | pagamento avulso (2ª via, taxas) |

**Só é genuinamente novo:** o schema da seção 3, ~7 páginas React, e o filtro de menu da seção 2.

---

## 6. Plano por fases

### Fase 0 — Fundação multi-ramo
- [ ] Migration `company_vertical` (seção 2.1)
- [ ] `src/config/verticals.ts` (seção 2.2)
- [ ] Expor `company.vertical` no `AuthContext`
- [ ] Hook `useVertical()` + `useTerm()` (seção 2.3)
- [ ] Filtro de módulo na `Sidebar` (seção 2.4)
- [ ] `<VerticalRoute>` no `App.tsx` (seção 2.5)
- [ ] Seletor de ramo no `MasterCompanies` (seção 2.6)

### Fase 1 — Cadastros
- [ ] Migration `auto_escola_core` (students, instructors, vehicles) + RLS
- [ ] Páginas `Students`, `StudentDetail`, `Instructors`, `Vehicles`

### Fase 2 — Matrículas + Kanban
- [ ] Migration `enrollments` + RLS + trigger de números
- [ ] Página `Enrollments` (kanban) + `EnrollmentEditor`

### Fase 3 — Aulas na Agenda
- [ ] Migration `lessons` + trigger de carga horária
- [ ] Integração na Agenda (filtro por instrutor/veículo, checagem de conflito)

### Fase 4 — Exames + Financeiro
- [ ] Migration `exams` + RLS
- [ ] Mensalidades via billing existente
- [ ] Lembretes de aula/exame via WhatsApp

---

## 7. Riscos e decisões em aberto

1. **`AuthContext` precisa da company completa.** Hoje carrega o profile; precisa incluir `vertical` (1 select a mais, barato).
2. **Carga horária DETRAN varia por estado/categoria.** Os defaults (45h teoria / 20h prática) devem ser configuráveis por empresa (Settings) — não hardcode.
3. **Instrutor = usuário do sistema?** `instructors.profile_id` é opcional: instrutor pode ou não ter login. Decidir se ele acessa app mobile (como o técnico hoje).
4. **Conflito de agenda.** Aula prática ocupa instrutor **e** veículo — precisa de checagem de sobreposição na hora de agendar.
5. **Numeração da matrícula** usa `bigserial` global; se quiser numeração por empresa, replicar a lógica de `number` da OS.

---

## 8. Próximo passo sugerido

Aprovado este documento, começar pela **Fase 0** (fundação) — é o que destrava tanto a auto escola quanto o depósito de construção, e não quebra nada do que já roda em produção.
