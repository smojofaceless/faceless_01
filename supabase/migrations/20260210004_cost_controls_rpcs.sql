-- =====================================================
-- COST CONTROLS RPCs
-- Migration: 20260210004_cost_controls_rpcs.sql
-- 
-- Implements:
-- 1. get_effective_limits - Cascading limit resolution
-- 2. record_api_usage - Atomic usage recording with idempotency
-- 3. check_budget - Budget/limit verification
-- 4. acquire_api_slot / release_api_slot - Concurrency throttle
-- 5. sweep_stale_api_slots - Cleanup expired slots
-- 6. get_usage_summary - Reporting/observability
-- 7. refresh_daily_usage - Materialized view refresh
--
-- Related: ROADMAP.md Item #6 "Cost Controls / Rate Limits"
-- =====================================================

-- =====================================================
-- 1. GET EFFECTIVE LIMITS
-- Resolves cascading limits: system → brand → campaign → job
-- Returns the most specific (lowest scope) non-null value for each limit
-- =====================================================

CREATE OR REPLACE FUNCTION get_effective_limits(
    p_job_id UUID DEFAULT NULL,
    p_campaign_id UUID DEFAULT NULL,
    p_brand_id UUID DEFAULT NULL,
    p_service TEXT DEFAULT NULL
)
RETURNS TABLE (
    service TEXT,
    daily_budget_cents INTEGER,
    monthly_budget_cents INTEGER,
    total_budget_cents INTEGER,
    max_calls_per_job INTEGER,
    max_calls_per_day INTEGER,
    max_concurrent INTEGER,
    cost_per_unit_cents NUMERIC(10,4),
    source_scope TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_brand_id UUID;
    v_campaign_id UUID;
BEGIN
    -- Resolve brand_id and campaign_id from job if not provided
    IF p_job_id IS NOT NULL THEN
        SELECT j.brand_id, j.batch_id INTO v_brand_id, v_campaign_id
        FROM jobs j WHERE j.id = p_job_id;
    END IF;
    
    v_brand_id := COALESCE(p_brand_id, v_brand_id);
    v_campaign_id := COALESCE(p_campaign_id, v_campaign_id);
    
    RETURN QUERY
    WITH all_limits AS (
        -- Get all applicable limits ordered by specificity
        SELECT 
            cl.service,
            cl.scope,
            cl.daily_budget_cents,
            cl.monthly_budget_cents,
            cl.total_budget_cents,
            cl.max_calls_per_job,
            cl.max_calls_per_day,
            cl.max_concurrent,
            cl.cost_per_unit_cents,
            -- Priority: job=4, campaign=3, brand=2, system=1
            CASE cl.scope
                WHEN 'job' THEN 4
                WHEN 'campaign' THEN 3
                WHEN 'brand' THEN 2
                WHEN 'system' THEN 1
            END AS priority
        FROM cost_limits cl
        WHERE cl.enabled = true
          AND (cl.service = p_service OR cl.service IS NULL OR p_service IS NULL)
          AND (
              (cl.scope = 'system') OR
              (cl.scope = 'brand' AND cl.brand_id = v_brand_id) OR
              (cl.scope = 'campaign' AND cl.campaign_id = v_campaign_id) OR
              (cl.scope = 'job' AND cl.job_id = p_job_id)
          )
    ),
    ranked_limits AS (
        SELECT DISTINCT ON (COALESCE(al.service, 'ALL'))
            COALESCE(al.service, 'ALL') AS service,
            al.daily_budget_cents,
            al.monthly_budget_cents,
            al.total_budget_cents,
            al.max_calls_per_job,
            al.max_calls_per_day,
            al.max_concurrent,
            al.cost_per_unit_cents,
            al.scope AS source_scope
        FROM all_limits al
        ORDER BY COALESCE(al.service, 'ALL'), al.priority DESC
    )
    SELECT 
        rl.service,
        rl.daily_budget_cents,
        rl.monthly_budget_cents,
        rl.total_budget_cents,
        rl.max_calls_per_job,
        rl.max_calls_per_day,
        rl.max_concurrent,
        rl.cost_per_unit_cents,
        rl.source_scope
    FROM ranked_limits rl;
END;
$$;

-- =====================================================
-- 2. RECORD API USAGE
-- Atomically records usage with idempotency check
-- Returns whether this was a new record or idempotency hit
-- =====================================================

CREATE OR REPLACE FUNCTION record_api_usage(
    p_service TEXT,
    p_idempotency_key TEXT,
    p_job_id UUID DEFAULT NULL,
    p_step_name TEXT DEFAULT NULL,
    p_units INTEGER DEFAULT 1,
    p_tokens INTEGER DEFAULT NULL,
    p_chars INTEGER DEFAULT NULL,
    p_duration_seconds INTEGER DEFAULT NULL,
    p_image_count INTEGER DEFAULT NULL,
    p_estimated_cost_cents NUMERIC DEFAULT NULL,
    p_request_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_existing_id UUID;
    v_new_id UUID;
    v_cost NUMERIC(10,4);
    v_cost_per_unit NUMERIC(10,4);
BEGIN
    -- Get job context
    IF p_job_id IS NOT NULL THEN
        SELECT j.id, j.batch_id, j.brand_id INTO v_job
        FROM jobs j WHERE j.id = p_job_id;
    END IF;
    
    -- Check for existing record (idempotency)
    SELECT id INTO v_existing_id
    FROM api_usage
    WHERE service = p_service AND idempotency_key = p_idempotency_key;
    
    IF v_existing_id IS NOT NULL THEN
        -- Idempotency hit - already recorded
        RETURN jsonb_build_object(
            'success', true,
            'idempotency_hit', true,
            'existing_id', v_existing_id,
            'message', 'Usage already recorded for this idempotency key'
        );
    END IF;
    
    -- Calculate cost if not provided
    IF p_estimated_cost_cents IS NULL THEN
        -- Get cost per unit from limits
        SELECT cost_per_unit_cents INTO v_cost_per_unit
        FROM cost_limits
        WHERE service = p_service AND enabled = true
        ORDER BY 
            CASE scope WHEN 'system' THEN 1 ELSE 2 END
        LIMIT 1;
        
        v_cost := COALESCE(v_cost_per_unit, 0) * p_units;
    ELSE
        v_cost := p_estimated_cost_cents;
    END IF;
    
    -- Insert new usage record
    INSERT INTO api_usage (
        job_id,
        campaign_id,
        brand_id,
        step_name,
        service,
        idempotency_key,
        units,
        tokens,
        chars,
        duration_seconds,
        image_count,
        estimated_cost_cents,
        idempotency_hit,
        request_meta
    ) VALUES (
        p_job_id,
        v_job.batch_id,
        v_job.brand_id,
        p_step_name,
        p_service,
        p_idempotency_key,
        p_units,
        p_tokens,
        p_chars,
        p_duration_seconds,
        p_image_count,
        v_cost,
        false,
        p_request_meta
    )
    RETURNING id INTO v_new_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'idempotency_hit', false,
        'usage_id', v_new_id,
        'estimated_cost_cents', v_cost
    );
END;
$$;

-- =====================================================
-- 3. CHECK BUDGET
-- Verifies all applicable limits before an operation
-- Returns can_proceed + detailed breakdown
-- =====================================================

CREATE OR REPLACE FUNCTION check_budget(
    p_service TEXT,
    p_job_id UUID,
    p_units INTEGER DEFAULT 1,
    p_estimated_cost_cents NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_limits RECORD;
    v_job_usage RECORD;
    v_campaign_daily_usage RECORD;
    v_global_daily_usage RECORD;
    v_current_slots INTEGER;
    v_reasons JSONB := '[]'::jsonb;
    v_can_proceed BOOLEAN := true;
    v_cost NUMERIC(10,4);
BEGIN
    -- Get job context
    SELECT j.id, j.batch_id, j.brand_id INTO v_job
    FROM jobs j WHERE j.id = p_job_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('can_proceed', false, 'reason', 'Job not found');
    END IF;
    
    -- Get effective limits for this service
    SELECT * INTO v_limits
    FROM get_effective_limits(p_job_id, v_job.batch_id, v_job.brand_id, p_service)
    WHERE service = p_service OR service = 'ALL'
    LIMIT 1;
    
    -- Calculate cost
    v_cost := COALESCE(p_estimated_cost_cents, COALESCE(v_limits.cost_per_unit_cents, 0) * p_units);
    
    -- === CHECK 1: Per-job call limit ===
    IF v_limits.max_calls_per_job IS NOT NULL THEN
        SELECT COUNT(*) AS call_count INTO v_job_usage
        FROM api_usage
        WHERE job_id = p_job_id 
          AND service = p_service 
          AND NOT idempotency_hit;
        
        IF v_job_usage.call_count >= v_limits.max_calls_per_job THEN
            v_can_proceed := false;
            v_reasons := v_reasons || jsonb_build_object(
                'check', 'max_calls_per_job',
                'limit', v_limits.max_calls_per_job,
                'current', v_job_usage.call_count,
                'message', format('Job has reached max %s calls for %s', v_limits.max_calls_per_job, p_service)
            );
        END IF;
    END IF;
    
    -- === CHECK 2: Campaign daily budget ===
    IF v_limits.daily_budget_cents IS NOT NULL AND v_job.batch_id IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_cost_cents), 0) AS daily_spend INTO v_campaign_daily_usage
        FROM api_usage
        WHERE campaign_id = v_job.batch_id
          AND DATE(created_at) = CURRENT_DATE
          AND NOT idempotency_hit;
        
        IF (v_campaign_daily_usage.daily_spend + v_cost) > v_limits.daily_budget_cents THEN
            v_can_proceed := false;
            v_reasons := v_reasons || jsonb_build_object(
                'check', 'campaign_daily_budget',
                'limit_cents', v_limits.daily_budget_cents,
                'current_cents', v_campaign_daily_usage.daily_spend,
                'requested_cents', v_cost,
                'message', format('Campaign daily budget exceeded (%.2f/%.2f cents)', 
                    v_campaign_daily_usage.daily_spend, v_limits.daily_budget_cents)
            );
        END IF;
    END IF;
    
    -- === CHECK 3: Global daily calls ===
    IF v_limits.max_calls_per_day IS NOT NULL THEN
        SELECT COUNT(*) AS daily_calls INTO v_global_daily_usage
        FROM api_usage
        WHERE service = p_service
          AND DATE(created_at) = CURRENT_DATE
          AND NOT idempotency_hit;
        
        IF v_global_daily_usage.daily_calls >= v_limits.max_calls_per_day THEN
            v_can_proceed := false;
            v_reasons := v_reasons || jsonb_build_object(
                'check', 'max_calls_per_day',
                'limit', v_limits.max_calls_per_day,
                'current', v_global_daily_usage.daily_calls,
                'message', format('Global daily limit reached for %s (%s/%s)', 
                    p_service, v_global_daily_usage.daily_calls, v_limits.max_calls_per_day)
            );
        END IF;
    END IF;
    
    -- === CHECK 4: Concurrency limit ===
    IF v_limits.max_concurrent IS NOT NULL THEN
        SELECT COUNT(*) INTO v_current_slots
        FROM api_slots
        WHERE service = p_service
          AND expires_at > NOW();
        
        IF v_current_slots >= v_limits.max_concurrent THEN
            v_can_proceed := false;
            v_reasons := v_reasons || jsonb_build_object(
                'check', 'max_concurrent',
                'limit', v_limits.max_concurrent,
                'current', v_current_slots,
                'message', format('Max concurrent %s calls reached (%s/%s)', 
                    p_service, v_current_slots, v_limits.max_concurrent)
            );
        END IF;
    END IF;
    
    RETURN jsonb_build_object(
        'can_proceed', v_can_proceed,
        'service', p_service,
        'job_id', p_job_id,
        'campaign_id', v_job.batch_id,
        'estimated_cost_cents', v_cost,
        'limits', row_to_json(v_limits),
        'checks_failed', v_reasons
    );
