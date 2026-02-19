# Story Profile System v1.0

> **Last Updated:** February 22, 2026

A brand-agnostic narrative enforcement system for story generation. This system mirrors the Effects Profile system but controls narrative structure, motif recurrence, voice format compliance, and closure behavior.

## Overview

The Story Profile system ensures generated stories adhere to structural contracts, not just loose suggestions. It works across all content niches (horror, food, finance, motivation, etc.) with niche-specific presets.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MERGE CHAIN                                  │
├─────────────────────────────────────────────────────────────────┤
│  System Defaults  (brand-agnostic baseline)                      │
│       ↓                                                          │
│  Template Defaults (by niche: horror, food, finance, etc.)       │
│       ↓                                                          │
│  Preset Profiles  (by vibe: urban_legend, one_too_many, etc.)        │
│       ↓                                                          │
│  Brand Overrides  (from brand.settings.storyProfile)             │
│       ↓                                                          │
│  User Overrides   (from job request story_profile)               │
│       ↓                                                          │
│  Sanitized Profile (clamped, validated, fail-soft)               │
└─────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `story_profile.ts` | Profile types, defaults, presets, resolution, sanitization |
| `story_contract.ts` | Prompt builder, beat tags, compliance checker, post-processor |

## Profile Structure

```typescript
interface StoryProfile {
  version: string;           // "1.0"
  schema_version: number;    // 1
  profile_name?: string;     // e.g., "horror_urban_legend"
  profile_source?: string;   // "system", "template", "preset", "brand", "user"
  
  // Voice & Format
  voiceFormat: {
    format: string;            // "documentary_narrator", "host_explainer", etc.
    structuralMarkers: string[]; // e.g., ["[STATIC]", "[PAUSE]"] for radio
    enforceMarkers: boolean;   // Whether to validate markers in output
    povConstraint: "first" | "third" | "passive" | "any";
    styleNotes?: string;       // Additional style guidance
    exampleFragment?: string;  // Few-shot example
  };
  
  // Motif Control
  motif: {
    minMentions: number;       // Minimum times repeating detail appears
    shouldEscalate: boolean;   // Each mention should transform/worsen
    distribution: "spread" | "clustered";
  };
  
  // Unique Element (Weird Axis)
  uniqueElement: {
    minAppearances: number;    // Typically 2+ for escalation
    requireEscalation: boolean; // Second appearance must worsen
    finalMentionPosition: "penultimate" | "final" | "any";
  };
  
  // Beat Structure
  beatStructure: {
    beatCount: number;         // Number of structural beats (4-6 typical)
    beatLabels: string[];      // ["OPENING", "DEVELOPMENT", "TURN", "CLOSE"]
    requireGroundingDetail: boolean;
    groundingTypes: string[];  // ["object", "sound", "smell", "tech"]
    minWordsPerBeat: number;
    maxWordsPerBeat: number;
  };
  
  // Era/Location Embodiment
  embodiment: {
    eraLevel: "name_only" | "objects" | "full_immersion";
    requirePeriodObjects: boolean;
    requireLocationSensory: boolean;
  };
  
  // Authority Response
  authority: {
    style: "summary" | "procedural" | "absent";
    minDetailSentences: number;
  };
  
  // Ending Control
  ending: {
    antiClosure: number;       // 0 = full resolution, 1 = maximally unresolved
    enforceFinalImage: boolean;
    allowedEndingTypes: string[];
    takeaway?: {               // For educational content
      enabled: boolean;
      style: "question" | "fact" | "action" | "reflection";
    };
  };
  
  // Word Count
  wordCount: {
    target: number;
    variance: number;          // +/- allowed
    priority: "structure" | "flow";
  };
  
  genreFlags?: Record<string, any>; // Niche-specific extras
}
```

## Template Defaults by Niche

### Horror (`horror`)
- 5 beats: OPENING → EARLY_REPORTS → PATTERN → ESCALATION → FINAL_IMAGE
- Motif: 3+ mentions, must escalate
- Anti-closure: 85% (no resolution)
- Final image enforced
- Era: objects level (period-accurate props)

