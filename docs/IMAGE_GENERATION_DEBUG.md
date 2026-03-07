# Image Generation: Debugging & Data Flow

> **Internal Documentation** — For debugging the image generation pipeline.  
> Last updated: February 8, 2026

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [What Gets Sent Where](#what-gets-sent-where)
3. [Prompt Assembly (Exact Template)](#prompt-assembly-exact-template)
4. [Scene Visual Contract System](#scene-visual-contract-system)
5. [Character Consistency System](#character-consistency-system)
6. [Observability & Logging](#observability--logging)
7. [Common Failure Points](#common-failure-points)
8. [How to Reproduce a Single Scene](#how-to-reproduce-a-single-scene)
9. [Concrete Examples](#concrete-examples)

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            USER STEP 1 SELECTIONS                           │
│  theme, visual_preset, art_style, custom_style?, scene_count                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. POST /create-job                                                        │
│     → Creates job record in DB                                              │
│     → Generates preview story (GPT-4o-mini)                                 │
│     → Returns job_id + story preview                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. POST /run-job (phase: audio)                                            │
│     → Generates full story + narration audio (ElevenLabs)                   │
│     → Extracts word timestamps                                              │
│     → Splits story into N scenes (extractSceneKeywords)                     │
│     → Saves scenes to job_assets (type: scene_data)                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. POST /run-job (phase: images)                                           │
│     → Creates Story Anchor (GPT-4o-mini) — visual bible for consistency     │
│     → Creates Visual Beats per scene (GPT-4o-mini) — camera/mood/focus      │
│     → Creates Visual Contracts per scene (GPT-4o-mini) — LITERAL frames     │
│     → For EACH scene:                                                       │
│         → buildFinalDallePrompt() — deterministic template + contract       │
│         → POST to DALL-E 3 API                                              │
│         → Save image URL to job_assets (type: dalle_image)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. POST /run-job (phase: assemble)                                         │
│     → Builds video template with images + audio + captions                  │
│     → Submits to FFmpeg renderer (primary) or Creatomate (legacy)           │
│     → FFmpeg renderer: self-hosted at video-renderer/server.js              │
│     → Polls for completion                                                  │
│     → Saves final video URL to job_assets (type: final_mp4)                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What Gets Sent Where

### 1. Frontend → `POST /create-job`

**Endpoint:** `supabase/functions/create-job`

**Input (Request Body):**
```typescript
{
  theme: string;              // "general" | "paranormal" | "psychological" | etc.
  length_preset: string;      // "short" | "medium" | "long" | "30" | "45" | "60" | "90"
  visual_preset: string;      // "forest" | "hallway" | "attic" | "foggy" | "rain"
  visual_source: string;      // "pexels" | "dalle"
  art_style: string;          // "cinematic-dark" | "analog-horror" | "custom-{uuid}"
  custom_style?: {            // Only if art_style.startsWith("custom-")
    name: string;
    basePrompt: string;
    colorOverride: string;
    technicalStyle: string;
    negativePrompt: string;
  };
  scene_count: number;        // 3-8
  preview_only: boolean;      // true for Step 1 preview
  // Effects (boolean flags)
  effect_filter: boolean;
  effect_kenburns: boolean;
  effect_transitions: boolean;
  effect_vignette: boolean;
  // Audio
  audio_music: boolean;
  audio_sfx: boolean;
  // Captions
  caption_style: string;      // "bold" | "minimal" | "dramatic"
  highlight_scary: boolean;
}
```

**Output (Response):**
```typescript
{
  success: boolean;
  status: "preview";
  job_id: string;             // UUID
  title: string;              // Generated story title
  story_text: string;         // Full preview story
  estimated_scenes: Array<{
    text: string;
    keywords: string[];
  }>;
}
```

**Storage:**
- Job record created in `jobs` table
- Options stored in `jobs.meta` column as JSON

---

### 2. GPT Call: Story Generation

**Endpoint:** OpenAI Chat Completions API  
**Called from:** `create-job/index.ts` (preview) and `run-job/index.ts` (full)

**Input:**
```typescript
{
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `You are a master horror writer... Theme: ${theme}...`
    },
    {
      role: "user", 
      content: `Write a ${duration}-second horror story...`
    }
  ],
  temperature: 0.8,
  response_format: { type: "json_object" }
}
```

**Expected Output Schema:**
```typescript
{
  title: string;
  story: string;
}
```

**Storage:**
- `jobs.title` — story title
- `jobs.story_text` — full story text

---

### 3. GPT Call: Scene Extraction (`extractSceneKeywords`)

**Endpoint:** OpenAI Chat Completions API  
**Called from:** `run-job/index.ts` → `runAudioPhase()`

**Input:**
```typescript
{
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `You are a video director. For each scene of this horror story, 
                provide 2 stock video search keywords...`
    },
    {
      role: "user",
      content: `Scenes:\nScene 1: "${sceneText1}"\nScene 2: "${sceneText2}"...`
    }
  ],
  temperature: 0.3,
  response_format: { type: "json_object" }
}
```

**Expected Output Schema:**
```typescript
{
  scenes: Array<{
    scene: number;
    keywords: string[];  // 2 keywords per scene
  }>
}
// OR direct array: [{ scene: 1, keywords: [...] }, ...]
```

**Storage:**
- Each scene saved to `job_assets` table with:
  - `type: "scene_data"`
  - `storage_path: "scene_{index}"`
  - `meta: { scene_index, scene_text, keywords, start_time, end_time }`

---

### 4. GPT Call: Story Anchor Creation (`createStoryAnchor`)

**Endpoint:** OpenAI Chat Completions API  
**Called from:** `run-job/index.ts` → `runImagesPhase()`

**Input:**
```typescript
{
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `You are a horror visual director creating a "Story Anchor"...
        
        TARGET ART STYLE: ${styleConfig.name}
        STYLE DESCRIPTION: ${styleConfig.basePrompt}
        COLOR PALETTE: ${styleConfig.colorOverride}
        CAMERA/TECHNIQUE: ${styleConfig.technicalStyle}
        
        Analyze the story and extract:
        1. ENVIRONMENT
        2. COLOR_PALETTE
        3. CAMERA_STYLE
        4. HORROR_TONE
        5. TIME_OF_DAY
        6. RECURRING_MOTIFS
        7. CHARACTER (REQUIRED if humans appear)
        8. CONTINUITY_RULES
        
        Return JSON...`
    },
    {
      role: "user",
      content: `Story:\n"${fullStory}"\n\nVisual theme preference: ${visualPreset}\n
                Target art style: ${styleConfig.name}`
    }
  ],
  temperature: 0.6,
  response_format: { type: "json_object" }
}
```

**Expected Output Schema (StoryAnchor):**
```typescript
{
  environment: string;           // "dark ancient forest at night, twisted pine trees..."
  colorPalette: string;          // "muted greens, cold blues, deep blacks"
  cameraStyle: string;           // "cinematic horror, film grain, shallow DOF"
  horrorTone: string;            // "psychological horror, building dread"
  timeOfDay: string;             // "deep night, pale moonlight"
  recurringMotifs: string;       // "fog between trees, shadows that move"
  characterDescription: string | null;  // "woman in her 30s, dark hair, red jacket"
  continuityRules: string;       // "trees always gnarled, fog at ground level"
  fullAnchorPrompt: string;      // Complete reusable prompt paragraph
}
```

**Storage:**
- Saved to `jobs.meta.story_anchor` as JSON object

---

### 5. GPT Call: Visual Beats Creation (`createVisualBeats`)

**Endpoint:** OpenAI Chat Completions API  
**Called from:** `run-job/index.ts` → `runImagesPhase()`

**Input:**
```typescript
{
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `You are a horror cinematographer creating "visual beats"...
        
        The story takes place in: ${storyAnchor.environment}
        Horror tone: ${storyAnchor.horrorTone}
        
        For EACH scene, create a visual beat with escalating mood...`
    },
    {
      role: "user",
      content: `Scene 1: "${sceneText1}"\n\nScene 2: "${sceneText2}"...`
    }
  ],
  temperature: 0.5,
  response_format: { type: "json_object" }
}
```

**Expected Output Schema:**
```typescript
{
  beats: Array<{
    sceneIndex: number;    // 0-based
    visualBeat: string;    // "A figure emerges from the fog..."
    cameraAngle: string;   // "wide establishing shot" | "close-up" | "dutch angle"
    focus: string;         // "the approaching shadow"
    moodLevel: number;     // 1-10, should escalate through scenes
    mirrorBehavior?: string;   // "none" | "reflection shows different expression" | "something in reflection" | "reflection delayed" | "no reflection"
    realityRule?: string;      // "normal" | "shadows wrong direction" | "too many fingers" | "eyes follow camera" | "background subtly wrong"
    compositionHint?: string;  // "centered subject" | "rule of thirds" | "negative space left/right" | "claustrophobic tight" | "vast empty"
  }>
}
```

**Storage:**
- Saved to `jobs.meta.visual_beats` as JSON array

**Mirror/Reality Rules (Horror Escalation):**

| Scene Position | mirrorBehavior | realityRule |
|----------------|----------------|-------------|
| Early (1-2) | "none" | "normal" |
| Middle (3-4) | "reflection shows different expression" | "shadows wrong direction" |
| Late (5+) | "something in reflection that isn't there" | "eyes follow camera" |

---

### 6. DALL-E 3: Image Generation

**Endpoint:** `POST https://api.openai.com/v1/images/generations`  
**Called from:** `run-job/index.ts` → `generateDalleImageWithAnchor()`

**Input:**
```typescript
{
  model: "dall-e-3",
  prompt: finalPromptString,  // Built by buildFinalDallePrompt()
  n: 1,
  size: "1024x1792",          // Portrait 9:16 for vertical video
  quality: "hd",
  response_format: "url"
}
```

**Output:**
```typescript
{
  data: [{
    url: string;  // Temporary OpenAI blob URL (expires in ~2 hours)
  }]
}
```

**Storage:**
- Each image saved to `job_assets` table with:
  - `type: "dalle_image"`
  - `storage_path: imageUrl`
  - `meta: { scene_index, dalle_prompt, visual_beat, mood_level, camera_angle, ... }`

---

## Prompt Assembly (Exact Template)

The `buildFinalDallePrompt()` function constructs the final string sent to DALL-E 3.

### ⚠️ NEW UNIFIED TEMPLATE (Jan 27, 2026)

The prompt now follows a **priority-ordered structure** with dedicated locks for orientation, style, character, and environment:

```
ORIENTATION + COMPOSITION LOCK:
Upright portrait 9:16, not rotated.
Centered symmetry, one-point perspective, eye-level camera.
Single dominant subject centered in frame, never cropped at edges.

STYLE LOCK:
{styleBlock - varies by custom vs built-in}

CHARACTER LOCK (ID: char_xxxx):
Face: {extracted face features}
Outfit: {extracted clothing}
Build: {extracted silhouette}
DO NOT CHANGE: {list of unchanging features}

ENVIRONMENT LOCK:
{environment description}
Recurring motifs: {motifs}
Continuity: {rules}

SCENE {n}/{total}:
Action: {visualBeat}
Mirror rule: {mirrorBehavior}
Reality rule: {realityRule}
Camera: {sanitized cameraAngle}
Focus: {focus}
Mood: {moodLevel}/10

AVOID:
{negativePrompt terms}
```

### Two Prompt Paths (Custom vs Built-in)

**CRITICAL:** Custom styles and built-in styles still use different **style blocks**, but the overall structure is now unified.

| Aspect | Custom Style | Built-in Style |
|--------|--------------|----------------|
| Style source | User's `basePrompt` verbatim | `storyAnchor.fullAnchorPrompt` |
| Style block content | `basePrompt` + `colorOverride` + `technicalStyle` | `"Maintain exact {name} style..."` + anchor prompt |
| Anchor/beat content | SANITIZED (style terms stripped) | Used as-is |
| Camera style appended | NO (would contaminate) | YES |

### Custom Style Path (Style Isolation)

When `art_style.startsWith('custom-')`, the prompt is built to **completely isolate** the user's style from contamination:

```
{customStyle.basePrompt}
Colors: {customStyle.colorOverride}
Technique: {customStyle.technicalStyle}

ORIENTATION LOCK:
Upright portrait 9:16. Character and objects must be upright (not rotated).
No dutch angle. No tilted horizon. Top = sky/ceiling. Bottom = ground/floor.

Scene content:
Setting: {SANITIZED environment}
Action: {SANITIZED visualBeat}
Camera framing: {SANITIZED cameraAngle} (portrait framing)
Focus: {beat.focus}
Mood intensity: {moodLevel}/10
Character: {SANITIZED characterDescription}

Avoid: {customStyle.negativePrompt}

CRITICAL: Portrait orientation (9:16 aspect ratio). Absolutely NO text...
```

**Key difference:** Style is ONLY from user. Anchor/beat provide CONTENT ONLY (what happens), not style (how it looks).

### Style Term Sanitization

Before content is added to custom style prompts, these terms are **stripped**:

```typescript
const FORBIDDEN_STYLE_TERMS = [
  "cinematic", "film grain", "depth of field", "dof", "bokeh",
  "photoreal", "photo-real", "photorealistic", "dslr", "macro",
  "noir", "graphic novel", "crosshatch", "crosshatching", "engraving",
  "realistic lighting", "dramatic lighting", "moody lighting",
  "ink shading", "hatching", "stippling", "woodcut",
  "concept art", "matte painting", "digital painting",
  "volumetric", "ray tracing", "unreal engine", "octane render",
  "cosmic dread", "visceral terror", "overwhelming horror"
];
```

**Implementation:**
```typescript
function stripForbiddenStyleTerms(input: string): string {
  let out = input;
  for (const term of FORBIDDEN_STYLE_TERMS) {
    out = out.replace(new RegExp(term, "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
```

### Built-in Style Path (Original)

When using built-in styles like "cinematic-dark", the original structure is used:

```
ORIENTATION LOCK:
Upright portrait 9:16. Character and objects must be upright (not rotated).
No dutch angle. No tilted horizon. Top = sky/ceiling. Bottom = ground/floor.

STYLE LOCK: Maintain exact {styleConfig.name} style throughout...

{storyAnchor.fullAnchorPrompt}

Scene {N} of {total}: {beat.visualBeat}
Camera: {sanitizedCameraAngle}
Focus: {beat.focus}
Mood: {moodDescriptor}
Continuity: {storyAnchor.continuityRules}
Character: {storyAnchor.characterDescription}

Avoid: {styleConfig.negativePrompt}

Technical: {storyAnchor.cameraStyle}
Colors: {storyAnchor.colorPalette}
Recurring elements: {storyAnchor.recurringMotifs}

CRITICAL: Portrait orientation (9:16 aspect ratio)...
```

### Camera Angle Sanitization (Portrait-Safe)

Camera angles that imply landscape orientation are automatically rewritten:

| Original | Sanitized |
|----------|-----------|
| `wide establishing shot` | `tall vertical establishing shot` |
| `panoramic` | `vertically framed` |
| `horizontal` | `vertical` |
| `landscape` | `portrait` |
| `side-scrolling` | `vertical scrolling` |
| `wide angle` | `tall vertical angle` |
| `full scene visible` | `full vertical scene visible` |

**Implementation:**
```typescript
function sanitizeCameraAngleForPortrait(cameraAngle: string): string {
  const replacements: [RegExp, string][] = [
    [/\bwide\s*(establishing)?\s*shot\b/gi, "tall vertical establishing shot"],
    [/\bpanoramic\b/gi, "vertically framed"],
    [/\bhorizontal\b/gi, "vertical"],
    // ... etc
  ];
  // Apply all replacements
}
```

### Mood Level Mapping (Deterministic)

| Level | Descriptor |
|-------|------------|
| 1 | "eerie stillness, subtle wrongness in the atmosphere" |
| 2 | "quiet unease, something slightly off but hard to pinpoint" |
| 3 | "creeping anxiety, shadows seem to shift at the edges" |
| 4 | "growing dread, tension building in every frame" |
| 5 | "mounting fear, the threat feels closer now" |
| 6 | "palpable terror, danger is unmistakably present" |
| 7 | "intense horror, the nightmare is unfolding" |
| 8 | "visceral fear, escape seems impossible" |
| 9 | "peak terror, the horror is fully revealed" |
| 10 | "overwhelming cosmic dread, nightmare beyond comprehension" |

### Technical Requirements Appended

After `buildFinalDallePrompt()`, the `generateDalleImageWithAnchor()` function appends:

```
Technical: {storyAnchor.cameraStyle}
Colors: {storyAnchor.colorPalette}
Recurring elements: {storyAnchor.recurringMotifs}

CRITICAL: Portrait orientation (9:16 aspect ratio). Absolutely NO text, NO words, NO letters, NO writing, NO symbols with text anywhere in the image.
```

### Why "Avoid:" Instead of `negative_prompt`

DALL-E 3's Images API **does not have a `negative_prompt` parameter**. To achieve similar effect, we append negative terms as natural language:

```
Avoid: text, words, letters, watermarks, signatures, blurry, low quality
```

This is a soft guidance, not a hard filter.

---

## Scene Visual Contract System

### The Core Problem (Why This Exists)

**Before Visual Contracts:**
- Story text: "My heart pounds as I hear soft whispers"
- DALL-E generates: Generic creepy forest with mirrors and portals

**Why?** Prose is too **abstract** for image models. DALL-E can't visualize:
- "Pounding heart" → What does that look like?
- "Soft whispers" → Where are they?
- "Panic" → How do we see that?

So DALL-E defaults to **symbolic horror imagery** (forests, mirrors, eyes) instead of **literal story frames**.

### The Solution: Shot Lists, Not Story Beats

Image models need **storyboard frames**, not prose paragraphs.

| ❌ Bad (Abstract) | ✅ Good (Literal) |
|-------------------|-------------------|
| "He panics as whispers grow louder" | "Man sitting upright on bed, hands clutching chest, ghostly whisper shapes circling his head" |
| "Fear grips her heart" | "Woman frozen mid-step in hallway, wide eyes, hand reaching toward door handle" |
| "The darkness closes in" | "Dark bedroom, man's face illuminated only by phone screen, shadows stretching on walls" |

### SceneVisualContract Interface

```typescript
interface SceneVisualContract {
  sceneIndex: number;
  location: string;              // exact physical place
  characterPose: string;         // what the body is doing
  facialExpression: string;      // visible emotion
  visibleObjects: string[];      // MUST be present in image
  supernaturalElement: string | null;  // the horror visual
  cameraDistance: "extreme-close-up" | "close-up" | "medium" | "wide";
  lightingSource: string;        // where light comes from
  actionFrozen: string;          // exact moment captured
  // Anti-drift fields (NEW)
  forbiddenElements: string[];   // "stairs", "hallway", "extra people" - MUST NOT appear
  continuityFromPrev: string;    // "same bedroom as scene 1" - link to previous
  evidenceRule: string;          // "shadows must be visible on wall" - proof scene is correct
}
```

### How Contracts Are Generated

**GPT Call:** `createSceneVisualContracts()`

**System Prompt (key parts):**
```
You are a storyboard artist converting story scenes into LITERAL visual frames.

RULES:
1. Be LITERAL and CONCRETE - no symbolism, no abstraction
2. Everything you describe MUST be visible in a single image
3. Location must be a SPECIFIC physical place (bedroom, bathroom, hallway)
4. Character pose must describe EXACTLY what the body is doing
5. Visible objects must be items that PHYSICALLY APPEAR in frame
6. Supernatural element should be VISUAL, not conceptual
7. MAINTAIN LOCATION CONTINUITY - don't jump locations
```

### Example: Story → Contract Conversion

**Scene Text:**
```
"I wake up gasping. The shadows dance in my room."
```

**Generated Contract:**
```json
{
  "sceneIndex": 0,
  "location": "dark bedroom at night",
  "characterPose": "man sitting upright on bed, shoulders hunched, breathing heavily",
  "facialExpression": "wide eyes, mouth slightly open, fear",
  "visibleObjects": ["bed", "bedside lamp", "wall behind bed"],
  "supernaturalElement": "elongated shadows writhing on the walls",
  "cameraDistance": "medium",
  "lightingSource": "faint moonlight through window",
  "actionFrozen": "the moment of waking from nightmare"
}
```

### How Contracts Appear in Prompts

**New MUST/MUST NOT format (high impact for DALL-E):**

```
SCENE 1/3 CONTRACT (MUST FOLLOW):

MUST SHOW:
- Location: dark bedroom at night
- Person: man sitting upright on bed, wide eyes, fear
- bed
- bedside lamp
- wall behind bed
- Supernatural: shadows writhing on wall

MUST NOT SHOW:
- stairs, hallway, extra people, mirror, forest, outdoors

EVIDENCE:
- shadows must be clearly visible on the bedroom wall behind the bed

Lighting: faint moonlight through window
Camera: medium shot
Continuity: establishing shot
Mood: 3/10
```

**Alignment Score Logging:**

For debugging, each scene logs a contract alignment score:

```
[CONTRACT] scene=1 location=Y objects=4 forbidden=6 evidence=Y continuity=Y
```

| Field | Meaning |
|-------|---------|
| `location` | Y/N - does contract have specific location? |
| `objects` | count of MUST SHOW items |
| `forbidden` | count of MUST NOT items |
| `evidence` | Y/N - does contract have evidence rule? |
| `continuity` | Y/N - does contract link to previous scene? |

If you see `forbidden=0` or `evidence=N`, drift is more likely.

### Why This Works

| Before (Style-First) | After (Story-First) |
|---------------------|---------------------|
| DALL-E optimizes for "looking scary" | DALL-E renders the actual scene |
| Abstract prose → generic horror imagery | Literal contract → specific frame |
| Environment drifts (bedroom → forest) | Location locked per scene |
| Character actions unclear | Exact pose specified |
| Symbolic horror (mirrors, portals) | Story-accurate horror |

### Storage

Visual contracts are cached in `jobs.meta.visual_contracts` as JSON array.

```sql
SELECT meta->'visual_contracts'->0 as first_contract
FROM jobs 
WHERE id = '{job_id}';
```

### Fallback Behavior

If GPT fails to generate contracts, the system falls back to basic contracts:

```typescript
{
  location: storyAnchor.environment.split(",")[0] || "dark room",
  characterPose: "standing, tense posture",
  facialExpression: "fear, wide eyes",
  visibleObjects: ["walls", "shadows"],
  supernaturalElement: i > 1 ? "unnatural shadows" : null,
  cameraDistance: i === 0 ? "wide" : "medium",
  lightingSource: "dim ambient light",
  actionFrozen: scene.text.substring(0, 50),
}
```

---

## Character Consistency System

### Overview

The Character Consistency System ensures the same character looks identical across all scenes. It uses a **CharacterLock** structure that extracts and enforces key visual features.

### CharacterLock Interface

```typescript
interface CharacterLock {
  id: string;              // Stable hash like "char_8f3a2b"
  face: string;            // "dark hair, brown eyes, pale skin, late 20s"
  outfit: string;          // "red jacket, white shirt, jeans"
  silhouette: string;      // "average build, woman"
  doNotChange: string[];   // ["hair color", "clothing color", "apparent age"]
}
```

### How Character ID is Generated

```typescript
function generateCharacterId(description: string): string {
  let hash = 0;
  for (let i = 0; i < description.length; i++) {
    const char = description.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `char_${Math.abs(hash).toString(16).substring(0, 6)}`;
}
```

This creates a **stable hash** from the character description. The same description always produces the same ID, enabling consistency tracking.

### Feature Extraction Functions

| Function | What It Extracts | Patterns Used |
|----------|------------------|---------------|
| `extractCharacterFace()` | Hair, eyes, skin, age | `hair`, `eyes`, `face`, `skin`, `X years old` |
| `extractCharacterOutfit()` | Clothing items | `wearing`, `dressed in`, `jacket`, `coat`, `shirt` |
| `extractCharacterSilhouette()` | Body type | `tall`, `slim`, `athletic`, `woman`, `man` |
| `extractDoNotChange()` | Key unchanging features | Hair color, clothing color, apparent age |

### Example: Character Extraction

**Input Description:**
```
"A woman in her late 20s with long dark hair, brown eyes, wearing a red jacket over a white shirt"
```

**Extracted CharacterLock:**
```json
{
  "id": "char_8f3a2b",
  "face": "late 20s, long dark hair, brown eyes",
  "outfit": "wearing a red jacket over a white shirt",
  "silhouette": "woman",
  "doNotChange": ["hair color", "clothing color", "apparent age"]
}
```

### How CHARACTER LOCK Appears in Prompts

```
CHARACTER LOCK (ID: char_8f3a2b):
Face: late 20s, long dark hair, brown eyes
Outfit: wearing a red jacket over a white shirt
Build: woman
DO NOT CHANGE: hair color, clothing color, apparent age
```

### Extended Anchors

The StoryAnchor now includes optional structured fields:

```typescript
interface StoryAnchor {
  // ... existing fields ...
  characterLock?: CharacterLock;  // Structured character data
  contentAnchor?: ContentAnchor;  // Environment/world data
  styleAnchor?: StyleAnchor;      // Render style data
}
```

### ContentAnchor Interface

```typescript
interface ContentAnchor {
  environment: string;       // "dark forest at night"
  props: string;             // "gnarled trees, fog, moonlight"
  recurringMotifs: string;   // "eyes in darkness, shifting shadows"
  continuityRules: string;   // "fog at ground level, moon upper-left"
  timeOfDay?: string;        // "midnight"
  characterLock?: CharacterLock;
}
```

### StyleAnchor Interface

```typescript
interface StyleAnchor {
  name: string;              // "Cinematic Dark" or custom name
  renderStyle: string;       // "photorealistic horror, film grain"
  colorPalette: string;      // "muted greens, cold blues, deep blacks"
  technique: string;         // "shallow DOF, dramatic lighting"
  negativePrompt: string;    // "text, watermarks, blurry"
}
```

### Mirror Behavior & Reality Rules

Visual beats now include horror-specific "wrongness" fields:

| Field | Purpose | Values |
|-------|---------|--------|
| `mirrorBehavior` | How reflections behave | "none", "reflection shows different expression", "something in reflection that isn't there", "reflection delayed", "no reflection at all" |
| `realityRule` | What's subtly wrong with reality | "normal", "shadows wrong direction", "too many fingers", "eyes follow camera", "background subtly wrong", "time seems frozen" |
| `compositionHint` | Framing suggestion | "centered subject", "rule of thirds", "negative space left/right", "claustrophobic tight", "vast empty" |

### ORIENTATION LOCK (Simplified)

**Previous version** (removed - caused hallway/stair bias):
```
ORIENTATION + COMPOSITION LOCK:
Centered symmetry, one-point perspective, eye-level camera.  ← This forces hallway/stair shots!
```

**Current version** (simplified - no forced perspective):
```
ORIENTATION LOCK:
Upright portrait 9:16, not rotated.
Top=ceiling/sky, bottom=floor/ground.
No dutch angle. No tilted horizon.
```

**Why the change?** "One-point perspective" and "centered symmetry" prime DALL-E to generate:
- Hallways
- Staircases
- Corridors

These are the classic one-point perspective subjects. By removing this constraint, we stop the model from defaulting to these when not in the story.

**Composition is now optional** via `compositionHint` in the visual beat.

### Prompt Length Limit

DALL-E 3 works best with prompts **under 2500 characters**. The unified template prioritizes:

1. **ORIENTATION LOCK** (always included - simplified)
2. **STYLE LOCK** (always included)
3. **CHARACTER LOCK** (included if character exists)
4. **SCENE CONTRACT** (MUST/MUST NOT format)
5. **AVOID** (always included)

---

## Observability & Logging

### Key Log Points

| Phase | Log Line Pattern | What It Tells You |
|-------|------------------|-------------------|
| Create Job | `Creating job: length={X}, preview={Y}` | Job creation started |
| Create Job | `Options meta: {...}` | Full user selections stored |
| Story Gen | `Story generated: {title}` | Story creation succeeded |
| Scene Split | `[extractSceneKeywords] {N} sentences, target {M} scenes` | Scene splitting logic |
| Scene Split | `[extractSceneKeywords] Created {N} scenes (target was {M})` | Final scene count |
| Anchor | `[createStoryAnchor] Using CUSTOM style: {name}` | Custom style detected |
| Anchor | `[createStoryAnchor] Using built-in style: {name}` | Built-in style used |
| Anchor | `Story Anchor created: {fullAnchorPrompt}` | Anchor generation succeeded |
| Images | `[IMAGES] Generating scene {i+1}/{total}...` | Image generation starting |
| Images | `[IMAGES] Scene {i+1} prompt built ({N} chars)` | Prompt assembled |
| DALL-E | `Scene {i+1} prompt (mood {M}/10): {visualBeat}` | What's being generated |
| DALL-E | `[DALLE] Full prompt length: {N} chars` | Prompt size check |
| DALL-E | `✓ Scene {i+1} image generated` | Success |
| DALL-E | `DALL-E API error: {status} {error}` | API failure |
| DB Save | `[IMAGES] ✓ Scene {i+1} saved to database` | Asset persisted |

### Example Log Sequence (Successful Run)

```
[CHECK] Job abc123: progress=50, images=0/3, meta.scene_count=3
[CHECK] Triggering images phase (scenes: 3, images: 0)
[IMAGES] Starting images phase for job abc123
[IMAGES] 0/3 images already generated
[createStoryAnchor] Using built-in style: Cinematic Dark
Story Anchor created: A dark, ancient forest at night. Towering pine trees...
[IMAGES] Creating visual beats...
[IMAGES] Visual beats created
[IMAGES] Generating scene 1/3...
Scene 1 prompt (mood 3/10): A woman stands frozen at the forest entrance
[DALLE] Full prompt length: 847 chars
✓ Scene 1 image generated
[IMAGES] ✓ Scene 1 saved to database
[IMAGES] Generating scene 2/3...
...
```

---

## Common Failure Points

### 1. Missing Fields

| Field | Where | Symptom | Fix |
|-------|-------|---------|-----|
| `custom_style` | create-job request | Custom style ignored, falls back to cinematic-dark | Check frontend is sending `custom_style` object when `art_style.startsWith('custom-')` |
| `scene_count` | job.meta | Always generates 4 scenes | Ensure `scene_count` is passed in request and stored in `meta` |
| `characterDescription` | StoryAnchor | Inconsistent characters across scenes | GPT may return `null`; check system prompt enforcement |

### 2. Malformed JSON from GPT

| Call | Symptom | Defense |
|------|---------|---------|
| Story generation | Missing `title` or `story` | Fallback to generic title, throw if `story` missing |
| Scene keywords | Not an array | Code handles both `{ scenes: [...] }` and `[...]` formats |
| Story Anchor | Missing `fullAnchorPrompt` | Falls back to preset anchors based on `visualPreset` |
| Visual Beats | Missing mood escalation | Uses default beat: `{ moodLevel: 5, cameraAngle: "medium shot" }` |

### 3. Scene Count Mismatch

**Symptom:** User selects 3 scenes but gets 5 images.

**Cause:** Story has many sentences, splitting algorithm creates more scenes.

**Current Fix:** `extractSceneKeywords` now uses array slicing to guarantee exactly `targetSceneCount` scenes:
```typescript
for (let i = 0; i < targetSceneCount; i++) {
  const startIdx = i * sentencesPerScene;
  const endIdx = (i === targetSceneCount - 1) ? sentences.length : ...
  sceneTexts.push(sentences.slice(startIdx, endIdx).join(''));
}
```

### 4. Style Drift Between Scenes

**Symptom:** Scene 1 is pixel art, Scene 3 is photorealistic. OR custom style looks like "graphic novel" instead of "meme webcomic".

**Root Cause:** Anchor/beat language **contaminates** the custom style. Terms like "cinematic", "film grain", "dramatic lighting" in the environment/beat text override the user's intended style.

**Fix (Implemented Jan 27):**

1. **Two separate prompt paths:**
   - Custom style: Style block first, content is SANITIZED
   - Built-in style: Original mixed approach

2. **Forbidden style terms are stripped:**
   ```typescript
   stripForbiddenStyleTerms("dark cinematic forest with dramatic lighting")
   // → "dark forest with lighting"
   ```

3. **Technical line NOT appended for custom styles:**
   - `storyAnchor.cameraStyle` often contains "cinematic horror, film grain" which kills clean styles
   - Custom styles only use `customStyle.technicalStyle`

**Verification checklist for custom style prompts:**

✅ Contains:
- User's exact `basePrompt` at the top
- User's exact `colorOverride` and `technicalStyle`
- `isCustomStyle: true` in logs

❌ Does NOT contain:
- `cinematic`, `film grain`, `DOF`, `noir`, `graphic novel`, `crosshatching`
- `Technical: {storyAnchor.cameraStyle}` line
- Horror escalation language like "cosmic dread", "visceral terror"

### 5. Prompt Too Long

**Symptom:** DALL-E returns 400 error.

**DALL-E 3 Limit:** ~4000 characters (exact limit implementation-dependent)

**Debug:** Log shows `[DALLE] Full prompt length: {N} chars`

**Fix:** Truncate `fullAnchorPrompt` or `visualBeat` if combined length > 3500.

### 6. Inconsistent Character Appearance

**Symptom:** Character has different hair/clothing in each scene.

**Causes:**
- `characterDescription` is `null`
- GPT generates vague description
- Character line not present in final prompt

**Debug Check:**
```sql
SELECT meta->>'character_description' 
FROM job_assets 
WHERE job_id = 'xxx' AND type = 'dalle_image';
```

### 7. Image URL Expired

**Symptom:** Images show in preview but fail in video assembly.

**Cause:** DALL-E URLs expire in ~2 hours.

**Current Handling:** Images are downloaded immediately by the FFmpeg renderer service. The renderer downloads all images to local temp storage before assembly, so expiration is rarely an issue. If using Creatomate fallback, URLs must be valid at render time.

### 8. Images Generated Sideways/Rotated

**Symptom:** Portrait images rendered with content rotated 90°.

**Causes:**
- Prompt says "portrait 9:16" but camera language implies landscape
- DALL-E prioritizes semantic camera language over aspect hints
- No explicit "up/down" direction defined

**Fix (Implemented):**

1. **ORIENTATION LOCK** at TOP of every prompt:
```
ORIENTATION LOCK:
Upright portrait composition (9:16). Do NOT rotate the scene.
Top of image = sky/ceiling. Bottom of image = ground/floor.
Vertical framing required.
```

2. **Camera angle sanitization** — auto-rewrite landscape terms:
```typescript
sanitizeCameraAngleForPortrait("wide establishing shot")
// → "tall vertical establishing shot"
```

3. **Post-generation safety net** (TODO):
```typescript
// Read image dimensions
// If width > height → rotate 90°
// Save corrected version before Creatomate
```

---

## How to Reproduce a Single Scene

Given a `job_id` and `scene_index`, follow this checklist to rebuild and regenerate:

### Step 1: Get Job Data

```sql
SELECT 
  id,
  meta->>'art_style' as art_style,
  meta->'custom_style' as custom_style,
  meta->'story_anchor' as story_anchor,
  meta->'visual_beats' as visual_beats,
  story_text,
  visual_preset
FROM jobs 
WHERE id = '{job_id}';
```

### Step 2: Get Scene Data

```sql
SELECT 
  meta->>'scene_index' as scene_index,
  meta->>'scene_text' as scene_text,
  meta->>'dalle_prompt' as dalle_prompt,
  meta->>'visual_beat' as visual_beat,
  meta->>'mood_level' as mood_level,
  meta->>'camera_angle' as camera_angle
FROM job_assets 
WHERE job_id = '{job_id}' 
  AND type = 'dalle_image'
  AND (meta->>'scene_index')::int = {scene_index};
```

### Step 3: Rebuild styleConfig

> **Note (Issue #7):** This describes the legacy `run-job` pipeline. The current `worker-v1` pipeline fetches style config from the `art_styles` DB table first (16 styles), falling back to hardcoded `styleTemplates` only if DB is unavailable.

```typescript
let styleConfig;
if (art_style.startsWith('custom-') && custom_style) {
  styleConfig = {
    name: custom_style.name,
    basePrompt: custom_style.basePrompt,
    colorOverride: custom_style.colorOverride,
    technicalStyle: custom_style.technicalStyle,
    negativePrompt: custom_style.negativePrompt
  };
} else {
  styleConfig = ART_STYLE_CONFIG[art_style];
}
```

### Step 4: Rebuild Beat

```typescript
const beat: VisualBeat = {
  sceneIndex: scene_index,
  visualBeat: visual_beat,  // from DB
  cameraAngle: camera_angle,
  focus: "the atmosphere",  // may need to query visual_beats array
  moodLevel: mood_level
};
```

### Step 5: Rebuild Final Prompt

```typescript
const finalPrompt = buildFinalDallePrompt(
  story_anchor,  // from job.meta
  beat,
  scene_index,
  total_scenes,
  styleConfig
);
```

### Step 6: Compare with Stored Prompt

```typescript
console.log("Stored prompt:", dalle_prompt);  // from job_assets
console.log("Rebuilt prompt:", finalPrompt);
// Should be identical
```

### Step 7: Regenerate Image

```bash
curl -X POST https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "{finalPrompt}",
    "n": 1,
    "size": "1024x1792",
    "quality": "hd"
  }'
```

---

## Concrete Examples

### Sample Step 1 Payload

```json
{
  "theme": "paranormal",
  "length_preset": "medium",
  "visual_preset": "forest",
  "visual_source": "dalle",
  "art_style": "custom-abc123",
  "custom_style": {
    "name": "8-bit Pixel Horror",
    "basePrompt": "Pixel art horror in the style of early 90s adventure games. 320x200 aesthetic, limited 16-color palette, dithered shadows, CRT scanline effect.",
    "colorOverride": "limited palette: deep greens, blacks, muted browns, single accent color",
    "technicalStyle": "side-scrolling game perspective, pixel-perfect edges, no anti-aliasing",
    "negativePrompt": "photorealistic, 3D render, smooth gradients, high resolution, modern graphics"
  },
  "scene_count": 3,
  "preview_only": true,
  "effect_filter": true,
  "effect_kenburns": true,
  "effect_vignette": true,
  "caption_style": "bold",
  "highlight_scary": true
}
```

### Sample Story Anchor JSON

```json
{
  "environment": "dark pixel art forest with twisted 8-bit trees, chunky fog sprites rolling along the ground, limited color palette creating stark contrasts",
  "colorPalette": "16-color palette: 4 shades of green, 3 blacks/grays, muted browns, single red accent",
  "cameraStyle": "side-scrolling game perspective, static camera with slight parallax, pixel-perfect rendering",
  "horrorTone": "retro psychological horror, nostalgic unease, something wrong with childhood memories",
  "timeOfDay": "perpetual twilight, amber sky gradient in 4 color bands",
  "recurringMotifs": "glitching sprites, corrupted tiles, eyes in the darkness between trees, static noise",
  "characterDescription": "young woman sprite, 32x64 pixels, brown ponytail (4 pixels wide), blue jacket, white shirt, determined expression, 3-frame walk cycle",
  "continuityRules": "Character always faces right except in danger. Trees always have exactly 3 branches. Fog always moves left-to-right. Eyes in darkness always red, 2x2 pixels.",
  "fullAnchorPrompt": "Pixel art horror in the style of early 90s adventure games. A dark forest scene with twisted 8-bit trees, chunky fog sprites, limited 16-color palette of deep greens and blacks. CRT scanline effect, dithered shadows, 320x200 aesthetic. Side-scrolling game perspective with pixel-perfect edges. Retro psychological horror atmosphere, nostalgic yet deeply unsettling."
}
```

### Sample Visual Beat JSON

```json
{
  "sceneIndex": 0,
  "visualBeat": "A pixel art woman sprite stands at the forest entrance, her 32x64 form barely visible against the dark trees, chunky fog sprites rolling past her feet",
  "cameraAngle": "wide side-scrolling view, full scene visible",
  "focus": "the character sprite at screen left, dark forest filling right side",
  "moodLevel": 3
}
```

### Sample Final DALL-E Request Body (Custom Style)

```json
{
  "model": "dall-e-3",
  "prompt": "Pixel art horror in the style of early 90s adventure games. 320x200 aesthetic, limited 16-color palette, dithered shadows, CRT scanline effect.\nColors: limited palette: deep greens, blacks, muted browns, single accent color\nTechnique: side-scrolling game perspective, pixel-perfect edges, no anti-aliasing\n\nORIENTATION LOCK:\nUpright portrait 9:16. Character and objects must be upright (not rotated).\nNo dutch angle. No tilted horizon. Top = sky/ceiling. Bottom = ground/floor.\n\nScene content:\nSetting: dark forest with twisted trees, fog rolling along the ground\nAction: A woman sprite stands at the forest entrance, her form barely visible against the dark trees, fog rolling past her feet\nCamera framing: tall vertical establishing shot (portrait framing)\nFocus: the character sprite at screen left, dark forest filling right side\nMood intensity: 3/10\nCharacter: young woman sprite, 32x64 pixels, brown ponytail, blue jacket, white shirt\n\nAvoid: photorealistic, 3D render, smooth gradients, high resolution, modern graphics\n\nCRITICAL: Portrait orientation (9:16 aspect ratio). Absolutely NO text, NO words, NO letters, NO writing anywhere in the image.",
  "n": 1,
  "size": "1024x1792",
  "quality": "hd",
  "response_format": "url"
}
```

**Key differences from built-in style prompts:**
1. **Style block FIRST** — User's exact `basePrompt`, `colorOverride`, `technicalStyle`
2. **Content is SANITIZED** — No "cinematic", "film grain", "dramatic lighting" in Setting/Action
3. **NO Technical line** — `storyAnchor.cameraStyle` is NOT appended (would contaminate style)
4. **Simple mood** — Just `3/10` not "creeping anxiety, shadows seem to shift"

### Sample Final DALL-E Request Body (Built-in Style)

```json
{
  "model": "dall-e-3",
  "prompt": "ORIENTATION LOCK:\nUpright portrait 9:16. Character and objects must be upright (not rotated).\nNo dutch angle. No tilted horizon. Top = sky/ceiling. Bottom = ground/floor.\n\nSTYLE LOCK: Maintain exact Cinematic Dark style throughout. Do not change art style, color palette, or rendering technique.\n\nA dark, ancient forest at night. Towering pine trees with twisted roots, heavy fog rolling through the ground, moonlight barely piercing the dense canopy. Muted greens and cold blue tones with deep shadows. Cinematic horror style, realistic, film grain, psychological horror mood.\n\nScene 1 of 3: A woman stands frozen at the forest entrance, fog swirling around her feet\nCamera: tall vertical establishing shot\nFocus: the woman's silhouette against the dark trees\nMood: creeping anxiety, shadows seem to shift at the edges\nContinuity: Trees always gnarled, fog at ground level, moonlight from upper left\nCharacter: woman in her 30s, dark hair, red jacket, jeans\n\nAvoid: text, words, letters, watermarks, signatures\n\nTechnical: cinematic horror, film grain, shallow depth of field\nColors: muted greens, cold blues, deep blacks\nRecurring elements: fog between trees, shadows that move, darkness beyond treeline\n\nCRITICAL: Portrait orientation (9:16 aspect ratio). Absolutely NO text, NO words, NO letters, NO writing, NO symbols with text anywhere in the image.",
  "n": 1,
  "size": "1024x1792",
  "quality": "hd",
  "response_format": "url"
}
```

---

## Quick Reference: Database Tables

### `jobs` Table

| Column | Type | Contains |
|--------|------|----------|
| `id` | uuid | Job ID |
| `status` | text | "preview", "generating", "rendering", "complete", "failed" |
| `progress` | int | 0-100 |
| `title` | text | Story title |
| `story_text` | text | Full story |
| `visual_preset` | text | Environment selection |
| `meta` | jsonb | All settings + `story_anchor` + `visual_beats` |
| `error` | text | Error message if failed |

### `job_assets` Table

| Column | Type | Contains |
|--------|------|----------|
| `id` | uuid | Asset ID |
| `job_id` | uuid | Parent job |
| `type` | text | "scene_data", "dalle_image", "bg_video", "final_mp4" |
| `storage_path` | text | URL or path identifier |
| `meta` | jsonb | Scene-specific data including `dalle_prompt` |

---

## Version History

| Date | Change |
|------|--------|
| Feb 8, 2026 | Updated documentation for FFmpeg renderer (primary), Creatomate (legacy fallback) |
| Feb 8, 2026 | Updated active vibe presets: only `urban_legend` and `one_too_many` are production |
| Jan 27, 2026 | **MAJOR:** Added anti-drift fields to SceneVisualContract: `forbiddenElements`, `continuityFromPrev`, `evidenceRule` |
| Jan 27, 2026 | **MAJOR:** Switched prompt format to MUST SHOW / MUST NOT SHOW blocks |
| Jan 27, 2026 | Simplified ORIENTATION LOCK - removed forced one-point perspective that caused hallway/stair drift |
| Jan 27, 2026 | Added alignment score logging: `[CONTRACT] scene=X location=Y objects=N forbidden=N evidence=Y` |
| Jan 27, 2026 | Removed "cosmic dread", "visceral terror" from FORBIDDEN_STYLE_TERMS (valid horror tone words) |
| Jan 27, 2026 | Composition is now optional via `compositionHint` instead of forced |
| Jan 27, 2026 | **MAJOR:** Added Scene Visual Contract system — converts prose to literal frames |
| Jan 27, 2026 | Added `SceneVisualContract` interface (location, pose, objects, supernatural element) |
| Jan 27, 2026 | Added `createSceneVisualContracts()` GPT function |
| Jan 27, 2026 | Visual contracts cached in `jobs.meta.visual_contracts` |
| Jan 27, 2026 | **MAJOR:** Added Character Consistency System with CharacterLock |
| Jan 27, 2026 | Added `CharacterLock` interface (id, face, outfit, silhouette, doNotChange) |
| Jan 27, 2026 | Added `ContentAnchor` interface for environment/world consistency |
| Jan 27, 2026 | Added `StyleAnchor` interface for render style consistency |
| Jan 27, 2026 | Added character extraction functions (extractCharacterFace, extractCharacterOutfit, etc.) |
| Jan 27, 2026 | Added `generateCharacterId()` for stable character hashing |
| Jan 27, 2026 | Added `buildCharacterLockBlock()` for CHARACTER LOCK prompt section |
| Jan 27, 2026 | Extended VisualBeat with mirrorBehavior, realityRule, compositionHint fields |
| Jan 27, 2026 | Updated `createVisualBeats()` to generate horror-specific mirror/reality rules |
| Jan 27, 2026 | Rewrote `buildFinalDallePrompt()` with unified priority-ordered template |
| Jan 27, 2026 | Split into two prompt paths (custom vs built-in style) |
| Jan 27, 2026 | Added `stripForbiddenStyleTerms()` sanitizer for custom styles |
| Jan 27, 2026 | Custom styles no longer append `storyAnchor.cameraStyle` |
| Jan 27, 2026 | Added `isCustomStyle` flag throughout pipeline |
| Jan 27, 2026 | Added camera angle sanitization for portrait-safe terms |
| Jan 2026 | Added `continuityRules` to StoryAnchor |
| Jan 2026 | Added STYLE LOCK line to all prompts |
| Jan 2026 | Added deterministic mood level mapping |
| Jan 2026 | Changed `characterDescription` to mandatory when humans present |
| Jan 2026 | Added `negativePrompt` as "Avoid:" line (DALL-E 3 has no native negative_prompt) |

---

## Active Vibe Presets

> **Note (Feb 2026):** As of v4.0, only **two story engines** are actively used in production:
> 
> | Preset | Description | Art Style |
> |--------|-------------|-----------|
> | `urban_legend` | Documentary folklore, creepypasta style | cinematic-dark (default) |
> | `one_too_many` | Counting horror (N+1 pattern) | **uncanny-illustrated** (forced) |
>
> Legacy presets (`slow_creepy`, `analog_horror`, `cosmic_horror`, etc.) still exist for backwards compatibility but are deprecated in the UI.
