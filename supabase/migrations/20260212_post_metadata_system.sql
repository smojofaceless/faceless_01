-- ============================================================================
-- POST METADATA SYSTEM
-- Platform-specific AI-generated metadata for scheduled posts
-- ============================================================================
-- Run in Supabase SQL Editor (consolidated migration)
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- Main metadata table: one row per (post, platform)
CREATE TABLE IF NOT EXISTS post_metadata (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started', 'generating', 'ready', 'failed', 'edited')),
    ai_metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    final_metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
    generation_model TEXT,
    idempotency_key TEXT UNIQUE,
    error           TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at    TIMESTAMPTZ,
    edited_at       TIMESTAMPTZ,

    CONSTRAINT uq_post_metadata_post_platform UNIQUE (post_id, platform)
);

-- Indexes for scheduler queries
CREATE INDEX IF NOT EXISTS idx_post_metadata_post_id
    ON post_metadata(post_id);

CREATE INDEX IF NOT EXISTS idx_post_metadata_status_needs_gen
    ON post_metadata(status)
    WHERE status IN ('not_started', 'failed');

CREATE INDEX IF NOT EXISTS idx_post_metadata_platform
    ON post_metadata(platform);

-- Platform field constraints reference table
CREATE TABLE IF NOT EXISTS platform_field_constraints (
    platform    TEXT PRIMARY KEY,
    fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. SEED PLATFORM CONSTRAINTS
-- ============================================================================

INSERT INTO platform_field_constraints (platform, fields) VALUES

('youtube_shorts', '{
    "title": {
        "max_length": 100,
        "required": true,
        "description": "Video title. Hook viewers in first 3 words. Include keywords."
    },
    "description": {
        "max_length": 5000,
        "recommended_length": 500,
        "required": true,
        "description": "Video description. Tease story, include keywords + CTA."
    },
    "tags": {
        "max_count": 30,
        "max_total_chars": 500,
        "required": true,
        "description": "Mix broad + niche keywords. No # prefix."
    },
    "category_id": {
        "type": "integer",
        "required": false,
        "default": 24,
        "description": "YouTube category. 24=Entertainment, 1=Film"
    },
    "made_for_kids": {
        "type": "boolean",
        "required": true,
        "default": false
    }
}'::jsonb),

('tiktok', '{
    "caption": {
        "max_length": 2200,
        "recommended_length": 150,
        "required": true,
        "description": "Caption including hashtags. Short punchy hook + hashtags at end."
    },
    "hashtags": {
        "max_count": 8,
        "required": true,
        "description": "Mix trending + niche. No # prefix in array."
    },
    "cover_text": {
        "max_length": 40,
        "required": false,
        "description": "Text overlay on video cover/thumbnail. Punchy, attention-grabbing."
    }
}'::jsonb),

('instagram_reels', '{
    "caption": {
        "max_length": 2200,
        "recommended_length": 300,
        "required": true,
        "description": "Story-style caption with line breaks. Hashtags at end."
    },
    "hashtags": {
        "max_count": 30,
        "recommended_count": 15,
        "required": true,
        "description": "Curated mix. No # prefix in array."
    },
    "alt_text": {
        "max_length": 125,
        "required": false,
        "description": "Accessibility description of the video thumbnail/content."
    }
}'::jsonb)

ON CONFLICT (platform) DO UPDATE SET
    fields = EXCLUDED.fields,
    updated_at = now();

-- ============================================================================
-- 3. AUTO-UPDATE TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_post_metadata_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_post_metadata_updated_at ON post_metadata;
CREATE TRIGGER trigger_post_metadata_updated_at
    BEFORE UPDATE ON post_metadata
    FOR EACH ROW
    EXECUTE FUNCTION trg_post_metadata_updated_at();

-- ============================================================================
-- 4. RPCs
-- ============================================================================

-- 4a. Upsert metadata (idempotent) — called by generate-post-metadata
CREATE OR REPLACE FUNCTION upsert_post_metadata(
    p_post_id         UUID,
    p_platform        TEXT,
    p_ai_metadata     JSONB,
    p_model           TEXT DEFAULT 'gpt-4o',
    p_idempotency_key TEXT DEFAULT NULL
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
        status, generated_at, attempt_count
    )
    VALUES (
        p_post_id, p_platform, p_ai_metadata, p_ai_metadata,
        p_model, p_idempotency_key,
        'ready', now(), 1
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
        error            = NULL
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- 4b. Get all metadata for a post
CREATE OR REPLACE FUNCTION get_post_metadata(p_post_id UUID)
RETURNS TABLE (
    id              UUID,
    post_id         UUID,
    platform        TEXT,
    status          TEXT,
    ai_metadata     JSONB,
    final_metadata  JSONB,
    generation_model TEXT,
    attempt_count   INTEGER,
    generated_at    TIMESTAMPTZ,
    edited_at       TIMESTAMPTZ,
    error           TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        pm.id, pm.post_id, pm.platform, pm.status,
        pm.ai_metadata, pm.final_metadata,
        pm.generation_model, pm.attempt_count,
        pm.generated_at, pm.edited_at, pm.error
    FROM post_metadata pm
    WHERE pm.post_id = p_post_id
    ORDER BY pm.platform;
$$;

-- 4c. Update metadata fields (user edit) — merges into final_metadata
CREATE OR REPLACE FUNCTION update_post_metadata_fields(
    p_post_id  UUID,
    p_platform TEXT,
    p_fields   JSONB
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE post_metadata
    SET
        final_metadata = final_metadata || p_fields,
        status         = 'edited',
        edited_at      = now()
    WHERE post_id = p_post_id
      AND platform = p_platform;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No metadata found for post_id=% platform=%', p_post_id, p_platform;
    END IF;
END;
$$;

-- 4d. Find posts needing metadata — used by metadata-scheduler
CREATE OR REPLACE FUNCTION find_posts_needing_metadata(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
    post_id      UUID,
    platform     TEXT,
    job_id       UUID,
    brand_id     UUID,
    title        TEXT,
    scheduled_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        p.id         AS post_id,
        p.platform   AS platform,
        p.job_id     AS job_id,
        p.brand_id   AS brand_id,
        p.title      AS title,
        p.scheduled_at AS scheduled_at
    FROM posts p
    LEFT JOIN post_metadata pm
        ON pm.post_id = p.id
        AND pm.platform = p.platform
    WHERE p.status IN ('scheduled')
      -- Include recent posts (up to 7 days old in case scheduler was behind)
      AND p.scheduled_at > now() - interval '7 days'
      AND (
          pm.id IS NULL                                          -- no metadata row
          OR pm.status = 'not_started'                           -- row exists but not started
          OR (pm.status = 'failed' AND pm.attempt_count < 3)    -- failed, can retry
      )
    ORDER BY p.scheduled_at ASC
    LIMIT p_limit;
$$;

-- 4e. Atomic claim for generation — prevents double-generation
CREATE OR REPLACE FUNCTION claim_metadata_generation(
    p_post_id  UUID,
    p_platform TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_claimed BOOLEAN := FALSE;
BEGIN
    -- Try to update existing row
    UPDATE post_metadata
    SET status = 'generating',
        attempt_count = attempt_count + 1,
        error = NULL
    WHERE post_id = p_post_id
      AND platform = p_platform
      AND status IN ('not_started', 'failed')
    RETURNING TRUE INTO v_claimed;

    IF v_claimed IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- No row exists — insert one in 'generating' state
    BEGIN
        INSERT INTO post_metadata (post_id, platform, status, attempt_count)
        VALUES (p_post_id, p_platform, 'generating', 1);
        RETURN TRUE;
    EXCEPTION WHEN unique_violation THEN
        -- Race condition: another worker claimed it
        RETURN FALSE;
    END;
END;
$$;

-- 4f. Mark metadata generation failed
CREATE OR REPLACE FUNCTION mark_metadata_failed(
    p_post_id  UUID,
    p_platform TEXT,
    p_error    TEXT
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE post_metadata
    SET status = 'failed',
        error  = p_error
    WHERE post_id = p_post_id
      AND platform = p_platform
      AND status = 'generating';
END;
$$;

-- 4g. Calendar view with metadata status — for UI
CREATE OR REPLACE FUNCTION get_calendar_posts_with_metadata(
    p_start    TIMESTAMPTZ,
    p_end      TIMESTAMPTZ,
    p_brand_id UUID DEFAULT NULL
)
RETURNS TABLE (
    post_id          UUID,
    platform         TEXT,
    scheduled_at     TIMESTAMPTZ,
    post_status      TEXT,
    video_url        TEXT,
    title            TEXT,
    metadata_status  TEXT,
    final_metadata   JSONB,
    metadata_error   TEXT,
    job_id           UUID,
    batch_id         UUID
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        p.id            AS post_id,
        p.platform      AS platform,
        p.scheduled_at  AS scheduled_at,
        p.status        AS post_status,
        p.video_url     AS video_url,
        p.title         AS title,
        pm.status       AS metadata_status,
        pm.final_metadata AS final_metadata,
        pm.error        AS metadata_error,
        p.job_id        AS job_id,
        p.batch_id      AS batch_id
    FROM posts p
    LEFT JOIN post_metadata pm
        ON pm.post_id = p.id AND pm.platform = p.platform
    WHERE p.scheduled_at >= p_start
      AND p.scheduled_at <= p_end
      AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
    ORDER BY p.scheduled_at ASC;
$$;

-- ============================================================================
-- 5. RLS POLICIES (open for dev — matches project pattern)
-- ============================================================================

ALTER TABLE post_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_field_constraints ENABLE ROW LEVEL SECURITY;

-- post_metadata: full access for anon (dev mode)
DROP POLICY IF EXISTS "post_metadata_select_all" ON post_metadata;
CREATE POLICY "post_metadata_select_all" ON post_metadata
    FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "post_metadata_insert_all" ON post_metadata;
CREATE POLICY "post_metadata_insert_all" ON post_metadata
    FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "post_metadata_update_all" ON post_metadata;
CREATE POLICY "post_metadata_update_all" ON post_metadata
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "post_metadata_delete_all" ON post_metadata;
CREATE POLICY "post_metadata_delete_all" ON post_metadata
    FOR DELETE TO anon USING (true);

-- platform_field_constraints: read-only for anon
DROP POLICY IF EXISTS "platform_constraints_select_all" ON platform_field_constraints;
CREATE POLICY "platform_constraints_select_all" ON platform_field_constraints
    FOR SELECT TO anon USING (true);

-- ============================================================================
-- 6. CRON JOB (metadata-scheduler every 2 minutes)
-- ============================================================================
-- Uncomment and run separately if pg_cron + pg_net are enabled:
--
-- SELECT cron.schedule(
--     'invoke-metadata-scheduler',
--     '*/2 * * * *',
--     $$
--     SELECT net.http_post(
--         url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/metadata-scheduler',
--         headers := jsonb_build_object(
--             'Content-Type', 'application/json',
--             'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
--         ),
--         body := '{}'::jsonb
--     ) AS request_id;
--     $$
-- );

-- ============================================================================
-- DONE
-- ============================================================================
