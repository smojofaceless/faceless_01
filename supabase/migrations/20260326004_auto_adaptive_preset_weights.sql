-- Migration: Auto-adaptive preset weights
-- Reads performance data from v_visual_performance (which includes retention scores)
-- and rebalances brand_templates.weight proportionally.
-- Min weight = 10 to maintain exploration of all presets.
-- Requires >= 3 posts per preset and >= 2 presets with data before rebalancing.

CREATE OR REPLACE FUNCTION recompute_preset_weights(
  p_brand_id UUID,
  p_window_days INT DEFAULT 30
)
RETURNS TABLE(
  preset TEXT,
  old_weight INT,
  new_weight INT,
  post_count BIGINT,
  avg_perf NUMERIC
) AS $$
DECLARE
  v_total_perf NUMERIC;
  v_preset_count INT;
BEGIN
  -- 1. Compute average performance per vibe_preset within the window
  DROP TABLE IF EXISTS _pw_perf;
  CREATE TEMP TABLE _pw_perf ON COMMIT DROP AS
  SELECT
    vp.vibe_preset,
    COUNT(*)        AS pcount,
    ROUND(AVG(vp.perf_score), 2) AS aperf
  FROM v_visual_performance vp
  WHERE vp.brand_id   = p_brand_id
    AND vp.posted_at  >= NOW() - (p_window_days || ' days')::INTERVAL
    AND vp.perf_score  > 0
    AND vp.vibe_preset IS NOT NULL
  GROUP BY vp.vibe_preset
  HAVING COUNT(*) >= 3;          -- need minimum signal

  SELECT COUNT(*) INTO v_preset_count FROM _pw_perf;

  IF v_preset_count < 2 THEN
    -- Not enough data to rebalance — return empty
    RETURN;
  END IF;

  SELECT SUM(aperf) INTO v_total_perf FROM _pw_perf;

  IF v_total_perf <= 0 THEN RETURN; END IF;

  -- 2. Snapshot old weights + compute new weights
  DROP TABLE IF EXISTS _pw_result;
  CREATE TEMP TABLE _pw_result ON COMMIT DROP AS
  SELECT
    bt.template_type                                       AS preset,
    bt.weight                                              AS old_weight,
    GREATEST(10, ROUND(100.0 * pp.aperf / v_total_perf))::INT AS new_weight,
    pp.pcount                                              AS post_count,
    pp.aperf                                               AS avg_perf
  FROM brand_templates bt
  JOIN _pw_perf pp ON bt.template_type = pp.vibe_preset
  WHERE bt.brand_id = p_brand_id;

  -- 3. Apply new weights
  UPDATE brand_templates bt
  SET weight     = r.new_weight,
      updated_at = NOW()
  FROM _pw_result r
  WHERE bt.brand_id     = p_brand_id
    AND bt.template_type = r.preset;

  -- 4. Return results
  RETURN QUERY SELECT r.preset, r.old_weight, r.new_weight, r.post_count, r.avg_perf
               FROM _pw_result r
               ORDER BY r.avg_perf DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service_role (edge functions) and authenticated (UI)
GRANT EXECUTE ON FUNCTION recompute_preset_weights(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION recompute_preset_weights(UUID, INT) TO authenticated;
