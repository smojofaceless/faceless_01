-- =====================================================
-- FIX: Stale lease sweeper cron calling wrong function
-- 
-- Bug: Cron called sweep_stale_leases(false) which doesn't exist
-- Fix: Call sweep_stale_jobs() for jobs + sweep_stale_post_leases(false) for posts
--
-- Date: February 12, 2026
-- =====================================================

-- Remove broken cron
SELECT cron.unschedule('sweep-stale-leases')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-leases');

-- Re-create with correct function calls
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
