# Cost Controls System

> **Version:** 1.1  
> **Date:** February 10, 2026  
> **Status:** ✅ Deployed & Verified  
> **Related:** ROADMAP.md Item #6 "Cost Controls / Rate Limits"  
> **Migration:** `20260210008_cost_controls_FULL.sql`

---

## Overview

The Cost Controls system prevents runaway API spending by enforcing:

1. **Per-job call limits** - Max expensive operations per job
2. **Per-campaign daily budgets** - Daily spend cap per campaign  
3. **Global daily limits** - System-wide daily caps
4. **Concurrency throttles** - Max simultaneous calls per service

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    COST CONTROL FLOW                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   schedule-jobs          worker-v1              Expensive     │
│   ┌─────────┐           ┌─────────┐             API Call      │
│   │ Check   │──────────▶│ Check   │──────────▶ ┌─────────┐   │
│   │ Budget  │           │ Budget  │            │ OpenAI  │   │
│   └────┬────┘           │ + Slot  │            │ Eleven  │   │
│        │                └────┬────┘            │ FFmpeg  │   │
│        │                     │                 └────┬────┘   │
│        │                     │                      │        │
│        │                     ▼                      │        │
│   (skip if over)        ┌─────────┐                │        │
│                         │ Record  │◀───────────────┘        │
│                         │ Usage   │                          │
│                         └─────────┘                          │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Services Tracked

| Service | Model | What's Counted | Unit | Default Cost |
|---------|-------|----------------|------|---------------|
| `openai_text` | gpt-4o | Story generation, scene breakdown | 1K tokens | $0.01 |
| `openai_image` | **gpt-image-1** (NOT DALL-E) | Scene images | 1 image | $0.02-0.04 |
| `elevenlabs` | eleven_turbo_v2_5 | Voice synthesis | chars | $0.30/1K |
| `ffmpeg_renderer` | (self-hosted) | Video assembly | render_seconds | $0.02/min |
| `creatomate` | (cloud API) | Fallback video render | 1 render | $0.50 |

## Default Limits

### System-Level Defaults

| Service | Daily Budget | Max/Job | Max/Day | Max Concurrent |
|---------|--------------|---------|---------|----------------|
| `openai_text` | $50 | 5 calls | 10,000 | 10 |
| `openai_image` (gpt-image-1) | $100 | **20 images** | 5,000 | 5 |
| `elevenlabs` | $30 | 3 calls | 1,000 | 3 |
| `ffmpeg_renderer` | $10 | 3 renders | 500 | 3 |
| `creatomate` | $25 | 2 renders | 500 | 2 |
| **All Services** | $200 | - | - | - |

### Monthly Global Cap
- **$5000/month** across all services

## Limit Hierarchy

Limits cascade with the most specific scope winning:

```
System (global defaults)
    ↓ override
Brand (per-brand limits)
    ↓ override
Campaign (per-campaign limits)
    ↓ override
Job (per-job limits)
```

## Database Schema

### Tables

#### `cost_limits`
Configuration table for budget limits at each scope level.

```sql
-- Key columns:
scope           -- 'system' | 'brand' | 'campaign' | 'job'
service         -- 'openai_text' | 'openai_image' | 'elevenlabs' | 'ffmpeg_renderer' | 'creatomate' | NULL
daily_budget_cents    -- Daily budget cap
monthly_budget_cents  -- Monthly budget cap  
per_call_max_cents    -- Max cost per single API call
max_calls_per_job     -- Per-job call limit
max_calls_per_day     -- Global daily call limit
max_concurrent        -- Concurrency throttle
max_tokens_per_call   -- For text models
max_chars_per_call    -- For TTS
max_images_per_job    -- For image generation
```

#### `api_usage`
Ledger of all API calls with idempotency support.

```sql
-- Key columns:
service             -- Which API was called
idempotency_key     -- Unique key (service + key, prevents double-counting)
units               -- How many units consumed
estimated_cost_cents -- Calculated cost
model               -- e.g., 'gpt-4o', 'gpt-image-1'
request_id          -- Provider's request ID for debugging
success             -- Whether the call succeeded
```

#### `api_slots`
Concurrency control tokens with lease expiry.

```sql
-- Key columns:
service       -- Which API
job_id        -- Job holding the slot
worker_id     -- Worker ID
expires_at    -- When slot auto-releases
```

### RPCs

| Function | Purpose | Access |
|----------|---------|--------|
| `get_effective_limits()` | Get cascaded limits for job/campaign/brand | service_role |
| `check_budget()` | Verify all limits before operation | service_role |
| `record_api_usage()` | Log API call (with idempotency) | service_role |
| `acquire_api_slot()` | Get concurrency slot | service_role |
| `release_api_slot()` | Return concurrency slot | service_role |
| `sweep_stale_api_slots()` | Clean up expired slots | service_role |
| `check_campaign_budget()` | Quick budget check for scheduler | service_role |
| `check_global_budget()` | Global daily budget gate for scheduler | service_role |
| `get_campaigns_over_budget()` | Find campaigns exceeding daily budget | service_role |
| `get_usage_summary()` | Usage statistics for reporting | auth, service_role |
| `refresh_daily_usage()` | Refresh materialized view | service_role |

## Worker-v1 Integration

### Import the Helper

```typescript
import { 
  CostControlHelper, 
  withCostControl,
  classifyCostFailure 
} from "./costControl.ts";
```

### Initialize Per Job

```typescript
const costHelper = new CostControlHelper(supabase, job.id, workerId);
```

### Check Before Expensive Calls

