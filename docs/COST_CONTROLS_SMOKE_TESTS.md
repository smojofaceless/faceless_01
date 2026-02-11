# Cost Controls Smoke Tests

> **Version:** 1.1  
> **Date:** February 10, 2026  
> **Status:** ✅ Verified  
> **Related:** ROADMAP.md Item #6, COST_CONTROLS.md

---

## Prerequisites

1. Migrations applied:
   - `20260210008_cost_controls_FULL.sql` (consolidated)

2. Service role key available:
   ```powershell
   $env:SUPABASE_SERVICE_ROLE_KEY = "your-key"
   ```

---

## Test 1: Tables Created

```sql
-- Run in SQL Editor
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('cost_limits', 'api_usage', 'api_slots');
```

**Expected:** 3 rows returned

---

## Test 2: Default Limits Loaded

```sql
SELECT service, daily_budget_cents, max_calls_per_job, max_concurrent
FROM cost_limits
WHERE scope = 'system' AND enabled = true
ORDER BY service;
```

**Expected:**
| service | daily_budget_cents | max_calls_per_job | max_concurrent |
|---------|-------------------|-------------------|----------------|
| NULL | 20000 | NULL | NULL |
| creatomate | 2500 | 2 | 2 |
| elevenlabs | 3000 | 3 | 3 |
| ffmpeg_renderer | 1000 | 3 | 3 |
| openai_image | 10000 | 20 | 5 |
| openai_text | 5000 | 5 | 10 |

---

## Test 3: get_effective_limits RPC

```sql
-- Get system limits for openai_image
SELECT * FROM get_effective_limits(
  p_service := 'openai_image'
);
```

**Expected:** Returns one row with openai_image limits

---

## Test 4: check_budget RPC (Pass Case)

```sql
-- Need a real job_id - get one first
WITH test_job AS (
  SELECT id FROM jobs WHERE status = 'pending' LIMIT 1
)
SELECT check_budget('openai_image', (SELECT id FROM test_job), 1)::json;
```

**Expected:** `{"can_proceed": true, ...}`

---

## Test 5: record_api_usage RPC (Idempotency)

```sql
-- First call - should create new record
SELECT record_api_usage(
  p_service := 'openai_image',
  p_idempotency_key := 'test:smoke:001',
  p_job_id := NULL,
  p_step_name := 'test',
  p_units := 1,
  p_image_count := 1
);

-- Second call - should hit idempotency
SELECT record_api_usage(
  p_service := 'openai_image',
  p_idempotency_key := 'test:smoke:001',
  p_job_id := NULL,
  p_step_name := 'test',
  p_units := 1,
  p_image_count := 1
);
```

**Expected:**
- First: `{"success": true, "idempotency_hit": false, "usage_id": "..."}`
- Second: `{"success": true, "idempotency_hit": true, "existing_id": "..."}`

---

## Test 6: acquire_api_slot / release_api_slot

```sql
-- Acquire a slot
SELECT acquire_api_slot(
  p_service := 'openai_image',
  p_job_id := NULL,
  p_worker_id := 'test-worker-001',
  p_operation := 'smoke_test'
);

-- Check slot exists
SELECT * FROM api_slots WHERE worker_id = 'test-worker-001';

-- Release slot
SELECT release_api_slot(
  p_service := 'openai_image',
  p_job_id := NULL,
  p_worker_id := 'test-worker-001',
  p_operation := 'smoke_test'
);

-- Verify released
SELECT * FROM api_slots WHERE worker_id = 'test-worker-001';
```

**Expected:**
- Acquire: `{"acquired": true, "slot_id": "...", ...}`
- After acquire: 1 row in api_slots
- Release: `{"success": true, "slots_released": 1}`
- After release: 0 rows in api_slots

---

## Test 7: Concurrency Limit Enforcement

```sql
-- Temporarily set max_concurrent to 1 for test
UPDATE cost_limits 
SET max_concurrent = 1 
WHERE scope = 'system' AND service = 'openai_image';

-- Acquire first slot
SELECT acquire_api_slot('openai_image', NULL, 'worker-a', 'test_1');

-- Try to acquire second (should fail)
SELECT acquire_api_slot('openai_image', NULL, 'worker-b', 'test_2');

-- Cleanup
SELECT release_api_slot(p_service := 'openai_image', p_worker_id := 'worker-a', p_operation := 'test_1');

-- Restore limit
UPDATE cost_limits 
SET max_concurrent = 5 
WHERE scope = 'system' AND service = 'openai_image';
```

**Expected:**
- First acquire: `{"acquired": true, ...}`
- Second acquire: `{"acquired": false, "message": "Max concurrent slots reached..."}`

---

## Test 8: Per-Job Call Limit

