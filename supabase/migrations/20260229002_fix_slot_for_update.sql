-- =====================================================
-- FIX: acquire_api_slot — FOR UPDATE not allowed with COUNT(*)
-- Run in Supabase Dashboard → SQL Editor
-- =====================================================

CREATE OR REPLACE FUNCTION acquire_api_slot(
    p_service TEXT,
    p_job_id UUID DEFAULT NULL,
    p_worker_id TEXT DEFAULT gen_random_uuid()::text,
    p_operation TEXT DEFAULT NULL,
    p_lease_seconds INTEGER DEFAULT 300
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

    -- Use advisory lock to prevent race conditions (hash of service name)
    PERFORM pg_advisory_xact_lock(hashtext('api_slot_' || p_service));

    -- Count current active slots (no FOR UPDATE — advisory lock prevents races)
    SELECT COUNT(*) INTO v_current_slots
    FROM api_slots
    WHERE service = p_service AND expires_at > NOW();

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

-- Verify
SELECT 'acquire_api_slot fixed' AS status;
