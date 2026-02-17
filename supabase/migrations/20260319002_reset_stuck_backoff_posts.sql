-- Fix: reset scheduled_at for 3 posts stuck in exponential backoff
-- These posts (threads, tiktok, twitter for "The Extra Spectator") were
-- marked with a 2-hour backoff because the post-worker edge function timed out
-- while processing 6 platforms sequentially.
UPDATE posts
SET 
  scheduled_at = '2026-02-17T02:26:15.647+00:00',
  next_attempt_at = NULL
WHERE id IN (
  'e000afcd-b1d3-4c39-869f-a1ba05592041',
  '72429a52-e57f-410b-803b-b3a7217f2546',
  '4e5b42c8-e8ed-4688-90b2-e5cd3968e16c'
)
AND status = 'scheduled';
