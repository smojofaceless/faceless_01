# Story Storage & Uniqueness System

> **Last Updated:** February 12, 2026  
> **Module Version:** 2.2.0 (Rich Story Generation + Thematic Uniqueness)

---

## Change Log

| Date | Version | Changes |
|------|---------|--------|
| Feb 12, 2026 | 2.2.0 | Rich one_too_many prompt engine with randomized trope packs. 8-dimension storytelling toolkit. Thematic avoidance prompt with concept_hash dedup. Cinematography-driven shot selection. |
| Feb 8, 2026 | 2.1.0 | Added "Write Path Contract" section (Gap 1: when DNA tables must be written) |
| Feb 8, 2026 | 2.1.0 | Added "Expected Empty Tables" reference (Gap 2: which tables are aggregation-only) |
| Feb 8, 2026 | 2.1.0 | Added "Diagnosis Checklist" for empty DNA tables |
| Feb 8, 2026 | 2.1.0 | Added "Failure Visibility" logging requirements |
| Feb 1, 2026 | 2.0.0 | Theme guidance system rewrite |

---

This system ensures story diversity over time **without extra API costs** using lightweight theme rotation.

## Overview

**Strategy: Theme Guidance, Not Retries**

Instead of generating multiple stories and rejecting duplicates (expensive!), we:
1. **Analyze recent stories** - Extract dominant themes from the last 7 days
2. **Pick a contrasting direction** - Choose a theme bucket that's different
3. **Add positive guidance** - Tell GPT "focus on water horror" (not "don't write about forests")
4. **Generate once** - Single API call, no retries
5. **Track everything** - Store stories and similarity scores for analytics

This approach:
- ✅ Costs exactly 1 API call (same as before)
- ✅ Pushes creativity in new directions
- ✅ Stores all data for analysis
- ✅ Tracks similarity without rejecting stories

## Theme Buckets

The system rotates between 6 theme buckets:

| Bucket | Themes | Settings |
|--------|--------|----------|
| **water** | drowning, deep sea, isolation | ocean, lake, flooded basement, ship |
| **forest** | getting lost, being watched, ancient evil | deep woods, foggy forest, clearing |
| **urban** | stalker, empty city, wrong floor | subway, parking garage, office, mall |
| **domestic** | home invasion, familiar turned wrong | attic, basement, bedroom, mirror |
| **cosmic** | incomprehensible, reality breaking | observatory, desert, mountain peak |
| **technological** | AI gone wrong, surveillance, glitch | server room, smart home, hospital |

## How It Works

1. **Fetch recent keywords** from last 7 days of stories
2. **Score each bucket** by how much it overlaps with recent themes
3. **Pick lowest-scoring bucket** (most contrasting)
4. **Add ~15 words to prompt** with positive direction

Example prompt addition:
```
THEME DIRECTION (for variety):
Focus on: stalker
Setting lean: parking garage
Key element: flickering lights
Horror beat: something pretending to be human
```

## Database Schema

### `stories` Table

Stores all generated stories with:
- Content hashes (SHA-256) for exact duplicate detection
- N-gram fingerprints (bigrams, trigrams) for fuzzy matching
- Keyword extraction for semantic similarity
- Generation metadata (vibe, length, visual preset)
- Usage tracking (use count, last used)

### `story_uniqueness_config` Table

Configurable parameters:
- `exact_match_threshold` (default: 0.95) - Above this = exact duplicate, reject
- `high_similarity_threshold` (default: 0.75) - Above this = too similar, reject
- `moderate_similarity_threshold` (default: 0.5) - Above this = warn but accept
- `decay_rate` (default: 0.023) - Exponential decay rate (~30-day half-life)
- `lookback_days` (default: 90) - Only compare against stories from last N days
- `max_generation_attempts` (default: 5) - Max retries to generate unique story

### `story_similarity_cache` Table (Optional)

Pre-computed similarity scores for larger datasets.

