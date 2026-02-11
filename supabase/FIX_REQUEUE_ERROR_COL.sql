-- =====================================================
-- FIX: requeue_failed_job — error_message column doesn't exist
-- The jobs table has "error" not "error_message"
-- Run in Supabase Dashboard → SQL Editor
-- =====================================================

CREATE OR REPLACE FUNCTION requeue_failed_job(
    p_job_id UUID,
    p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
    v_latest_failure RECORD;
    v_policy RECORD;
    v_backoff_minutes INTEGER;
    v_next_generate_by TIMESTAMPTZ;
    v_can_retry BOOLEAN;
BEGIN
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;
    
    IF v_job.status != 'failed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job is not in failed status', 'current_status', v_job.status);
    END IF;
    
    IF NOT p_force AND v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at > NOW() THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Job has active lease until ' || v_job.lease_expires_at::TEXT,
            'locked_by', v_job.locked_by,
            'lease_expires_at', v_job.lease_expires_at,
            'hint', 'Wait for lease to expire or use force=true'
        );
    END IF;
    
    SELECT * INTO v_latest_failure 
    FROM job_failures 
    WHERE job_id = p_job_id 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    IF NOT p_force THEN
        IF v_latest_failure.failure_class IN ('permanent', 'misconfig') THEN
            RETURN jsonb_build_object(
                'success', false, 
                'error', 'Cannot retry: failure class is ' || v_latest_failure.failure_class,
                'recommendation', CASE 
                    WHEN v_latest_failure.failure_class = 'permanent' THEN 'Content was rejected. Review and regenerate.'
                    ELSE 'Configuration error. Check API keys and settings.'
                END
            );
        END IF;
        
        SELECT * INTO v_policy FROM job_step_retry_policies WHERE step_name = v_latest_failure.step_name;
        
        IF v_policy IS NOT NULL AND v_latest_failure.step_attempt_number >= v_policy.max_attempts THEN
            RETURN jsonb_build_object(
                'success', false, 
                'error', 'Max step attempts reached for ' || v_latest_failure.step_name,
                'step_attempts', v_latest_failure.step_attempt_number,
                'max_attempts', v_policy.max_attempts
            );
        END IF;
    END IF;
    
    IF v_latest_failure IS NOT NULL AND v_latest_failure.next_retry_at IS NOT NULL AND NOT p_force THEN
        v_next_generate_by := v_latest_failure.next_retry_at;
    ELSE
        v_next_generate_by := NOW();
    END IF;
    
    -- Reset job for retry — uses "error" (not "error_message")
    UPDATE jobs SET
        status = 'pending',
        locked_by = NULL,
        locked_at = NULL,
        lease_expires_at = NULL,
        generate_by = v_next_generate_by,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        error = NULL,
        meta = jsonb_set(
            COALESCE(meta, '{}'::jsonb),
            ARRAY['last_requeue'],
            jsonb_build_object(
                'at', NOW(),
                'forced', p_force,
                'previous_failure_step', v_latest_failure.step_name,
                'scheduled_for', v_next_generate_by,
                'resume_from_step', v_job.current_step
            )
        ),
        updated_at = NOW()
    WHERE id = p_job_id;
    
    UPDATE job_failures SET
        raw_meta = raw_meta || jsonb_build_object('requeued_at', NOW(), 'requeue_forced', p_force)
    WHERE id = v_latest_failure.id;
    
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'new_status', 'pending',
        'generate_by', v_next_generate_by,
        'attempt_count', COALESCE(v_job.attempt_count, 0) + 1,
        'previous_failure_step', v_latest_failure.step_name,
        'resume_from_step', v_job.current_step,
        'forced', p_force
    );
END;
$$;

SELECT 'requeue_failed_job fixed' AS status;
