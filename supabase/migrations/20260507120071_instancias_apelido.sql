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