END;
$$;

-- =====================================================
-- 4. ACQUIRE API SLOT
-- Acquires a concurrency slot with lease expiry
-- Returns slot_id or null if limit reached
-- =====================================================

CREATE OR REPLACE FUNCTION acquire_api_slot(
    p_service TEXT,
    p_job_id UUID,
    p_worker_id TEXT,
    p_operation TEXT DEFAULT NULL,
    p_lease_seconds INTEGER DEFAULT 300 -- 5 minute default
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_concurrent INTEGER;
    v_current_slots INTEGER;
    v_slot_id UUID;
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- Get max concurrent limit
    SELECT max_concurrent INTO v_max_concurrent
    FROM cost_limits
    WHERE (service = p_service OR service IS NULL)
      AND enabled = true
    ORDER BY 
        CASE WHEN service = p_service THEN 1 ELSE 2 END,
        CASE scope WHEN 'system' THEN 1 ELSE 2 END
    LIMIT 1;
    
    -- If no limit configured, always allow
    IF v_max_concurrent IS NULL THEN
        RETURN jsonb_build_object(
            'acquired', true,
            'slot_id', NULL,
            'message', 'No concurrency limit configured'
        );
    END IF;
    
    -- Clean up expired slots first
    DELETE FROM api_slots WHERE expires_at < NOW();
    
    -- Check current slot count
    SELECT COUNT(*) INTO v_current_slots
    FROM api_slots
    WHERE service = p_service;
    
    IF v_current_slots >= v_max_concurrent THEN
        RETURN jsonb_build_object(
            'acquired', false,
            'slot_id', NULL,
            'current_slots', v_current_slots,
            'max_concurrent', v_max_concurrent,
            'message', format('Max concurrent slots reached for %s (%s/%s)', 
                p_service, v_current_slots, v_max_concurrent)
        );
    END IF;
    
    -- Acquire slot
    v_expires_at := NOW() + (p_lease_seconds || ' seconds')::INTERVAL;
    
    INSERT INTO api_slots (service, job_id, worker_id, operation, expires_at)
    VALUES (p_service, p_job_id, p_worker_id, p_operation, v_expires_at)
    ON CONFLICT (service, job_id, worker_id, operation) 
    DO UPDATE SET 
        acquired_at = NOW(),
        expires_at = v_expires_at
    RETURNING id INTO v_slot_id;
    
    RETURN jsonb_build_object(
        'acquired', true,
        'slot_id', v_slot_id,
        'expires_at', v_expires_at,
        'current_slots', v_current_slots + 1,
        'max_concurrent', v_max_concurrent
    );
END;
$$;

-- =====================================================
-- 5. RELEASE API SLOT
-- Releases a concurrency slot
-- =====================================================

CREATE OR REPLACE FUNCTION release_api_slot(
    p_slot_id UUID DEFAULT NULL,
    p_service TEXT DEFAULT NULL,
    p_job_id UUID DEFAULT NULL,
    p_worker_id TEXT DEFAULT NULL,
    p_operation TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF p_slot_id IS NOT NULL THEN
        DELETE FROM api_slots WHERE id = p_slot_id;
    ELSIF p_service IS NOT NULL AND p_job_id IS NOT NULL AND p_worker_id IS NOT NULL THEN
        DELETE FROM api_slots 
        WHERE service = p_service 
          AND job_id = p_job_id 
          AND worker_id = p_worker_id
          AND (p_operation IS NULL OR operation = p_operation);
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Must provide slot_id or service+job_id+worker_id');
    END IF;
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    
    RETURN jsonb_build_object(
        'success', true,
        'slots_released', v_deleted
    );
END;
$$;

-- =====================================================
-- 6. SWEEP STALE API SLOTS
-- Cleanup function for expired slots
-- =====================================================

CREATE OR REPLACE FUNCTION sweep_stale_api_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM api_slots WHERE expires_at < NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    
    RETURN jsonb_build_object(
        'success', true,
        'slots_swept', v_deleted,
        'swept_at', NOW()
    );
END;
$$;

-- =====================================================
-- 7. GET USAGE SUMMARY
-- Returns usage statistics for observability
-- =====================================================

CREATE OR REPLACE FUNCTION get_usage_summary(
    p_campaign_id UUID DEFAULT NULL,
    p_brand_id UUID DEFAULT NULL,
    p_service TEXT DEFAULT NULL,
    p_date_from DATE DEFAULT CURRENT_DATE - INTERVAL '7 days',
    p_date_to DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    service TEXT,
    usage_date DATE,
    call_count BIGINT,
    idempotency_hits BIGINT,
    total_units BIGINT,
    total_cost_cents NUMERIC,
    total_tokens BIGINT,
    total_chars BIGINT,
    total_images BIGINT,
    total_duration_seconds BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        au.service,
        DATE(au.created_at) AS usage_date,
        COUNT(*) AS call_count,
        COUNT(*) FILTER (WHERE au.idempotency_hit) AS idempotency_hits,
        SUM(au.units) AS total_units,
        SUM(au.estimated_cost_cents) FILTER (WHERE NOT au.idempotency_hit) AS total_cost_cents,
        SUM(au.tokens) AS total_tokens,
        SUM(au.chars) AS total_chars,
        SUM(au.image_count) AS total_images,
        SUM(au.duration_seconds) AS total_duration_seconds
    FROM api_usage au
    WHERE (p_campaign_id IS NULL OR au.campaign_id = p_campaign_id)
      AND (p_brand_id IS NULL OR au.brand_id = p_brand_id)
      AND (p_service IS NULL OR au.service = p_service)
      AND DATE(au.created_at) BETWEEN p_date_from AND p_date_to
    GROUP BY au.service, DATE(au.created_at)
    ORDER BY DATE(au.created_at) DESC, au.service;
END;
$$;

-- =====================================================
-- 8. CHECK CAMPAIGN BUDGET (Lightweight for Scheduler)
-- Quick check if campaign has budget remaining
-- =====================================================

CREATE OR REPLACE FUNCTION check_campaign_budget(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_campaign RECORD;
    v_limits RECORD;
    v_daily_spend NUMERIC;
    v_total_spend NUMERIC;
    v_can_proceed BOOLEAN := true;
    v_reason TEXT;
BEGIN
    -- Get campaign info
    SELECT gb.id, gb.brand_id INTO v_campaign
    FROM generation_batches gb WHERE gb.id = p_campaign_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('can_proceed', false, 'reason', 'Campaign not found');
    END IF;
    
    -- Get campaign-level or brand-level limits
    SELECT 
        COALESCE(
            (SELECT daily_budget_cents FROM cost_limits WHERE scope = 'campaign' AND campaign_id = p_campaign_id AND enabled = true LIMIT 1),
            (SELECT daily_budget_cents FROM cost_limits WHERE scope = 'brand' AND brand_id = v_campaign.brand_id AND enabled = true LIMIT 1),
            (SELECT daily_budget_cents FROM cost_limits WHERE scope = 'system' AND enabled = true LIMIT 1)
        ) AS daily_budget_cents,
        COALESCE(
            (SELECT total_budget_cents FROM cost_limits WHERE scope = 'campaign' AND campaign_id = p_campaign_id AND enabled = true LIMIT 1),
            (SELECT total_budget_cents FROM cost_limits WHERE scope = 'brand' AND brand_id = v_campaign.brand_id AND enabled = true LIMIT 1)
        ) AS total_budget_cents
    INTO v_limits;
    
    -- Check daily spend
    IF v_limits.daily_budget_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_daily_spend
        FROM api_usage
        WHERE campaign_id = p_campaign_id
          AND DATE(created_at) = CURRENT_DATE
          AND NOT idempotency_hit;
        
        IF v_daily_spend >= v_limits.daily_budget_cents THEN
            v_can_proceed := false;
            v_reason := format('Campaign daily budget exceeded (%.2f/%.2f cents)', 
                v_daily_spend, v_limits.daily_budget_cents);
        END IF;
    END IF;
    
    -- Check total spend
    IF v_can_proceed AND v_limits.total_budget_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_total_spend
        FROM api_usage
        WHERE campaign_id = p_campaign_id
          AND NOT idempotency_hit;
        
        IF v_total_spend >= v_limits.total_budget_cents THEN
            v_can_proceed := false;
            v_reason := format('Campaign total budget exceeded (%.2f/%.2f cents)', 
                v_total_spend, v_limits.total_budget_cents);
        END IF;
    END IF;
    
    RETURN jsonb_build_object(
        'can_proceed', v_can_proceed,
        'campaign_id', p_campaign_id,
        'daily_spend_cents', v_daily_spend,
        'daily_budget_cents', v_limits.daily_budget_cents,
        'total_spend_cents', v_total_spend,
        'total_budget_cents', v_limits.total_budget_cents,
        'reason', v_reason
    );
END;
$$;

-- =====================================================
-- 9. REFRESH DAILY USAGE (for materialized view)
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_daily_usage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_usage;
    RETURN jsonb_build_object('success', true, 'refreshed_at', NOW());
EXCEPTION WHEN OTHERS THEN
    -- Fallback to non-concurrent refresh if unique index doesn't exist yet
    REFRESH MATERIALIZED VIEW mv_daily_usage;
    RETURN jsonb_build_object('success', true, 'refreshed_at', NOW(), 'mode', 'non-concurrent');
END;
$$;

-- =====================================================
-- 10. GRANTS FOR RPCs
-- =====================================================

GRANT EXECUTE ON FUNCTION get_effective_limits(UUID, UUID, UUID, TEXT) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION record_api_usage(TEXT, TEXT, UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION check_budget(TEXT, UUID, INTEGER, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION acquire_api_slot(TEXT, UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_api_slot(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sweep_stale_api_slots() TO service_role;
GRANT EXECUTE ON FUNCTION get_usage_summary(UUID, UUID, TEXT, DATE, DATE) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION check_campaign_budget(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_daily_usage() TO service_role;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION get_effective_limits IS 'Resolves cascading limits: system→brand→campaign→job, returns most specific non-null value';
COMMENT ON FUNCTION record_api_usage IS 'Records API usage with idempotency check, returns whether new record or hit';
COMMENT ON FUNCTION check_budget IS 'Checks all applicable limits before an operation, returns can_proceed + details';
COMMENT ON FUNCTION acquire_api_slot IS 'Acquires a concurrency slot with lease expiry';
COMMENT ON FUNCTION release_api_slot IS 'Releases a concurrency slot';
COMMENT ON FUNCTION sweep_stale_api_slots IS 'Cleanup function for expired concurrency slots';
COMMENT ON FUNCTION get_usage_summary IS 'Returns usage statistics grouped by service and date';
COMMENT ON FUNCTION check_campaign_budget IS 'Lightweight budget check for scheduler (daily + total)';
COMMENT ON FUNCTION refresh_daily_usage IS 'Refreshes the mv_daily_usage materialized view';
