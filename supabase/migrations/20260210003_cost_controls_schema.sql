-- =====================================================
-- COST CONTROLS SCHEMA
-- Migration: 20260210003_cost_controls_schema.sql
-- 
-- Implements:
-- 1. cost_limits - Budget/limit configuration at system/brand/campaign/job level
-- 2. api_usage - Ledger of all API calls with cost metadata
-- 3. api_slots - Concurrency throttle tokens per service
--
-- Related: ROADMAP.md Item #6 "Cost Controls / Rate Limits"
-- =====================================================

-- =====================================================
-- 1. COST LIMITS TABLE
-- Hierarchical budget configuration with cascading overrides
-- =====================================================

CREATE TABLE IF NOT EXISTS cost_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Scope: system > brand > campaign > job (most specific wins)
    scope TEXT NOT NULL CHECK (scope IN ('system', 'brand', 'campaign', 'job')),
    
    -- Foreign keys (nullable based on scope)
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES generation_batches(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    
    -- Service being limited (null = applies to all services)
    service TEXT CHECK (service IN ('openai_text', 'openai_image', 'elevenlabs', 'ffmpeg_renderer', 'creatomate', NULL)),
    
    -- === BUDGET LIMITS ===
    -- Daily budget in cents (null = unlimited)
    daily_budget_cents INTEGER,
    -- Monthly budget in cents (null = unlimited)
    monthly_budget_cents INTEGER,
    -- Total budget in cents for campaign/job lifetime (null = unlimited)
    total_budget_cents INTEGER,
    
    -- === CALL LIMITS ===
    -- Max calls per job (for per-job caps like "max 10 images per job")
    max_calls_per_job INTEGER,
    -- Max calls per day globally
    max_calls_per_day INTEGER,
    
    -- === CONCURRENCY LIMITS ===
    -- Max concurrent calls for this service (throttle)
    max_concurrent INTEGER,
    
    -- === UNIT COSTS (for budget calculation) ===
    -- Cost per unit in cents (service-specific meaning)
    cost_per_unit_cents NUMERIC(10,4),
    
    -- Metadata
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure scope matches foreign keys
    CONSTRAINT cost_limits_scope_check CHECK (
        (scope = 'system' AND brand_id IS NULL AND campaign_id IS NULL AND job_id IS NULL) OR
        (scope = 'brand' AND brand_id IS NOT NULL AND campaign_id IS NULL AND job_id IS NULL) OR
        (scope = 'campaign' AND campaign_id IS NOT NULL AND job_id IS NULL) OR
        (scope = 'job' AND job_id IS NOT NULL)
    )
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_cost_limits_scope ON cost_limits(scope);
CREATE INDEX IF NOT EXISTS idx_cost_limits_brand ON cost_limits(brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cost_limits_campaign ON cost_limits(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cost_limits_job ON cost_limits(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cost_limits_service ON cost_limits(service);
CREATE INDEX IF NOT EXISTS idx_cost_limits_enabled ON cost_limits(enabled) WHERE enabled = true;

-- Unique constraint: one limit per scope+entity+service combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_unique_system 
    ON cost_limits(scope, service) WHERE scope = 'system';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_unique_brand 
    ON cost_limits(scope, brand_id, service) WHERE scope = 'brand';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_unique_campaign 
    ON cost_limits(scope, campaign_id, service) WHERE scope = 'campaign';
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_limits_unique_job 
    ON cost_limits(scope, job_id, service) WHERE scope = 'job';

-- =====================================================
-- 2. API USAGE TABLE (Ledger)
-- Records every API call for budget tracking and audit
-- =====================================================

CREATE TABLE IF NOT EXISTS api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Context
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES generation_batches(id) ON DELETE SET NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    step_name TEXT,
    
    -- Service called
    service TEXT NOT NULL CHECK (service IN ('openai_text', 'openai_image', 'elevenlabs', 'ffmpeg_renderer', 'creatomate')),
    
    -- Idempotency: prevent double-counting
    idempotency_key TEXT NOT NULL,
    
    -- Usage metrics (service-specific)
    units INTEGER NOT NULL DEFAULT 1, -- Generic unit count
    tokens INTEGER, -- For openai_text
    chars INTEGER, -- For elevenlabs
    duration_seconds INTEGER, -- For ffmpeg_renderer
    image_count INTEGER, -- For openai_image
    
    -- Cost tracking
    estimated_cost_cents NUMERIC(10,4),
    
    -- Was this an idempotency hit? (reused existing asset, no actual API call)
    idempotency_hit BOOLEAN NOT NULL DEFAULT false,
    
    -- Request metadata
    request_meta JSONB DEFAULT '{}'::jsonb,
    -- Structure: { model, resolution, prompt_hash, response_status, latency_ms }
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint on idempotency key per service
    UNIQUE(service, idempotency_key)
);

-- Indexes for efficient budget queries
CREATE INDEX IF NOT EXISTS idx_api_usage_job ON api_usage(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_usage_campaign ON api_usage(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_usage_brand ON api_usage(brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_usage_service ON api_usage(service);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily ON api_usage(service, created_at) 
    WHERE NOT idempotency_hit; -- For daily budget queries

-- Partial index for non-idempotency-hit records (actual spend)
CREATE INDEX IF NOT EXISTS idx_api_usage_actual_spend ON api_usage(service, campaign_id, created_at)
    WHERE NOT idempotency_hit;

-- =====================================================
-- 3. API SLOTS TABLE (Concurrency Throttle)
-- Semaphore-style tokens with lease expiry
-- =====================================================

CREATE TABLE IF NOT EXISTS api_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Service being throttled
    service TEXT NOT NULL CHECK (service IN ('openai_text', 'openai_image', 'elevenlabs', 'ffmpeg_renderer', 'creatomate')),
    
    -- Who holds this slot
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL,
    
    -- Lease semantics (like job leases)
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Optional metadata
    operation TEXT, -- e.g., 'scene_3_image', 'voice_synthesis'
    
    -- Unique: one slot per worker+job+service+operation
    UNIQUE(service, job_id, worker_id, operation)
);

CREATE INDEX IF NOT EXISTS idx_api_slots_service ON api_slots(service);
CREATE INDEX IF NOT EXISTS idx_api_slots_expires ON api_slots(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_slots_job ON api_slots(job_id);

-- =====================================================
-- 4. MATERIALIZED VIEW: Daily Usage Summary
-- For efficient budget checks without scanning full table
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_usage AS
SELECT 
    service,
    brand_id,
    campaign_id,
    DATE(created_at) AS usage_date,
    COUNT(*) FILTER (WHERE NOT idempotency_hit) AS call_count,
    SUM(units) FILTER (WHERE NOT idempotency_hit) AS total_units,
    SUM(estimated_cost_cents) FILTER (WHERE NOT idempotency_hit) AS total_cost_cents,
    SUM(tokens) FILTER (WHERE NOT idempotency_hit) AS total_tokens,
    SUM(chars) FILTER (WHERE NOT idempotency_hit) AS total_chars,
    SUM(image_count) FILTER (WHERE NOT idempotency_hit) AS total_images,
    SUM(duration_seconds) FILTER (WHERE NOT idempotency_hit) AS total_duration_seconds
FROM api_usage
GROUP BY service, brand_id, campaign_id, DATE(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_usage_pk 
    ON mv_daily_usage(service, COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), 
                      COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), usage_date);

-- =====================================================
-- 5. RLS POLICIES
-- =====================================================

ALTER TABLE cost_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_slots ENABLE ROW LEVEL SECURITY;

-- cost_limits: anyone can read, service_role can write
CREATE POLICY "Anyone can read cost_limits" ON cost_limits
    FOR SELECT USING (true);
CREATE POLICY "Service role manages cost_limits" ON cost_limits
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- api_usage: authenticated can read, service_role can write
CREATE POLICY "Authenticated can read api_usage" ON api_usage
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages api_usage" ON api_usage
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- api_slots: service_role only
CREATE POLICY "Service role manages api_slots" ON api_slots
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 6. GRANTS
-- =====================================================

GRANT SELECT ON cost_limits TO anon, authenticated;
GRANT ALL ON cost_limits TO service_role;

GRANT SELECT ON api_usage TO authenticated;
GRANT ALL ON api_usage TO service_role;

GRANT ALL ON api_slots TO service_role;

GRANT SELECT ON mv_daily_usage TO authenticated, service_role;

-- =====================================================
-- 7. COMMENTS
-- =====================================================

COMMENT ON TABLE cost_limits IS 'Budget and rate limit configuration with hierarchical override (system→brand→campaign→job)';
COMMENT ON TABLE api_usage IS 'Ledger of all external API calls with cost tracking and idempotency';
COMMENT ON TABLE api_slots IS 'Concurrency throttle tokens with lease-based expiry';
COMMENT ON MATERIALIZED VIEW mv_daily_usage IS 'Aggregated daily usage for efficient budget checks';
