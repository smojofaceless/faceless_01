-- =====================================================
-- Raise openai_image per-job limits from 20 → 30
-- Needed since scene count is now 24 (was 10-20 when limits were set)
-- 30 allows 24 scenes + 6 retries
-- =====================================================

UPDATE cost_limits
SET 
    max_calls_per_job = 30,
    max_images_per_job = 30,
    description = 'System default: gpt-image-1 model ONLY (not DALL-E). 30 = 24 scenes + retry headroom.'
WHERE scope = 'system' 
  AND service = 'openai_image';
