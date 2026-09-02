-- =====================================================================
-- Plano "Completo" — Profissional + add-on Financeiro incluso.
--
-- Escada comercial: Profissional R$ 197 | Completo R$ 297.
-- O "incluso" é resolvido na aplicação (src/lib/addons.ts): empresa no
-- plano 'completo' tem o add-on 'financeiro' ativo sem precisar de linha
-- em company_addons. Assim, trocar o plano no Master liga/desliga o
-- Financeiro automaticamente, e cancelar o plano não deixa lixo.
-- =====================================================================

insert into public.billing_plans (code, name, price_cents, max_users, max_instances)
select 'completo', 'Completo', 29700, 15, 3
where not exists (select 1 from public.billing_plans bp where bp.code = 'completo');
