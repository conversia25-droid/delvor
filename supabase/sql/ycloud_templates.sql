-- YCloud Templates: cache local dos templates WhatsApp da empresa
-- Cada empresa tem seus proprios templates (multi-tenant via company_id).
-- O status (PENDING/APPROVED/REJECTED/PAUSED/DISABLED) e atualizado pelo
-- webhook inbound quando o YCloud notifica mudancas.

create table if not exists public.ycloud_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  -- Identificadores Meta/YCloud
  ycloud_template_id text,                    -- id retornado pela YCloud apos criacao
  waba_id text,                               -- WABA onde o template existe

  -- Definicao
  name text not null,                         -- nome do template (unique within WABA)
  category text not null,                     -- MARKETING / UTILITY / AUTHENTICATION
  language text not null default 'pt_BR',     -- pt_BR / en_US / es / etc
  components jsonb not null default '[]',     -- array com header/body/footer/buttons

  -- Status
  status text not null default 'DRAFT',
  rejection_reason text,
  quality_score text,                          -- HIGH / MEDIUM / LOW (atualizado periodicamente)

  -- Metadados
  submitted_at timestamptz,
  approved_at timestamptz,
  last_synced_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ycloud_templates_status_check check (status in (
    'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'
  )),
  constraint ycloud_templates_category_check check (category in (
    'MARKETING', 'UTILITY', 'AUTHENTICATION'
  )),
  constraint ycloud_templates_unique_name unique (company_id, name, language)
);

create index if not exists idx_ycloud_templates_company
  on public.ycloud_templates (company_id, status);

alter table public.ycloud_templates enable row level security;

-- Admin da empresa (ou super_admin) gerencia os templates
drop policy if exists "company_admin_can_manage_ycloud_templates"
  on public.ycloud_templates;
create policy "company_admin_can_manage_ycloud_templates"
on public.ycloud_templates
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = ycloud_templates.company_id
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = ycloud_templates.company_id
  )
);

drop trigger if exists trg_ycloud_templates_updated_at
  on public.ycloud_templates;
create trigger trg_ycloud_templates_updated_at
before update on public.ycloud_templates
for each row execute function public.set_current_timestamp_updated_at();

NOTIFY pgrst, 'reload schema';
