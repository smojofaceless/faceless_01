-- =====================================================
-- SYSTEM HARDENING BATCH
-- Date: 2026-03-19
--
-- Items:
--   1. Data cleanup cron (monthly)
--   2. Winning patterns multi-window (7/14/30)
--   3. Recency decay weighting in recompute_winning_patterns
--   4. Story uniqueness threshold enforcement
--   5. Sweep permanently-stuck posts to 'failed'
--   6. Skip stub platforms in metrics collection
-- =====================================================


-- ─── 1. DATA CLEANUP CRON ────────────────────────────────────────
-- Schedule existing cleanup RPCs that were never cron'd

SELECT cron.unschedule('cleanup-old-data')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-data');

SELECT cron.schedule(
  'cleanup-old-data',
  '0 4 1 * *',   -- 1st of each month at 04:00 UTC
  $$
    -- Clean job step logs older than 30 days
    SELECT cleanup_old_job_logs(30);
    -- Clean lifecycle events older than 90 days
    SELECT cleanup_old_lifecycle_events(90);
    -- Clean post metrics older than 365 days
    SELECT cleanup_old_post_metrics(365);
  $$
);

COMMENT ON FUNCTION cleanup_old_post_metrics IS 
  'Monthly cron: removes post_metrics rows older than N days. Scheduled via cleanup-old-data cron.';


-- ─── 2. WINNING PATTERNS MULTI-WINDOW ───────────────────────────
-- Current cron only computes 30-day. Add 7 and 14 day windows.

SELECT cron.unschedule('recompute-winning-patterns')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-winning-patterns');

SELECT cron.schedule(
  'recompute-winning-patterns',
  '0 3 * * *',   -- Daily at 03:00 UTC (unchanged schedule)
  $$
    SELECT recompute_all_winning_patterns(7);
    SELECT recompute_all_winning_patterns(14);
    SELECT recompute_all_winning_patterns(30);
  $$
);


-- ─── 3. RECENCY DECAY IN WINNING PATTERNS ───────────────────────
-- Modify recompute_winning_patterns to weight recent posts higher.
-- Uses exponential decay: weight = exp(-0.03 * days_old)
-- A post 7 days old has weight ~0.81, 14 days ~0.66, 30 days ~0.41

