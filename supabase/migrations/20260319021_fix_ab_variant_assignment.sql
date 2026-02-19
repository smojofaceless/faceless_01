-- Fix auto_assign_ab_variants: table uses job_id not post_id
-- Fix cron cleanup calls to use correct param names

-- ─── Fix auto_assign_ab_variants ────────────────────────────────
CREATE OR REPLACE FUNCTION auto_assign_ab_variants(
  p_brand_id UUID,
  p_platform TEXT,
  p_job_id UUID,
  p_split_ratio NUMERIC DEFAULT 0.5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_post RECORD;
  v_count INTEGER := 0;
  v_variant TEXT;
BEGIN
  FOR v_post IN
    SELECT p.id, p.job_id FROM posts p
    WHERE p.brand_id = p_brand_id
      AND p.platform = p_platform
      AND p.job_id = p_job_id
      AND p.status IN ('pending', 'scheduled')
      AND p.job_id NOT IN (
        SELECT pva.job_id FROM post_metadata_variant_assignments pva 
        WHERE pva.platform = p_platform AND pva.is_active = true
      )
    ORDER BY p.created_at
  LOOP
    v_variant := CASE WHEN random() < p_split_ratio THEN 'A' ELSE 'B' END;
    
    INSERT INTO post_metadata_variant_assignments (job_id, platform, variant_key, is_active)
    VALUES (v_post.job_id, p_platform, v_variant, true)
    ON CONFLICT DO NOTHING;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_assign_ab_variants TO service_role;
