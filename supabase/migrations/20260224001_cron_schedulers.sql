-- =====================================================
-- CRON SCHEDULERS FOR JOB & POST QUEUES
-- Sets up pg_cron jobs to invoke edge functions
-- 
-- Reference: JOB_SCHEDULER.md, POST_QUEUE.md
-- Date: February 24, 2026
-- =====================================================

-- Enable pg_cron and pg_net extensions (should already exist on Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =====================================================
-- SCHEDULE-JOBS CRON
-- Runs every minute to find due jobs and invoke worker-v1
-- =====================================================

-- Remove existing if present (idempotent)
SELECT cron.unschedule('invoke-schedule-jobs') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-schedule-jobs');

-- Schedule: every minute
SELECT cron.schedule(
  'invoke-schedule-jobs',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://ustmetegzisztqqcjigt.supabase.co/functions/v1/schedule-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- =====================================================
-- SCHEDULE-POSTS CRON
-- Runs every minute to find due posts and invoke post-worker
-- =====================================================

-- Remove existing if present (idempotent)
SELECT cron.unschedule('invoke-schedule-posts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-schedule-posts');

-- Schedule: every minute
SELECT cron.schedule(
  'invoke-schedule-posts',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://ustmetegzisztqqcjigt.supabase.co/functions/v1/schedule-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- =====================================================
-- SWEEP STALE LEASES CRON (every 5 minutes)
-- Recovers stuck jobs and posts
-- =====================================================

-- Remove existing if present
SELECT cron.unschedule('sweep-stale-leases')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-leases');

-- Schedule: every 5 minutes
SELECT cron.schedule(
  'sweep-stale-leases',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  -- Sweep stale job leases (fail jobs with expired leases or no heartbeat for 60 min)
  SELECT * FROM sweep_stale_jobs(60, 50);
  -- Sweep stale post leases
  SELECT * FROM sweep_stale_post_leases(false);
  $$
);

-- =====================================================
-- VERIFICATION VIEW
-- =====================================================

COMMENT ON EXTENSION pg_cron IS 'Cron scheduler for PostgreSQL - runs schedule-jobs and schedule-posts every minute';

-- Note: To verify crons are running, check:
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
