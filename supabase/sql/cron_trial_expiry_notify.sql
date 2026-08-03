-- Schedule pra rodar a Edge Function trial-expiry-notify todo dia às 11h (BRT).
-- Requer extensões: pg_cron + pg_net (ambas vêm habilitadas no Supabase Cloud por padrão).
-- Se rodando self-hosted, precisa habilitar:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- IMPORTANTE: troca a URL abaixo pela sua de Supabase + token de service_role
-- (use uma variável de banco se preferir, via ALTER DATABASE postgres SET app.functions_url = '...')

-- 1) Remove schedule antigo se existir (idempotente)
SELECT cron.unschedule('trial-expiry-notify-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trial-expiry-notify-daily');

-- 2) Cria o schedule — todo dia às 14:00 UTC (= 11:00 BRT)
SELECT cron.schedule(
  'trial-expiry-notify-daily',
  '0 14 * * *',
  $$
    SELECT net.http_post(
      url := 'https://api.zapcompany.com.br/functions/v1/trial-expiry-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Pra ver os jobs ativos:
--   SELECT jobid, jobname, schedule, command, active FROM cron.job;
--
-- Pra ver as últimas execuções:
--   SELECT jobid, runid, status, return_message, start_time, end_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- Pra setar a service_role_key como variável (rode UMA vez como super_admin):
--   ALTER DATABASE postgres SET app.service_role_key = 'eyJhbGc...';
--   (Reconecta pra aplicar.)
