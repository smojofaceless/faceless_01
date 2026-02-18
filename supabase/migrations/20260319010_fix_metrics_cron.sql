-- =====================================================
-- FIX: metrics-collector cron job
-- 
-- Problem: The original cron job used current_setting('app.settings.supabase_url')
-- and current_setting('app.settings.service_role_key') which aren't configured,
-- causing every cron invocation to silently fail. Metrics collection stopped ~Feb 16.
--
-- Fix: Hardcode URL and service_role_key like the schedule-posts cron does.
-- Also run every 30 minutes.
-- =====================================================

-- Remove broken cron job
SELECT cron.unschedule('metrics-collector-cron')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'metrics-collector-cron');

-- Re-create with hardcoded credentials (matches schedule-posts pattern)
SELECT cron.schedule(
  'metrics-collector-cron',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ustmetegzisztqqcjigt.supabase.co/functions/v1/metrics-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8'
    ),
    body := '{"source": "cron"}'::jsonb
  );
  $$
);
