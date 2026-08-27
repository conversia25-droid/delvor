-- =====================================================================
-- Papel 'financeiro' — só o enum
-- Isolado numa migration só porque Postgres não deixa usar um valor de
-- enum recém-criado dentro da mesma transação. As policies que usam o
-- valor 'financeiro' entram na migration 51.
-- =====================================================================

alter type public.app_role add value if not exists 'financeiro';
