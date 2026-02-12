-- =====================================================
-- METADATA HARDENING PATCHES
-- Migration: 20260212007_metadata_hardening.sql
--
-- Patches:
-- 1. schema_version, generated_by, worker_id columns
-- 2. Update get_post_metadata to return new columns
-- 3. Update upsert_post_metadata to accept generated_by, worker_id
--
-- Date: February 12, 2026
-- =====================================================

-- 1. Add debug/tracking columns
ALTER TABLE post_metadata ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1;
ALTER TABLE post_metadata ADD COLUMN IF NOT EXISTS generated_by TEXT;  -- 'scheduler' | 'manual' | 'api'
ALTER TABLE post_metadata ADD COLUMN IF NOT EXISTS worker_id TEXT;     -- function instance id

-- 2. Update get_post_metadata to return all columns including new ones
DROP FUNCTION IF EXISTS get_post_metadata(UUID);

CREATE OR REPLACE FUNCTION get_post_metadata(p_post_id UUID, p_platform TEXT DEFAULT NULL)
RETURNS TABLE (
    id               UUID,
    post_id          UUID,
    platform         TEXT,
    status           TEXT,
    ai_metadata      JSONB,
    final_metadata   JSONB,
    generation_model TEXT,
    attempt_count    INTEGER,
    generated_at     TIMESTAMPTZ,
    edited_at        TIMESTAMPTZ,
    error            TEXT,
    failure_class    TEXT,
    next_retry_at    TIMESTAMPTZ,
    schema_version   INTEGER,
    generated_by     TEXT,
    worker_id        TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        pm.id, pm.post_id, pm.platform, pm.status,
        pm.ai_metadata, pm.final_metadata,
        pm.generation_model, pm.attempt_count,
        pm.generated_at, pm.edited_at, pm.error,
        pm.failure_class, pm.next_retry_at,
        pm.schema_version, pm.generated_by, pm.worker_id
    FROM post_metadata pm
    WHERE pm.post_id = p_post_id
      AND (p_platform IS NULL OR pm.platform = p_platform)
    ORDER BY pm.platform;
$$;

-- 3. Update upsert_post_metadata to accept generated_by + worker_id
DROP FUNCTION IF EXISTS upsert_post_metadata(UUID, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION upsert_post_metadata(
    p_post_id         UUID,
    p_platform        TEXT,
    p_ai_metadata     JSONB,
    p_model           TEXT DEFAULT 'gpt-4o',
    p_idempotency_key TEXT DEFAULT NULL,
    p_generated_by    TEXT DEFAULT 'scheduler',
    p_worker_id       TEXT DEFAULT NULL,
    p_schema_version  INTEGER DEFAULT 1
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_id UUID;
    v_existing_status TEXT;
BEGIN
    -- Idempotency check: if key exists and metadata is ready/edited, skip
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, status INTO v_id, v_existing_status
        FROM post_metadata
        WHERE idempotency_key = p_idempotency_key;

        IF v_id IS NOT NULL AND v_existing_status IN ('ready', 'edited') THEN
            RETURN v_id;
        END IF;
    END IF;

    INSERT INTO post_metadata (
        post_id, platform, ai_metadata, final_metadata,
        generation_model, idempotency_key,
        status, generated_at, attempt_count,
        generated_by, worker_id, schema_version,
        -- Clear any failed state
        error, failure_class, next_retry_at
    )
    VALUES (
        p_post_id, p_platform, p_ai_metadata, p_ai_metadata,
        p_model, p_idempotency_key,
        'ready', now(), 1,
        p_generated_by, p_worker_id, p_schema_version,
        NULL, NULL, NULL
    )
    ON CONFLICT (post_id, platform) DO UPDATE SET
        ai_metadata      = EXCLUDED.ai_metadata,
        -- Preserve user edits: only overwrite final_metadata if NOT user-edited
        final_metadata   = CASE
            WHEN post_metadata.status = 'edited' THEN post_metadata.final_metadata
            ELSE EXCLUDED.ai_metadata
        END,
        generation_model = EXCLUDED.generation_model,
        idempotency_key  = COALESCE(EXCLUDED.idempotency_key, post_metadata.idempotency_key),
        status           = CASE
            WHEN post_metadata.status = 'edited' THEN 'edited'
            ELSE 'ready'
        END,
        generated_at     = now(),
        attempt_count    = post_metadata.attempt_count + 1,
        error            = NULL,
        failure_class    = NULL,
        next_retry_at    = NULL,
        generated_by     = EXCLUDED.generated_by,
        worker_id        = EXCLUDED.worker_id,
        schema_version   = EXCLUDED.schema_version
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- 4. Grants
GRANT EXECUTE ON FUNCTION get_post_metadata(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_post_metadata(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_post_metadata(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION upsert_post_metadata(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