## How Similarity Works

### Multi-Algorithm Approach

The system uses four complementary similarity measures:

1. **Content Hash Match** - Exact duplicate detection
2. **Bigram Similarity** (Jaccard) - Detects similar word pairs
3. **Trigram Similarity** (Jaccard) - Detects similar word sequences
4. **Keyword Similarity** (Jaccard) - Compares key terms
5. **Cosine Similarity** - Overall text similarity

### Weighted Combination

```
final_similarity = 
    bigram_sim * 0.15 +
    trigram_sim * 0.30 +
    keyword_sim * 0.25 +
    text_sim * 0.30
```

### Time-Based Decay (Weighted Reuse)

The "effective similarity" considers story age:

```
effective_similarity = raw_similarity × age_weight
age_weight = e^(-decay_rate × days_old)
```

With default settings (decay_rate = 0.023):
- **1 day old**: weight ≈ 0.98 (nearly full weight)
- **7 days old**: weight ≈ 0.85
- **30 days old**: weight ≈ 0.50 (half weight = half-life)
- **60 days old**: weight ≈ 0.25
- **90 days old**: weight ≈ 0.13

Stories older than `lookback_days` (90 days default) have 0 weight and can be freely repeated.

## Usage in Code

### Automatic Integration

The system is automatically integrated into `runPreviewMode` and `runAudioPhase` in `phases.ts`. When generating a new story:

1. Checks if uniqueness is enabled
2. Generates story using OpenAI
3. Computes similarity against existing stories
4. If too similar, regenerates (up to `max_generation_attempts`)
5. Stores the final story with metadata
6. Returns uniqueness info in the response

### Manual Usage

```typescript
import { 
  checkStoryUniqueness, 
  storeStory, 
  getUniquenessConfig 
} from "./stories.ts";

// Check uniqueness without storing
const result = await checkStoryUniqueness(supabase, {
  title: "The Dark Forest",
  story: "I walked into the woods...",
  hook: "Some things should stay buried"
}, {
  vibe_preset: "slow_creepy",
  visual_preset: "forest"
});

if (result.recommendation === 'accept') {
  // Store the story
  const storyId = await storeStory(supabase, story, metadata);
}
```

## Configuration

### Via Database

Update the `story_uniqueness_config` table:

```sql
-- Make uniqueness checking stricter
UPDATE story_uniqueness_config 
SET high_similarity_threshold = 0.6
WHERE config_name = 'default';

-- Increase lookback period
UPDATE story_uniqueness_config 
SET lookback_days = 180
WHERE config_name = 'default';

-- Disable uniqueness checking (store only)
UPDATE story_uniqueness_config 
SET uniqueness_enabled = false
WHERE config_name = 'default';
```

### Via RPC Function

```sql
SELECT update_uniqueness_config(
    p_high_similarity_threshold := 0.6,
    p_lookback_days := 180
);
```

## API Response

When generating a story in preview mode, the response includes:

```json
{
  "generation_details": {
    "story_id": "uuid-of-stored-story",
    "generation_attempts": 1,
    "uniqueness": {
      "is_unique": true,
      "recommendation": "accept",
      "highest_similarity": 0.42,
      "effective_similarity": 0.35,
      "message": "Story is sufficiently unique",
      "most_similar_title": "The Whispering Shadows",
      "most_similar_days_old": 23.5
    }
  }
}
```

## Analytics

### View Story Statistics

```sql
SELECT * FROM get_story_statistics();
```

### View Stories with Age Weights

```sql
SELECT * FROM v_stories_with_weights LIMIT 10;
```

### View Statistics by Preset

```sql
SELECT * FROM v_story_stats;
```

## Migration

Run the migration to set up the tables:

```bash
npx supabase db push
```

Or apply manually:
```bash
npx supabase migration up
```

## Tuning Recommendations

### For High Volume (many stories per day)

