-- YCloud: credenciais por empresa (cada empresa tem sua propria API key YCloud)
-- Modelo: cada empresa-cliente cria a conta dela no ycloud.com,
-- copia a API key do painel YCloud e cola no CRM.
-- O CRM entao consegue listar os numeros WhatsApp dela automaticamente
-- via o n8n-proxy (que chama https://api.ycloud.com com essa key).

create table if not exists public.company_ycloud_credentials (
  company_id uuid primary key references public.companies (id) on delete cascade,

  -- API key do YCloud da empresa
  -- OBS: em producao considerar encriptar com pgcrypto.
  api_key text not null,

  -- Status do ultimo teste de conexao
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_ycloud_credentials enable row level security;

-- Admin da empresa (ou super_admin) pode gerenciar
drop policy if exists "company_admin_can_manage_ycloud_credentials"
  on public.company_ycloud_credentials;
create policy "company_admin_can_manage_ycloud_credentials"
on public.company_ycloud_credentials
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = company_ycloud_credentials.company_id
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = company_ycloud_credentials.company_id
  )
);

drop trigger if exists trg_company_ycloud_credentials_updated_at
  on public.company_ycloud_credentials;
create trigger trg_company_ycloud_credentials_updated_at
before update on public.company_ycloud_credentials
for each row execute function public.set_current_timestamp_updated_at();

-- ---------- adiciona n8n_proxy_url em ycloud_settings ----------
alter table public.ycloud_settings
  add column if not exists n8n_proxy_url text;

-- ---------- RPC: expoe apenas a proxy_url pra usuarios autenticados ----------
-- Evita vazar api_key/shared_secret do master para usuarios normais.
create or replace function public.get_ycloud_proxy_url()
returns text
language sql
security definer
set search_path = public
as $$
  select n8n_proxy_url from public.ycloud_settings where id = true;
$$;

grant execute on function public.get_ycloud_proxy_url() to authenticated;

NOTIFY pgrst, 'reload schema';
