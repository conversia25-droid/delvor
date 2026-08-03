-- =====================================================================
-- OSManager — Separação semântica de "agendamento" em duas datas
--
-- Antes: campo único `scheduled_at` cumpria dois papéis ambíguos
--   (data prometida ao cliente vs. visita técnica agendada).
--
-- Agora:
--   • due_at        → PRAZO de entrega prometido ao cliente
--                     (é o que dispara o KPI de OS em atraso)
--   • scheduled_at  → VISITA agendada (técnico vai ao cliente)
--                     Continua existindo, mas agora é opcional e
--                     usado pela agenda do técnico (próxima fase).
--
-- Backfill: como historicamente o filtro de atraso usava scheduled_at
-- como prazo, copiamos o valor para due_at.
-- =====================================================================

alter table public.service_orders
  add column if not exists due_at timestamptz;

create index if not exists os_due_idx on public.service_orders(due_at);

-- Backfill: assumimos que o scheduled_at existente era usado como prazo.
update public.service_orders
   set due_at = scheduled_at
 where due_at is null
   and scheduled_at is not null;

comment on column public.service_orders.due_at       is 'Prazo de entrega prometido ao cliente (deadline). Define se a OS está em atraso.';
comment on column public.service_orders.scheduled_at is 'Visita técnica agendada (opcional). Aparece na agenda do técnico.';