```sql
-- Create test job
INSERT INTO jobs (id, status, brand_id, batch_id)
VALUES ('00000000-0000-0000-0000-000000000099', 'generating', NULL, NULL);

-- Record usage up to limit (max_calls_per_job = 20 for images)
-- Simulate 20 calls
DO $$
BEGIN
  FOR i IN 1..20 LOOP
    PERFORM record_api_usage(
      p_service := 'openai_image',
      p_idempotency_key := 'test:job99:image_' || i,
      p_job_id := '00000000-0000-0000-0000-000000000099',
      p_step_name := 'images',
      p_units := 1,
      p_image_count := 1
    );
  END LOOP;
END $$;

-- Now check budget (should fail)
SELECT check_budget('openai_image', '00000000-0000-0000-0000-000000000099', 1);

-- Cleanup
DELETE FROM api_usage WHERE job_id = '00000000-0000-0000-0000-000000000099';
DELETE FROM jobs WHERE id = '00000000-0000-0000-0000-000000000099';
```

**Expected:** `check_budget` returns `{"can_proceed": false, "checks_failed": [{"check": "max_calls_per_job", ...}]}`

---

## Test 9: check_campaign_budget (Scheduler Integration)

```sql
-- Get a real campaign
WITH test_campaign AS (
  SELECT id FROM generation_batches WHERE status = 'running' LIMIT 1
)
SELECT check_campaign_budget((SELECT id FROM test_campaign));
```

**Expected:** Returns budget status with `can_proceed`, `daily_spend_cents`, etc.

---

## Test 10: get_usage_summary

```sql
SELECT * FROM get_usage_summary(
  p_date_from := CURRENT_DATE - INTERVAL '7 days',
  p_date_to := CURRENT_DATE
);
```

**Expected:** Returns rows with usage aggregated by service and date

---

## Test 11: sweep_stale_api_slots

```sql
-- Create an expired slot
INSERT INTO api_slots (service, job_id, worker_id, operation, expires_at)
VALUES ('openai_image', NULL, 'stale-worker', 'expired_test', NOW() - INTERVAL '1 hour');

-- Run sweep
SELECT sweep_stale_api_slots();

-- Verify cleaned
SELECT * FROM api_slots WHERE worker_id = 'stale-worker';
```

**Expected:**
- Sweep returns `{"success": true, "slots_swept": 1}`
- No rows for stale-worker after sweep

---

## Test 12: Brand-Level Override

```sql
-- Get a brand ID
WITH test_brand AS (
  SELECT id FROM brands LIMIT 1
)
-- Insert brand override with higher limit
INSERT INTO cost_limits (
  scope, brand_id, service,
  max_calls_per_job,
  description
) VALUES (
  'brand',
  (SELECT id FROM test_brand),
  'openai_image',
  50,  -- Higher than system default of 30
  'Test brand override'
);

-- Get effective limits for a job in this brand
WITH test_job AS (
  SELECT j.id FROM jobs j
  JOIN brands b ON j.brand_id = b.id
  WHERE j.brand_id = (SELECT id FROM test_brand)
  LIMIT 1
)
SELECT * FROM get_effective_limits(
  p_job_id := (SELECT id FROM test_job),
  p_service := 'openai_image'
);

-- Cleanup
DELETE FROM cost_limits WHERE description = 'Test brand override';
```

**Expected:** Effective limit shows `max_calls_per_job = 50` (brand override)

---

## Smoke Test Summary

| Test | Component | Pass Criteria |
|------|-----------|---------------|
| 1 | Tables | 3 tables exist |
| 2 | Defaults | 6 system limits loaded |
| 3 | get_effective_limits | Returns limits |
| 4 | check_budget (pass) | can_proceed = true |
| 5 | record_api_usage | Idempotency works |
| 6 | acquire/release_api_slot | Slots create/delete |
| 7 | Concurrency limit | Second acquire fails |
| 8 | Per-job limit | Check fails at limit |
| 9 | check_campaign_budget | Returns status |
| 10 | get_usage_summary | Returns aggregates |
| 11 | sweep_stale_api_slots | Cleans expired |
| 12 | Brand override | Most specific wins |

---

## Integration Test (Optional)

After deploying worker-v1 with cost controls:

1. Create a test campaign with 1 job
2. Set a very low limit: `max_calls_per_job = 2` for `openai_image`
3. Run the job
4. Verify:
   - Job fails at images step after 2 images
   - `job_failures` has entry with class `misconfig`
   - `api_usage` has exactly 2 image records
   - Job is NOT auto-retried (misconfig = operator must adjust limits)

```sql
-- After test job runs:
SELECT step_name, failure_class, error_message 
FROM job_failures 
WHERE job_id = 'test-job-id'
ORDER BY created_at DESC LIMIT 1;

SELECT service, COUNT(*) as calls
FROM api_usage
WHERE job_id = 'test-job-id'
GROUP BY service;
```

---

## Test 13: check_global_budget (Scheduler Gate)

```sql
SELECT check_global_budget();
```

**Expected:** Returns `{"can_proceed": true, "daily_spend_cents": 0, "daily_budget_cents": 20000, "pct_used": 0.0, ...}`

---

## Test 14: get_campaigns_over_budget

```sql
SELECT * FROM get_campaigns_over_budget();
```

**Expected:** Empty result (no campaigns over budget with fresh install)
