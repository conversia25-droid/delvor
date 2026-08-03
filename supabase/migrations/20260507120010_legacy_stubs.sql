-- =====================================================================
-- OSManager — Stubs adicionais de tabelas/colunas usadas por hooks
-- e contexts herdados do CRM original (App.tsx, OnboardingContext,
-- useClaudeAgent, NotificationToast).
--
-- Sem essas estruturas o app funciona, mas inunda o console de erros
-- 404/400 que confundem na hora de depurar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- companies: campos extras lidos pelo OnboardingContext e MasterBilling
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists onboarding_completed boolean not null default true;

-- ---------------------------------------------------------------------
-- leads (App.tsx faz um SELECT pra montar mapa de remote_jid → nome)
-- Esta é a tabela do CRM antigo. Vai ficar vazia no OSManager.
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  remote_jid   text,
  lead_code    text,
  lead_name    text,
  created_at   timestamptz not null default now()
);
create index if not exists leads_company_idx on public.leads(company_id);
create index if not exists leads_jid_idx     on public.leads(remote_jid);

alter table public.leads enable row level security;
drop policy if exists "leads_rw" on public.leads;
create policy "leads_rw" on public.leads for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- tasks (App.tsx faz polling pra alertas de tarefas vencidas/vencendo)
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,
  title         text not null,
  description   text,
  done          boolean not null default false,
  due_at        timestamptz,
  assigned_to   uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_company_idx on public.tasks(company_id);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to);
create index if not exists tasks_due_idx     on public.tasks(due_at);

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.tg_set_updated_at();

alter table public.tasks enable row level security;
drop policy if exists "tasks_rw" on public.tasks;
create policy "tasks_rw" on public.tasks for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- wpp_conversations (App.tsx + useClaudeAgent + Sidebar usam Realtime)
-- ---------------------------------------------------------------------
create table if not exists public.wpp_conversations (
  id                bigserial primary key,
  company_id        uuid references public.companies(id) on delete cascade,
  remote_jid        text,
  message           text,
  from_me           boolean not null default false,
  read_at           timestamptz,
  assigned_user_id  uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists wpp_conv_company_idx on public.wpp_conversations(company_id);
create index if not exists wpp_conv_jid_idx     on public.wpp_conversations(remote_jid);

alter table public.wpp_conversations enable row level security;
drop policy if exists "wpp_conv_rw" on public.wpp_conversations;
create policy "wpp_conv_rw" on public.wpp_conversations for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
