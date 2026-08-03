-- =====================================================================
-- OSManager — Stubs adicionais de tabelas/colunas usadas por componentes
-- legados do CRM (Sidebar bell, SystemAnnouncementBanner, etc).
--
-- Sem essas estruturas o app funciona, mas inunda o console de erros
-- 400/404 que confundem o user.
-- =====================================================================

-- ---------------------------------------------------------------------
-- wpp_conversations.message_type
-- ---------------------------------------------------------------------
alter table public.wpp_conversations
  add column if not exists message_type text default 'text';

-- ---------------------------------------------------------------------
-- notifications (in-app)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  user_id     uuid references public.profiles(id)  on delete cascade,
  type        text,
  title       text,
  body        text,
  meta        jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, read);

alter table public.notifications enable row level security;
drop policy if exists "notifications_self_rw" on public.notifications;
create policy "notifications_self_rw" on public.notifications for all
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and (user_id = auth.uid() or public.is_admin_or_manager()))
  )
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- system_announcements (banner / popup global do super_admin)
-- ---------------------------------------------------------------------
create table if not exists public.system_announcements (
  id                 uuid primary key default gen_random_uuid(),
  title              text,
  message            text,
  severity           text default 'info',
  active             boolean not null default false,
  pinned             boolean not null default false,
  display_type       text default 'banner',     -- 'banner' | 'popup' | 'both'
  allow_hide_forever boolean default true,
  starts_at          timestamptz default now(),
  ends_at            timestamptz,
  created_at         timestamptz not null default now()
);

alter table public.system_announcements enable row level security;
drop policy if exists "sys_ann_read_all" on public.system_announcements;
create policy "sys_ann_read_all" on public.system_announcements for select
  using (true);
drop policy if exists "sys_ann_super_write" on public.system_announcements;
create policy "sys_ann_super_write" on public.system_announcements for all
  using (public.is_super_admin())
  with check (public.is_super_admin());
