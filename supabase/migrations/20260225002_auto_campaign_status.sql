-- =====================================================
-- AUTO CAMPAIGN STATUS SYNC
-- Automatically updates campaign status based on job completion
-- =====================================================

-- Function to sync campaign status based on job states
CREATE OR REPLACE FUNCTION sync_campaign_status_from_jobs()
RETURNS TRIGGER AS $$
DECLARE
    v_batch_id UUID;
    v_total_jobs INTEGER;
    v_complete_jobs INTEGER;
    v_failed_jobs INTEGER;
    v_current_status TEXT;
BEGIN
    -- Get the batch_id from the job
    v_batch_id := COALESCE(NEW.batch_id, OLD.batch_id);
    
    -- Skip if no batch_id
    IF v_batch_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Get current campaign status
    SELECT status INTO v_current_status
    FROM generation_batches
    WHERE id = v_batch_id;
    
    -- Skip if campaign is cancelled (don't auto-change)
    IF v_current_status = 'cancelled' THEN
        RETURN NEW;
    END IF;
    
    -- Count job states for this campaign
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'complete'),
        COUNT(*) FILTER (WHERE status = 'failed')
    INTO v_total_jobs, v_complete_jobs, v_failed_jobs
    FROM jobs
    WHERE batch_id = v_batch_id;
    
    -- Update campaign status based on job states
    IF v_total_jobs > 0 THEN
        IF v_complete_jobs = v_total_jobs THEN
            -- All jobs complete → mark campaign completed
            UPDATE generation_batches 
            SET status = 'completed', 
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = v_batch_id 
              AND status NOT IN ('completed', 'cancelled');
        ELSIF v_complete_jobs > 0 OR v_failed_jobs > 0 THEN
            -- Some jobs have run → mark campaign active (if not already)
            UPDATE generation_batches 
            SET status = 'active',
                updated_at = NOW()
            WHERE id = v_batch_id 
              AND status IN ('planned', 'setup', 'stories');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on jobs table
DROP TRIGGER IF EXISTS trg_sync_campaign_status ON jobs;
CREATE TRIGGER trg_sync_campaign_status
    AFTER UPDATE OF status ON jobs
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION sync_campaign_status_from_jobs();

-- Also run initial sync for existing data
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT 
            gb.id,
            gb.status AS current_status,
            COUNT(j.id) AS total_jobs,
            COUNT(j.id) FILTER (WHERE j.status = 'complete') AS complete_jobs
        FROM generation_batches gb
        LEFT JOIN jobs j ON j.batch_id = gb.id
        WHERE gb.status NOT IN ('cancelled', 'completed')
        GROUP BY gb.id, gb.status
    LOOP
        -- If all jobs complete, mark completed
        IF r.total_jobs > 0 AND r.complete_jobs = r.total_jobs THEN
            UPDATE generation_batches 
            SET status = 'completed', 
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE id = r.id;
            RAISE NOTICE 'Campaign % marked completed (% jobs done)', r.id, r.complete_jobs;
        -- If some jobs complete but campaign still planned, mark active
        ELSIF r.complete_jobs > 0 AND r.current_status = 'planned' THEN
            UPDATE generation_batches 
            SET status = 'active',
                updated_at = NOW()
            WHERE id = r.id;
            RAISE NOTICE 'Campaign % marked active (% of % jobs done)', r.id, r.complete_jobs, r.total_jobs;
        END IF;
    END LOOP;
END $$;

COMMENT ON FUNCTION sync_campaign_status_from_jobs IS 'Auto-syncs campaign status when jobs complete';