### Food (`food`)
- 4 beats: HOOK → FACT → CONTEXT → TAKEAWAY
- Motif: 1 mention (facts don't need repetition)
- Anti-closure: 10% (full resolution)
- Takeaway: action style
- Grounding: object, visual, taste, texture

### Finance (`finance`)
- 4 beats: PROBLEM → INSIGHT → SOLUTION → TAKEAWAY
- Motif: 2 mentions
- Anti-closure: 20%
- Takeaway: action style
- Grounding: number, example, comparison

### Motivation (`motivation`)
- 4 beats: CHALLENGE → STRUGGLE → BREAKTHROUGH → LESSON
- Motif: 2 mentions, escalating
- Anti-closure: 30%
- Takeaway: reflection style

### Generic (`generic`)
- 4 beats: OPENING → DEVELOPMENT → CLIMAX → CLOSE
- Motif: 2 mentions
- Anti-closure: 40%
- Default baseline for new niches

## Preset Profiles (Vibe-Based)

> **Note (Feb 2026):** As of v4.1, **four story engines** are actively used in production:
> - `urban_legend` - Documentary folklore style
> - `one_too_many` - Counting horror style
> - `reddit_trending_horror` - Viral Reddit-style narration
> - `dark_origins` - Origin-story folklore, slow-burn dread
>
> Legacy presets are deprecated and map to `urban_legend` for backwards compatibility.

| Preset | Anti-Closure | Motif | Beat Count | Key Feature |
|--------|--------------|-------|------------|-------------|
| `urban_legend` | 90% | 3+ | 5 | Documentary voice, ACTIVE |
| `one_too_many` | 90% | 3+ | 5 | Counting horror (N+1), ACTIVE |
| `reddit_trending_horror` | 85% | 2+ | 5 | Viral Reddit hooks, ACTIVE |
| `dark_origins` | 90% | 3+ | 5 | Origin folklore, slow-burn, ACTIVE |
| `radio_transcript` | 95% | 3+ | 5 | Structural markers [STATIC] (deprecated) |
| `police_report` | 85% | 2+ | 5 | Official document format (deprecated) |
| `slow_creepy` | 80% | 3+ | 5 | Atmospheric buildup (deprecated) |
| `punchy_shock` | 60% | 2+ | 4 | Rapid escalation (deprecated) |
| `analog_horror` | 95% | 2+ | 5 | VHS aesthetic (deprecated) |

### One Too Many Preset (Counting Horror)

The `one_too_many` preset uses a **rich trope pack engine** (`buildOneToManyPrompt()`) with randomized story seeds and an 8-dimension storytelling toolkit.

**Trope Pack Arrays (randomized per generation):**
- `groupSizes`: 5 options (4→5 through 8→9)
- `groupTypes`: 8 options (college friends, coworkers, hikers, wedding party, etc.)
- `containers`: 18 options (van, elevator, ferry, ski lift gondola, escape room, etc.)
- `evidenceSources`: 11 options (group photo, dashcam, security camera, receipt, etc.)
- `glitches`: 10 options (clock resetting, doors won't unlock, GPS rerouting, etc.)
- `witnesses`: 8 options (gas station attendant, park ranger, ferry worker, etc.)
- `dialogueLines`: 6 options ("I think we're one too many.", "Count again.", etc.)

**Storytelling Toolkit (8 dimensions — soft guidance, not rigid requirements):**
1. **RECOUNTS**: Multiple counting methods (headcount, by seat, by name)
2. **SPATIAL GROUNDING**: Physical arrangement — who sits where, who's by the door
3. **EXTERNAL CONFIRMATION**: Outsider independently notices + layered evidence
4. **ENVIRONMENTAL DISTURBANCE**: 2-3 scattered wrongnesses (reality fraying)
5. **VISUAL PROOF**: Evidence surfaces later (photo, footage, receipt)
6. **THE EXTRA — "ALMOST RIGHT"**: Specific uncanny valley descriptions
7. **NAMED CHARACTERS**: The person who first notices gets a name
8. **AFTERMATH WITH TIME-SKIP**: Weeks/months later epilogue — proof lingers

**Narrative Voice:** Flexible — first-person, third-person, or "Did you know..." hooks (via `getStorySystemPrompt()`). Not forced into first-person like other presets.

**Design Principle:** "Don't make it too strict or each story will feel the same" — all toolkit items are suggestions to pick from, not a checklist. Randomized seeds ensure fresh raw material.

**Failure Modes (story is rejected if):**
- Numbers drift (N→N+2 or N-1→N)
- Vague numbers ("a few", "several")
- Missing final proof image
- Extra person explained/identified
- Counting mechanic removable from story

## Contract Prompts

When `story_mode: "custom"` or DNA generation is active, the system builds a **contract prompt** with beat tags:

```
[BEAT_1:OPENING]
First section of story...

[BEAT_2:EARLY_REPORTS]
Second section...

[BEAT_3:PATTERN]
...
```

### Contract Features

1. **Beat Tags**: `[BEAT_N:LABEL]` markers enforce structure
2. **Binding Requirements**: Stated as MUST, not should
3. **Motif Mentions**: Explicit minimum count
4. **Final Image**: Must appear in final beat
5. **Anti-Closure Directives**: Based on antiClosure score
6. **Word Allocation**: Per-beat word targets

## Compliance Checking

After generation, `checkCompliance()` validates:

| Check | Type | Description |
|-------|------|-------------|
| Beat count | Error | Correct number of beat tags present |
| Beat labels | Error | Expected beat names found |
| Motif mentions | Error | Repeating detail appears N+ times |
| Unique element | Warning | Weird axis appears with escalation |
| Final image | Error | DNA final_image in last beat |
| Word count | Warning | Within target ± variance |
| Markers | Warning | Structural markers present (if enforced) |
| Grounding | Warning | Sensory details per beat |

### Compliance Score

```
Score = 100 - (errors × 20) - (warnings × 5)
Passed = errors === 0
```

## Post-Processing

`stripContractTags()` removes beat tags for TTS/display:

```typescript
// Before
"[BEAT_1:OPENING] In the late 1970s..."

// After  
"In the late 1970s..."
```

## API Usage

### Job Creation

```typescript
// create-job request
{
  vibe_preset: "urban_legend",
  story_mode: "custom",  // Use custom profile
  story_profile: {
    motif: { minMentions: 4 },  // Override motif count
    ending: { antiClosure: 0.95 },  // More open-ended
  }
}
```

### In Edge Function

```typescript
import { resolveStoryProfile, sanitizeStoryProfile } from './story_profile.ts';
import { buildStoryContract, checkCompliance, stripContractTags } from './story_contract.ts';

// Resolve profile
const resolved = resolveStoryProfile({
  template: getTemplateDefaults('horror'),
  preset: getPresetProfile('urban_legend'),
  user: jobMeta.story_profile,
});
const profile = sanitizeStoryProfile(resolved);

// Build contract prompt
const contract = buildStoryContract(dna, profile);
console.log(contract.prompt);  // Send to LLM

// Validate and clean output
const { story, compliance } = processStoryOutput(rawStory, contract);
console.log(complianceToLog(compliance));
// "✅ PASSED (score: 95/100), words=142, beats=5, motif=3, unique=2"
```

## Quality Gates (v4.1)

Quality gates are preset-specific validation functions that run **after story generation** to enforce narrative quality. If a gate fails, the story is regenerated (up to 2 retries).

| Gate | Preset | Checks |
|------|--------|--------|
| `gateOneToMany` | `one_too_many` | Counting language present ("counted", "one too many", N→N+1 pattern, digit sequences) |
| `gateRedditTrendingHorror` | `reddit_trending_horror` | First-person voice ("I ", "my ", "me "), community refs ("reddit", "posted", "thread") |
| `gateDarkOrigins` | `dark_origins` | Origin language ("origin", "began", "first", "ancient"), past-tense framing |

**Retry Logic:**
- Attempt 1: Generate story → run gate → if fail, clear idempotency asset, throw error
- Attempt 2: Regenerate → run gate → if fail, accept with warning log
- Gate results stored in `job.meta.quality_gate_attempts`

**Implementation:** `supabase/functions/worker-v1/steps.ts` — `runQualityGate()` dispatcher

---

## Future Enhancements

1. **Brand-Level Profiles**: Store in `brand.settings.storyProfile`
2. **Template Files**: Load from `templates/{niche}/story_profile.json`
3. **A/B Testing**: Compare profile variants
4. **Learning**: Adjust based on engagement metrics
5. **Contract Regeneration**: If compliance fails, regenerate with stricter prompt

## Summary

| Concept | Purpose |
|---------|---------|
| StoryProfile | Declares structural requirements |
| Contract | Converts profile + DNA into binding prompt |
| Beat Tags | Enforce section structure |
| Compliance | Validates output meets requirements |
| Sanitize | Fail-soft defaults for invalid values |
| Strip | Clean output for TTS/display |

The goal: **Make the LLM a RENDERER, not a source of structural decisions.**
