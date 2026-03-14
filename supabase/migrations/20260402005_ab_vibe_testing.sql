-- Migration: Automated A/B Vibe Testing
-- Schedules structured experiments comparing dominant vs challenger vibes,
-- evaluates after maturation period, and auto-adjusts preset weights.
-- Works with existing post_metadata_variant_assignments + recompute_preset_weights.

-- =====================================================
-- 1. TABLE: ab_vibe_tests
-- =====================================================

CREATE TABLE IF NOT EXISTS ab_vibe_tests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    control_vibe    TEXT NOT NULL,
    challenger_vibe TEXT NOT NULL,
    platforms       TEXT[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','active','evaluating','completed','cancelled')),
    posts_control   INT NOT NULL DEFAULT 0,
    posts_challenger INT NOT NULL DEFAULT 0,
    result          JSONB,          -- {control_avg_perf, challenger_avg_perf, winner, weight_delta}
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    evaluate_after  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '48 hours',
    evaluated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_vibe_tests_brand_status
    ON ab_vibe_tests (brand_id, status);

ALTER TABLE ab_vibe_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ab_vibe_tests_select" ON ab_vibe_tests FOR SELECT USING (true);
CREATE POLICY "ab_vibe_tests_insert" ON ab_vibe_tests FOR INSERT WITH CHECK (true);
CREATE POLICY "ab_vibe_tests_update" ON ab_vibe_tests FOR UPDATE USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON ab_vibe_tests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ab_vibe_tests TO service_role;

-- =====================================================
-- 2. FUNCTION: schedule_ab_vibe_test
-- Picks dominant + challenger vibe for a brand,
-- assigns variant instructions to upcoming pending posts.
-- =====================================================

CREATE OR REPLACE FUNCTION schedule_ab_vibe_test(p_brand_id UUID)
RETURNS UUID AS $$
DECLARE
    v_control       TEXT;
    v_challenger    TEXT;
    v_test_id       UUID;
    v_job           RECORD;
    v_platforms     TEXT[];
    v_count_ctrl    INT := 0;
    v_count_chal    INT := 0;
    v_idx           INT := 0;
BEGIN
    -- Check no active test exists for this brand
    IF EXISTS (
        SELECT 1 FROM ab_vibe_tests
        WHERE brand_id = p_brand_id
          AND status IN ('scheduled', 'active')
    ) THEN
        RETURN NULL; -- already has an active test
    END IF;

    -- Find dominant vibe (highest weight) and challenger (lowest weight, >= 10)
    SELECT template_type INTO v_control
    FROM brand_templates
    WHERE brand_id = p_brand_id AND weight > 0
    ORDER BY weight DESC
    LIMIT 1;

    SELECT template_type INTO v_challenger
    FROM brand_templates
    WHERE brand_id = p_brand_id AND weight > 0
      AND template_type != v_control
    ORDER BY weight ASC
    LIMIT 1;

    IF v_control IS NULL OR v_challenger IS NULL THEN
        RETURN NULL; -- need at least 2 presets
    END IF;

    -- Get platforms this brand posts to
    SELECT ARRAY_AGG(DISTINCT platform) INTO v_platforms
    FROM posts
    WHERE brand_id = p_brand_id
      AND status = 'posted'
      AND posted_at > NOW() - INTERVAL '30 days';

    IF v_platforms IS NULL OR array_length(v_platforms, 1) = 0 THEN
        RETURN NULL;
    END IF;

    -- Create test record
    INSERT INTO ab_vibe_tests (brand_id, control_vibe, challenger_vibe, platforms)
    VALUES (p_brand_id, v_control, v_challenger, v_platforms)
    RETURNING id INTO v_test_id;

    -- Find upcoming pending jobs for this brand (next 6 jobs)
    FOR v_job IN
        SELECT j.id AS job_id, p.platform
        FROM jobs j
        JOIN posts p ON p.job_id = j.id
        WHERE j.brand_id = p_brand_id
          AND j.status = 'pending'
          AND p.status = 'pending'
          AND p.scheduled_at > NOW()
        ORDER BY p.scheduled_at ASC
        LIMIT 6
    LOOP
        v_idx := v_idx + 1;

        IF v_idx % 2 = 0 THEN
            -- Challenger: inject vibe override via variant instructions
            INSERT INTO post_metadata_variant_assignments (
                job_id, platform, variant_key, style_instructions
            ) VALUES (
                v_job.job_id,
                v_job.platform,
                'ab_vibe_' || v_test_id::TEXT,
                'CRITICAL VIBE OVERRIDE: This is an A/B test. '
                || 'Use the "' || v_challenger || '" vibe/genre instead of the assigned vibe. '
                || 'Adopt the tone, aesthetic, and conventions of "' || v_challenger || '" throughout all generated fields. '
                || 'This override takes priority over the VIBE/GENRE field above.'
            ) ON CONFLICT (job_id, platform, variant_key) DO NOTHING;

            v_count_chal := v_count_chal + 1;
        ELSE
            -- Control: mark as control variant (no override, uses default vibe)
            INSERT INTO post_metadata_variant_assignments (
                job_id, platform, variant_key, style_instructions
            ) VALUES (
                v_job.job_id,
                v_job.platform,
                'ab_vibe_' || v_test_id::TEXT,
                'CONTROL: Use the assigned vibe/genre as-is. No modifications.'
            ) ON CONFLICT (job_id, platform, variant_key) DO NOTHING;

            v_count_ctrl := v_count_ctrl + 1;
        END IF;
    END LOOP;

    -- Update counts
    UPDATE ab_vibe_tests
    SET posts_control = v_count_ctrl,
        posts_challenger = v_count_chal,
        status = CASE WHEN v_count_ctrl + v_count_chal > 0 THEN 'active' ELSE 'cancelled' END
    WHERE id = v_test_id;

    IF v_count_ctrl + v_count_chal = 0 THEN
        RETURN NULL; -- no posts to test
    END IF;

    RETURN v_test_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. FUNCTION: evaluate_ab_vibe_tests
-- Checks mature tests, compares performance, updates weights.
-- =====================================================

CREATE OR REPLACE FUNCTION evaluate_ab_vibe_tests()
RETURNS INT AS $$
DECLARE
    v_test      RECORD;
    v_ctrl_perf NUMERIC;
    v_chal_perf NUMERIC;
    v_ctrl_cnt  INT;
    v_chal_cnt  INT;
    v_winner    TEXT;
    v_evaluated INT := 0;
    v_test_key  TEXT;
    v_weight_delta INT;
BEGIN
    FOR v_test IN
        SELECT * FROM ab_vibe_tests
        WHERE status = 'active'
          AND evaluate_after <= NOW()
    LOOP
        v_test_key := 'ab_vibe_' || v_test.id::TEXT;

        -- Get control performance (posts where variant_key matches but style = CONTROL)
        SELECT COUNT(*), COALESCE(AVG(
            (m.views + 5 * m.likes + 10 * m.comments + 10 * m.shares)
        ), 0)
        INTO v_ctrl_cnt, v_ctrl_perf
        FROM post_metadata_variant_assignments va
        JOIN posts p ON p.job_id = va.job_id AND p.platform = va.platform
        JOIN v_post_metrics_latest m ON m.post_id = p.id AND m.platform = p.platform
        WHERE va.variant_key = v_test_key
          AND va.style_instructions LIKE 'CONTROL:%';

        -- Get challenger performance
        SELECT COUNT(*), COALESCE(AVG(
            (m.views + 5 * m.likes + 10 * m.comments + 10 * m.shares)
        ), 0)
        INTO v_chal_cnt, v_chal_perf
        FROM post_metadata_variant_assignments va
        JOIN posts p ON p.job_id = va.job_id AND p.platform = va.platform
        JOIN v_post_metrics_latest m ON m.post_id = p.id AND m.platform = p.platform
        WHERE va.variant_key = v_test_key
          AND va.style_instructions LIKE 'CRITICAL VIBE OVERRIDE:%';

        -- Need at least 1 post on each side with metrics
        IF v_ctrl_cnt < 1 OR v_chal_cnt < 1 THEN
            -- Not enough data yet — extend evaluation window by 24h
            UPDATE ab_vibe_tests
            SET evaluate_after = NOW() + INTERVAL '24 hours'
            WHERE id = v_test.id;
            CONTINUE;
        END IF;

        -- Determine winner
        IF v_chal_perf > v_ctrl_perf * 1.1 THEN
            -- Challenger wins by >10% margin: boost challenger weight
            v_winner := 'challenger';
            v_weight_delta := LEAST(15, GREATEST(5, ROUND((v_chal_perf / NULLIF(v_ctrl_perf, 0) - 1) * 100)::INT));

            UPDATE brand_templates
            SET weight = GREATEST(10, weight - v_weight_delta), updated_at = NOW()
            WHERE brand_id = v_test.brand_id AND template_type = v_test.control_vibe;

            UPDATE brand_templates
            SET weight = LEAST(90, weight + v_weight_delta), updated_at = NOW()
            WHERE brand_id = v_test.brand_id AND template_type = v_test.challenger_vibe;

        ELSIF v_ctrl_perf > v_chal_perf * 1.1 THEN
            -- Control wins: no weight change, control dominance confirmed
            v_winner := 'control';
            v_weight_delta := 0;
        ELSE
            -- Within 10% margin: no significant difference
            v_winner := 'tie';
            v_weight_delta := 0;
        END IF;

        -- Record result
        UPDATE ab_vibe_tests
        SET status = 'completed',
            evaluated_at = NOW(),
            result = jsonb_build_object(
                'control_avg_perf', ROUND(v_ctrl_perf, 1),
                'challenger_avg_perf', ROUND(v_chal_perf, 1),
                'control_count', v_ctrl_cnt,
                'challenger_count', v_chal_cnt,
                'winner', v_winner,
                'weight_delta', v_weight_delta
            )
        WHERE id = v_test.id;

        -- Deactivate variant assignments
        UPDATE post_metadata_variant_assignments
        SET is_active = false
        WHERE variant_key = v_test_key;

        v_evaluated := v_evaluated + 1;
    END LOOP;

    RETURN v_evaluated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 4. FUNCTION: run_ab_vibe_testing (orchestrator)
-- Called by cron: evaluates mature tests, schedules new ones.
-- =====================================================

CREATE OR REPLACE FUNCTION run_ab_vibe_testing()
RETURNS JSONB AS $$
DECLARE
    v_evaluated INT;
    v_scheduled INT := 0;
    v_brand     RECORD;
    v_test_id   UUID;
BEGIN
    -- Step 1: Evaluate any mature tests
    v_evaluated := evaluate_ab_vibe_tests();

    -- Step 2: Schedule new tests for brands that don't have active ones
    FOR v_brand IN
        SELECT DISTINCT bt.brand_id
        FROM brand_templates bt
        WHERE bt.weight > 0
        GROUP BY bt.brand_id
        HAVING COUNT(*) >= 2  -- need at least 2 presets
    LOOP
        v_test_id := schedule_ab_vibe_test(v_brand.brand_id);
        IF v_test_id IS NOT NULL THEN
            v_scheduled := v_scheduled + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'evaluated', v_evaluated,
        'scheduled', v_scheduled,
        'run_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. CRON: Run A/B vibe testing daily at 04:00 UTC
-- =====================================================

SELECT cron.schedule(
    'run_ab_vibe_testing',
    '0 4 * * *',
    $$SELECT run_ab_vibe_testing()$$
);

-- Grant execute on new functions
GRANT EXECUTE ON FUNCTION schedule_ab_vibe_test(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION evaluate_ab_vibe_tests() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION run_ab_vibe_testing() TO anon, authenticated, service_role;
