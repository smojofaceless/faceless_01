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
    WHERE DATE(recorded_at) = CURRENT_DATE
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
          AND DATE(au.recorded_at) = CURRENT_DATE
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
