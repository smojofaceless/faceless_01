-- Add atomic lock columns for parallel image generation
-- This prevents race conditions where two requests start parallel jobs simultaneously

-- Add lock columns to jobs table (stored in meta JSONB for simplicity)
-- We'll use a single atomic UPDATE to acquire the lock

-- Note: We're using JSONB meta column which already exists
-- The lock fields will be:
--   meta.parallel_lock_token (text) - UUID of lock holder
--   meta.parallel_lock_expires_at (timestamp) - When lock expires

-- Create a function for atomic lock acquisition
CREATE OR REPLACE FUNCTION acquire_parallel_lock(
    p_job_id UUID,
    p_lock_token TEXT,
    p_lock_duration_seconds INTEGER DEFAULT 300
)
RETURNS BOOLEAN AS $$
DECLARE
    v_updated INTEGER;
    v_current_lock TEXT;
    v_lock_expires TIMESTAMPTZ;
BEGIN
    -- Get current lock state
    SELECT 
        meta->>'parallel_lock_token',
        (meta->>'parallel_lock_expires_at')::TIMESTAMPTZ
    INTO v_current_lock, v_lock_expires
    FROM jobs
    WHERE id = p_job_id;
    
    -- Try to acquire lock atomically
    -- Only succeeds if: no lock exists OR lock is expired OR we already own it
    UPDATE jobs
    SET 
        meta = meta || jsonb_build_object(
            'parallel_lock_token', p_lock_token,
            'parallel_lock_expires_at', (NOW() + (p_lock_duration_seconds || ' seconds')::INTERVAL)::TEXT
        ),
        updated_at = NOW()
    WHERE id = p_job_id
    AND (
        meta->>'parallel_lock_token' IS NULL 
        OR (meta->>'parallel_lock_expires_at')::TIMESTAMPTZ < NOW()
        OR meta->>'parallel_lock_token' = p_lock_token
    );
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    
    RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Create a function to release the lock
CREATE OR REPLACE FUNCTION release_parallel_lock(
    p_job_id UUID,
    p_lock_token TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE jobs
    SET 
        meta = meta - 'parallel_lock_token' - 'parallel_lock_expires_at',
        updated_at = NOW()
    WHERE id = p_job_id
    AND meta->>'parallel_lock_token' = p_lock_token;
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    
    RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION acquire_parallel_lock(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION acquire_parallel_lock(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_parallel_lock(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION release_parallel_lock(UUID, TEXT) TO service_role;
