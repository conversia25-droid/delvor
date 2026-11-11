-- =====================================================================
-- DELVOR — Nome dos números de WhatsApp + filtro por número — 11/11/2026
-- Projeto: wggvhxtfeucntdunhocn
-- Abrir em: https://supabase.com/dashboard/project/wggvhxtfeucntdunhocn/sql/new
--
--   71  apelido do número aparece no chat e nos contatos; filtro "por
--       número"; e fecha a lista de números, que hoje qualquer pessoa
--       (até sem login) consegue ler de TODAS as empresas.
--
-- Pode rodar mais de uma vez. Se der erro, nada é aplicado.
-- =====================================================================

-- ───────── TRAVA: só roda no banco do Delvor ─────────
do $$ begin
  if to_regclass('public.sales') is null
     or to_regclass('public.wpp_instances') is null
     or to_regclass('public.finance_periods') is null then
    raise exception 'TRAVA: este SQL é do Delvor (projeto wggvhxtfeucntdunhocn). Banco errado — nada foi alterado.';
  end if;
end $$;

-- =====================================================================
-- 71 — Nome (apelido) do número de WhatsApp + qual número fala com quem
--
-- • A view `instancias` (usada pelo chat) passa a trazer `label`, o
--   apelido que o admin dá ao número em Configurações → WhatsApp
--   (ex.: "Loja", "Assistência"). Sem apelido, cai no nome técnico.
-- • Segurança: a view rodava como dona e estava liberada até para anon,
--   mostrando instâncias e telefones de TODAS as empresas. Agora roda
--   com as regras de quem consulta (security_invoker) e só para logados.
--   Super admin continua vendo todas (painel master).
-- • inbox_jid_instances(): para cada contato, o número da empresa pelo
--   qual foi a última conversa — usado no filtro "por número" do chat e
--   da tela de contatos.
-- =====================================================================

drop policy if exists wpp_instances_select on public.wpp_instances;
create policy wpp_instances_select on public.wpp_instances
  for select using (public.is_super_admin() or company_id = public.current_company_id());

drop view if exists public.instancias;
create view public.instancias with (security_invoker = true) as
  select
    i.id,
    i.instance_name           as instance_name,
    i.instance_name           as instance_key,
    i.instance_name           as token_id,
    i.phone_number,
    case i.status
      when 'connected'    then 'CONNECTED'
      when 'connecting'   then 'CONNECTING'
      when 'waiting_qr'   then 'WAITING_QR'
      when 'warning_qr'   then 'WARNING_QR'
      when 'disconnected' then 'DISCONNECTED'
      when 'closed'       then 'CLOSED'
      when 'error'        then 'ERROR'
      else 'DISCONNECTED'
    end                       as status,
    i.company_id,
    null::uuid                as user_id,
    i.is_default,
    null::uuid                as default_funnel_id,
    i.created_at,
    coalesce(nullif(btrim(i.label), ''), i.instance_name) as label
  from public.wpp_instances i;

revoke all on public.instancias from anon;
grant select on public.instancias to authenticated;

create or replace function public.inbox_jid_instances()
returns table (remote_jid text, instance_id text)
language sql
stable
set search_path = public
as $$
  select distinct on (c.remote_jid) c.remote_jid, c.instance_id
    from public.wpp_conversations c
   where c.company_id = public.current_company_id()
     and c.remote_jid is not null
     and c.instance_id is not null
   order by c.remote_jid, c.created_at desc;
$$;

grant execute on function public.inbox_jid_instances() to authenticated;

-- ───────── CONFERÊNCIA (o Studio mostra só este resultado) ─────────
select 'apelido na lista de números (71)' as item,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='instancias' and column_name='label') as ok
union all select 'lista de números fechada para quem não está logado (71)',
       not has_table_privilege('anon', 'public.instancias', 'select')
union all select 'qual número fala com cada contato (71)', to_regprocedure('public.inbox_jid_instances()') is not null;
