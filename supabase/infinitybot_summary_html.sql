-- InfinityBot: colunas para link do resumo em HTML
alter table public.leads
  add column if not exists chat_summary_html_url text;

alter table public.leads
  add column if not exists chat_summary_html_updated_at timestamptz;

-- Storage:
-- Crie um bucket chamado chat_summaries e deixe como public.
