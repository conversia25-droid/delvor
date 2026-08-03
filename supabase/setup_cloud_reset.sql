-- =====================================================================
-- OSManager — Reset do schema public (DESTRUTIVO)
-- Use APENAS se o projeto Supabase Cloud está com tabelas residuais
-- de uma tentativa anterior e você quer recomeçar do zero.
--
-- Apaga TODAS as tabelas, views, funções e tipos do schema public.
-- NÃO toca em auth.* nem em storage.*.
-- =====================================================================

-- Confirma que você sabe o que tá fazendo
do $$ begin
  raise notice 'Iniciando RESET do schema public — todas as tabelas serão apagadas em 3 segundos.';
  perform pg_sleep(3);
end $$;

-- 1) Apaga todas as tabelas, views, sequences (cascade pega FKs)
do $$
declare r record;
begin
  -- Drop views first
  for r in select schemaname, viewname from pg_views where schemaname = 'public'
  loop
    execute format('drop view if exists %I.%I cascade', r.schemaname, r.viewname);
  end loop;

  -- Drop tables
  for r in select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop table if exists %I.%I cascade', r.schemaname, r.tablename);
  end loop;

  -- Drop sequences órfãs (raro)
  for r in select schemaname, sequencename from pg_sequences where schemaname = 'public'
  loop
    execute format('drop sequence if exists %I.%I cascade', r.schemaname, r.sequencename);
  end loop;
end $$;

-- 2) Apaga todas as funções customizadas do public
do $$
declare r record;
begin
  for r in
    select n.nspname as schema, p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('drop function if exists %I.%I(%s) cascade', r.schema, r.name, r.args);
  end loop;
end $$;

-- 3) Apaga tipos enum customizados
do $$
declare r record;
begin
  for r in
    select n.nspname as schema, t.typname as name
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'e'
  loop
    execute format('drop type if exists %I.%I cascade', r.schema, r.name);
  end loop;
end $$;

-- Pronto. Agora rode setup_cloud.sql.
do $$ begin
  raise notice 'Schema public resetado. Agora rode setup_cloud.sql.';
end $$;