- Lower `high_similarity_threshold` to 0.6-0.7
- Increase `max_generation_attempts` to 7-10
- Consider shorter `decay_half_life_days` (14-21 days)

### For Niche Content (fewer unique scenarios)

- Higher `high_similarity_threshold` (0.8-0.85)
- Longer `lookback_days` (120-180 days)
- Accept that some repetition is natural

### For Maximum Uniqueness

- Low `high_similarity_threshold` (0.5)
- Very long `lookback_days` (365 days)
- High `max_generation_attempts` (10)
- Be aware this may slow generation significantly

---

## Write Path Contract

This section defines **when and where** DNA tables must be written. This is critical for understanding why tables might be empty.

### Generation Flows Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TWO GENERATION FLOWS                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FLOW A: Manual Generation (create.html)                           │
│  ─────────────────────────────────────────                         │
│  User → create.html → api.js::runPreviewMode(jobId)                │
│       → run-job Edge Function (preview_only=true)                  │
│       → phases.ts::runPreviewMode()                                │
│       → openai.ts::generateStoryWithDNA()                          │
│       → ✅ storeDNA() + ✅ storeVisualDNA()                         │
│       → Return to UI (user reviews story)                          │
│       → [Later] User clicks "Approve" → Images phase → Assemble    │
│                                                                     │
│  FLOW B: Worker/Campaign Generation                                 │
│  ─────────────────────────────────────                             │
│  auto-poster worker → create-job → run-job (full, no preview_only) │
│       → phases.ts::runPreviewMode() (same as Flow A)               │
│       → ✅ storeDNA() + ✅ storeVisualDNA()                         │
│       → Continue automatically to Audio → Images → Assemble        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### DNA Write Responsibility Matrix

| Table | When Written | Written By | Failure Behavior |
|-------|--------------|------------|------------------|
| `stories` | After story text generated (legacy flow only) | `stories.ts::storeAndAnalyzeStory()` | Log error, continue |
| `story_dna` | During `generateStoryWithDNA()` | `story_dna.ts::storeDNA()` | Log error, **throw** (stops job) |
| `visual_dna` | Immediately after story_dna stored | `visual_dna.ts::storeVisualDNA()` | Log error, **throw** (stops job) |
| `story_dna_component_frequency` | Derived view (not direct insert) | Database view | N/A |
| `story_dna_concept_usage` | Derived view (not direct insert) | Database view | N/A |

### Key Invariants

1. **DNA Written at Story Accept Time**: Both `story_dna` and `visual_dna` are written during `generateStoryWithDNA()`, which is called by `runPreviewMode()`. This happens:
   - For manual flow: When user clicks "Generate" (Step 2: Settings → Story)
   - For worker flow: Automatically when job is picked up

