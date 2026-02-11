-- =====================================================
-- COST CONTROLS DEFAULT LIMITS
-- Migration: 20260210005_cost_controls_defaults.sql
-- 
-- Sets up default system-level limits for all services.
-- These can be overridden at brand/campaign/job level.
--
-- Related: ROADMAP.md Item #6 "Cost Controls / Rate Limits"
-- =====================================================

-- =====================================================
-- SYSTEM-LEVEL DEFAULTS (Global)
-- =====================================================

-- OpenAI Text (story generation, scene breakdown)
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    cost_per_unit_cents,
    description
) VALUES (
    'system', 'openai_text',
    5000,           -- $50/day max
    5,              -- Max 5 text calls per job (story + scenes + retries)
    500,            -- Max 500 text calls per day globally
    10,             -- Max 10 concurrent text calls
    1.0,            -- $0.01 per 1K tokens (estimate)
    'OpenAI text generation (story, scenes). Cost is per 1K tokens.'
) ON CONFLICT DO NOTHING;

-- OpenAI gpt-image-1 (scene images)
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    cost_per_unit_cents,
    description
) VALUES (
    'system', 'openai_image',
    10000,          -- $100/day max (images are expensive)
    30,             -- Max 30 images per job (typical video has 10-20 scenes + retries)
    1000,           -- Max 1000 images per day globally
    5,              -- Max 5 concurrent image generation (avoid rate limits)
    4.0,            -- $0.04 per image (gpt-image-1 estimate)
    'OpenAI gpt-image-1 generation. Cost is per image.'
) ON CONFLICT DO NOTHING;

-- ElevenLabs (voice synthesis)
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    cost_per_unit_cents,
    description
) VALUES (
    'system', 'elevenlabs',
    3000,           -- $30/day max
    3,              -- Max 3 voice calls per job (voice + retries)
    200,            -- Max 200 voice calls per day globally
    3,              -- Max 3 concurrent voice calls
    30.0,           -- $0.30 per 1K chars (estimate)
    'ElevenLabs voice synthesis. Cost is per 1K characters.'
) ON CONFLICT DO NOTHING;

-- FFmpeg Renderer (video assembly)
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    cost_per_unit_cents,
    description
) VALUES (
    'system', 'ffmpeg_renderer',
    1000,           -- $10/day max
    3,              -- Max 3 render calls per job (assemble + retries)
    100,            -- Max 100 renders per day globally
    3,              -- Max 3 concurrent renders
    2.0,            -- $0.02 per minute of render time (estimate)
    'FFmpeg video renderer. Cost is per minute of render time.'
) ON CONFLICT DO NOTHING;

-- Creatomate (fallback renderer)
INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    max_calls_per_job,
    max_calls_per_day,
    max_concurrent,
    cost_per_unit_cents,
    description
) VALUES (
    'system', 'creatomate',
    2500,           -- $25/day max
    2,              -- Max 2 creatomate calls per job (fallback only)
    50,             -- Max 50 creatomate renders per day globally
    2,              -- Max 2 concurrent creatomate renders
    50.0,           -- $0.50 per render (estimate)
    'Creatomate fallback renderer. Cost is per render.'
) ON CONFLICT DO NOTHING;

-- =====================================================
-- GLOBAL AGGREGATE LIMITS (All Services)
-- =====================================================

INSERT INTO cost_limits (
    scope, service,
    daily_budget_cents,
    monthly_budget_cents,
    description
) VALUES (
    'system', NULL,  -- NULL service = applies to all
    20000,           -- $200/day total across all services
    500000,          -- $5000/month total
    'Global daily and monthly budget caps across all services.'
) ON CONFLICT DO NOTHING;

-- =====================================================
-- EXAMPLE: Per-brand override (commented out)
-- Uncomment and modify for specific brands
-- =====================================================

/*
-- Example: Horror Stories brand with higher image budget
INSERT INTO cost_limits (
    scope, brand_id, service,
    daily_budget_cents,
    max_calls_per_job,
    description
) VALUES (
    'brand', 
    '68a58afb-8c85-4d6d-9eec-144ab7e5f106', -- Horror Stories brand_id
    'openai_image',
    15000,          -- $150/day for this brand
    40,             -- Allow more images per job
    'Horror Stories brand - higher image budget for detailed scenes.'
);
*/

-- =====================================================
-- VERIFY DEFAULTS
-- =====================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM cost_limits WHERE scope = 'system';
    RAISE NOTICE 'Inserted % system-level cost limits', v_count;
END $$;
