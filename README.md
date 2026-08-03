# Delvor

CRM + Ordens de Serviço + Estoque + WhatsApp para serviços de tecnologia (impressoras, suprimentos, periféricos).

## Stack

- **Vite + React 18 + TypeScript**
- **Tailwind CSS + shadcn/ui** (componentes)
- **Supabase** (Postgres + Auth + Storage + Realtime + Edge Functions)
- **WhatsApp** via Evolution API (não-oficial) e/ou YCloud (API oficial Meta)

---

## 🚀 Setup local com Supabase em Docker (recomendado para começar)

Pré-requisitos: **Docker Desktop** rodando e **Supabase CLI** ≥ 2.x.

```bash
# 1. Instalar dependências do app
npm install

# 2. Subir o stack Supabase local (Postgres, Auth, Storage, Studio, Realtime)
#    A primeira vez baixa as imagens (~1.5 GB) — pode levar alguns minutos.
npm run sb:start

# 3. Rodar dev server (já vem apontado para o Supabase local via .env.local)
npm run dev
```

A primeira execução de `sb:start`:

- Roda todas as migrations em `supabase/migrations/` (cria todas as tabelas).
- Executa `supabase/seed.sql` (cria empresa "Delvor Demo", produtos, serviços, categorias e o trigger que vincula automaticamente o primeiro usuário cadastrado como **admin** + **super_admin**).
- Abre o Studio em http://127.0.0.1:54323

Acesse:

| Serviço | URL |
|---|---|
| App (Vite) | http://localhost:8080 |
| Studio (admin DB) | http://127.0.0.1:54423 |
| API REST/Auth | http://127.0.0.1:54421 |
| Postgres | `postgres://postgres:postgres@127.0.0.1:54422/postgres` |
| Inbucket (e-mails de teste) | http://127.0.0.1:54424 |

> 💡 Delvor usa o range **5442x** (não o padrão 5432x) para coexistir com outros projetos Supabase locais que você já tenha rodando.

### Primeiro acesso

1. Vá em http://localhost:5173/login
2. Cadastre uma conta (qualquer email + senha)
3. O trigger `bootstrap_first_user` te vincula à empresa demo como admin
4. Pronto — entre em **Clientes** e cadastre um.

### Comandos úteis

```bash
npm run sb:status   # mostra URLs e chaves locais
npm run sb:reset    # apaga o banco e re-roda migrations + seed
npm run sb:stop     # para os containers (preserva dados)
```

> ⚠️ **Anon key local:** está fixada em `.env.local`. Caso a CLI do Supabase imprima uma chave diferente em `sb:status`, copie de lá para o `.env.local`.

---

## 📤 Deploy em projeto Supabase remoto (depois)

Quando quiser sair do local:

```bash
# 1. Crie um projeto em https://supabase.com/dashboard
# 2. Copie URL e anon key para o arquivo .env (NÃO o .env.local)
cp .env.example .env

# 3. Conecte o CLI ao projeto remoto
supabase link --project-ref SEU-PROJECT-REF

# 4. Suba as migrations
supabase db push
```

> Em produção use `.env` (com URL/key reais). O `.env.local` tem precedência sobre `.env` em desenvolvimento — para desabilitar o local, renomeie ou apague o `.env.local`.

---

## Estrutura de pastas (resumo)

```
src/
  components/          # UI components (shadcn) e componentes do app
    ui/                # primitives shadcn
    whatsapp-inbox/    # inbox WhatsApp Lite
  contexts/            # AuthContext, ThemeContext etc.
  hooks/               # hooks reutilizáveis
  integrations/
    supabase/          # client + types (gerado)
  lib/                 # formatters, utils
  pages/               # páginas (Customers, Sales, ServiceOrders, etc)
  types/               # tipos do domínio (delvor.ts)
supabase/
  config.toml          # configuração da CLI (portas, buckets, edge functions)
  migrations/          # SQLs aplicados em ordem (versionados)
  seed.sql             # dados de exemplo + bootstrap do primeiro user
  setup/               # cópia legível dos SQLs (referência manual)
  functions/           # Edge Functions herdadas (desabilitadas por padrão)
```

## Roadmap por fases

| Fase | Status | Entrega |
|---|---|---|
| **1** | ✅ | Cópia do projeto base, branding Delvor, schema SQL completo, página de Clientes, Supabase local |
| **2** | 🔲 | Produtos & Estoque, Catálogo de Serviços |
| **3** | 🔲 | Vendas (orçamento → pedido → faturamento) com PDF |
| **4** | 🔲 | Ordens de Serviço com workflow técnico e timeline |
| **5** | 🔲 | Fornecedores, Compras, integração WhatsApp nos módulos, ajustes |

## Multi-tenant

Todas as tabelas têm `company_id` e RLS. A função `public.current_company_id()` lê o `company_id` do `profile` do usuário autenticado. Super admins (role `super_admin`) podem ver todas as empresas.

## Troubleshooting

**`supabase start` falha com `Cannot connect to the Docker daemon`:**
abra o Docker Desktop e espere o ícone ficar verde antes de tentar de novo.

**Esqueci a senha do user demo:**
```bash
npm run sb:reset   # limpa tudo e roda seed novamente
```
Depois cadastre conta nova pela tela de login.

**Quero ver/editar tabelas direto:**
abra o Studio em http://127.0.0.1:54323