2. **DNA Tables Are Always Paired**: If `story_dna` exists, `visual_dna` should exist (they're written in sequence with the same `story_dna_id` FK).

3. **Preview vs Full Mode**: Both modes call the same DNA generation path. The difference is whether subsequent phases (images, audio, assemble) run automatically.

4. **Rejected Stories**: By default, **only accepted stories have their DNA stored**. If story generation fails before reaching `storeDNA()`, no DNA record is created. This is intentional—we don't track failed attempts in DNA tables.

### Code Path Reference

```typescript
// openai.ts - Around line 1095-1110
// This is where DNA storage happens

// Step 10: Store both DNAs for tracking
try {
    await storeDNA(supabase, dna, undefined, jobId);
    console.log(`[STORY-DNA] Story DNA stored successfully`);
} catch (e) {
    console.error(`[STORY-DNA] Failed to store Story DNA:`, e);
    // NOTE: Error is caught but NOT re-thrown in current code
    // This is a BUG - DNA storage failures should halt the job
}

try {
    await storeVisualDNA(supabase, visualDNA);
    console.log(`[VISUAL-DNA] Visual DNA stored successfully`);
} catch (e) {
    console.error(`[VISUAL-DNA] Failed to store Visual DNA:`, e);
    // NOTE: Same issue - silently swallowed
}
```

---

## Expected Empty Tables

Not all tables in the uniqueness/DNA system are populated during normal story generation. Some require separate aggregation jobs.

### Immediately Populated (Should NOT Be Empty If Stories Exist)

| Table | Expected State | Populator |
|-------|----------------|-----------|
| `stories` | Populated (legacy flow) or empty (DNA flow) | `storeAndAnalyzeStory()` |
| `story_dna` | **Must have rows if DNA generation is working** | `storeDNA()` |
| `visual_dna` | **Must have rows if story_dna has rows** | `storeVisualDNA()` |

### Aggregation/Cache Tables (Expected Empty Until Aggregator Exists)

| Table | Expected State | Required Aggregator | Priority |
|-------|----------------|---------------------|----------|
| `story_dna_daily_stats` | Empty | Daily rollup cron job | Low |
| `story_dna_component_frequency` | View (auto-populated) | N/A - it's a view | N/A |
| `story_dna_concept_usage` | View (auto-populated) | N/A - it's a view | N/A |
| `story_similarity_cache` | Empty | Optional pre-compute job | Low |
| `time_slot_scores` | Empty | Analytics worker | Medium |

### Brand-Related Tables (Expected Empty Until Feature Enabled)

| Table | Expected State | Reason |
|-------|----------------|--------|
| `brand_templates` | Empty | Feature not yet implemented (see DB Option 1 plan) |
| `brand_credentials` | Empty or partial | Only populated via connections.html OAuth flow |

---

## Diagnosis Checklist: Empty DNA Tables

If `story_dna` and `visual_dna` are empty but `stories` or `jobs` have data, use this checklist:

### 1. Check Generation Flow

**Question**: Are stories being generated via DNA path or legacy path?

```sql
-- Check if jobs exist with story_text (generation happened)
SELECT id, status, title, created_at, 
       meta->>'generation_method' as gen_method
FROM jobs 
WHERE story_text IS NOT NULL 
ORDER BY created_at DESC 
LIMIT 10;
```

- If `gen_method = 'dna_contract'` or `'dna_fresh'`: DNA path was used, should have DNA records
- If `gen_method IS NULL`: Likely legacy path, DNA tables expected empty

### 2. Check for RLS/Permission Issues

```sql
-- Run as service role to bypass RLS
-- Check if story_dna has any rows at all
SELECT COUNT(*) as total_dna FROM story_dna;

-- Check if visual_dna has any rows
SELECT COUNT(*) as total_visual FROM visual_dna;

-- Check RLS policies
SELECT tablename, policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename IN ('story_dna', 'visual_dna');
```

**Common Issue**: If Edge Functions aren't using `service_role` key, RLS may block inserts.

### 3. Check for Schema Mismatch

```sql
-- Get actual column names in story_dna
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'story_dna'
ORDER BY ordinal_position;
```

Compare against what `storeDNA()` is trying to insert. Schema drift can cause silent failures.

### 4. Check Edge Function Logs

Look for these log patterns in Supabase Dashboard → Edge Functions → Logs:

| Log Pattern | Meaning |
|-------------|---------|
| `[STORY-DNA] Story DNA stored successfully` | ✅ DNA insert succeeded |
| `[STORY-DNA] Failed to store Story DNA:` | ❌ DNA insert failed - check error |
| `[VISUAL-DNA] Visual DNA stored successfully` | ✅ Visual DNA insert succeeded |
| `[VISUAL-DNA] Failed to store Visual DNA:` | ❌ Visual DNA insert failed |
| `[DNA] Error storing DNA:` | ❌ Lower-level storage error |

### 5. Verify Foreign Key Constraint

```sql
-- visual_dna requires story_dna_id FK
-- If story_dna insert fails, visual_dna insert will also fail
SELECT 
  (SELECT COUNT(*) FROM story_dna) as story_dna_count,
  (SELECT COUNT(*) FROM visual_dna) as visual_dna_count;
```

If `story_dna_count = 0` but `visual_dna_count > 0`, something is very wrong.

### 6. Test Insert Manually

```sql
-- Test if inserts work (use realistic data)
INSERT INTO story_dna (
    id, concept_hash, full_hash, genre,
    era_id, era_label, location_id, location_label,
    specific_states, subgenre_id, authority_id,
    narrative_artifact_id, narrative_artifact_label,
    threat_behavior_id, threat_behavior_description,
    threat_manifestation_id, threat_manifestation_description,
    repeating_detail_id, repeating_detail_description,
    weird_axis_id, weird_axis_description,
    escalation_id,
    ending_knowledge_id, ending_knowledge_description,
    ending_imagery_id, ending_imagery_description,
    emotion_id, generation_attempt, job_id, created_at
) VALUES (
    gen_random_uuid(), 'test_hash', 'test_full', 'urban_legend',
    'test_era', 'Test Era', 'test_loc', 'Test Location',
    ARRAY['CA'], 'test_sub', 'test_auth',
    'test_artifact', 'Test Artifact',
    'test_behav', 'Test behavior',
    'test_manif', 'Test manifestation',
    'test_repeat', 'Test repeating detail',
    'test_weird', 'Test weird axis',
    'test_esc',
    'test_end_know', 'Test ending knowledge',
    'test_end_img', 'Test ending imagery',
    'test_emotion', 1, NULL, NOW()
);

-- If this fails, you'll see the actual error
```

---

## Failure Visibility Requirements

**Rule: Never Fail Silently**

All DNA storage operations must log structured errors that include:

### Required Log Fields on Failure

```typescript
// REQUIRED logging pattern for DNA storage failures
console.error(`[DNA-STORAGE-FAILURE] {
    "table": "story_dna" | "visual_dna",
    "job_id": "${jobId}",
    "story_dna_id": "${dna.dna_id}",
    "error_code": "${error.code}",
    "error_message": "${error.message}",
    "error_details": ${JSON.stringify(error.details)},
    "timestamp": "${new Date().toISOString()}"
}`);
```

### Recommended Behavior on DNA Storage Failure

| Failure Type | Current Behavior | Recommended Behavior |
|--------------|------------------|----------------------|
| `story_dna` insert fails | Log + continue | Log + **throw** (halt job) |
| `visual_dna` insert fails | Log + continue | Log + **throw** (halt job) |
| RLS permission denied | Silent 403 | Log with `error_code: 'PERMISSION_DENIED'` + throw |
| FK constraint violation | Silent failure | Log with FK details + throw |

### Why Throw on DNA Failure?

1. **Data Integrity**: If DNA isn't stored, the uniqueness system can't prevent duplicates
2. **Debugging**: Failed jobs are easier to diagnose than jobs that "succeeded" with missing data
3. **Alerting**: Thrown errors trigger Edge Function error metrics, making issues visible
4. **Retry Path**: Failed jobs can be retried; "successful" jobs with missing DNA cannot

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Theme bucket guidance | ✅ Implemented | 6 buckets, lowest-overlap selection |
| Story DNA generation | ✅ Implemented | `story_dna.ts::generateStoryDNA()` |
| Visual DNA derivation | ✅ Implemented | `visual_dna.ts::deriveVisualDNA()` |
| DNA storage | ⚠️ Partial | Inserts exist but errors may be swallowed |
| Failure logging | ⚠️ Partial | Logs exist but not structured/alertable |
| Aggregation views | ✅ Implemented | `story_dna_component_frequency` is a view |
| Daily rollup job | ❌ Not implemented | `story_dna_daily_stats` always empty |
| Similarity cache | ❌ Not implemented | `story_similarity_cache` always empty |
