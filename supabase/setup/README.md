# OSManager — Setup do Banco (Supabase)

Rode os arquivos **na ordem** abaixo no SQL Editor do Supabase, do mesmo projeto onde os usuários fazem login:

| Ordem | Arquivo | O que cria |
|---|---|---|
| 1 | `01_core.sql` | `companies`, `profiles`, `user_roles`, helpers de RLS, audit log, trigger que cria profile automaticamente após signup |
| 2 | `02_customers.sql` | `customers`, `customer_contacts`, `customer_equipments` |
| 3 | `03_inventory.sql` | `suppliers`, `products`, `product_categories`, `services_catalog`, `stock_movements`, `purchases` + trigger de baixa de estoque |
| 4 | `04_sales.sql` | `sales`, `sale_items`, `sale_payments` + trigger que dá baixa no estoque ao faturar |
| 5 | `05_service_orders.sql` | `service_orders`, `service_order_items`, `service_order_history`, `service_order_attachments` + triggers de log de status e consumo de peça |
| 6 | `06_views_seed.sql` | Views de KPI e seed comentado de categorias/serviços padrão |

> **Importante:** as policies de RLS dependem das funções `public.has_role`, `public.current_company_id` e `public.is_super_admin` criadas em `01_core.sql`. Não pule a ordem.

## Primeiro acesso

1. Crie um usuário pelo `Auth → Users → Add user` (ou via signup pelo app).
2. No SQL Editor, crie sua primeira empresa e vincule o user:
   ```sql
   insert into public.companies (name) values ('Minha Empresa') returning id;
   -- copie o id retornado
   update public.profiles set company_id = '<COMPANY_ID>' where id = '<USER_ID>';
   insert into public.user_roles (user_id, role, company_id) values ('<USER_ID>', 'admin', '<COMPANY_ID>');
   -- (opcional) torne-se super_admin para acessar todas as empresas
   insert into public.user_roles (user_id, role, company_id) values ('<USER_ID>', 'super_admin', null);
   ```
3. Configure o Storage `os-attachments` (público) para anexos de OS:
   ```sql
   insert into storage.buckets (id, name, public) values ('os-attachments','os-attachments', true)
   on conflict (id) do nothing;
   ```

## Variáveis de ambiente do app

Crie um `.env` na raiz do projeto com:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SEU_ANON_KEY
```