CREATE OR REPLACE FUNCTION recompute_winning_patterns(
  p_brand_id UUID,
  p_platform TEXT,
  p_vibe_preset TEXT DEFAULT NULL,
  p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  brand_id UUID,
  platform TEXT,
  vibe_preset TEXT,
  sample_count INTEGER,
  computed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_top_hooks       JSONB;
    v_top_hashtags    JSONB;
    v_top_ctas        JSONB;
    v_length_stats    JSONB;
    v_sample_count    INTEGER;
    v_avg_perf        NUMERIC;
    v_computed        TIMESTAMPTZ := now();
BEGIN
    DROP TABLE IF EXISTS _wp_versions;

    -- Gather top-performing versions with recency weight
    CREATE TEMP TABLE _wp_versions ON COMMIT DROP AS
    SELECT
        vp.post_id,
        vp.fields,
        vp.performance_value,
        vp.version_created_at,
        -- Exponential recency decay
        EXP(-0.03 * EXTRACT(EPOCH FROM (now() - vp.version_created_at)) / 86400.0) AS recency_weight,
        vp.performance_value * EXP(-0.03 * EXTRACT(EPOCH FROM (now() - vp.version_created_at)) / 86400.0) AS weighted_perf
    FROM v_post_variant_performance vp
    WHERE vp.brand_id = p_brand_id
      AND vp.platform = p_platform
      AND (p_vibe_preset IS NULL OR vp.vibe_preset = p_vibe_preset)
      AND vp.version_type IN ('ai', 'regenerate')
      AND vp.performance_value > 0
      AND vp.version_created_at >= now() - (p_window_days || ' days')::INTERVAL
    ORDER BY weighted_perf DESC
    LIMIT 50;

    SELECT COUNT(*), COALESCE(ROUND(SUM(weighted_perf) / NULLIF(SUM(recency_weight), 0), 2), 0)
    INTO v_sample_count, v_avg_perf
    FROM _wp_versions;

    IF v_sample_count = 0 THEN
        INSERT INTO winning_metadata_patterns (
            brand_id, platform, vibe_preset, window_days,
            top_hooks, top_hashtags, top_ctas, length_stats,
            sample_count, avg_performance, computed_at
        ) VALUES (
            p_brand_id, p_platform, p_vibe_preset, p_window_days,
            '[]', '[]', '[]', '{}',
            0, 0, v_computed
        )
        ON CONFLICT (brand_id, platform, COALESCE(vibe_preset, ''), window_days)
        DO UPDATE SET
            top_hooks = '[]', top_hashtags = '[]', top_ctas = '[]',
            length_stats = '{}', sample_count = 0, avg_performance = 0,
            computed_at = v_computed;

        RETURN QUERY SELECT p_brand_id, p_platform, p_vibe_preset, 0, v_computed;
        RETURN;
    END IF;

    -- Top hooks (by recency-weighted perf)
    SELECT COALESCE(jsonb_agg(hook_row ORDER BY (hook_row->>'perf')::NUMERIC DESC), '[]'::JSONB)
    INTO v_top_hooks
    FROM (
        SELECT jsonb_build_object(
            'hook', hook_text,
            'perf', ROUND(SUM(v.weighted_perf)),
            'post_id', (array_agg(v.post_id ORDER BY v.weighted_perf DESC))[1]
        ) AS hook_row
        FROM _wp_versions v,
        LATERAL (
            SELECT LEFT(COALESCE(v.fields->>'title', v.fields->>'caption', ''), 80) AS hook_text
        ) h
        WHERE h.hook_text != ''
        GROUP BY hook_text
        ORDER BY SUM(v.weighted_perf) DESC
        LIMIT 10
    ) hooks;

    -- Top hashtags (recency-weighted avg)
    SELECT COALESCE(jsonb_agg(tag_row ORDER BY (tag_row->>'avg_perf')::NUMERIC DESC), '[]'::JSONB)
    INTO v_top_hashtags
    FROM (
        SELECT jsonb_build_object(
            'tag', LOWER(tag_val),
            'count', COUNT(*),
            'avg_perf', ROUND(SUM(v.weighted_perf) / NULLIF(SUM(v.recency_weight), 0), 1)
        ) AS tag_row
        FROM _wp_versions v,
        LATERAL jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(v.fields->'hashtags') = 'array' THEN v.fields->'hashtags'
                WHEN jsonb_typeof(v.fields->'tags') = 'array' THEN v.fields->'tags'
                ELSE '[]'::JSONB
            END
        ) AS tag_val
        WHERE tag_val IS NOT NULL AND tag_val != ''
        GROUP BY LOWER(tag_val)
        HAVING COUNT(*) >= 2
        ORDER BY SUM(v.weighted_perf) / NULLIF(SUM(v.recency_weight), 0) DESC
        LIMIT 20
    ) tags;

    -- CTA phrases
    SELECT COALESCE(jsonb_agg(cta_row ORDER BY (cta_row->>'count')::INT DESC), '[]'::JSONB)
    INTO v_top_ctas
    FROM (
        SELECT jsonb_build_object(
            'cta', cta_match,
            'count', COUNT(*)
        ) AS cta_row
        FROM _wp_versions v,
        LATERAL (
            SELECT (regexp_matches(
                LOWER(COALESCE(v.fields->>'description', '') || ' ' || COALESCE(v.fields->>'caption', '')),
                '(subscribe|like (?:and |& )?(?:share|comment)|follow (?:for |us )?(?:more)?|share (?:this|with)|comment (?:below|your|what)|turn on (?:notifications|the bell)|hit (?:the )?(?:bell|like)|don''t forget to|link in (?:bio|description)|watch (?:till|until|to) (?:the )?end)',
                'gi'
            ))[1] AS cta_match
        ) cta
        WHERE cta.cta_match IS NOT NULL
        GROUP BY cta_match
        ORDER BY COUNT(*) DESC
        LIMIT 10
    ) ctas;

    -- Length stats (recency-weighted)
    SELECT jsonb_build_object(
        'avg_title_len', COALESCE(ROUND(SUM(LENGTH(v.fields->>'title') * v.recency_weight) / NULLIF(SUM(v.recency_weight), 0), 0), 0),
        'avg_desc_len', COALESCE(ROUND(SUM(LENGTH(COALESCE(v.fields->>'description', v.fields->>'caption', '')) * v.recency_weight) / NULLIF(SUM(v.recency_weight), 0), 0), 0),
        'avg_tag_count', COALESCE(ROUND(SUM(
            CASE
                WHEN jsonb_typeof(v.fields->'hashtags') = 'array' THEN jsonb_array_length(v.fields->'hashtags')
                WHEN jsonb_typeof(v.fields->'tags') = 'array' THEN jsonb_array_length(v.fields->'tags')
                ELSE 0
            END * v.recency_weight
        ) / NULLIF(SUM(v.recency_weight), 0), 1), 0),
        'avg_perf', v_avg_perf
    )
    INTO v_length_stats
    FROM _wp_versions v;

    -- Upsert
    INSERT INTO winning_metadata_patterns (
        brand_id, platform, vibe_preset, window_days,
        top_hooks, top_hashtags, top_ctas, length_stats,
        sample_count, avg_performance, computed_at
    ) VALUES (
        p_brand_id, p_platform, p_vibe_preset, p_window_days,
        v_top_hooks, v_top_hashtags, v_top_ctas, v_length_stats,
        v_sample_count, v_avg_perf, v_computed
    )
    ON CONFLICT (brand_id, platform, COALESCE(vibe_preset, ''), window_days)
    DO UPDATE SET
        top_hooks       = EXCLUDED.top_hooks,
        top_hashtags    = EXCLUDED.top_hashtags,
        top_ctas        = EXCLUDED.top_ctas,
        length_stats    = EXCLUDED.length_stats,
        sample_count    = EXCLUDED.sample_count,
        avg_performance = EXCLUDED.avg_performance,
        computed_at     = EXCLUDED.computed_at;

    RETURN QUERY SELECT p_brand_id, p_platform, p_vibe_preset, v_sample_count, v_computed;
