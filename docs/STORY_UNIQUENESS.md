# Story Storage & Uniqueness System

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