```typescript
// In image generation loop:
for (let i = 0; i < scenes.length; i++) {
  const idempotencyKey = CostControlHelper.generateIdempotencyKey(
    job.id, 'openai_image', 'images', i
  );
  
  // Check budget + acquire slot
  const check = await costHelper.checkAndAcquire('openai_image', `scene_${i}`);
  if (!check.allowed) {
    // Cost limit reached - fail with misconfig (operator-actionable, not auto-retried)
    return { 
      success: false, 
      error: check.reason,
      failureClass: 'misconfig' // Operator must adjust limits
    };
  }
  
  try {
    // Make the API call
    const imageUrl = await generateImage(prompt);
    
    // Record usage (only if NOT idempotency hit)
    await costHelper.recordUsage('openai_image', idempotencyKey, {
      image_count: 1,
      request_meta: { model: 'gpt-image-1', scene_index: i }
    }, 'images');
    
  } finally {
    // Always release slot
    await costHelper.releaseSlot('openai_image', `scene_${i}`);
  }
}
```

### Using the withCostControl Wrapper

```typescript
const result = await withCostControl(
  costHelper,
  'elevenlabs',
  'voice_synthesis',
  async () => {
    const audio = await synthesizeVoice(text);
    return { 
      result: audio, 
      metrics: { chars: text.length } 
    };
  },
  idempotencyKey,
  'voice'
);

if (!result.success) {
  return { success: false, error: result.reason };
}
```

### Cleanup on Job Completion

```typescript
// In finally block:
await costHelper.releaseAllSlots();
```

## Schedule-Jobs Integration

### Check Campaign Budget Before Claiming

```typescript
// In schedule-jobs, before claiming jobs:
for (const campaign of activeCampaigns) {
  const { data: budgetCheck } = await supabase
    .rpc('check_campaign_budget', { p_campaign_id: campaign.id });
  
  if (!budgetCheck.can_proceed) {
    console.log(`Campaign ${campaign.id} over budget: ${budgetCheck.reason}`);
    
    // Auto-pause campaign
    await supabase
      .from('generation_batches')
      .update({ 
        status: 'paused',
        auto_paused_at: new Date().toISOString(),
        auto_pause_reason: budgetCheck.reason
      })
      .eq('id', campaign.id);
    
    continue; // Skip this campaign's jobs
  }
}
```

## Failure Classification

When a cost limit is hit, classify it as `cost_limit`:

```typescript
// In classifyError.ts or step failure handling:
if (error.includes('budget exceeded') || error.includes('limit reached')) {
  return {
    class: 'misconfig',
    retryable: false, // Operator must adjust limits
    signature: 'misconfig:images:budget'
  };
}
```

The `misconfig` failure class:
- **Is NOT auto-retried** (unlike `transient` or `dependency`)
- Operator must review and adjust cost limits
- Shows in DLQ with `recommended_action: 'adjust cost limits'`
- Budget limits don't reset on their own during a job's lifetime

## Observability

### View Current Usage

```sql
-- Today's usage by service
SELECT * FROM get_usage_summary(
  p_date_from := CURRENT_DATE,
  p_date_to := CURRENT_DATE
);

-- Campaign-specific usage
SELECT * FROM get_usage_summary(
  p_campaign_id := 'your-campaign-id',
  p_date_from := CURRENT_DATE - INTERVAL '7 days'
);
```

### View Active Limits

```sql
-- System defaults
SELECT * FROM cost_limits WHERE scope = 'system' AND enabled = true;

-- Brand overrides
SELECT * FROM cost_limits WHERE scope = 'brand' AND brand_id = 'your-brand-id';
```

### View Current Slots

```sql
-- Active concurrency slots
SELECT service, COUNT(*) as active_slots
FROM api_slots
WHERE expires_at > NOW()
GROUP BY service;
```

### Budget Status for Campaign

```sql
SELECT * FROM check_campaign_budget('your-campaign-id');
```

## Override Examples

### Increase Image Budget for a Brand

```sql
INSERT INTO cost_limits (
  scope, brand_id, service,
  daily_budget_cents,
  max_calls_per_job,
  description
) VALUES (
  'brand',
  '68a58afb-8c85-4d6d-9eec-144ab7e5f106',
  'openai_image',
  15000,  -- $150/day
  50,     -- 50 images/job
  'Horror Stories brand - higher image budget'
);
```

### Set Campaign Total Budget

```sql
INSERT INTO cost_limits (
  scope, campaign_id, service,
  total_budget_cents,
  description
) VALUES (
  'campaign',
  'your-campaign-id',
  NULL,   -- All services
  50000,  -- $500 total lifetime
  'Campaign X - limited budget test'
);
```

### Reduce Concurrency for a Service

```sql
UPDATE cost_limits
SET max_concurrent = 2
WHERE scope = 'system' AND service = 'openai_image';
```

## Troubleshooting

### Job Failing with "budget exceeded"

1. Check current usage:
   ```sql
   SELECT * FROM get_usage_summary(p_campaign_id := 'job-campaign-id');
   ```

2. Check applicable limits:
   ```sql
   SELECT * FROM get_effective_limits(p_job_id := 'your-job-id');
   ```

3. If legitimate, increase limit or wait for daily reset

### Slots Not Releasing

1. Check for stuck slots:
   ```sql
   SELECT * FROM api_slots WHERE expires_at < NOW();
   ```

2. Run cleanup:
   ```sql
   SELECT * FROM sweep_stale_api_slots();
   ```

### Idempotency Not Working

1. Check if usage was recorded:
   ```sql
   SELECT * FROM api_usage
   WHERE job_id = 'your-job-id'
   ORDER BY created_at DESC;
   ```

2. Verify idempotency key format matches exactly

## Migration Notes

- No breaking changes to existing behavior
- Default limits are permissive (won't block existing workloads)
- Gradually tighten limits based on observed usage
- Monitor `mv_daily_usage` for aggregated cost data