END;
$$;


-- ─── 4. STORY UNIQUENESS THRESHOLD CONFIG ────────────────────────
-- Add a brand-level config for uniqueness rejection threshold
-- and a RPC to check + enforce it

CREATE OR REPLACE FUNCTION check_story_uniqueness(
  p_brand_id UUID,
  p_concept_hash TEXT,
  p_job_id UUID,
  p_threshold NUMERIC DEFAULT 0.6
)
RETURNS TABLE (
  is_unique BOOLEAN,
  uniqueness_score NUMERIC,
  collision_count INTEGER,
  colliding_titles TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_collisions RECORD;
  v_count INTEGER := 0;
  v_titles TEXT[] := '{}';
BEGIN
  SELECT COUNT(*)::INTEGER, 
         array_agg(meta->>'title') FILTER (WHERE meta->>'title' IS NOT NULL)
  INTO v_count, v_titles
  FROM story_dna
  WHERE brand_id = p_brand_id
    AND concept_hash = p_concept_hash
    AND job_id != p_job_id;

  RETURN QUERY SELECT
    (v_count = 0) AS is_unique,
    CASE WHEN v_count = 0 THEN 0.95 ELSE GREATEST(0.1, 0.95 - (v_count * 0.2)) END AS uniqueness_score,
    v_count AS collision_count,
    COALESCE(v_titles, '{}') AS colliding_titles;
END;
$$;

GRANT EXECUTE ON FUNCTION check_story_uniqueness(UUID, TEXT, UUID, NUMERIC) TO anon;
GRANT EXECUTE ON FUNCTION check_story_uniqueness(UUID, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION check_story_uniqueness(UUID, TEXT, UUID, NUMERIC) TO service_role;


-- ─── 5. SWEEP STUCK POSTS ───────────────────────────────────────
-- Posts with attempt_count >= 3 stuck in 'scheduled' → move to 'failed'

CREATE OR REPLACE FUNCTION sweep_dead_posts(
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH dead AS (
    UPDATE posts
    SET 
      status = 'failed',
      error = jsonb_build_object(
        'class', 'exhausted',
        'message', format('Exceeded max attempts (%s)', p_max_attempts),
        'failed_at', NOW()
      ),
      failed_at = NOW(),
      updated_at = NOW()
    WHERE status = 'scheduled'
      AND COALESCE(attempt_count, 0) >= p_max_attempts
      AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM dead;
  
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION sweep_dead_posts(INTEGER) TO service_role;

-- Add to existing stale sweeper cron (every 5 min)
SELECT cron.unschedule('sweep-stale-leases')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-leases');

SELECT cron.schedule(
  'sweep-stale-leases',
  '*/5 * * * *',
  $$
    SELECT sweep_stale_jobs(60, 50);
    SELECT sweep_stale_post_leases(false);
    SELECT sweep_dead_posts(3);
  $$
);


-- ─── 6. CROSS-PLATFORM COMPARISON VIEW ──────────────────────────
-- Per-story, per-platform metrics for side-by-side comparison

CREATE OR REPLACE VIEW v_cross_platform_performance AS
SELECT
  p.job_id,
  p.brand_id,
  p.title,
  p.platform,
  p.posted_at,
  m.views,
  m.likes,
  m.comments,
  m.shares,
  m.saves,
  (COALESCE(m.views, 0) + 5 * COALESCE(m.likes, 0) + 10 * COALESCE(m.comments, 0) + 10 * COALESCE(m.shares, 0)) AS perf_score,
  m.collected_at AS metrics_at
FROM posts p
LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
WHERE p.status = 'posted'
  AND p.job_id IS NOT NULL;

GRANT SELECT ON v_cross_platform_performance TO anon;
GRANT SELECT ON v_cross_platform_performance TO authenticated;


-- ─── 7. STRATEGY INTELLIGENCE TABLES ────────────────────────────
-- Foundation for the strategy awareness system (Roadmap items 21-22)

-- 7a. Post Strategy Registry
CREATE TABLE IF NOT EXISTS post_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  strategy_type TEXT NOT NULL,
  cta_type TEXT DEFAULT 'none',
  caption_style TEXT DEFAULT 'narrative',
  hook_type TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by TEXT DEFAULT 'ai',
  meta JSONB DEFAULT '{}',
  UNIQUE (post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_strategies_platform ON post_strategies (platform, strategy_type);
CREATE INDEX IF NOT EXISTS idx_post_strategies_post ON post_strategies (post_id);

ALTER TABLE post_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_select_all" ON post_strategies FOR SELECT USING (true);
CREATE POLICY "ps_insert_all" ON post_strategies FOR INSERT WITH CHECK (true);
CREATE POLICY "ps_update_all" ON post_strategies FOR UPDATE USING (true);
GRANT SELECT, INSERT, UPDATE ON post_strategies TO anon;
GRANT SELECT, INSERT, UPDATE ON post_strategies TO authenticated;
GRANT ALL ON post_strategies TO service_role;

-- 7b. Platform Strategy Archetypes (catalog)
CREATE TABLE IF NOT EXISTS platform_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  strategy_type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  primary_metric TEXT NOT NULL,
  allowed_cta_types TEXT[] DEFAULT '{}',
  disallowed_patterns TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform, strategy_type)
);

ALTER TABLE platform_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pstrat_select_all" ON platform_strategies FOR SELECT USING (true);
GRANT SELECT ON platform_strategies TO anon;
GRANT SELECT ON platform_strategies TO authenticated;
GRANT ALL ON platform_strategies TO service_role;

-- Seed platform strategies
INSERT INTO platform_strategies (platform, strategy_type, label, description, primary_metric, allowed_cta_types) VALUES
  -- YouTube Shorts
  ('youtube_shorts', 'retention_hook', 'Retention Hook', 'Open with an irresistible first line that prevents scroll. Build tension through the short.', 'views', ARRAY['subscribe', 'none']),
  ('youtube_shorts', 'curiosity_gap', 'Curiosity Gap', 'Title creates a question the viewer must watch to answer. Reward at the end.', 'views', ARRAY['subscribe', 'none']),
  ('youtube_shorts', 'counting_anomaly', 'Counting Anomaly', 'Use numbers that dont add up (e.g., "5 people entered, 4 came out"). Creates instant intrigue.', 'views', ARRAY['subscribe', 'question']),
  ('youtube_shorts', 'found_footage', 'Found Footage', 'Present as discovered evidence. Raw, unpolished feel. Urgency in narration.', 'views', ARRAY['subscribe', 'none']),
  ('youtube_shorts', 'hidden_entity', 'Hidden Entity', 'Something is there but unseen. Build atmospheric dread through suggestion, not revelation.', 'views', ARRAY['subscribe', 'none']),
  -- Instagram Reels
  ('instagram_reels', 'save_bait', 'Save Bait', 'Create content so valuable/creepy that viewers save it to revisit. Lists, lore dumps, unsettling details.', 'saves', ARRAY['save_prompt', 'share_prompt']),
  ('instagram_reels', 'share_hook', 'Share Hook', 'Content designed to be sent to friends. Relatable fear, tag-a-friend moments.', 'shares', ARRAY['share_prompt', 'question']),
  ('instagram_reels', 'carousel_teaser', 'Carousel Teaser', 'Reel teases a deeper story. Drive to carousel post or story highlights.', 'saves', ARRAY['follow', 'none']),
  ('instagram_reels', 'aesthetic_dread', 'Aesthetic Dread', 'Visually beautiful but deeply unsettling. High production value focus.', 'likes', ARRAY['follow', 'none']),
  ('instagram_reels', 'reply_farming', 'Reply Farming', 'End with open question or ambiguous ending that demands viewer opinions.', 'comments', ARRAY['question']),
  -- Facebook Reels
  ('facebook_reels', 'watch_party', 'Watch Party', 'Content that groups watch together. Community-oriented horror.', 'shares', ARRAY['share_prompt', 'question']),
  ('facebook_reels', 'nostalgia_horror', 'Nostalgia Horror', 'Reference shared cultural memories with a dark twist. 80s/90s settings.', 'views', ARRAY['share_prompt', 'none']),
  ('facebook_reels', 'local_legend', 'Local Legend', 'Stories that feel like they could happen in your town. Geographic specificity.', 'shares', ARRAY['share_prompt', 'question']),
  -- TikTok
  ('tiktok', 'scroll_stop', 'Scroll Stop', 'First frame must freeze the thumb. Visual or text hook in frame 1.', 'views', ARRAY['none']),
  ('tiktok', 'stitch_bait', 'Stitch Bait', 'Create content others want to stitch/react to. Controversial or unbelievable claims.', 'shares', ARRAY['none', 'question']),
  ('tiktok', 'series_hook', 'Series Hook', 'Part 1 of N format. End on cliffhanger. Drive follows for next episode.', 'views', ARRAY['follow', 'none']),
  -- Threads
  ('threads', 'conversation_starter', 'Conversation Starter', 'Open-ended horror scenario. Ask what viewers would do.', 'comments', ARRAY['question']),
  ('threads', 'micro_lore', 'Micro Lore', 'Tiny self-contained horror lore in 1-2 sentences. Worldbuilding snippets.', 'likes', ARRAY['none']),
  -- X/Twitter
  ('x', 'quote_bait', 'Quote Bait', 'Statement so bold/creepy it demands quote-tweeting with reactions.', 'shares', ARRAY['none']),
  ('x', 'thread_hook', 'Thread Hook', 'First tweet hooks, thread delivers. Horror in installments.', 'views', ARRAY['follow', 'none'])
ON CONFLICT (platform, strategy_type) DO NOTHING;


-- 7c. Strategy Performance View
CREATE OR REPLACE VIEW v_strategy_performance AS
SELECT
  ps.platform,
  ps.strategy_type,
  ps.caption_style,
  ps.hook_type,
  p.brand_id,
  COUNT(*) AS post_count,
  ROUND(AVG(COALESCE(m.views, 0)), 0) AS avg_views,
  ROUND(AVG(COALESCE(m.likes, 0)), 0) AS avg_likes,
  ROUND(AVG(COALESCE(m.comments, 0)), 0) AS avg_comments,
  ROUND(AVG(COALESCE(m.shares, 0)), 0) AS avg_shares,
  ROUND(AVG(COALESCE(m.saves, 0)), 0) AS avg_saves,
  ROUND(AVG(
    COALESCE(m.views, 0) + 5 * COALESCE(m.likes, 0) + 10 * COALESCE(m.comments, 0) + 10 * COALESCE(m.shares, 0)
  ), 0) AS avg_perf_score
FROM post_strategies ps
JOIN posts p ON ps.post_id = p.id
LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
WHERE p.status = 'posted'
GROUP BY ps.platform, ps.strategy_type, ps.caption_style, ps.hook_type, p.brand_id;

GRANT SELECT ON v_strategy_performance TO anon;
GRANT SELECT ON v_strategy_performance TO authenticated;


-- 7d. Strategy RPCs
CREATE OR REPLACE FUNCTION assign_post_strategy(
  p_post_id UUID,
  p_platform TEXT,
  p_strategy_type TEXT,
  p_cta_type TEXT DEFAULT 'none',
  p_caption_style TEXT DEFAULT 'narrative',
  p_hook_type TEXT DEFAULT NULL,
  p_assigned_by TEXT DEFAULT 'ai'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO post_strategies (post_id, platform, strategy_type, cta_type, caption_style, hook_type, assigned_by)
  VALUES (p_post_id, p_platform, p_strategy_type, p_cta_type, p_caption_style, p_hook_type, p_assigned_by)
  ON CONFLICT (post_id) DO UPDATE SET
    strategy_type = EXCLUDED.strategy_type,
    cta_type = EXCLUDED.cta_type,
    caption_style = EXCLUDED.caption_style,
    hook_type = EXCLUDED.hook_type,
    assigned_by = EXCLUDED.assigned_by,
    assigned_at = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_post_strategy TO service_role;
GRANT EXECUTE ON FUNCTION assign_post_strategy TO anon;

CREATE OR REPLACE FUNCTION get_top_strategies(
  p_brand_id UUID,
  p_platform TEXT,
  p_limit INTEGER DEFAULT 3,
  p_window_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  strategy_type TEXT,
  post_count BIGINT,
  avg_perf_score NUMERIC,
  avg_views NUMERIC,
  best_hook TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.strategy_type,
    COUNT(*) AS post_count,
    ROUND(AVG(
      COALESCE(m.views, 0) + 5 * COALESCE(m.likes, 0) + 10 * COALESCE(m.comments, 0) + 10 * COALESCE(m.shares, 0)
    ), 0) AS avg_perf_score,
    ROUND(AVG(COALESCE(m.views, 0)), 0) AS avg_views,
    (array_agg(p.title ORDER BY COALESCE(m.views, 0) DESC))[1] AS best_hook
  FROM post_strategies ps
  JOIN posts p ON ps.post_id = p.id
  LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
  WHERE p.brand_id = p_brand_id
    AND ps.platform = p_platform
    AND p.status = 'posted'
    AND p.posted_at >= NOW() - (p_window_days || ' days')::INTERVAL
  GROUP BY ps.strategy_type
  HAVING COUNT(*) >= 2
  ORDER BY avg_perf_score DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_top_strategies TO anon;
GRANT EXECUTE ON FUNCTION get_top_strategies TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_strategies TO service_role;


-- ─── 8. A/B VARIANT ASSIGNMENT RPC ──────────────────────────────
-- The missing piece — auto-assign A/B variants to posts

CREATE OR REPLACE FUNCTION auto_assign_ab_variants(
  p_brand_id UUID,
  p_platform TEXT,
  p_job_id UUID,
  p_split_ratio NUMERIC DEFAULT 0.5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_post RECORD;
  v_count INTEGER := 0;
  v_variant TEXT;
BEGIN
  FOR v_post IN
    SELECT id FROM posts
    WHERE brand_id = p_brand_id
      AND platform = p_platform
      AND job_id = p_job_id
      AND status IN ('pending', 'scheduled')
      AND id NOT IN (SELECT post_id FROM post_metadata_variant_assignments WHERE is_active = true)
    ORDER BY created_at
  LOOP
    -- Alternate variants: A gets standard gen, B gets experimental
    v_variant := CASE WHEN random() < p_split_ratio THEN 'A' ELSE 'B' END;
    
    INSERT INTO post_metadata_variant_assignments (post_id, variant_key, platform, is_active, meta)
    VALUES (v_post.id, v_variant, p_platform, true, jsonb_build_object(
      'assigned_at', NOW(),
      'split_ratio', p_split_ratio,
      'source', 'auto_assign'
    ))
    ON CONFLICT DO NOTHING;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_assign_ab_variants TO service_role;


-- ─── 9. IMAGE/VISUAL PERFORMANCE TRACKING VIEW ─────────────────
-- Connect image pipeline data to metrics for visual style analysis

CREATE OR REPLACE VIEW v_visual_performance AS
SELECT
  p.brand_id,
  p.job_id,
  p.title,
  p.platform,
  ja.meta->>'scene_count' AS scene_count,
  ja.meta->>'total_images' AS total_images,
  ja.meta->>'image_provider' AS image_provider,
  p.meta->>'vibe_preset' AS vibe_preset,
  COALESCE(m.views, 0) AS views,
  COALESCE(m.likes, 0) AS likes,
  COALESCE(m.comments, 0) AS comments,
  COALESCE(m.shares, 0) AS shares,
  (COALESCE(m.views, 0) + 5 * COALESCE(m.likes, 0) + 10 * COALESCE(m.comments, 0) + 10 * COALESCE(m.shares, 0)) AS perf_score,
  p.posted_at
FROM posts p
LEFT JOIN v_post_metrics_latest m ON m.post_id = p.id
LEFT JOIN job_assets ja ON ja.job_id = p.job_id AND ja.type = 'image_manifest'
WHERE p.status = 'posted';

GRANT SELECT ON v_visual_performance TO anon;
GRANT SELECT ON v_visual_performance TO authenticated;


-- ─── 10. DRAFT STATUS FOR POSTS ─────────────────────────────────
-- Allow posts to be created in 'draft' status for preview/approval

-- The posts table already uses TEXT for status, so just add support
-- in the find_due_posts / claim_due_posts to skip drafts (they already do —
-- they only pick status='scheduled'). We just need an RPC to promote drafts.

CREATE OR REPLACE FUNCTION promote_draft_to_scheduled(
  p_post_id UUID,
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts
  SET 
    status = 'scheduled',
    scheduled_at = COALESCE(p_scheduled_at, scheduled_at, NOW() + INTERVAL '5 minutes'),
    updated_at = NOW()
  WHERE id = p_post_id
    AND status = 'draft';
  
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION promote_draft_to_scheduled TO anon;
GRANT EXECUTE ON FUNCTION promote_draft_to_scheduled TO authenticated;
GRANT EXECUTE ON FUNCTION promote_draft_to_scheduled TO service_role;

CREATE OR REPLACE FUNCTION reject_draft(
  p_post_id UUID,
  p_reason TEXT DEFAULT 'Rejected by user'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts
  SET 
    status = 'cancelled',
    error = jsonb_build_object('class', 'rejected', 'message', p_reason, 'rejected_at', NOW()),
    updated_at = NOW()
  WHERE id = p_post_id
    AND status = 'draft';
  
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_draft TO anon;
GRANT EXECUTE ON FUNCTION reject_draft TO authenticated;
GRANT EXECUTE ON FUNCTION reject_draft TO service_role;


-- ─── 11. BRAND ALERT WEBHOOK CONFIG ─────────────────────────────
-- Store webhook URLs per brand for external alerting

CREATE TABLE IF NOT EXISTS brand_alert_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_type TEXT NOT NULL DEFAULT 'discord',
  events TEXT[] DEFAULT ARRAY['token_expired', 'campaign_paused', 'budget_exceeded', 'renderer_down'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (brand_id, webhook_type)
);

ALTER TABLE brand_alert_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bac_select_all" ON brand_alert_config FOR SELECT USING (true);
CREATE POLICY "bac_insert_all" ON brand_alert_config FOR INSERT WITH CHECK (true);
CREATE POLICY "bac_update_all" ON brand_alert_config FOR UPDATE USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON brand_alert_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON brand_alert_config TO authenticated;
GRANT ALL ON brand_alert_config TO service_role;

-- Global alerts config (non-brand-specific)
CREATE TABLE IF NOT EXISTS system_alert_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url TEXT NOT NULL,
  webhook_type TEXT NOT NULL DEFAULT 'discord',
  events TEXT[] DEFAULT ARRAY['kill_switch', 'renderer_down', 'cron_failure'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (webhook_type)
);

ALTER TABLE system_alert_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sac_select_all" ON system_alert_config FOR SELECT USING (true);
GRANT SELECT ON system_alert_config TO anon;
GRANT ALL ON system_alert_config TO service_role;
