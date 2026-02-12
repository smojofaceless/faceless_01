# Image & Story Generation Pipeline

> **Document Version:** 1.0  
> **Last Updated:** February 11, 2026  
> **Architecture:** worker-v1 (10-step pipeline)  
> **Status:** Production

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Step 1: Story Generation](#step-1-story-generation)
4. [Step 2: Uniqueness Check](#step-2-uniqueness-check)
5. [Step 3: Scene Splitting](#step-3-scene-splitting)
6. [Step 4: Voice Synthesis](#step-4-voice-synthesis)
7. [Step 5: Music Selection](#step-5-music-selection)
8. [Step 6: Image Generation](#step-6-image-generation)
9. [Step 7: Subtitles](#step-7-subtitles)
10. [Step 8: Assembly](#step-8-assembly)
11. [Step 9: Upload](#step-9-upload)
12. [Step 10: Schedule](#step-10-schedule)
13. [Voice-Aligned Scene Transitions](#voice-aligned-scene-transitions)
14. [Multi-Image Long Scenes](#multi-image-long-scenes)
15. [Mood Levels & Ken Burns](#mood-levels--ken-burns)
16. [Climax Awareness](#climax-awareness)
17. [Micro-Scene Merge](#micro-scene-merge)
18. [Story Anchor System](#story-anchor-system)
19. [Visual Cue Extraction](#visual-cue-extraction)
20. [Image Prompt Assembly](#image-prompt-assembly)
21. [Image Sequence Manifest](#image-sequence-manifest)
22. [Data Flow & Storage](#data-flow--storage)
23. [Idempotency & Continuation](#idempotency--continuation)
24. [Cost Controls](#cost-controls)
25. [Common Failure Points](#common-failure-points)
26. [Debugging Guide](#debugging-guide)

---

## Pipeline Overview

The **worker-v1** pipeline processes each video as a single job with 10 sequential steps. Each step is idempotent — if the worker is interrupted, it can resume from the last incomplete step.

| # | Step | Function | External API | Cost | Output |
|---|------|----------|-------------|------|--------|
| 1 | `story` | `executeStoryStep()` | OpenAI GPT-4o | ~$0.01 | Story text + title |
| 2 | `uniqueness` | `executeUniquenessStep()` | None (DB) | Free | Uniqueness score |
| 3 | `scenes` | `executeScenesStep()` | None (local) | Free | Scene array with timing |
| 4 | `voice` | `executeVoiceStep()` | ElevenLabs TTS | ~$0.05 | Narration MP3 + timestamps |
| 5 | `music` | `executeMusicStep()` | None (DB) | Free | Music track selection |
| 6 | `images` | `executeImagesStep()` | OpenAI gpt-image-1 | ~$0.20-0.50 | Scene images + manifest |
| 7 | `subtitles` | `executeSubtitlesStep()` | None (local) | Free | SRT file |
| 8 | `assemble` | `executeAssembleStep()` | FFmpeg renderer | ~$0.00 | Final MP4 video |
| 9 | `upload` | `executeUploadStep()` | Supabase Storage | Free | Public URL |
| 10 | `schedule` | `executeScheduleStep()` | Supabase RPC | Free | Post queue entry |

**Total cost per video:** ~$0.25–0.60 depending on scene count and image model.

---

## Architecture Diagram

```
                    ┌──────────────┐
                    │ schedule-jobs│  (cron: every 5 min)
                    │  function    │
                    └──────┬───────┘
                           │ POST /worker-v1 { job_id }
                           ▼
                    ┌──────────────┐
                    │  worker-v1   │  (Deno Edge Function, 400s wall-clock)
                    │  index.ts    │
                    └──────┬───────┘
                           │ claim_job RPC (atomic lock)
                           │ Returns HTTP 202 immediately
                           │ EdgeRuntime.waitUntil() for background processing
                           ▼
                 ┌─────────────────────┐
                 │    Step Loop        │
                 │                     │
                 │  for step in ORDER: │
                 │    skip if complete │
                 │    heartbeat()      │
                 │    execute step     │
                 │    mark complete    │
                 └─────────┬───────────┘
                           │
          ┌────────────────┼────────────────────┐
          │                │                    │
          ▼                ▼                    ▼
    ┌──────────┐    ┌──────────┐         ┌──────────┐
    │  OpenAI  │    │ElevenLabs│         │  FFmpeg  │
    │  GPT-4o  │    │   TTS    │         │ Renderer │
    │gpt-image-1│   │          │         │ (Docker) │
    └──────────┘    └──────────┘         └──────────┘
```

---

## Step 1: Story Generation

**Function:** `executeStoryStep()`  
**Model:** OpenAI GPT-4o  
**Temperature:** 0.9  
**Max Tokens:** 2000  
**Response Format:** JSON `{ "title": "...", "story": "..." }`

### Word Count Targeting

The story length is calibrated to the target video duration:

```
wordCount = duration × 2.5 words/second
range = wordCount ± 15%
```

For a 60s video: target 150 words (128–173 range).

### Vibe Presets

The system prompt adapts based on the job's `vibe_preset`:

| Preset | Theme Description |
|--------|-------------------|
| `urban_legend` | Urban legend, folklore, unexplained phenomena |
| `one_too_many` | Counting horror — extra person in group, VARIED settings |
| `backrooms` | Liminal spaces, reality glitches, impossible architecture |
| `nosleep` | First-person creepypasta, mundane → terrifying |
| `glitch` | Glitch in the matrix, déjà vu, NPCs acting weird |

### System Prompt

For `one_too_many`: Uses `getStorySystemPrompt('one_too_many')` — flexible narrative voice (any POV). Prompt built by `buildOneToManyPrompt(wordRange)` with randomized trope packs (18 containers, 11 evidence sources, 10 glitches, 8 witnesses, 8 group types, 5 group sizes, 6 dialogue lines) and 8-dimension storytelling toolkit.

For all other presets: Standard first-person narration system prompt. Built by `buildStoryPrompt(vibePreset, wordRange)`.

Both paths include thematic avoidance from recent stories (last 20, same preset) to prevent repetition.

### Outputs

- `jobs.title` — Story title  
- `jobs.story_text` — Full story text  
- `jobs.story_word_count` — Actual word count  
- Snapshot log: `story prompt` (records full prompt for debugging)  
- Snapshot log: `Generated story` (records preview + word count)

---

## Step 2: Uniqueness Check

**Function:** `executeUniquenessStep()`  
**External API:** None (Supabase queries)

Compares the new story against all previous stories for the same brand using the `story_dna` table. Calculates a uniqueness percentage based on structural similarity (themes, settings, plot patterns).

### Outputs

- `jobs.uniqueness_score` — Percentage (0–100)  
- `jobs.meta.steps.uniqueness` — Detailed comparison data

---

## Step 3: Scene Splitting

**Function:** `executeScenesStep()`  
**External API:** None (purely local algorithm)

### Algorithm

1. **Sentence splitting:** Split story text using `/(?<=[.!?])\s+/`
2. **Clause splitting:** If fewer sentences than `sceneCount`, split on commas, semicolons, dashes, "and", "but", "when", "as", "while", "then"
3. **Even distribution:** Distribute text chunks across target scene count
4. **Word-proportional timing:** Each scene's duration is proportional to its word count:
   ```
   minSceneDuration = 1.5s
   flexibleTime = totalDuration - (sceneCount × minSceneDuration)
   sceneDuration = minSceneDuration + flexibleTime × (sceneWords / totalWords)
   ```
5. **Last scene extension:** Last scene always extends to fill `totalDuration` exactly
6. **Micro-scene merge:** Any scene < 3s merges into its neighbor (see [Micro-Scene Merge](#micro-scene-merge))

### Scene Count Source

- Primary: `job.meta.scene_count` (from UI pace presets + platform clamps)
- Fallback: `Math.max(12, Math.min(24, Math.round(duration / 2.5)))`

### Output Format

Each scene has:
```typescript
{
  index: number;       // 0-based
  text: string;        // Narration text for this scene
  startTime: number;   // Start time in seconds
  endTime: number;     // End time in seconds
  keywords: string[];  // Extracted keywords (max 5)
}
```

### Storage

- Job asset: `{job_id}:scenes_subtitles` (type: `scene_data`)
- Asset meta: `{ scenes: Scene[] }`

---

## Step 4: Voice Synthesis

**Function:** `executeVoiceStep()`  
**API:** ElevenLabs TTS with timestamps  
**Endpoint:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps`

### Configuration

| Parameter | Value |
|-----------|-------|
| Voice ID | `pNInz6obpgDQGcFmaJgB` (Adam) |
| Model | `eleven_turbo_v2_5` |
| Stability | 0.5 |
| Similarity Boost | 0.75 |
| Output Format | MP3 |

### Process

1. Hash input parameters (`voice_id|model|stability|similarity|text`) for billing protection
2. Check for existing asset with same hash → skip API call if found
3. Call ElevenLabs with `with-timestamps` endpoint
4. Receive base64 audio + character-level timestamps
5. Parse character timestamps into word-level timestamps
6. Upload audio to `brands/{brand_id}/jobs/{job_id}/audio/narration.mp3`
7. Store word timestamps in `job.meta.audio_timestamps`

### Word Timestamps Format

```typescript
{
  word: string;   // The spoken word
  start: number;  // Start time in seconds
  end: number;    // End time in seconds
}
```

These timestamps are critical for [Voice-Aligned Scene Transitions](#voice-aligned-scene-transitions).

### Outputs

- Supabase Storage: `narration.mp3`
- Job asset: `{job_id}:voice_narration`
- `job.meta.audio_timestamps` — Word-level timing array
- `job.meta.audio_duration` — Total audio duration in seconds

---

## Step 5: Music Selection

**Function:** `executeMusicStep()`  
**External API:** None (DB-driven selection)

Selects a background music track from the brand's `music_tracks` table using deterministic hash-based selection. Configures ducking, fade in/out, and volume based on brand settings.

### Outputs

- Job asset: `{job_id}:music_track`
- `job.meta.music_config` — `{ track_id, volume, ducking, fade_in_ms, fade_out_ms, loopable }`

---

## Step 6: Image Generation

**Function:** `executeImagesStep()`  
**Model:** OpenAI gpt-image-1 (default)  
**Size:** 1024×1536 (portrait)  
**Quality:** low  
**Output Format:** WebP

This is the most complex step and the most expensive. It orchestrates:

1. **Story Anchor creation** (see [Story Anchor System](#story-anchor-system))
2. **Visual Cue extraction** (see [Visual Cue Extraction](#visual-cue-extraction))
3. **Voice alignment** (see [Voice-Aligned Scene Transitions](#voice-aligned-scene-transitions))
4. **Image sequence planning** (see [Multi-Image Long Scenes](#multi-image-long-scenes))
5. **Mood level computation** (see [Mood Levels & Ken Burns](#mood-levels--ken-burns))
6. **Per-scene image generation** with prompt assembly
7. **Image sequence manifest** saved to `job.meta.image_sequence`

### Model Selection

| Model | Size | Quality | Cost/Image | Notes |
|-------|------|---------|-----------|-------|
| `gpt-image-1` | 1024×1536 | low | ~$0.016 | Default, best value |
| `dall-e-3` | 1024×1792 | standard | ~$0.040 | Higher quality |
| `dall-e-2` | 1024×1024 | n/a | ~$0.020 | Square only |

### Time Budget Management

The images step tracks wall-clock time carefully:
- `WALL_CLOCK_BUDGET_MS = 340,000` (340s, leaving 60s buffer)
- `IMAGE_RESERVE_MS = 30,000` (30s per remaining image)
- If time runs out → saves progress, sets `continuation_needed = true`
- Worker self-invokes to continue from where it left off

### Outputs

- Supabase Storage: `brands/{brand_id}/jobs/{job_id}/images/scene_000.png` (per scene)
- Job assets: `{job_id}:image_generate_scene_{index}` (per image)
- Job asset: `{job_id}:visual_cues` — Cached visual cues
- Job asset: `{job_id}:story_anchor` — Cached story anchor
- `job.meta.image_sequence` — [Image Sequence Manifest](#image-sequence-manifest)

---

## Step 7: Subtitles

**Function:** `executeSubtitlesStep()`  
**External API:** None (SRT generation from word timestamps)

Generates SRT subtitle file from the word-level timestamps stored in `job.meta.audio_timestamps`. Groups words into subtitle segments based on timing gaps and word count limits.

### Outputs

- Supabase Storage: `brands/{brand_id}/jobs/{job_id}/subtitles/captions.srt`
- Job asset: `{job_id}:subtitle_srt`

---

## Step 8: Assembly

**Function:** `executeAssembleStep()`  
**Renderer:** FFmpeg video renderer (Docker container)

### Payload Structure

```typescript
{
  job_id: string;
  images: string[];           // Ordered image URLs
  audio_url: string;          // Narration MP3 URL
  durations: number[];        // Per-image display duration (from image_sequence)
  captions: WordTimestamp[];   // Word-level timestamps for subtitles
  effects: {
    kenBurns: boolean;
    fadeTransitions: boolean;
    fadeIn: boolean;
    fadeOut: boolean;
    filmGrain: boolean;       // false when Controlled Motion is active
    vignette: boolean;        // false when Controlled Motion is active
    horrorGrade: boolean;     // false when Controlled Motion is active
    captionStyle: string;
  };
  effects_config: EffectsConfig | null;  // Controlled Motion (overrides legacy booleans)
  music_url: string | null;
  music_volume: number;        // 0-100
  music_config: {
    ducking: boolean;
    fade: { in_ms: number; out_ms: number };
    loopable: boolean;
  };
  mood_levels: number[];       // Per-image mood intensity (1-10)
  low_memory: true;
}
```

### Critical: Per-Scene Durations

As of Feb 11, 2026, the assembler reads the **image_sequence manifest** from `job.meta.image_sequence` to get real per-image durations. Previously, durations were uniformly distributed (`audioDuration / imageCount`), which erased word-proportional timing. Now each image's display duration matches its scene's voice-aligned timing.

### Retry Logic

- HTTP 503 (renderer busy): Up to 4 retries with `retry-after` header wait
- Polling: 5s intervals, up to 150-180s (smart timeout based on remaining wall-clock)
- HTTP 200 with `status: "processing"`: Continue polling

### Outputs

- Supabase Storage: `brands/{brand_id}/jobs/{job_id}/video/assembled.mp4`
- Job asset: `{job_id}:assemble_video`

---

## Step 9: Upload

**Function:** `executeUploadStep()`  
Copies the assembled video to the final path and updates `jobs.video_url`.

### Outputs

- Supabase Storage: `brands/{brand_id}/jobs/{job_id}/video/final.mp4`
- `jobs.video_url` — Public URL for the final video

---

## Step 10: Schedule

**Function:** `executeScheduleStep()`  
Creates a post queue entry for automated publishing.

### Outputs

- `posts_queue` table entry with `post_at`, `platform`, `status: 'pending'`

---

## Voice-Aligned Scene Transitions

**Added:** February 11, 2026

The `alignScenesToVoice()` function synchronizes scene transitions with actual spoken word timing from ElevenLabs timestamps.

### Algorithm

1. Normalize words (lowercase, strip non-alphanumeric except apostrophes)
2. Walk through scene words and voice timestamp words sequentially
3. For each scene word, look ahead up to 5 positions in voice words for fuzzy matching
4. Record the voice timestamp range (start of first matched word → end of last matched word)
5. Minimum scene duration enforced: 0.5s
6. Last scene extends to cover total audio duration (captures trailing silence)

### Why This Matters

Before voice alignment, scene timing was purely mathematical (word-proportional). The actual spoken timing from ElevenLabs TTS may differ because:
- Some words take longer to speak than others
- The TTS model inserts pauses for punctuation
- Emphasis and pacing vary

Voice alignment ensures the image changes exactly when the narration moves to the next scene.

### Fallback

If no `audio_timestamps` are available (e.g., voice step was skipped), the original word-proportional timing is preserved.

---

## Multi-Image Long Scenes

**Added:** February 11, 2026

Scenes longer than 10 seconds receive multiple images to maintain visual engagement.

### Thresholds

```
LONG_SCENE_THRESHOLD = 10s
TARGET_IMAGE_DURATION = 8s
MAX_IMAGES_PER_SCENE = 3
```

### Algorithm

```
if sceneDuration ≤ 10s → 1 image (duration = sceneDuration)
if sceneDuration > 10s → min(3, ceil(sceneDuration / 8)) images
    sub-duration = sceneDuration / imageCount
```

### Sub-Image Variations

Multi-image scenes use different camera perspectives for visual variety:
- Sub 1: "from a different angle"
- Sub 2: "focusing on a different detail"
- Sub 3: "from a closer perspective"

The last sub-image in a long scene gets `moodLevel + 1` for slight tension escalation.

### Data Model

```typescript
interface ImageSequenceEntry {
  sceneIndex: number;     // Original scene index
  subIndex: number;       // 0 for first/only image, 1+ for multi-image
  duration: number;       // Seconds this image displays
  moodLevel: number;      // Ken Burns mood intensity (1-10)
  assetKey: string;       // Asset idempotency key
  url?: string;           // Resolved public URL (populated at end)
}
```

---

## Mood Levels & Ken Burns

**Added:** February 11, 2026

Each image receives a **mood level** (1–10) that controls the intensity of Ken Burns camera movement during assembly.

### Computation: `computeMoodLevel()`

```
Base mood = 3 + (sceneProgress × 5)       # Escalates from 3→8 across video
```

**Adjustments by scene type and camera:**

| Condition | Effect |
|-----------|--------|
| `isClimax: true` | `baseMood + 3` (capped at 10) |
| `establishing` or `wide` | `mood - 1` (min 2) |
| `object` + `close-up` | capped at 6 |
| `atmosphere` | `mood + 1` (max 8) |
| `group` | capped at 7 |
| `character` + `close-up` | `mood + 1` (max 8) |
| `pov` | `mood + 2` (max 9) |

### Ken Burns Behavior

| Mood Range | Style | Description |
|------------|-------|-------------|
| 1–6 | Gentle | Classic slow zoom (in or out) |
| 7–10 | Cinematic | Pan, sweep, diagonal movement |

The FFmpeg renderer reads the `mood_levels` array from the assembly payload and applies per-image Ken Burns parameters accordingly.

---

## Climax Awareness

**Added:** February 11, 2026

The visual cue extraction prompt now instructs GPT to mark the last 1–2 scenes as climax moments:

> "The last 1–2 scenes MUST depict the story's most powerful, disturbing, or dramatic visual moment. Mark these with `isClimax: true`."

Climax scenes receive:
- `isClimax: true` in their visual cue
- Boosted mood level (`baseMood + 3`, max 10) → more dramatic Ken Burns
- Priority for the most impactful visual description

---

## Micro-Scene Merge

**Added:** February 11, 2026

After initial scene splitting, any scene shorter than 3 seconds is merged into its neighbor to prevent jarring rapid cuts.

### Algorithm

```
MIN_SCENE_DURATION = 3.0s

while any scene < 3s:
    find short scene
    merge with next neighbor (or previous if last scene)
    combine text, extend time range, dedupe keywords (max 5)
    re-index all scenes
    loop until stable
```

### Constraints

- Minimum 2 scenes preserved (never merge down to 1)
- Merge loop repeats until no scene is under 3s

---

## Story Anchor System

The **Story Anchor** is a "visual bible" that ensures all generated images maintain visual consistency across the entire video.

### Creation

**Model:** GPT-4o-mini (temperature 0.5, max_tokens 1000, JSON mode)

**Input:** Art style, environment guide, vibe preset, and first 1500 characters of story.

### Interface

```typescript
interface StoryAnchor {
  environment: string;           // Primary setting description
  characterDescription: string | null;  // Main character if present
  recurringMotifs: string;       // Visual elements that repeat
  horrorTone: string;            // Overall horror atmosphere
  timeOfDay: string;             // Lighting context
  isGroupStory: boolean;         // Whether multiple people appear
  groupCount: number | null;     // Expected count BEFORE the extra person
}
```

### Critical for "One Too Many"

For the `one_too_many` vibe preset, `groupCount` represents the NORMAL count of people BEFORE the extra person is noticed. This is essential for the counting horror reveal:

- **Before reveal (first 65% of scenes):** Show `groupCount` people, everyone normal
- **After reveal (last 35% of scenes):** Show `groupCount + 1` people, one subtly wrong

### Caching

Stored as job asset `{job_id}:story_anchor` for continuation invocations (if worker times out and resumes, the same anchor is reused).

---

## Visual Cue Extraction

Visual cues are per-scene directives that guide image generation. Extracted in batch for all scenes simultaneously.

### Model

GPT-4o-mini (temperature 0.7, max_tokens 4000, JSON mode)

### Interface

```typescript
interface VisualCue {
  sceneIndex: number;       // Which scene
  description: string;      // What the IMAGE should depict
  sceneType: string;        // establishing | object | atmosphere | character | group
  camera: string;           // wide | medium | close-up | extreme-close-up | overhead | low-angle | pov
  isClimax?: boolean;       // true for the most dramatic scene(s)
}
```

### Prompt Rules

The visual cue prompt includes preset-specific constraints:

**For `one_too_many`:**
- Before the 65% mark: Show expected `groupCount`, everyone normal
- After the 65% mark: Show `groupCount + 1`, one person subtly wrong

**For `backrooms`:**
- Avoid humans entirely
- Focus on empty impossible architecture
- Prefer POV shots

**Variety mandate (all presets):**
- Max 2 group scenes
- At least 2 object/atmosphere scenes
- At least 1 close-up
- At least 1 overhead/low-angle/pov

**Climax rule:**
- Last 1–2 scenes must show the story's most powerful visual
- Mark with `isClimax: true`

### Caching

Stored as job asset `{job_id}:visual_cues` → `meta.cues: VisualCue[]`

---

## Image Prompt Assembly

The function `buildImagePrompt()` constructs the full DALL-E prompt for each scene. Two paths exist:

### DB-Driven Path (Primary)

When an `ImagePromptConfig` is available from the brand's configuration:

```
Scene Description: {visualCue.description}
Narration Context: "{scene.text}" (first 120 chars)
Art Style: {config.art_style}
Environment: {storyAnchor.environment} (overrides config.environment)
Mood: {config.mood} — Tension Level {3-10 escalation} of 10
Camera Angle: {visualCue.camera}
Lighting: {config.lighting}
Color Palette: {config.color_palette}
Character Block: {storyAnchor.characterDescription or group rules}
Recurring Motifs: {storyAnchor.recurringMotifs}
Negative: {config.negative_prompt}
Suffix: {config.suffix}
```

**Group count enforcement:** For `one_too_many`, the character block explicitly states "exactly N people" or "exactly N+1 people" depending on whether the scene is before/after the reveal point.

**Tension escalation:** Mood intensity scales from 3 to 10 across all scenes. The tension level is included in the prompt: "subtle unease" (3-4), "growing dread" (5-6), "full horror" (7-8), "nightmarish climax" (9-10).

### Legacy Fallback Path

Uses hardcoded style templates (`cinematic-dark`, `analog-horror`, `uncanny-illustrated`) with visual preset environment hints and keywords.

---

## Image Sequence Manifest

After all images are generated, the images step saves an **image sequence manifest** to `job.meta.image_sequence`. This is the authoritative source for per-image display timing during assembly.

### Structure

```typescript
ImageSequenceEntry[] = [
  {
    sceneIndex: 0,
    subIndex: 0,
    duration: 4.235,      // Seconds
    moodLevel: 3,         // Ken Burns intensity
    assetKey: "abc123:image_generate_scene_000",
    url: "https://...scene_000.png"
  },
  {
    sceneIndex: 1,
    subIndex: 0,
    duration: 3.891,
    moodLevel: 4,
    assetKey: "abc123:image_generate_scene_001",
    url: "https://...scene_001.png"
  },
  // For a long scene (>10s) with 2 images:
  {
    sceneIndex: 5,
    subIndex: 0,
    duration: 6.5,
    moodLevel: 6,
    assetKey: "abc123:image_generate_scene_005_0",
    url: "https://...scene_005_0.png"
  },
  {
    sceneIndex: 5,
    subIndex: 1,
    duration: 6.5,
    moodLevel: 7,         // +1 for last sub-image
    assetKey: "abc123:image_generate_scene_005_1",
    url: "https://...scene_005_1.png"
  }
]
```

### How Assembly Uses It

The assembler reads `job.meta.image_sequence` and:
1. Extracts `durations[]` array → per-image display times (replaces uniform distribution)
2. Extracts `mood_levels[]` array → per-image Ken Burns intensity
3. Extracts `url[]` in order → image URLs

This ensures each scene's image displays for exactly the time the narrator speaks its text.

---

## Data Flow & Storage

### Supabase Storage Paths

```
brands/{brand_id}/jobs/{job_id}/
├── audio/
│   ├── narration.mp3          # Voice narration
│   └── music.mp3              # Background music (copied)
├── images/
│   ├── scene_000.png          # Single-image scenes
│   ├── scene_001.png
│   ├── scene_005_0.png        # Multi-image scene (sub 0)
│   └── scene_005_1.png        # Multi-image scene (sub 1)
├── subtitles/
│   └── captions.srt           # Generated SRT
└── video/
    ├── assembled.mp4          # Raw assembled video
    └── final.mp4              # Final uploaded video
```

### Job Assets Table (`job_assets`)

| Key Pattern | Type | Contents |
|-------------|------|----------|
| `{job_id}:story_anchor` | `story_anchor` | `meta.environment`, `meta.characterDescription`, etc. |
| `{job_id}:visual_cues` | `visual_cues` | `meta.cues: VisualCue[]` |
| `{job_id}:scenes_subtitles` | `scene_data` | `meta.scenes: Scene[]` |
| `{job_id}:voice_narration` | `audio` | Storage path + public URL |
| `{job_id}:music_track` | `music` | Track ID + config |
| `{job_id}:image_generate_scene_{N}` | `image` | Storage path + public URL + prompt hash |
| `{job_id}:image_generate_scene_{N}_{sub}` | `image` | Multi-image sub-index |
| `{job_id}:subtitle_srt` | `subtitle` | Storage path |
| `{job_id}:assemble_video` | `video` | Assembled video URL |
| `{job_id}:upload_final` | `final_mp4` | Final video URL |

### Job Meta (`jobs.meta`)

Key fields populated during pipeline:

```typescript
{
  // Configuration (set at job creation)
  duration: number;           // Target video duration in seconds
  scene_count: number;        // Target scene count
  platform: string;           // youtube_shorts | tiktok | reels
  art_style: string;          // cinematic-dark | analog-horror | etc.
  pace: string;               // slow | balanced | fast
  effects_mode: string;       // auto | custom
  vibe_preset: string;        // urban_legend | one_too_many | etc.
  
  // Populated by steps
  audio_timestamps: Array<{word,start,end}>;  // Voice step
  audio_duration: number;                      // Voice step
  music_config: { track_id, volume, ... };    // Music step
  image_sequence: ImageSequenceEntry[];        // Images step
  image_model: string;                         // Images step
  
  // Step tracking
  steps: {
    [stepName]: {
      status: string;
      attempts: number;
      started_at: string;
      completed_at: string;
      last_error: string | null;
    }
  }
}
```

### Job Step Logs (`job_step_logs`)

Every step emits structured logs:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `job_id` | UUID | FK to jobs |
| `step_name` | TEXT | story, scenes, voice, images, etc. |
| `event_type` | TEXT | started, completed, failed, progress, snapshot |
| `message` | TEXT | Human-readable message |
| `meta` | JSONB | Structured data (prompts, configs, results) |
| `created_at` | TIMESTAMP | When logged |
| `attempt` | INTEGER | Which attempt |
| `worker_id` | TEXT | Which worker instance |

---

## Idempotency & Continuation

### Asset-Level Idempotency

Every asset uses an `idempotency_key` (format: `{job_id}:{type}_{detail}`). Before generating an image:

1. Check `getAssetByKey(jobId, key, requireQualityOk=true)` 
2. If found with `quality_ok: true` → skip generation, reuse URL
3. If found with `quality_ok: false` → regenerate
4. If not found → generate new

### Voice Billing Protection

Voice synthesis hashes all input parameters:
```
hash = SHA-256(voice_id|model|stability|similarity|story_text)
```
If an asset with the same hash exists → skip the API call entirely.

### Continuation (Time Budget)

The worker has a 340s wall-clock budget (400s limit minus 60s safety buffer). For the images step:

1. Before each image: check `timeRemaining > IMAGE_RESERVE_MS (30s)`
2. If insufficient time → save all completed images + partial image_sequence
3. Set `continuation_needed = true` in step result
4. Worker releases job as `queued` and self-invokes
5. Next invocation skips completed steps, resumes images from where it left off

---

## Cost Controls

### Per-Job Cost Caps

Each API call is tracked in the `api_usage` table:

| Service | Estimated Cost |
|---------|------|
| `openai_text` (story) | ~$0.01 |
| `openai_text` (anchor + cues) | ~$0.005 |
| `openai_image` (per image) | ~$0.016 (gpt-image-1 low) |
| `elevenlabs` (voice) | ~$0.05 |
| `ffmpeg_renderer` (assembly) | ~$0.00 (self-hosted) |

### Concurrency Slots

- `schedule-jobs` function checks `available_concurrency_slots` before dispatching
- Prevents overloading external APIs
- Configurable per-brand and globally

---

## Common Failure Points

| Failure | Step | Cause | Recovery |
|---------|------|-------|----------|
| OpenAI rate limit (429) | story, images | Too many concurrent requests | Auto-retry with backoff |
| ElevenLabs timeout | voice | Long text, server load | Retry with same hash (billing safe) |
| Renderer 503 | assemble | All renderer instances busy | Up to 4 retries with `retry-after` |
| Wall-clock timeout | images | Too many scenes, slow API | Continuation (self-invoke) |
| Lease lost | any | Worker took too long between heartbeats | Job released, re-claimable |
| Storage upload fail | images, upload | Transient network error | Retry (upsert idempotent) |
| Kill switch active | any | Admin paused all processing | Returns 503, job stays queued |

---

## Debugging Guide

### Inspecting a Job

1. **Campaign Detail Page:** Click a job → step timeline shows status of each step
2. **Step Detail Panel:** Click any step → see configuration, snapshots, outputs
3. **Log Viewer:** Full chronological log with filter by type (snapshot/progress)
4. **Copy Logs:** Use the copy button to export all logs for external analysis

### Reproducing an Image

To regenerate a specific scene's image:

1. Find the job in campaign detail
2. Click the Images step
3. Click the image to see its full prompt
4. Copy the prompt from the detail modal
5. Use the same model + size settings in the OpenAI playground

### Key Snapshot Labels

| Snapshot Message | Step | Contains |
|-----------------|------|----------|
| `story prompt` | story | Full GPT prompt |
| `Generated story` | story | Story preview + word count |
| `Visual cues extracted` | images | Scene types, cameras, descriptions |
| `Image prompt` | images | Per-scene DALL-E prompt |
| `Image sequence planned` | images | Full manifest with durations |
| `Assembly payload` | assemble | Renderer request payload |
| `Assembly output` | assemble | Video URL + render stats |

### Database Queries for Debugging

```sql
-- Get all logs for a job
SELECT * FROM job_step_logs 
WHERE job_id = 'xxx' 
ORDER BY created_at;

-- Get image sequence manifest
SELECT meta->'image_sequence' 
FROM jobs WHERE id = 'xxx';

-- Get visual cues
SELECT meta->'cues' 
FROM job_assets 
WHERE job_id = 'xxx' AND idempotency_key LIKE '%visual_cues';

-- Get story anchor
SELECT meta 
FROM job_assets 
WHERE job_id = 'xxx' AND idempotency_key LIKE '%story_anchor';

-- Check asset quality flags
SELECT idempotency_key, meta->>'quality_ok', meta->>'quality_reason'
FROM job_assets 
WHERE job_id = 'xxx' AND type = 'image';
```

---

## Changelog

| Date | Changes |
|------|---------|
| Feb 11, 2026 | **v1.0** — Initial comprehensive pipeline documentation. Covers all 10 steps, voice alignment, multi-image scenes, mood levels, climax awareness, micro-scene merge, image sequence manifest. |
