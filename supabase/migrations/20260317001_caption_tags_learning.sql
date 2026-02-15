-- =============================================================================
-- Migration: 20260317001_caption_tags_learning.sql
-- Phase: Roadmap #20 — Caption/Tags Learning Loop
-- =============================================================================
-- Creates:
--   1. post_metadata_versions        — append-only version history
--   2. post_metadata_variant_assignments — A/B test variant config
--   3. v_post_variant_performance     — versions × metrics join
--   4. v_top_metadata_patterns        — top performers per brand/platform/vibe
--   5. RPCs:
--      - record_post_metadata_version
--      - get_post_metadata_versions
--      - get_variant_performance
--      - assign_ab_variant
--      - get_generation_exemplars
-- =============================================================================

-- =====================================================
-- 1. TABLE: post_metadata_versions
-- =====================================================

CREATE TABLE IF NOT EXISTS post_metadata_versions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id           UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform          TEXT NOT NULL,
    version_number    INTEGER NOT NULL,
    version_type      TEXT NOT NULL CHECK (version_type IN ('ai', 'edit', 'regenerate')),
    variant_key       TEXT,               -- NULL = control group
    fields            JSONB NOT NULL,     -- full metadata snapshot
    generation_model  TEXT,               -- e.g. 'gpt-4o'
    schema_version    INTEGER NOT NULL DEFAULT 1,
    idempotency_key   TEXT UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        TEXT NOT NULL DEFAULT 'scheduler',

    UNIQUE (post_id, platform, version_number)
);

-- Ordered history lookup
CREATE INDEX IF NOT EXISTS idx_pmv_post_platform_ver
    ON post_metadata_versions (post_id, platform, version_number DESC);

-- Filter by type
CREATE INDEX IF NOT EXISTS idx_pmv_post_platform_type
    ON post_metadata_versions (post_id, platform, version_type);

-- Idempotency (covered by UNIQUE above, but explicit for clarity)
-- Already has unique constraint on idempotency_key

COMMENT ON TABLE post_metadata_versions IS
    'Append-only history of every AI generation, user edit, and regeneration event for post metadata.';

-- =====================================================
-- 2. TABLE: post_metadata_variant_assignments
-- =====================================================

