-- =====================================================
-- METADATA BACKOFF + FAILURE CLASSIFICATION
-- Migration: 20260212006_metadata_backoff.sql
--
-- Adds:
-- 1. next_retry_at column for retry backoff scheduling
-- 2. failure_class column for error classification
-- 3. Updates find_posts_needing_metadata to respect backoff
-- 4. Updates mark_metadata_failed to compute next_retry_at
-- 5. Updates get_calendar_posts_with_metadata with new columns
-- 6. Adds metadata-scheduler cron job
--
-- Date: February 12, 2026
-- =====================================================

-- 1. Add columns to post_metadata
ALTER TABLE post_metadata ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE post_metadata ADD COLUMN IF NOT EXISTS failure_class TEXT;

-- Index for efficient backoff queries
CREATE INDEX IF NOT EXISTS idx_post_metadata_next_retry
    ON post_metadata (next_retry_at)
    WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- =====================================================
-- 2. UPDATE find_posts_needing_metadata — respect backoff
--    Original returns: (post_id, platform, job_id, brand_id, title, scheduled_at)
--    Must DROP first — return type changes not allowed by CREATE OR REPLACE
-- =====================================================

DROP FUNCTION IF EXISTS find_posts_needing_metadata(INTEGER);

CREATE OR REPLACE FUNCTION find_posts_needing_metadata(
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    post_id      UUID,
    platform     TEXT,
    job_id       UUID,
    brand_id     UUID,
    title        TEXT,
    scheduled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT p.id           AS post_id,
           p.platform     AS platform,
           p.job_id       AS job_id,
           p.brand_id     AS brand_id,
           p.title        AS title,
           p.scheduled_at AS scheduled_at
    FROM posts p
    LEFT JOIN post_metadata pm
        ON pm.post_id = p.id AND pm.platform = p.platform
    WHERE p.status IN ('scheduled', 'queued')
      AND p.video_url IS NOT NULL
      AND p.brand_id IS NOT NULL
      AND (
          -- No metadata record yet
          pm.id IS NULL
          -- Or status is not_started
          OR pm.status = 'not_started'
          -- Or failed but retryable: under attempt limit, retryable class, AND backoff expired
          OR (
              pm.status = 'failed'
              AND pm.attempt_count < 3
              AND (pm.failure_class IS NULL OR pm.failure_class IN ('transient', 'dependency'))
              AND (pm.next_retry_at IS NULL OR pm.next_retry_at <= NOW())
          )
      )
    ORDER BY p.scheduled_at ASC
    LIMIT p_limit;
END;
$$;

-- =====================================================
-- 3. UPDATE mark_metadata_failed — backoff computation
--    Adding p_failure_class parameter requires DROP of old signature
-- =====================================================

DROP FUNCTION IF EXISTS mark_metadata_failed(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION mark_metadata_failed(
    p_post_id UUID,
    p_platform TEXT,
    p_error TEXT,
    p_failure_class TEXT DEFAULT 'transient'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attempt INTEGER;
    v_backoff INTERVAL;
BEGIN
    -- Get current attempt count
    SELECT attempt_count INTO v_attempt
    FROM post_metadata
    WHERE post_id = p_post_id AND platform = p_platform;
    
    v_attempt := COALESCE(v_attempt, 0) + 1;
    
    -- Calculate backoff based on failure class and attempt count
    -- permanent/misconfig → no retry (NULL next_retry_at)
    -- transient/dependency → 30min, 2h, then permanent (NULL)
    v_backoff := CASE
        WHEN p_failure_class IN ('permanent', 'misconfig') THEN NULL
        WHEN v_attempt >= 3 THEN NULL
        WHEN v_attempt = 1 THEN INTERVAL '30 minutes'
        WHEN v_attempt = 2 THEN INTERVAL '2 hours'
        ELSE NULL
    END;
    
    UPDATE post_metadata
    SET status = 'failed',
        error = p_error,
        failure_class = p_failure_class,
        attempt_count = v_attempt,
        next_retry_at = CASE WHEN v_backoff IS NOT NULL THEN NOW() + v_backoff ELSE NULL END,
        updated_at = NOW()
    WHERE post_id = p_post_id AND platform = p_platform;
    
    -- If no row exists yet, insert one
    IF NOT FOUND THEN
        INSERT INTO post_metadata (post_id, platform, status, error, failure_class, attempt_count, next_retry_at)
        VALUES (
            p_post_id, p_platform, 'failed', p_error, p_failure_class, 1,
            CASE WHEN v_backoff IS NOT NULL THEN NOW() + v_backoff ELSE NULL END
        );
    END IF;
END;
$$;

-- =====================================================
-- 4. UPDATE get_calendar_posts_with_metadata — add new columns
--    Return type changes so DROP first
-- =====================================================

DROP FUNCTION IF EXISTS get_calendar_posts_with_metadata(TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION get_calendar_posts_with_metadata(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_brand_id UUID DEFAULT NULL,
    p_platform TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    job_id UUID,
    brand_id UUID,
    batch_id UUID,
    platform TEXT,
    title TEXT,
    description TEXT,
    video_url TEXT,
    thumbnail_url TEXT,
    scheduled_at TIMESTAMPTZ,
    posted_at TIMESTAMPTZ,
    status TEXT,
    error_message TEXT,
    attempt_count INTEGER,
    tags TEXT[],
    -- Metadata fields
    metadata_id UUID,
    metadata_status TEXT,
    ai_metadata JSONB,
    final_metadata JSONB,
    metadata_error TEXT,
    metadata_attempt_count INTEGER,
    metadata_failure_class TEXT,
    metadata_next_retry_at TIMESTAMPTZ,
    metadata_generated_at TIMESTAMPTZ,
    metadata_edited_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.job_id,
        p.brand_id,
        p.batch_id,
        p.platform,
        p.title,
        p.description,
        p.video_url,
        p.thumbnail_url,
        p.scheduled_at,
        p.posted_at,
        p.status,
        p.error_message,
        p.attempt_count,
        p.tags,
        -- Metadata
        pm.id AS metadata_id,
        pm.status AS metadata_status,
        pm.ai_metadata,
        pm.final_metadata,
        pm.error AS metadata_error,
        pm.attempt_count AS metadata_attempt_count,
        pm.failure_class AS metadata_failure_class,
        pm.next_retry_at AS metadata_next_retry_at,
        pm.generated_at AS metadata_generated_at,
        pm.edited_at AS metadata_edited_at
    FROM posts p
    LEFT JOIN post_metadata pm
        ON pm.post_id = p.id AND pm.platform = p.platform
    WHERE p.scheduled_at >= p_start_date
      AND p.scheduled_at <= p_end_date
      AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
      AND (p_platform IS NULL OR p.platform = p_platform)
    ORDER BY p.scheduled_at ASC;
END;
$$;

-- =====================================================
-- 5. GRANT permissions
-- =====================================================

GRANT EXECUTE ON FUNCTION find_posts_needing_metadata(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION find_posts_needing_metadata(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_metadata_failed(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION mark_metadata_failed(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_calendar_posts_with_metadata(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_calendar_posts_with_metadata(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) TO authenticated;

-- =====================================================
-- 6. METADATA-SCHEDULER CRON (every 2 minutes)
-- =====================================================

SELECT cron.unschedule('invoke-metadata-scheduler')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-metadata-scheduler');

SELECT cron.schedule(
  'invoke-metadata-scheduler',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ustmetegzisztqqcjigt.supabase.co/functions/v1/metadata-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdG1ldGVnemlzenRxcWNqaWd0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTU0NzQ3OSwiZXhwIjoyMDg1MTIzNDc5fQ.01lwYvZ-DG8zLMgJfCW4zHVXyegAOaXGf2XPsHpIOn8'
    ),
    body := '{}'::jsonb
  );
  $$
);
