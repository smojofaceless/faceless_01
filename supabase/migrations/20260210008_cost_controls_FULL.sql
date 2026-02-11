-- ===========================================================
-- COST CONTROLS - CONSOLIDATED MIGRATION
-- ===========================================================
-- Run this entire file in Supabase SQL Editor
-- Combines: schema + rpcs + defaults
-- ===========================================================

-- ===========================================
-- PART 1: SCHEMA
-- ===========================================

-- ================================================================
-- cost_limits: Configuration table for budget/throttle limits
-- Scope hierarchy: system → brand → campaign → job
-- Most specific scope wins when fetching effective limits
-- ================================================================
CREATE TABLE IF NOT EXISTS cost_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Scope level (determines which limits apply)
    scope TEXT NOT NULL CHECK (scope IN ('system', 'brand', 'campaign', 'job')),
    
    -- Scope references (null for system-level)
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES generation_batches(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    
    -- Service this limit applies to (null = global aggregate)
    service TEXT CHECK (service IS NULL OR service IN (
        'openai_text', 
        'openai_image', 
        'elevenlabs', 
        'ffmpeg_renderer',
        'creatomate'
    )),
    
    -- Budget limits (in cents for precision)
    daily_budget_cents INTEGER,          -- Max spend per day
    monthly_budget_cents INTEGER,        -- Max spend per month
    per_call_max_cents INTEGER,          -- Max cost per single API call
    
    -- Call count limits
    max_calls_per_job INTEGER,           -- Max API calls per job for this service
    max_calls_per_day INTEGER,           -- Max daily calls (count-based)
    
    -- Concurrency throttle
    max_concurrent INTEGER,              -- Max parallel slots for this service
    
    -- Token/unit limits (service-specific)
    max_tokens_per_call INTEGER,         -- For text models
    max_chars_per_call INTEGER,          -- For TTS
    max_images_per_job INTEGER,          -- For image generation
    
    -- Meta
    enabled BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_cost_limits_scope ON cost_limits(scope);
CREATE INDEX IF NOT EXISTS idx_cost_limits_brand_id ON cost_limits(brand_id);
CREATE INDEX IF NOT EXISTS idx_cost_limits_campaign_id ON cost_limits(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cost_limits_job_id ON cost_limits(job_id);
CREATE INDEX IF NOT EXISTS idx_cost_limits_service ON cost_limits(service);

-- Unique constraints to prevent duplicate configs
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_system_service 
    ON cost_limits(service) WHERE scope = 'system' AND brand_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_brand_service 
    ON cost_limits(brand_id, service) WHERE scope = 'brand';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_campaign_service 
    ON cost_limits(campaign_id, service) WHERE scope = 'campaign';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_job_service 
    ON cost_limits(job_id, service) WHERE scope = 'job';

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_cost_limits_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_cost_limits_updated ON cost_limits;
CREATE TRIGGER trigger_cost_limits_updated
    BEFORE UPDATE ON cost_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_cost_limits_timestamp();


-- ================================================================
-- api_usage: Ledger of all API calls with cost data
-- Idempotency-safe via unique constraint on (service, idempotency_key)
-- ================================================================
CREATE TABLE IF NOT EXISTS api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- When this usage occurred
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Which service (required)
    service TEXT NOT NULL CHECK (service IN (
        'openai_text', 
        'openai_image', 
        'elevenlabs', 
        'ffmpeg_renderer',
        'creatomate'
    )),
    
    -- Idempotency key (prevents double-counting retries)
    -- Format suggestions:
    --   openai_text: "job:{id}:story:{hash}" or "job:{id}:prompt:{hash}"
    --   openai_image: "job:{id}:image:{scene_index}:{variant}"
    --   elevenlabs: "job:{id}:voice:{hash}"
    --   ffmpeg_renderer: "job:{id}:render:{hash}"
    idempotency_key TEXT NOT NULL,
    
    -- Context (all nullable to support system-level tracking)
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    
    -- Operation context
    step_name TEXT,                       -- e.g., 'story', 'images', 'voice'
    operation TEXT,                       -- Specific operation within step
    
    -- Usage metrics (at least one should be set)
    units INTEGER NOT NULL DEFAULT 1,     -- Generic unit count (calls)
    tokens_input INTEGER,                 -- For text models (prompt tokens)
    tokens_output INTEGER,                -- For text models (completion tokens)
    chars_processed INTEGER,              -- For TTS (character count)
    image_count INTEGER,                  -- For image generation
    render_seconds NUMERIC(10,2),         -- For video rendering
    
    -- Cost (in cents for precision)
    estimated_cost_cents INTEGER,         -- Our estimate at time of call
    actual_cost_cents INTEGER,            -- If we get actual cost back
    
    -- Request metadata
    model TEXT,                           -- e.g., 'gpt-4o', 'gpt-image-1'
    request_id TEXT,                      -- Provider's request ID for debugging
    
    -- Success tracking
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_usage_idempotency 
    ON api_usage(service, idempotency_key);

-- Indexes for fast aggregation queries
CREATE INDEX IF NOT EXISTS idx_api_usage_job_id ON api_usage(job_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_campaign_id ON api_usage(campaign_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_brand_id ON api_usage(brand_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_service ON api_usage(service);
CREATE INDEX IF NOT EXISTS idx_api_usage_recorded_at ON api_usage(recorded_at);

-- Note: No composite date index - timestamptz::date cast is timezone-dependent (not IMMUTABLE)
-- Use range queries on recorded_at instead: WHERE recorded_at >= '2026-02-10' AND recorded_at < '2026-02-11'


-- ================================================================
-- api_slots: Concurrency throttle (semaphore-style)
-- Workers acquire slots before making API calls, release after
-- Stale slots are swept by cron or on-demand
-- ================================================================
CREATE TABLE IF NOT EXISTS api_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Which service this slot is for
    service TEXT NOT NULL CHECK (service IN (
        'openai_text', 
        'openai_image', 
        'elevenlabs', 
        'ffmpeg_renderer',
        'creatomate'
    )),
    
    -- Context
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL,              -- Worker function instance ID
    operation TEXT,                       -- What operation is using this slot
    
    -- Lease management (like job leases)
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    
    -- Meta
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for fast slot counting
CREATE INDEX IF NOT EXISTS idx_api_slots_service ON api_slots(service);
CREATE INDEX IF NOT EXISTS idx_api_slots_expires_at ON api_slots(expires_at);

-- Composite for slot release
CREATE INDEX IF NOT EXISTS idx_api_slots_release 
    ON api_slots(service, job_id, worker_id, operation);


-- ================================================================
-- mv_daily_usage: Materialized view for fast budget checks
-- Refreshed periodically by cron, or manually
-- ================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_usage AS
SELECT 
    service,
    brand_id,
    campaign_id,
    recorded_at::date as usage_date,
    COUNT(*) as call_count,
    SUM(units) as total_units,
    SUM(COALESCE(estimated_cost_cents, 0)) as total_cost_cents,
    SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0)) as total_tokens,
    SUM(COALESCE(chars_processed, 0)) as total_chars,
    SUM(COALESCE(image_count, 0)) as total_images,
    SUM(COALESCE(render_seconds, 0)) as total_render_seconds
FROM api_usage
WHERE success = true
GROUP BY service, brand_id, campaign_id, recorded_at::date;

-- Indexes on materialized view (simple indexes, no expressions)
CREATE INDEX IF NOT EXISTS idx_mv_daily_usage_date ON mv_daily_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_mv_daily_usage_service ON mv_daily_usage(service);
CREATE INDEX IF NOT EXISTS idx_mv_daily_usage_brand ON mv_daily_usage(brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mv_daily_usage_campaign ON mv_daily_usage(campaign_id) WHERE campaign_id IS NOT NULL;


-- ================================================================
-- RLS Policies
-- ================================================================
ALTER TABLE cost_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_slots ENABLE ROW LEVEL SECURITY;

-- cost_limits: Service role full access, users can read system/brand limits
DROP POLICY IF EXISTS "Service role can manage cost_limits" ON cost_limits;
CREATE POLICY "Service role can manage cost_limits" ON cost_limits
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read applicable limits" ON cost_limits;
CREATE POLICY "Users can read applicable limits" ON cost_limits
    FOR SELECT TO authenticated
    USING (scope = 'system' OR brand_id IN (
        SELECT id FROM brands WHERE user_id = auth.uid()
    ));

-- api_usage: Service role full access, users can read their brand's usage
DROP POLICY IF EXISTS "Service role can manage api_usage" ON api_usage;
CREATE POLICY "Service role can manage api_usage" ON api_usage
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read their brand usage" ON api_usage;
CREATE POLICY "Users can read their brand usage" ON api_usage
    FOR SELECT TO authenticated
    USING (brand_id IN (
        SELECT id FROM brands WHERE user_id = auth.uid()
    ));

-- api_slots: Service role only
DROP POLICY IF EXISTS "Service role can manage api_slots" ON api_slots;
CREATE POLICY "Service role can manage api_slots" ON api_slots
    FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================================
-- Grants
-- ================================================================
GRANT SELECT ON cost_limits TO authenticated;
GRANT ALL ON cost_limits TO service_role;

GRANT SELECT ON api_usage TO authenticated;
GRANT ALL ON api_usage TO service_role;

GRANT ALL ON api_slots TO service_role;

GRANT SELECT ON mv_daily_usage TO authenticated;
GRANT ALL ON mv_daily_usage TO service_role;


-- ===========================================
-- PART 2: RPCs
-- ===========================================

-- ================================================================
-- get_effective_limits: Returns the effective limits for a job/service
-- Cascades through: job → campaign → brand → system
-- Most specific scope with a value wins
-- ================================================================
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
    per_call_max_cents INTEGER,
    max_calls_per_job INTEGER,
    max_calls_per_day INTEGER,
    max_concurrent INTEGER,
    max_tokens_per_call INTEGER,
    max_chars_per_call INTEGER,
    max_images_per_job INTEGER,
    effective_scope TEXT,
    source_id UUID
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_brand_id UUID;
    v_campaign_id UUID;
BEGIN
    -- Resolve brand and campaign from job if provided
    IF p_job_id IS NOT NULL THEN
        SELECT j.brand_id, j.batch_id 
        INTO v_brand_id, v_campaign_id
        FROM jobs j WHERE j.id = p_job_id;
    ELSE
        v_brand_id := p_brand_id;
        v_campaign_id := p_campaign_id;
    END IF;
    
    -- If campaign provided but no brand, get brand from campaign
    IF v_campaign_id IS NOT NULL AND v_brand_id IS NULL THEN
        SELECT gb.brand_id INTO v_brand_id
        FROM generation_batches gb WHERE gb.id = v_campaign_id;
    END IF;

    RETURN QUERY
    WITH ranked_limits AS (
        SELECT 
            cl.service,
            cl.daily_budget_cents,
            cl.monthly_budget_cents,
            cl.per_call_max_cents,
            cl.max_calls_per_job,
            cl.max_calls_per_day,
            cl.max_concurrent,
            cl.max_tokens_per_call,
            cl.max_chars_per_call,
            cl.max_images_per_job,
            cl.scope AS effective_scope,
            cl.id AS source_id,
            -- Rank by specificity: job > campaign > brand > system
            CASE cl.scope
                WHEN 'job' THEN 1
                WHEN 'campaign' THEN 2
                WHEN 'brand' THEN 3
                WHEN 'system' THEN 4
            END AS priority
        FROM cost_limits cl
        WHERE cl.enabled = true
          AND (p_service IS NULL OR cl.service IS NULL OR cl.service = p_service)
          AND (
              (cl.scope = 'system')
              OR (cl.scope = 'brand' AND cl.brand_id = v_brand_id)
              OR (cl.scope = 'campaign' AND cl.campaign_id = v_campaign_id)
              OR (cl.scope = 'job' AND cl.job_id = p_job_id)
          )
    )
    SELECT DISTINCT ON (rl.service)
        rl.service,
        rl.daily_budget_cents,
        rl.monthly_budget_cents,
        rl.per_call_max_cents,
        rl.max_calls_per_job,
        rl.max_calls_per_day,
        rl.max_concurrent,
        rl.max_tokens_per_call,
        rl.max_chars_per_call,
        rl.max_images_per_job,
        rl.effective_scope,
        rl.source_id
    FROM ranked_limits rl
    ORDER BY rl.service, rl.priority;
END;
$$;


-- ================================================================
-- record_api_usage: Record an API call with idempotency protection
-- Returns success status and whether idempotency key was hit
-- ================================================================
CREATE OR REPLACE FUNCTION record_api_usage(
    p_service TEXT,
    p_idempotency_key TEXT,
    p_job_id UUID DEFAULT NULL,
    p_step_name TEXT DEFAULT NULL,
    p_operation TEXT DEFAULT NULL,
    p_units INTEGER DEFAULT 1,
    p_tokens_input INTEGER DEFAULT NULL,
    p_tokens_output INTEGER DEFAULT NULL,
    p_chars_processed INTEGER DEFAULT NULL,
    p_image_count INTEGER DEFAULT NULL,
    p_render_seconds NUMERIC DEFAULT NULL,
    p_estimated_cost_cents INTEGER DEFAULT NULL,
    p_model TEXT DEFAULT NULL,
    p_request_id TEXT DEFAULT NULL,
    p_success BOOLEAN DEFAULT true,
    p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_id UUID;
    v_new_id UUID;
    v_campaign_id UUID;
    v_brand_id UUID;
BEGIN
    -- Check for existing record (idempotency)
    SELECT id INTO v_existing_id
    FROM api_usage
    WHERE service = p_service AND idempotency_key = p_idempotency_key;
    
    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'idempotency_hit', true,
            'existing_id', v_existing_id
        );
    END IF;
    
    -- Resolve campaign and brand from job
    IF p_job_id IS NOT NULL THEN
        SELECT j.batch_id, j.brand_id 
        INTO v_campaign_id, v_brand_id
        FROM jobs j WHERE j.id = p_job_id;
    END IF;
    
    -- Insert new usage record
    INSERT INTO api_usage (
        service, idempotency_key, job_id, campaign_id, brand_id,
        step_name, operation, units,
        tokens_input, tokens_output, chars_processed,
        image_count, render_seconds, estimated_cost_cents,
        model, request_id, success, error_message
    ) VALUES (
        p_service, p_idempotency_key, p_job_id, v_campaign_id, v_brand_id,
        p_step_name, p_operation, p_units,
        p_tokens_input, p_tokens_output, p_chars_processed,
        p_image_count, p_render_seconds, p_estimated_cost_cents,
        p_model, p_request_id, p_success, p_error_message
    )
    RETURNING id INTO v_new_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'idempotency_hit', false,
        'usage_id', v_new_id
    );
    
EXCEPTION
    WHEN unique_violation THEN
        -- Race condition - another request inserted first
        SELECT id INTO v_existing_id
        FROM api_usage
        WHERE service = p_service AND idempotency_key = p_idempotency_key;
        
        RETURN jsonb_build_object(
            'success', true,
            'idempotency_hit', true,
            'existing_id', v_existing_id,
            'race_condition', true
        );
END;
$$;


-- ================================================================
-- check_budget: Full budget check for a service + job
-- Returns whether operation can proceed and why/why not
-- ================================================================
CREATE OR REPLACE FUNCTION check_budget(
    p_service TEXT,
    p_job_id UUID,
    p_units_needed INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limits RECORD;
    v_global_limits RECORD;
    v_job_calls INTEGER;
    v_daily_cost INTEGER;
    v_monthly_cost INTEGER;
    v_current_slots INTEGER;
    v_checks_failed JSONB := '[]'::jsonb;
    v_can_proceed BOOLEAN := true;
BEGIN
    -- Get service-specific limits
    SELECT * INTO v_limits
    FROM get_effective_limits(p_job_id := p_job_id, p_service := p_service)
    WHERE service = p_service;
    
    -- Get global limits (service = NULL means aggregate)
    SELECT * INTO v_global_limits
    FROM get_effective_limits(p_job_id := p_job_id, p_service := NULL)
    WHERE service IS NULL;
    
    -- Check 1: Per-job call count
    IF v_limits.max_calls_per_job IS NOT NULL THEN
        SELECT COUNT(*) INTO v_job_calls
        FROM api_usage
        WHERE job_id = p_job_id AND service = p_service AND success = true;
        
        IF v_job_calls + p_units_needed > v_limits.max_calls_per_job THEN
            v_can_proceed := false;
            v_checks_failed := v_checks_failed || jsonb_build_object(
                'check', 'max_calls_per_job',
                'current', v_job_calls,
                'limit', v_limits.max_calls_per_job,
                'needed', p_units_needed
            );
        END IF;
    END IF;
    
    -- Check 2: Daily budget for this service
    IF v_limits.daily_budget_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_daily_cost
        FROM api_usage
        WHERE service = p_service 
          AND recorded_at::date = CURRENT_DATE
          AND success = true;
        
        IF v_daily_cost >= v_limits.daily_budget_cents THEN
            v_can_proceed := false;
            v_checks_failed := v_checks_failed || jsonb_build_object(
                'check', 'daily_budget',
                'service', p_service,
                'current_cents', v_daily_cost,
                'limit_cents', v_limits.daily_budget_cents
            );
        END IF;
    END IF;
    
    -- Check 3: Global daily budget (all services)
    IF v_global_limits.daily_budget_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_daily_cost
        FROM api_usage
        WHERE recorded_at::date = CURRENT_DATE
          AND success = true;
        
        IF v_daily_cost >= v_global_limits.daily_budget_cents THEN
            v_can_proceed := false;
            v_checks_failed := v_checks_failed || jsonb_build_object(
                'check', 'global_daily_budget',
                'current_cents', v_daily_cost,
                'limit_cents', v_global_limits.daily_budget_cents
            );
        END IF;
    END IF;
    
    -- Check 4: Monthly budget
    IF v_limits.monthly_budget_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_monthly_cost
        FROM api_usage
        WHERE service = p_service
          AND DATE_TRUNC('month', recorded_at) = DATE_TRUNC('month', CURRENT_DATE)
          AND success = true;
        
        IF v_monthly_cost >= v_limits.monthly_budget_cents THEN
            v_can_proceed := false;
            v_checks_failed := v_checks_failed || jsonb_build_object(
                'check', 'monthly_budget',
                'service', p_service,
                'current_cents', v_monthly_cost,
                'limit_cents', v_limits.monthly_budget_cents
            );
        END IF;
    END IF;
    
    -- Check 5: Concurrency (slot count)
    IF v_limits.max_concurrent IS NOT NULL THEN
        SELECT COUNT(*) INTO v_current_slots
        FROM api_slots
        WHERE service = p_service AND expires_at > NOW();
        
        IF v_current_slots >= v_limits.max_concurrent THEN
            v_can_proceed := false;
            v_checks_failed := v_checks_failed || jsonb_build_object(
                'check', 'max_concurrent',
                'service', p_service,
                'current', v_current_slots,
                'limit', v_limits.max_concurrent
            );
        END IF;
    END IF;
    
    RETURN jsonb_build_object(
        'can_proceed', v_can_proceed,
        'service', p_service,
        'job_id', p_job_id,
        'units_needed', p_units_needed,
        'effective_limits', CASE WHEN v_limits IS NOT NULL THEN row_to_json(v_limits)::jsonb ELSE '{}'::jsonb END,
        'checks_failed', v_checks_failed,
        'checked_at', NOW()
    );
END;
$$;


-- ================================================================
-- acquire_api_slot: Acquire a concurrency slot for an API service
-- Returns slot info or failure reason
-- ================================================================
CREATE OR REPLACE FUNCTION acquire_api_slot(
    p_service TEXT,
    p_job_id UUID DEFAULT NULL,
    p_worker_id TEXT DEFAULT gen_random_uuid()::text,
    p_operation TEXT DEFAULT NULL,
    p_lease_seconds INTEGER DEFAULT 300  -- 5 minutes default
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_concurrent INTEGER;
    v_current_slots INTEGER;
    v_new_slot_id UUID;
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- First, sweep stale slots
    DELETE FROM api_slots WHERE expires_at <= NOW();
    
    -- Get max concurrent for this service
    SELECT max_concurrent INTO v_max_concurrent
    FROM get_effective_limits(p_job_id := p_job_id, p_service := p_service)
    WHERE service = p_service;
    
    -- If no limit set, allow unlimited
    IF v_max_concurrent IS NULL THEN
        v_max_concurrent := 999999;
    END IF;
    
    -- Count current active slots (with row lock to prevent races)
    SELECT COUNT(*) INTO v_current_slots
    FROM api_slots
    WHERE service = p_service AND expires_at > NOW()
    FOR UPDATE;
    
    -- Check if we can acquire
    IF v_current_slots >= v_max_concurrent THEN
        RETURN jsonb_build_object(
            'acquired', false,
            'message', 'Max concurrent slots reached',
            'service', p_service,
            'current_slots', v_current_slots,
            'max_concurrent', v_max_concurrent
        );
    END IF;
    
    -- Acquire slot
    v_expires_at := NOW() + (p_lease_seconds || ' seconds')::interval;
    
    INSERT INTO api_slots (
        service, job_id, worker_id, operation, expires_at
    ) VALUES (
        p_service, p_job_id, p_worker_id, p_operation, v_expires_at
    )
    RETURNING id INTO v_new_slot_id;
    
    RETURN jsonb_build_object(
        'acquired', true,
        'slot_id', v_new_slot_id,
        'service', p_service,
        'worker_id', p_worker_id,
        'expires_at', v_expires_at,
        'current_slots', v_current_slots + 1,
        'max_concurrent', v_max_concurrent
    );
END;
$$;


-- ================================================================
-- release_api_slot: Release a concurrency slot
-- ================================================================
CREATE OR REPLACE FUNCTION release_api_slot(
    p_service TEXT,
    p_job_id UUID DEFAULT NULL,
    p_worker_id TEXT DEFAULT NULL,
    p_operation TEXT DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    -- Delete by slot_id if provided
    IF p_slot_id IS NOT NULL THEN
        DELETE FROM api_slots WHERE id = p_slot_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        -- Delete by service + job + worker + operation
        DELETE FROM api_slots
        WHERE service = p_service
          AND (p_job_id IS NULL OR job_id = p_job_id)
          AND (p_worker_id IS NULL OR worker_id = p_worker_id)
          AND (p_operation IS NULL OR operation = p_operation);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'slots_released', v_deleted
    );
END;
$$;


-- ================================================================
-- sweep_stale_api_slots: Clean up expired slots (for cron)
-- ================================================================
CREATE OR REPLACE FUNCTION sweep_stale_api_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM api_slots WHERE expires_at <= NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    
    RETURN jsonb_build_object(
        'success', true,
        'slots_swept', v_deleted,
        'swept_at', NOW()
    );
END;
$$;


-- ================================================================
-- get_usage_summary: Get aggregated usage for reporting
-- ================================================================
CREATE OR REPLACE FUNCTION get_usage_summary(
    p_brand_id UUID DEFAULT NULL,
    p_campaign_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL,
    p_service TEXT DEFAULT NULL,
    p_date_from TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
    p_date_to TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    service TEXT,
    usage_date DATE,
    call_count BIGINT,
    total_cost_cents BIGINT,
    total_tokens BIGINT,
    total_chars BIGINT,
    total_images BIGINT,
    total_render_seconds NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        au.service,
        au.recorded_at::date as usage_date,
        COUNT(*) as call_count,
        SUM(COALESCE(au.estimated_cost_cents, 0)) as total_cost_cents,
        SUM(COALESCE(au.tokens_input, 0) + COALESCE(au.tokens_output, 0)) as total_tokens,
        SUM(COALESCE(au.chars_processed, 0)) as total_chars,
        SUM(COALESCE(au.image_count, 0)) as total_images,
        SUM(COALESCE(au.render_seconds, 0)) as total_render_seconds
    FROM api_usage au
    WHERE au.success = true
      AND au.recorded_at BETWEEN p_date_from AND p_date_to
      AND (p_brand_id IS NULL OR au.brand_id = p_brand_id)
      AND (p_campaign_id IS NULL OR au.campaign_id = p_campaign_id)
      AND (p_job_id IS NULL OR au.job_id = p_job_id)
      AND (p_service IS NULL OR au.service = p_service)
    GROUP BY au.service, au.recorded_at::date
    ORDER BY au.recorded_at::date DESC, au.service;
END;
$$;


-- ================================================================
-- check_campaign_budget: Lightweight check for scheduler
-- Used before claiming jobs to skip budget-exceeded campaigns
-- ================================================================
CREATE OR REPLACE FUNCTION check_campaign_budget(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limits RECORD;
    v_daily_spend INTEGER;
    v_can_proceed BOOLEAN := true;
    v_reason TEXT;
BEGIN
    -- Get campaign-level limits (or brand/system fallback)
    SELECT 
        COALESCE(
            (SELECT daily_budget_cents FROM cost_limits WHERE scope = 'campaign' AND campaign_id = p_campaign_id AND service IS NULL AND enabled = true),
            (SELECT daily_budget_cents FROM cost_limits cl 
             JOIN generation_batches gb ON cl.brand_id = gb.brand_id 
             WHERE cl.scope = 'brand' AND gb.id = p_campaign_id AND cl.service IS NULL AND cl.enabled = true),
            (SELECT daily_budget_cents FROM cost_limits WHERE scope = 'system' AND service IS NULL AND enabled = true),
            999999999  -- No limit
        ) as daily_budget_cents
    INTO v_limits;
    
    -- Get today's spend for this campaign
    SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_daily_spend
    FROM api_usage
    WHERE campaign_id = p_campaign_id
      AND recorded_at::date = CURRENT_DATE
      AND success = true;
    
    IF v_daily_spend >= v_limits.daily_budget_cents THEN
        v_can_proceed := false;
        v_reason := 'Daily campaign budget exceeded';
    END IF;
    
    RETURN jsonb_build_object(
        'can_proceed', v_can_proceed,
        'campaign_id', p_campaign_id,
        'daily_spend_cents', v_daily_spend,
        'daily_budget_cents', v_limits.daily_budget_cents,
        'reason', v_reason
    );
END;
$$;


-- ================================================================
-- refresh_daily_usage: Refresh the materialized view
-- ================================================================
CREATE OR REPLACE FUNCTION refresh_daily_usage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Non-concurrent refresh (we don't have a unique index)
    REFRESH MATERIALIZED VIEW mv_daily_usage;
    
    RETURN jsonb_build_object(
        'success', true,
        'refreshed_at', NOW()
    );
END;
$$;


-- ================================================================
-- Grants for RPCs
-- ================================================================
GRANT EXECUTE ON FUNCTION get_effective_limits TO service_role;
GRANT EXECUTE ON FUNCTION record_api_usage TO service_role;
GRANT EXECUTE ON FUNCTION check_budget TO service_role;
GRANT EXECUTE ON FUNCTION acquire_api_slot TO service_role;
GRANT EXECUTE ON FUNCTION release_api_slot TO service_role;
GRANT EXECUTE ON FUNCTION sweep_stale_api_slots TO service_role;
GRANT EXECUTE ON FUNCTION get_usage_summary TO authenticated;
GRANT EXECUTE ON FUNCTION check_campaign_budget TO service_role;
GRANT EXECUTE ON FUNCTION refresh_daily_usage TO service_role;


-- ===========================================
-- PART 3: DEFAULT LIMITS
-- ===========================================

-- Clear existing system limits (idempotent)
DELETE FROM cost_limits WHERE scope = 'system';

-- ================================================================
-- OpenAI Text (gpt-4o, gpt-4o-mini)
-- Costs: ~$5-10 per 1M tokens for gpt-4o
-- Typical usage: ~2K tokens per story = ~$0.01-0.02/call
-- ================================================================
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    monthly_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    max_tokens_per_call,
    description
) VALUES (
    'system', 'openai_text',
    5000,           -- $50/day
    100000,         -- $1000/month
    5,              -- Max 5 text calls per job (story + retries)
    10000,          -- 10K calls per day
    10,             -- 10 concurrent text calls
    8000,           -- 8K tokens per call (reasonable for story gen)
    'System default: OpenAI text models (gpt-4o, gpt-4o-mini)'
);

-- ================================================================
-- OpenAI Image (gpt-image-1 only - NOT DALL-E)
-- Model: gpt-image-1 (the fast, cheap one)
-- Costs: ~$0.02-0.04 per image at low quality
-- Typical usage: 10-20 images per video
-- Note: We track image_count units, not just call count
-- ================================================================
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    monthly_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    max_images_per_job,
    description
) VALUES (
    'system', 'openai_image',
    10000,          -- $100/day
    200000,         -- $2000/month
    20,             -- Max 20 image calls per job (tight: 10-15 scenes + retries)
    5000,           -- 5K images per day
    5,              -- 5 concurrent image generations (gpt-image-1 is fast but let's be safe)
    20,             -- Max 20 images per job
    'System default: gpt-image-1 model ONLY (not DALL-E). Tracks image_count.'
);

-- ================================================================
-- ElevenLabs TTS
-- Costs: ~$0.30 per 1K characters
-- Typical usage: ~3-5K chars per video = ~$1-1.50/video
-- Note: We track chars_processed units for budget enforcement
-- ================================================================
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    monthly_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    max_chars_per_call,
    description
) VALUES (
    'system', 'elevenlabs',
    3000,           -- $30/day
    50000,          -- $500/month
    3,              -- Max 3 TTS calls per job (1 + retries)
    1000,           -- 1K calls per day
    3,              -- 3 concurrent TTS calls
    10000,          -- 10K chars per call (generous for long stories)
    'System default: ElevenLabs TTS. Tracks chars_processed.'
);

-- ================================================================
-- FFmpeg Renderer (self-hosted)
-- Costs: Server time, not direct API costs
-- Limit concurrency to avoid overwhelming render server
-- Note: We track render_seconds for duration-based budgets
-- ================================================================
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    description
) VALUES (
    'system', 'ffmpeg_renderer',
    1000,           -- $10/day (notional cost tracking)
    3,              -- Max 3 render calls per job (1 + retries)
    500,            -- 500 renders per day
    3,              -- 3 concurrent renders (prevent server overload)
    'System default: FFmpeg renderer (self-hosted). Tracks render_seconds.'
);

-- ================================================================
-- Creatomate (cloud rendering alternative)
-- Costs: ~$0.05-0.20 per render depending on duration
-- ================================================================
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    monthly_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    description
) VALUES (
    'system', 'creatomate',
    2500,           -- $25/day
    50000,          -- $500/month
    2,              -- Max 2 render calls per job
    500,            -- 500 renders per day
    2,              -- 2 concurrent (API rate limits)
    'System default: Creatomate cloud rendering'
);

-- ================================================================
-- Global aggregate limit (applies across all services)
-- ================================================================
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    monthly_budget_cents,
    description
) VALUES (
    'system', NULL,
    20000,          -- $200/day total across all services
    500000,         -- $5000/month total
    'System default: Global daily/monthly budget cap'
);


-- ===========================================
-- VERIFICATION
-- ===========================================
DO $$
DECLARE
    tbl_count INTEGER;
    func_count INTEGER;
    limit_count INTEGER;
BEGIN
    -- Verify tables
    SELECT COUNT(*) INTO tbl_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('cost_limits', 'api_usage', 'api_slots');
    
    IF tbl_count != 3 THEN
        RAISE EXCEPTION 'Expected 3 tables, found %', tbl_count;
    END IF;
    
    -- Verify functions
    SELECT COUNT(*) INTO func_count
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name IN (
        'get_effective_limits', 'record_api_usage', 'check_budget',
        'acquire_api_slot', 'release_api_slot', 'sweep_stale_api_slots',
        'get_usage_summary', 'check_campaign_budget', 'refresh_daily_usage'
      );
    
    IF func_count != 9 THEN
        RAISE EXCEPTION 'Expected 9 functions, found %', func_count;
    END IF;
    
    -- Verify default limits
    SELECT COUNT(*) INTO limit_count
    FROM cost_limits WHERE scope = 'system';
    
    IF limit_count < 6 THEN
        RAISE EXCEPTION 'Expected 6 system limits, found %', limit_count;
    END IF;
    
    RAISE NOTICE '✅ Cost controls migration complete: 3 tables, 9 functions, % default limits', limit_count;
END $$;


-- ================================================================
-- COST CONTROLS: Scheduler Integration RPCs
-- Run AFTER 20260210006_cost_controls_consolidated.sql
-- ================================================================

-- ================================================================
-- check_global_budget: Quick check for scheduler before claiming jobs
-- Returns whether global daily budget allows more jobs
-- ================================================================
CREATE OR REPLACE FUNCTION check_global_budget()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_global_limit INTEGER;
    v_daily_spend INTEGER;
    v_can_proceed BOOLEAN := true;
    v_reason TEXT;
    v_pct_used NUMERIC;
BEGIN
    -- Get global daily budget limit (service = NULL)
    SELECT daily_budget_cents INTO v_global_limit
    FROM cost_limits
    WHERE scope = 'system' AND service IS NULL AND enabled = true;
    
    -- Default to $200/day if not set
    v_global_limit := COALESCE(v_global_limit, 20000);
    
    -- Get today's total spend
    SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_daily_spend
    FROM api_usage
    WHERE recorded_at::date = CURRENT_DATE
      AND success = true;
    
    v_pct_used := ROUND((v_daily_spend::numeric / v_global_limit::numeric) * 100, 1);
    
    IF v_daily_spend >= v_global_limit THEN
        v_can_proceed := false;
        v_reason := 'Global daily budget exceeded';
    ELSIF v_daily_spend >= (v_global_limit * 0.9) THEN
        -- Warning: approaching limit
        v_reason := 'Global daily budget at 90%+';
    END IF;
    
    RETURN jsonb_build_object(
        'can_proceed', v_can_proceed,
        'daily_spend_cents', v_daily_spend,
        'daily_budget_cents', v_global_limit,
        'pct_used', v_pct_used,
        'reason', v_reason
    );
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION check_global_budget TO service_role;


-- ================================================================
-- get_campaigns_over_budget: Returns campaign IDs that exceeded daily budget
-- Scheduler can use this to pause campaigns
-- ================================================================
CREATE OR REPLACE FUNCTION get_campaigns_over_budget()
RETURNS TABLE (
    campaign_id UUID,
    campaign_name TEXT,
    daily_spend_cents INTEGER,
    daily_budget_cents INTEGER,
    pct_used NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH campaign_spend AS (
        SELECT 
            au.campaign_id,
            SUM(COALESCE(au.estimated_cost_cents, 0))::INTEGER as daily_spend
        FROM api_usage au
        WHERE au.campaign_id IS NOT NULL
          AND au.recorded_at::date = CURRENT_DATE
          AND au.success = true
        GROUP BY au.campaign_id
    ),
    campaign_limits AS (
        SELECT 
            gb.id as campaign_id,
            gb.name as campaign_name,
            COALESCE(
                (SELECT cl.daily_budget_cents FROM cost_limits cl 
                 WHERE cl.scope = 'campaign' AND cl.campaign_id = gb.id AND cl.service IS NULL AND cl.enabled = true),
                (SELECT cl.daily_budget_cents FROM cost_limits cl 
                 WHERE cl.scope = 'brand' AND cl.brand_id = gb.brand_id AND cl.service IS NULL AND cl.enabled = true),
                (SELECT cl.daily_budget_cents FROM cost_limits cl 
                 WHERE cl.scope = 'system' AND cl.service IS NULL AND cl.enabled = true),
                20000  -- Default $200/day
            ) as budget
        FROM generation_batches gb
        WHERE gb.status IN ('pending', 'running')
    )
    SELECT 
        cl.campaign_id,
        cl.campaign_name,
        COALESCE(cs.daily_spend, 0) as daily_spend_cents,
        cl.budget as daily_budget_cents,
        ROUND((COALESCE(cs.daily_spend, 0)::numeric / cl.budget::numeric) * 100, 1) as pct_used
    FROM campaign_limits cl
    LEFT JOIN campaign_spend cs ON cs.campaign_id = cl.campaign_id
    WHERE COALESCE(cs.daily_spend, 0) >= cl.budget;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION get_campaigns_over_budget TO service_role;


-- ================================================================
-- Verification
-- ================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_global_budget') 
       AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_campaigns_over_budget') THEN
        RAISE NOTICE '✅ Scheduler integration RPCs created: check_global_budget, get_campaigns_over_budget';
    ELSE
        RAISE EXCEPTION 'Failed to create scheduler integration RPCs';
    END IF;
END $$;