CREATE TABLE IF NOT EXISTS post_metadata_variant_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    platform            TEXT NOT NULL,
    variant_key         TEXT NOT NULL,
    style_instructions  TEXT NOT NULL,       -- extra prompt text for this variant
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (job_id, platform, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_pmva_job_platform
    ON post_metadata_variant_assignments (job_id, platform)
    WHERE is_active = true;

COMMENT ON TABLE post_metadata_variant_assignments IS
    'A/B test variant configuration per job/platform. Style instructions injected into the generation prompt.';

-- =====================================================
-- 3. RLS + GRANTS
-- =====================================================

ALTER TABLE post_metadata_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmv_select_all" ON post_metadata_versions
    FOR SELECT USING (true);
CREATE POLICY "pmv_insert_all" ON post_metadata_versions
    FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT ON post_metadata_versions TO anon;
GRANT SELECT, INSERT ON post_metadata_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_metadata_versions TO service_role;

ALTER TABLE post_metadata_variant_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmva_select_all" ON post_metadata_variant_assignments
    FOR SELECT USING (true);
CREATE POLICY "pmva_insert_all" ON post_metadata_variant_assignments
    FOR INSERT WITH CHECK (true);
CREATE POLICY "pmva_update_all" ON post_metadata_variant_assignments
    FOR UPDATE USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON post_metadata_variant_assignments TO anon;
GRANT SELECT, INSERT, UPDATE ON post_metadata_variant_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_metadata_variant_assignments TO service_role;

-- =====================================================
-- 4. VIEW: v_post_variant_performance
-- =====================================================

CREATE OR REPLACE VIEW v_post_variant_performance AS
SELECT
    v.id             AS version_id,
    v.post_id,
    v.platform,
    v.version_number,
    v.version_type,
    v.variant_key,
    v.fields,
    v.generation_model,
    v.created_at     AS version_created_at,
    v.created_by,
    p.brand_id,
    p.job_id,
    j.vibe_preset,
    m.views,
    m.likes,
    m.comments,
    m.shares,
    COALESCE(m.views, 0)
        + 5  * COALESCE(m.likes, 0)
        + 10 * COALESCE(m.comments, 0)
        + 10 * COALESCE(m.shares, 0)
    AS performance_value
FROM post_metadata_versions v
JOIN posts p ON p.id = v.post_id
LEFT JOIN jobs j ON j.id = p.job_id
LEFT JOIN v_post_metrics_latest m
    ON m.post_id = v.post_id AND m.platform = v.platform;

COMMENT ON VIEW v_post_variant_performance IS
    'Metadata versions joined with latest engagement metrics. performance_value = views + 5*likes + 10*comments + 10*shares.';

-- =====================================================
-- 5. VIEW: v_top_metadata_patterns
-- =====================================================

CREATE OR REPLACE VIEW v_top_metadata_patterns AS
WITH ranked AS (
    SELECT
        vp.version_id,
        vp.post_id,
        vp.platform,
        vp.version_number,
        vp.variant_key,
        vp.fields,
        vp.brand_id,
        vp.vibe_preset,
        vp.performance_value,
        vp.version_created_at,
        ROW_NUMBER() OVER (
            PARTITION BY vp.brand_id, vp.platform, vp.vibe_preset
            ORDER BY vp.performance_value DESC, vp.version_created_at DESC
        ) AS rank_in_group
    FROM v_post_variant_performance vp
    WHERE vp.performance_value > 0
      AND vp.version_type IN ('ai', 'regenerate')    -- only AI-generated content
)
SELECT
    version_id,
    post_id,
    platform,
    version_number,
    variant_key,
    fields,
    brand_id,
    vibe_preset,
    performance_value,
    version_created_at,
    rank_in_group
FROM ranked
WHERE rank_in_group <= 10;  -- keep top 10 per group; RPCs further limit

COMMENT ON VIEW v_top_metadata_patterns IS
    'Top-performing AI-generated metadata per (brand_id, platform, vibe_preset). Used by get_generation_exemplars RPC.';

-- =====================================================
-- 6. RPC: record_post_metadata_version
-- =====================================================

CREATE OR REPLACE FUNCTION record_post_metadata_version(
    p_post_id          UUID,
    p_platform         TEXT,
    p_version_type     TEXT,
    p_variant_key      TEXT DEFAULT NULL,
    p_fields           JSONB DEFAULT '{}'::JSONB,
    p_generation_model TEXT DEFAULT NULL,
    p_schema_version   INTEGER DEFAULT 1,
    p_idempotency_key  TEXT DEFAULT NULL,
    p_created_by       TEXT DEFAULT 'scheduler'
)
RETURNS TABLE (
    id              UUID,
    version_number  INTEGER,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_next_version INTEGER;
    v_id           UUID;
    v_created_at   TIMESTAMPTZ;
BEGIN
    -- Idempotency: if key already exists, return existing row
    IF p_idempotency_key IS NOT NULL THEN
        SELECT pmv.id, pmv.version_number, pmv.created_at
        INTO v_id, v_next_version, v_created_at
        FROM post_metadata_versions pmv
        WHERE pmv.idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN QUERY SELECT v_id, v_next_version, v_created_at;
            RETURN;
        END IF;
    END IF;

    -- Compute next version number
    SELECT COALESCE(MAX(pmv.version_number), 0) + 1
    INTO v_next_version
    FROM post_metadata_versions pmv
    WHERE pmv.post_id = p_post_id AND pmv.platform = p_platform;

    -- Insert
    INSERT INTO post_metadata_versions (
        post_id, platform, version_number, version_type,
        variant_key, fields, generation_model, schema_version,
        idempotency_key, created_by
    ) VALUES (
        p_post_id, p_platform, v_next_version, p_version_type,
        p_variant_key, p_fields, p_generation_model, p_schema_version,
        p_idempotency_key, p_created_by
    )
    RETURNING post_metadata_versions.id, post_metadata_versions.version_number, post_metadata_versions.created_at
    INTO v_id, v_next_version, v_created_at;

    RETURN QUERY SELECT v_id, v_next_version, v_created_at;
END;
$$;

-- =====================================================
-- 7. RPC: get_post_metadata_versions
-- =====================================================

CREATE OR REPLACE FUNCTION get_post_metadata_versions(
    p_post_id   UUID,
    p_platform  TEXT
)
RETURNS TABLE (
    id               UUID,
    version_number   INTEGER,
    version_type     TEXT,
    variant_key      TEXT,
    fields           JSONB,
    generation_model TEXT,
    performance_value BIGINT,
    created_at       TIMESTAMPTZ,
    created_by       TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        v.id,
        v.version_number,
        v.version_type,
        v.variant_key,
        v.fields,
        v.generation_model,
        (COALESCE(m.views, 0)
            + 5  * COALESCE(m.likes, 0)
            + 10 * COALESCE(m.comments, 0)
            + 10 * COALESCE(m.shares, 0))::BIGINT AS performance_value,
        v.created_at,
        v.created_by
    FROM post_metadata_versions v
    LEFT JOIN v_post_metrics_latest m
        ON m.post_id = v.post_id AND m.platform = v.platform
    WHERE v.post_id = p_post_id
      AND v.platform = p_platform
    ORDER BY v.version_number DESC;
$$;

-- =====================================================
-- 8. RPC: get_variant_performance
-- =====================================================

CREATE OR REPLACE FUNCTION get_variant_performance(
    p_job_id    UUID,
    p_platform  TEXT
)
RETURNS TABLE (
    variant_key      TEXT,
    avg_performance  NUMERIC,
    post_count       INTEGER,
    min_performance  BIGINT,
    max_performance  BIGINT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        COALESCE(vp.variant_key, '_control') AS variant_key,
        ROUND(AVG(vp.performance_value), 2)  AS avg_performance,
        COUNT(DISTINCT vp.post_id)::INTEGER  AS post_count,
        MIN(vp.performance_value)::BIGINT    AS min_performance,
        MAX(vp.performance_value)::BIGINT    AS max_performance
    FROM v_post_variant_performance vp
    WHERE vp.job_id = p_job_id
      AND vp.platform = p_platform
      AND vp.version_type IN ('ai', 'regenerate')  -- only AI versions
    GROUP BY COALESCE(vp.variant_key, '_control')
    ORDER BY avg_performance DESC;
$$;

-- =====================================================
-- 9. RPC: assign_ab_variant
-- =====================================================

CREATE OR REPLACE FUNCTION assign_ab_variant(
    p_job_id              UUID,
    p_platform            TEXT,
    p_variant_key         TEXT,
    p_style_instructions  TEXT
)
RETURNS TABLE (
    id          UUID,
    variant_key TEXT,
    is_active   BOOLEAN,
    created_at  TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO post_metadata_variant_assignments (
        job_id, platform, variant_key, style_instructions
    ) VALUES (
        p_job_id, p_platform, p_variant_key, p_style_instructions
    )
    ON CONFLICT (job_id, platform, variant_key)
    DO UPDATE SET
        style_instructions = EXCLUDED.style_instructions,
        is_active = true
    RETURNING
        post_metadata_variant_assignments.id,
        post_metadata_variant_assignments.variant_key,
        post_metadata_variant_assignments.is_active,
        post_metadata_variant_assignments.created_at;
$$;

-- =====================================================
-- 10. RPC: get_generation_exemplars
-- =====================================================

CREATE OR REPLACE FUNCTION get_generation_exemplars(
    p_brand_id     UUID,
    p_platform     TEXT,
    p_vibe_preset  TEXT,
    p_limit        INTEGER DEFAULT 3
)
RETURNS TABLE (
    post_id           UUID,
    fields            JSONB,
    performance_value BIGINT,
    variant_key       TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        t.post_id,
        t.fields,
        t.performance_value::BIGINT,
        t.variant_key
    FROM v_top_metadata_patterns t
    WHERE t.brand_id = p_brand_id
      AND t.platform = p_platform
      AND t.vibe_preset = p_vibe_preset
    ORDER BY t.performance_value DESC, t.version_created_at DESC
    LIMIT p_limit;
$$;

-- =====================================================
-- Done
-- =====================================================
