# `two_doors` Preset Upgrade Spec — v2.0

> **Brand:** Decide This Daily  
> **Preset:** `two_doors`  
> **Platforms:** Instagram Reels · Facebook Reels · YouTube Shorts  
> **Date:** March 2026  
> **Status:** DEPLOYED (March 16, 2026)  
> **Author:** Internal preset engineering

---

## Table of Contents

1. [Diagnosis: Why v1 Underperforms](#1-diagnosis)
2. [Upgraded Creative Philosophy](#2-philosophy)
3. [Preset Design Spec v2](#3-design-spec)
4. [Beat Structure v2](#4-beat-structure)
5. [Generation Prompt v2](#5-generation-prompt)
6. [Quality Gates](#6-quality-gates)
7. [Avoid Rules (Anti-Patterns)](#7-avoid-rules)
8. [Rewritten Example Stories](#8-rewritten-examples)
9. [10 Example Hooks](#9-example-hooks)
10. [10 Dilemma Seeds](#10-dilemma-seeds)
11. [Target Length Recommendation](#11-target-length)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Final Production Recommendations](#13-final-production-recommendations)

---

<a name="1-diagnosis"></a>
## 1. Diagnosis: Why v1 Underperforms for Short-Form

The current `two_doors` engine generates poetic binary-choice vignettes. The problem is that it writes like a **symbolic allegory**, not a **scroll-stopping spoken challenge**. Here's what's wrong:

### 1.1 Word Count Is Far Too Long

The current DB config sets word targets of 95–125 (target 110). The story profile is configured at 110 ± 15. At ~2.5 words per second TTS, this produces **44–50 second videos**.

Short-form "pick one" content performs best at **20–32 seconds** — long enough to present both paths clearly, short enough for high completion rate and replays. That means **70–95 words**.

The current range wastes 15–20 seconds on filler that dilutes the impact of the binary choice.

### 1.2 Hooks Are Atmospheric, Not Immediate

The current prompt says: *"State the framing device in ONE sentence, no backstory."*

In practice, GPT produces openers like:

> "In an old studio, two blank canvases stand before you, each vibrant and swirling with colors yet to be born."

That's scene description. The framing device is buried inside descriptive language. On Reels and Shorts, the viewer has **1.3 seconds** before deciding to keep scrolling. The framing device must land immediately — as the very first image, not as window dressing.

Better:
> "Two canvases appear in front of you."

Six words. Framing device established. Viewer is hooked.

### 1.3 Too Much Poetic Description

The current prompt encourages "vivid, specific, genuinely appealing" paths and "parallel sentence structure." GPT interprets this as license for literary prose:

> "Behind the first door, the air carries the scent of salt and distant shores; the second hums with the quiet warmth of a hearth you've always known."

This is beautiful writing. It's terrible short-form narration. Every decorative phrase is a second lost. Viewers process spoken content literally — metaphor requires cognitive work that slows comprehension and kills pacing.

Short-form paths need **concrete clarity**, not poetic texture.

### 1.4 Paths Are Not Structurally Separated

The current prompt and beat structure (4 beats: FRAME, PATH_A, PATH_B, CUT) doesn't enforce clear separation. Paths are often buried inside flowing paragraphs, making it difficult for the viewer to distinguish where one option ends and the other begins.

Viewers need an unmistakable **pivot signal**: "Behind the first door..." / "Behind the second door..." — or even clearer structural breaks.

### 1.5 Framing Device Detection Is Too Rigid

The current `gateTwoDoors()` quality gate only recognizes:

```
doors, pills, paths, portals, envelopes, timelines, keys, boxes, buttons, corridors, gates, roads
```

Plus a few positional variants (`door one`, `left path`, etc.).

But GPT frequently generates perfectly valid framing devices outside this list:

- canvas, mirror, book, bridge, staircase, window, river, road, hallway, coin, switch, lever, key, scroll, clock, tunnel, lamp, compass, map, photo, letter, flame, ring, bottle, stone

The gate rejects good stories because the framing vocabulary is arbitrarily narrow.

### 1.6 Stories Don't Drive Comment Engagement

The current prompt says paths should be "genuinely appealing" and "equally appealing" — but it doesn't specify **what kind** of contrast makes people argue. 

The strongest binary-choice content pits **value conflicts** against each other:

- Freedom vs. security
- Power vs. love
- Knowledge vs. peace
- Adventure vs. stability
- Truth vs. happiness
- Ambition vs. belonging

Without this explicit guidance, GPT produces surface-level aesthetic contrasts ("one path is warm, one is cool") instead of deep value tensions that split audiences 50/50 and generate comment debates.

### 1.7 The Ending Question Is Weak

The current prompt says: *"End with: 'Which door do you open?' or similar."*

This produces formulaic, predictable endings. The question should feel like a direct challenge, not a polite prompt. It should match the framing device and feel sharp:

- "Which canvas do you paint?" 
- "Which life do you walk into?"
- "So which one do you choose?"

---

<a name="2-philosophy"></a>
## 2. Upgraded Creative Philosophy

### Core Principle: The Choice IS the Content

v1 treats the framing device as a narrative wrapper around two parallel descriptions. v2 treats the **value conflict** as the only thing that matters — the framing device is just the delivery mechanism.

### How `two_doors` Complements `no_good_choice`

| Preset | Emotional Engine | Viewer Feeling |
|--------|-----------------|----------------|
| `no_good_choice` | Lose-lose: both options **hurt** | "I don't want EITHER of these." |
| `two_doors` | Win-win conflict: both options are **desirable but incompatible** | "I want BOTH of these." |

This is a critical distinction. `no_good_choice` creates discomfort. `two_doors` creates **longing** — the viewer wants both paths and must sacrifice one forever.

### Philosophy Pillars

**1. Framing device first, always.**  
The first sentence presents the symbolic frame — two doors, two keys, two canvases, two roads. No adjectives. No atmosphere. Just the device. The viewer must see the binary structure within 2 seconds.

**2. Desire on both sides.**  
Both paths must be genuinely tempting. Not "good vs. bad." Not "easy vs. hard." Both should represent something the viewer **actually wants**: love, freedom, knowledge, adventure, stability, creativity, power, belonging. The tension comes from wanting both and having to sacrifice one.

**3. Value conflict is mandatory.**  
The two paths must represent different **life values** in tension. This is what drives comment debate. Generic aesthetic contrasts ("warm vs. cool", "nature vs. city") are too shallow. The paths must force the viewer to rank their priorities: "Do I value freedom more than love? Knowledge more than peace?"

**4. Concrete over abstract.**  
"You wake up every morning with no alarm, no boss, no schedule" beats "freedom and independence." "Your partner is always beside you, your kids know your name" beats "love and belonging." Paint each path as a specific, tangible life moment.

**5. Short, clear, spoken.**  
Every sentence must sound natural when read aloud. No semicolons. No literary flourishes. No complex metaphors. The viewer processes spoken words linearly — every syllable of confusion is a lost viewer.

**6. No hints, no consequences revealed.**  
The framing device must feel permanent and blind. The viewer chooses without knowing what happens. This is what separates `two_doors` from `no_good_choice` — there is no visible cost. Only the sacrifice of the unchosen path.

**7. The question is a challenge.**  
The final question shouldn't feel like a polite "what would you do?" — it should feel like a direct dare. Match the framing device. Make it personal.

---

<a name="3-design-spec"></a>
## 3. Preset Design Spec v2

### Identity

| Field | Value |
|-------|-------|
| **Preset ID** | `two_doors` |
| **Brand** | Decide This Daily |
| **Category** | Decision / value conflict |
| **Core mechanic** | Desirable but incompatible life choices |
| **POV** | Second person ("you") |
| **Tone** | Calm-provocative — like someone offering a gift you can only half-accept |
| **Visual type** | AI images — high-contrast cinematic (`ai_images_contrast`) |
| **Platform targets** | Instagram Reels, Facebook Reels, YouTube Shorts |

### Purpose

Generate short-form spoken narration presenting a symbolic binary choice where both options represent genuinely desirable but mutually exclusive life paths. The viewer must sacrifice one to gain the other.

### Emotional Target

The viewer should feel:
- **Torn** — "I want both of these."
- **Forced** — "But I can only pick one."
- **Opinionated** — "The first one, easily — wait, actually..."
- **Curious** — swipes to comments to see what others chose and why

### Ideal Audience Reaction

- Pauses scrolling within 1 second (framing device catches the eye)
- Watches to the end to hear both paths fully
- Feels genuine longing for both options
- Immediately types a comment with their choice and reasoning
- Replays the video to reconsider
- Shares to a friend: "which one would YOU pick?"

### What Makes a STRONG Story

- Framing device appears in the very first sentence — no buildup
- Both paths are genuinely desirable — viewer wants both
- The value conflict is deep (freedom vs. love, not sunny vs. rainy)
- Each path is described with one concrete, tangible life moment 
- Sentences are short, clear, and TTS-native
- The question at the end feels like a personal challenge
- Viewers would genuinely split 50/50

### What Makes a WEAK Story

- Hook is atmospheric scene description ("In an ancient temple...")
- Framing device appears mid-paragraph instead of sentence one
- One path is obviously better than the other
- Paths are aesthetic contrasts rather than value conflicts (warm vs. cold)
- Language is poetic or literary ("swirling with colors yet to be born")
- Paths are described in flowing paragraphs without clear separation
- Question is generic ("What would you choose?") or formulaic
- Story requires fantasy or supernatural context to make sense
- Both paths represent the same fundamental value

---

<a name="4-beat-structure"></a>
## 4. Beat Structure v2

### v1 Beat Map (current — 4 beats)

```
FRAME → PATH_A → PATH_B → CUT
```

Problems: FRAME often becomes atmospheric scene-setting. PATH_A and PATH_B run together without clear boundaries. CUT doesn't specify question quality. No beat enforces the value conflict.

### v2 Beat Map (upgraded — 5 beats)

| Beat | Label | Purpose | Target Length | Feel |
|------|-------|---------|-------------|------|
| **1** | `HOOK` | Present the framing device immediately. The viewer sees the binary structure in the first sentence. No buildup, no atmosphere, no scene-setting. | 1 sentence (5–12 words) | Instant. Clean. Visual. |
| **2** | `FRAME` | One sentence explaining that the choice is permanent and the two options represent different lives. Seal the stakes. | 1 sentence (8–15 words) | Gravity. Finality. |
| **3** | `PATH_A` | Describe the first life path with one concrete, tangible moment that makes it real. What does this life look like on a Tuesday morning? Not abstract values — specific scenes. | 2–3 sentences (18–28 words) | Desire. Longing. "I want this." |
| **4** | `PATH_B` | Describe the second life path with equal specificity and appeal. Different value category. Same level of desirability. The viewer should want this one too, equally. | 2–3 sentences (18–28 words) | Desire. Conflict. "But I want this too." |
| **5** | `QUESTION` | Direct, sharp question that matches the framing device. No softening. No summary. A challenge. | 1 sentence (4–10 words) | Dare. Direct eye contact energy. |

### Why 5 Beats Instead of 4

The old structure lacked a dedicated HOOK beat — the framing device was merged into FRAME, allowing atmospheric openers. The new structure **forces** the framing device into its own beat (sentence one), then separates the stakes explanation (FRAME beat) from the paths. This creates a clean, fast rhythm: device → stakes → path → path → question.

### Why Not 7 Beats Like `no_good_choice`?

`no_good_choice` needs 7 beats because it must present two options AND two costs (4 distinct pieces of content). `two_doors` presents two options with **no explicit costs** — the cost is implicit (losing the unchosen path). This means fewer beats, shorter script, faster pace.

### Pacing Guide

```
Beat 1 (HOOK):       ████░░░░░░░░░░░░░░░░░░░░░░░░░░  ~8%
Beat 2 (FRAME):      ██████░░░░░░░░░░░░░░░░░░░░░░░░  ~12%
Beat 3 (PATH_A):     ████████████████░░░░░░░░░░░░░░  ~32%
Beat 4 (PATH_B):     ████████████████░░░░░░░░░░░░░░  ~32%
Beat 5 (QUESTION):   ████████░░░░░░░░░░░░░░░░░░░░░░  ~16% (pause-weighted for TTS)
```

The two path beats get the most time. That's where the emotional tension lives — the viewer is weighing two desirable futures against each other.

---

<a name="5-generation-prompt"></a>
## 5. Generation Prompt v2

This replaces the existing `two_doors` prompt in `worker-v1/steps.ts`.

```
a symbolic binary choice presenting two desirable but incompatible life paths through a framing device. The viewer must sacrifice one to gain the other.

FORMAT — 5 beats, strict order:

BEAT 1 — HOOK (1 sentence):
Present the framing device immediately. First sentence. The viewer sees two objects, two paths, two options within the first two seconds. No backstory. No atmosphere. No "you find yourself in..." openers. State the device plainly.
Examples of strong hooks:
- "Two doors appear in front of you."
- "Two envelopes sit on the table."
- "A coin lands in your hand. Heads or tails."
- "Two keys. One gold. One silver."
Examples of weak hooks (NEVER open like these):
- "In an old studio, two blank canvases stand before you, each vibrant and swirling..." — too atmospheric
- "You're standing at a crossroads, the wind carrying whispers of two different futures..." — scene-setting
- "Imagine a place where every choice leads to a different world..." — abstract and slow

BEAT 2 — FRAME (1 sentence):
Explain that the choice is permanent and the two options represent different lives. This is the gravity sentence — the viewer understands the stakes. Keep it plain.
Examples:
- "You can only pick one. The other disappears forever."
- "Each one leads to a completely different life. There's no coming back."
- "One opens. The other locks forever."

BEAT 3 — PATH A (2-3 sentences):
Describe the first life path. Make it CONCRETE and TANGIBLE. Don't say "freedom and adventure" — describe what the viewer's life actually looks like: what they see when they wake up, who's beside them, what their hands are doing, what sounds they hear. One specific, filmable moment.
Do NOT label it "Path A" or "Option A." Transition directly from the frame.
Transition examples:
- "Behind the first door..."
- "The gold key opens a life where..."
- "One path leads to..."

BEAT 4 — PATH B (2-3 sentences):
Describe the second life path with equal specificity and equal appeal. It must represent a DIFFERENT VALUE CATEGORY than Path A. If Path A is freedom, Path B should be belonging — NOT a different flavor of freedom.
Transition examples:
- "Behind the second door..."
- "The silver key opens a life where..."
- "The other path leads to..."

VALUE CONFLICT PAIRS (use these or invent similar ones):
- freedom vs. security
- adventure vs. stability  
- power vs. love
- knowledge vs. peace
- ambition vs. belonging
- truth vs. happiness
- creativity vs. comfort
- independence vs. family
- fame vs. privacy
- passion vs. safety

BEAT 5 — QUESTION (1 sentence):
Short, direct question that matches the framing device. No reflection. No summary. No softening. A dare.
Strong: "Which door do you open?"
Strong: "Which key do you turn?"
Strong: "So which life do you choose?"
Weak: "The choice is yours — what matters more?" — too soft
Weak: "It all depends on what you value most." — not even a question

RULES:
- Second person throughout ("you", "your"). Never break POV.
- ${wordRange.min}-${wordRange.max} words total. THIS IS CRITICAL.
- The framing device can be ANYTHING symbolic: doors, keys, envelopes, canvases, mirrors, bridges, roads, coins, buttons, switches, flames, rivers, stairs, windows, books, compasses, maps, bottles, stones, rings, clocks, lanterns, scrolls. The only rule is that there are TWO of them.
- Spoken-word native. Every sentence must sound natural read aloud. No semicolons. No literary flourishes. No poetic metaphors. No complex clauses.
- Short sentences dominate. Max one compound sentence per beat.
- Both paths must be GENUINELY DESIRABLE. Neither is "the bad one." The viewer must want both.
- Both paths must represent DIFFERENT VALUE CATEGORIES. Not two flavors of the same thing.
- Do NOT reveal consequences, downsides, or outcomes. The viewer chooses blind.
- Do NOT add moral commentary, reflection, or summarization after the paths.
- Do NOT use horror, supernatural, or fantasy framing. The symbolic device is a metaphor — the paths describe REAL life experiences.
- Do NOT literally write "Path A" or "Path B" or "Option A" or "Option B." Use natural transitions tied to the framing device.
- Scenario categories for paths: career, relationships, lifestyle, identity, geography, creativity, knowledge, community, family, legacy.
```

### What Changed From v1

| Aspect | v1 | v2 |
|--------|----|----|
| Opening | "a symbolic binary choice using a framing device (two doors, two pills, two paths, two envelopes, two timelines)" — lists devices inline | Clean imperative with beat structure. Device list moved to RULES section and massively expanded. |
| Hook | "State the framing device in ONE sentence, no backstory" — but no examples of weak hooks to reject | Explicit strong/weak hook examples with explanations. Atmospheric openers explicitly banned. |
| Beat count | 4 (FRAME, PATH_A, PATH_B, CUT) | 5 (HOOK, FRAME, PATH_A, PATH_B, QUESTION) — HOOK separated from FRAME, CUT renamed to QUESTION with quality guidance |
| Path description | "vivid, specific, genuinely appealing" — GPT defaults to poetic | "CONCRETE and TANGIBLE" — describe what the viewer's life actually looks like, specific moments |
| Value conflict | "Contrast types: adventure/stability, knowledge/bliss, power/love, freedom/belonging" — one line, easy to ignore | Dedicated section with 10 explicit value pairs. Enforcement rule: paths must represent DIFFERENT VALUE CATEGORIES |
| Framing device list | "doors, pills, paths, portals, envelopes, timelines" — 6 items | 25+ devices listed. Explicit rule: "can be ANYTHING symbolic" |
| Ending question | "End with: 'Which door do you open?' or similar" — formulaic | Strong/weak examples with quality criteria. Must match framing device. |
| Word count | 95–125 (target 110) | 70–95 (target 80) |
| Anti-patterns | "Do NOT reveal consequences" and "Do NOT make one path clearly better" — 2 rules | Full negative guidance: no labels, no poetic metaphors, no moral commentary, no supernatural, no same-category values |
| Labels | No rule against literal labels | Explicitly banned: "Do NOT literally write 'Path A' or 'Option A'" |
| Parallel structure | Required by prompt | Removed — replaced by value conflict requirement which is more important |

---

<a name="6-quality-gates"></a>
## 6. Quality Gates

These replace the existing `gateTwoDoors()` function. The function still calls `sharedDecisionGateChecks()` first (second-person voice, question ending, first-sentence length), then applies the preset-specific gates below.

### Structural Gates (hard fail → regenerate)

| # | Gate | Check Logic | Failure Message |
|---|------|------------|-----------------|
| G1 | **Framing device in sentence one** | The first sentence must contain a **symbolic binary device**. Detection: match `/(two|2|pair of|both)\s+(doors?|keys?|paths?|roads?|pills?|envelopes?|canvases?|mirrors?|bridges?|books?|buttons?|switches?|coins?|flames?|rivers?|stairs?|staircases?|windows?|scrolls?|clocks?|bottles?|stones?|rings?|lamps?|lanterns?|compasses?|maps?|photos?|letters?|tunnels?|hallways?|corridors?|gates?|portals?|boxes?|chests?|cups?|chalices?|orbs?|gems?|feathers?|masks?|cards?|levers?|ropes?|ladders?|ships?|trains?|tickets?|journals?|screens?|doors?|lights?|shadows?|worlds?|lives?)/i` in the first sentence. Also accept patterns like: `/(heads or tails|left or right|one .* or the other|door (one|1)|the first .* the second)/i`. | `"Framing device not found in first sentence — must open with a symbolic binary device (two doors, two keys, etc.)"` |
| G2 | **Two paths described** | Text must contain two structurally distinct path descriptions. Detection: look for **path transition language** — at least two of: `/(behind the (first|second|other)|the (first|gold|silver|left|right|red|blue) (door|key|path|envelope|mirror|coin|road|book|button)|one (leads?|opens?|takes? you|shows?|reveals?)|the other (leads?|opens?|takes? you|shows?|reveals?)|on one side|on the other)/i`. Fallback: at least one `/(or|the other|the second|alternatively|but the other)/i` appearing between two distinct descriptive passages. | `"Cannot identify two parallel paths — needs clear 'first path / second path' structure with transitions"` |
| G3 | **Value conflict present** | The two paths must represent meaningfully different values. Detection: extract keywords from each path section and check against value category buckets: **freedom** (`free, freedom, travel, wander, explore, adventure, open road, no rules, no limits, no schedule, anywhere`), **security** (`safe, secure, stable, steady, certain, guaranteed, protected, home, routine`), **love** (`love, partner, family, children, kids, heart, beside you, together, hold, connection, relationship`), **power** (`power, influence, control, lead, command, authority, throne, empire, rule`), **knowledge** (`know, learn, truth, understand, discover, wisdom, answers, curiosity, library, books`), **peace** (`peace, quiet, calm, still, silence, rest, content, simple, serene`), **ambition** (`ambition, career, success, build, create, achieve, legacy, famous, recognition, name`), **belonging** (`belong, community, roots, hometown, neighbors, tradition, history, family table`). Both paths must hit **different** buckets. If both hit the same bucket or neither hits any bucket, flag. | `"Value conflict missing — both paths must represent different life values (e.g., freedom vs. love, not two flavors of freedom)"` |
| G4 | **No consequences revealed** | Text must NOT reveal downsides, costs, or negative outcomes: `/(you lose|you'll lose|the cost|the price|the catch|downside|but you (can't|won't|never|lose)|consequence|sacrifice|risk|giving up|at the expense|trade.?off|but it means losing)/i`. Light comparative language is allowed ("you can't have both" is fine — it states the tradeoff existence without revealing costs). | `"Consequence or cost language detected — two_doors paths must be blind choices with no revealed downsides"` |
| G5 | **Direct final question** | Last sentence must end with `?`. Must be ≤ 12 words. Must NOT contain softening language: `/(it's up to you|what matters more|only you can decide|whatever you choose|it all depends|it comes down to|what do you value|depends on who you are)/i`. | `"Final line must be a short, direct question (≤12 words) with no softening"` |
| G6 | **No supernatural/fantasy** | No matches for: `/(magic|spell|ghost|demon|vampire|werewolf|zombie|supernatural|teleport|superpow|immortal|wizard|witch|dragon|curse|haunted|potion|enchant|alien|time.?travel|parallel.?universe|prophecy|sorcerer|mystical|enchanted)/i`. The framing device is symbolic — the paths describe real-world life experiences. | `"Supernatural/fantasy elements detected — paths must describe real-world lives"` |
| G7 | **No literal option labels** | Text must NOT contain `/(option|path|choice|door)\s*(a|b|1|2|one|two)\s*:/i` as a label pattern. Natural transition phrases like "behind door one" are fine — but "Path A:" as a structural label is banned. | `"Literal option labels detected ('Path A:', 'Option 1:', etc.) — use natural framing-device transitions instead"` |
| G8 | **No reflection or moralizing** | Last 2 sentences (excluding the final question) must not contain: `/(the choice is|each path|carries weight|in the end|whatever you choose|no right answer|both options|it all depends|no matter what|either way|the decision|only you know|it reveals|it says something about|what kind of person)/i`. | `"Reflection/moralizing detected — the paths should speak for themselves"` |

### Soft Gates (warn, don't block)

| # | Gate | Check Logic | Warning |
|---|------|------------|---------|
| S1 | **Hook length** | First sentence > 12 words. | `"Hook may be too long — aim for ≤10 words for instant framing device recognition"` |
| S2 | **Word count** | Outside target range (70–95). | `"Word count outside target range (70-95)"` |
| S3 | **Poetic language** | Contains ≥ 2 instances of: `swirling`, `whisper`, `shimmer`, `ethereal`, `vibrant`, `glow`, `radiant`, `luminous`, `cascade`, `blooming`, `dancing`, `caress`, `velvet`, `crystalline`, `iridescent`, `transcendent`. | `"Poetic language detected — use clear, concrete description instead"` |
| S4 | **Path balance** | One path section is more than 2x the word count of the other path section. (Approximate: split text at the second path transition marker and compare word counts of each half.) | `"Paths are unbalanced in length — both should receive roughly equal description"` |
| S5 | **Both paths desirable** | Either path contains negative/undesirable language: `/(lonely|alone|empty|cold|boring|monoton|dull|bleak|gray|grim|harsh|suffer|pain|miserable|unhappy|trapped)/i`. Both paths should feel appealing, not one appealing and one dreary. | `"Negative language in a path — both paths must be genuinely desirable, not one good and one bad"` |
| S6 | **Framing device consistency** | The final question should reference the same framing device as the hook (e.g., if hook says "two doors," question should say "door" not "path"). Heuristic: extract the device noun from sentence 1 and check if it appears in the final sentence. | `"Final question doesn't reference the same framing device as the hook — keep consistent"` |

---

<a name="7-avoid-rules"></a>
## 7. Avoid Rules (Anti-Patterns)

These are things the `two_doors` engine should **never produce**. Include as negative guidance in the prompt and use as review criteria.

### Atmospheric Scene-Setting Before the Device
> ❌ "In an old studio, two blank canvases stand before you, each vibrant and swirling with colors yet to be born."

The studio doesn't matter. The canvases are the hook.
> ✅ "Two canvases appear in front of you."

### Poetic / Literary Description of Paths
> ❌ "Behind the first door, the air carries the scent of salt and distant shores; memories of laughter drift on a warm breeze, and your footsteps fall lightly on sun-warmed cobblestones."  
> ❌ "The second path shimmers with the quiet luminescence of unwritten pages, each one a story waiting to unfold in the cathedral of your mind."

The viewer doesn't have time to decode metaphors. Describe a concrete life:
> ✅ "Behind the first door, you wake up in a different country every month. No job. No routine. Just a backpack and a one-way ticket."  
> ✅ "Behind the second door, you come home every night to the same person. Same kitchen. Same laugh. Twenty years and counting."

### Same-Category Value Contrast
> ❌ Path A: "Travel the world freely" / Path B: "Explore the unknown with no limits"  
> ❌ Path A: "Become wealthy" / Path B: "Become powerful"

These are two flavors of the same value. The contrast must be between genuinely **different** values:
> ✅ Path A (freedom): "Travel the world freely" / Path B (love): "Come home to the same person every night"  
> ✅ Path A (ambition): "Build an empire" / Path B (peace): "Live simply in the mountains, needing nothing"

### Revealing Consequences or Costs
> ❌ "You gain knowledge, but you lose the ability to feel joy."  
> ❌ "The freedom comes at a price — you never see your family again."  
> ❌ "But this path means leaving everything behind."

`two_doors` is a **blind choice**. No costs revealed. No catches. The sacrifice is implicit — you're giving up the other path — but never stated as a penalty.

### One Path Obviously Better
> ❌ Path A: "You live your dream life" / Path B: "You exist in mediocrity"  
> ❌ Path A: "You're surrounded by love" / Path B: "You sit alone in the dark"

Both paths must be genuinely desirable. If 90% of viewers would pick the same one without hesitation, the value conflict is broken.

### Literal Option Labels
> ❌ "Option A: A life of adventure..."  
> ❌ "Path B: A life of stability..."

Use the framing device naturally:
> ✅ "Behind the first door..."  
> ✅ "The silver key opens a life where..."

### Soft Final Questions
> ❌ "The choice is yours — what matters more to you?"  
> ❌ "It all depends on who you are. What would you choose?"  
> ❌ "Which one speaks to your heart?"

The question should be blunt and short:
> ✅ "Which door do you open?"  
> ✅ "Which key do you turn?"  
> ✅ "So, which life do you pick?"

### Reflection After the Paths
> ❌ "Both paths offer something beautiful. Only you know which one is right."  
> ❌ "The choice reveals what kind of person you are."

Never summarize or moralize. The paths speak for themselves. Go straight to the question.

### Fantasy / Supernatural Setting
> ❌ "In a realm between worlds, two enchanted portals shimmer before you..."  
> ❌ "A wizard offers you two magic potions..."

The framing device is symbolic, but the paths must describe **real-world lives** — jobs, relationships, cities, routines, families, experiences.

---

<a name="8-rewritten-examples"></a>
## 8. Rewritten Example Stories

### Example 1 — v1 Style (current)

> "In an old studio, two blank canvases stand before you, each vibrant and swirling with colors yet to be born. The first canvas comes alive under your brush with wild, untamed strokes of crimson and gold, each mark a leap into the unknown, alive with the thrill of risk and discovery. It's a world where you chase sunsets across foreign lands, where every morning is a blank page, and your heart races with possibility. The second canvas tells a different story, one of soft blues and steady greens, painted with careful, loving strokes. It shows a porch with a familiar view, a garden you planted years ago, children's laughter echoing through the halls, and a partner whose hand fits perfectly in yours. Which canvas do you paint?"

**128 words. Framing device buried in scene description. Paths are poetic rather than concrete. Runtime ~51 seconds — too long.**

### Example 1 — v2 Rewrite

> Two canvases appear in front of you.
>
> You can only paint one. The other stays blank forever.
>
> The first canvas becomes a life where you wake up in a different city every month. No alarm. No boss. No routine. You answer to nobody and every morning feels like the first day of something.
>
> The second canvas becomes a life where the same person is beside you for forty years. Same kitchen table. Same bedtime stories. You build something that lasts long after you're gone.
>
> Which canvas do you paint?

**84 words. ~24 seconds narration.**

### Why the Rewrite Is Stronger

| Aspect | v1 | v2 |
|--------|----|----|
| **Hook** | "In an old studio, two blank canvases stand before you" — 12 words, scene-setting | "Two canvases appear in front of you." — 7 words, immediate device |
| **Frame** | Implied, no explicit "you can only pick one" | "You can only paint one. The other stays blank forever." — clear finality |
| **Path A** | Poetic atmosphere: "sunsets across foreign lands," "heart races with possibility" | Concrete moments: "different city every month. No alarm. No boss. No routine." |
| **Path B** | Poetic atmosphere: "soft blues and steady greens," "children's laughter echoing through the halls" | Concrete moments: "same person beside you for forty years. Same kitchen table. Same bedtime stories." |
| **Value conflict** | Aesthetic (wild vs. gentle colors) | Deep (freedom vs. belonging) |
| **Question** | "Which canvas do you paint?" ✅ | "Which canvas do you paint?" ✅ |
| **Word count** | 128 (too long) | 84 (in range) |
| **Spoken feel** | Literary prose | Conversational challenge |

---

### Example 2 — v2 Fresh

**Title:** Gold Key, Silver Key

> Two keys. One gold. One silver.
>
> Each unlocks a different life. You can only turn one.
>
> The gold key opens a life where your name is known. You fill rooms when you speak. Your work changes how people think. Strangers recognize you on the street.
>
> The silver key opens a life where nobody knows your name, but one person knows every single thing about you. Quiet mornings. Long conversations about nothing. A love so steady it never needs to prove itself.
>
> Which key do you turn?

**82 words. ~24 seconds narration.**

Value conflict: **Fame vs. intimacy**.

---

### Example 3 — v2 Fresh

**Title:** Two Tickets

> Two plane tickets sit on the counter in front of you.
>
> Pick one. The other burns.
>
> The first ticket takes you somewhere you've never been. New language. New streets. New name if you want one. Nobody from your old life can find you. You start completely over.
>
> The second ticket takes you home. The house you grew up in. The friends who remember your middle name. Sunday dinners where nobody checks the time.
>
> Which ticket do you take?

**76 words. ~22 seconds narration.**

Value conflict: **Reinvention vs. roots**.

---

<a name="9-example-hooks"></a>
## 9. 10 Example Hooks

These are first-sentence hooks only — designed to establish the binary framing device within 2 seconds.

| # | Hook |
|---|------|
| 1 | Two doors appear in front of you. |
| 2 | Two envelopes sit on the table. |
| 3 | A coin lands in your hand. Heads or tails. |
| 4 | Two keys. One gold. One silver. |
| 5 | Two phones ring at the same time. |
| 6 | Two plane tickets sit on the counter. |
| 7 | Two roads split in front of you. |
| 8 | Two letters arrive at your door. |
| 9 | Two buttons. One red. One blue. |
| 10 | Two staircases. One goes up. One goes down. |

---

<a name="10-dilemma-seeds"></a>
## 10. 10 Dilemma Seeds

Full scenario concepts for future story generation:

| # | Seed | Path A (Value) | Path B (Value) |
|---|------|----------------|----------------|
| 1 | **Two Doors: Freedom vs. Love** | You live wherever you want, whenever you want. No roots, no obligations, total freedom. | You come home to the same person every night. Deep, steady, permanent love. You never wonder if you belong. |
| 2 | **Two Keys: Fame vs. Privacy** | Your name is known everywhere. Your work matters. People listen when you speak. | Nobody knows your name. But one person knows everything about you. Quiet, invisible, deeply known. |
| 3 | **Two Envelopes: Truth vs. Happiness** | You know the answer to every question you've ever asked. Nothing is hidden from you. The truth about everything. | You never learn another hard truth again. Every day feels warm. You're content with what you have. |
| 4 | **Two Tickets: Adventure vs. Stability** | Every month is somewhere new. New cities, new languages, new people. Nothing is permanent except the next departure. | Same town. Same neighbors. Your kids go to the school you went to. You know every face at the grocery store. |
| 5 | **Two Roads: Power vs. Peace** | You lead. People follow your decisions. You shape the world around you. The pressure never stops but neither does the impact. | You live simply. A cabin. A garden. Your biggest decision is what to cook for dinner. Nobody needs anything from you. |
| 6 | **Two Mirrors: Youth vs. Wisdom** | You stay exactly as you are right now. Same energy. Same body. Same fearlessness. You never age past today. | You gain fifty years of experience in an instant. You understand everything — people, patterns, consequences. But those years show. |
| 7 | **Two Coins: Wealth vs. Time** | You never worry about money again. Every bill is covered. Every door opens. But your days move fast — retirement arrives before you're ready. | You live modestly, but every day stretches long. You have more hours than anyone else. You're never rushed. |
| 8 | **Two Books: Knowledge vs. Connection** | You understand everything — science, history, language, human nature. Your mind is limitless. But you struggle to explain it to anyone. | You understand one person perfectly — and they understand you. No words wasted. No feelings missed. But the rest of the world stays mysterious. |
| 9 | **Two Bridges: Legacy vs. Presence** | Everything you build outlasts you. Your work, your name, your ideas — they echo for generations. But you're always working. Always building. | Nothing outlasts you. But every moment feels full. You are entirely, completely here for every second of your life. |
| 10 | **Two Windows: Independence vs. Family** | You answer to no one. Your schedule is yours. You eat when you want, sleep when you want, change your mind whenever you want. | Your kitchen table seats six every Sunday. Your kids argue over who sits where. It's loud and messy and yours. |

---

<a name="11-target-length"></a>
## 11. Target Length Recommendation

### Current

| Metric | Value |
|--------|-------|
| Word target (DB config) | 110 (range 95–125) |
| Word target (story profile) | 110 ± 15 |
| Avg spoken duration | ~44–50s |
| Words per second (TTS) | ~2.5 wps |

### Recommendation: Shorten Significantly

| Metric | New Target | Reasoning |
|--------|-----------|-----------|
| **Word target** | **80** | The v2 5-beat structure has no atmospheric setup and no reflection. 80 words at 2.5 wps = ~32s of speech. With TTS pauses and question hang-time, total lands ~28–35s. |
| **Word range** | **70–95** | Tight enough to enforce discipline, loose enough for two distinct path descriptions. |
| **Spoken duration** | **22–32s** | Sweet spot for binary-choice content on Reels/Shorts. Enough time to present both paths clearly. Short enough for high completion rates and replays. |

### Justification

**Short-form binary-choice content data:**
- "Pick one" / "This or that" format content performs optimally at 15–35s
- Two paths need roughly equal screen time (10–15s each at most)
- Under 20s doesn't leave enough time for two meaningful path descriptions
- Over 35s introduces filler that the format doesn't need — there are no costs to reveal, no consequences to describe
- Higher completion rates → more impressions → more loop replays → more comments

**Comparison with `no_good_choice`:**
- NGC at 80–110 words (40–50s): correct for 7 beats with costs to reveal
- `two_doors` at 70–95 words (22–32s): correct for 5 beats with no costs — shorter format, faster pace
- The difference in word count reflects the structural difference: `two_doors` has fewer beats and less content to present

### What to Change

| Location | Current | New |
|----------|---------|-----|
| `brand_templates.config_overrides.word_target` | 110 | 80 |
| `brand_templates.config_overrides.word_min` | 95 | 70 |
| `brand_templates.config_overrides.word_max` | 125 | 95 |
| Story profile `wordCount.target` | 110 | 80 |
| Story profile `wordCount.variance` | 15 | 10 |
| `steps.ts` word range override for `two_doors` | None (uses default) | Add override: `min = 70, max = 95` |

---

<a name="12-implementation-roadmap"></a>
## 12. Implementation Roadmap

---

### Phase 0 — Baseline Capture

**Purpose:** Establish current performance numbers before any code changes.

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| 0.1 | Record current `two_doors` metrics | Query platform analytics for the last 30 days: avg completion rate, comment rate, share rate, avg watch time. If insufficient data, note "baseline unavailable" and skip. |
| 0.2 | Save 5 v1 generated stories | Generate 5 stories with the current prompt (or pull from recent jobs). Save as reference samples. |
| 0.3 | Confirm current gate pass rate | Check `job_step_logs` for recent `two_doors` quality gate snapshots. Note how often v1 gates fire. |

**Files affected:** None — read-only.

**Rollback:** N/A — no changes made.

---

### Phase 1 — Prompt Replacement ✅ COMPLETED (March 16, 2026)

**Purpose:** Replace the v1 generation prompt with the v2 prompt (Section 5).

**Tasks:**

| # | Task | Detail | Status |
|---|------|--------|--------|
| 1.1 | Replace `two_doors` prompt string in `buildStoryPrompt()` | In `supabase/functions/worker-v1/steps.ts`, locate the `two_doors` case in the preset prompt map (~line 1054). Replace the entire prompt string with the v2 prompt from Section 5 of this spec. Keep the `${wordRange.min}-${wordRange.max}` template interpolation — it's still used. | ✅ Done |
| 1.2 | Verify the prompt wrapper is unchanged | The routing logic wraps the preset prompt with `Create ${vibeDesc}.${avoidanceSection}`. The v2 prompt starts with "a symbolic binary choice..." — which works with the `Create ` prefix (producing "Create a symbolic binary choice..."). Confirm no duplication. | ✅ Verified |
| 1.3 | Verify `${wordRange.min}` and `${wordRange.max}` interpolation | The v2 prompt contains `${wordRange.min}-${wordRange.max} words total. THIS IS CRITICAL.` — confirm this matches the existing template literal syntax. | ✅ Verified |

**Files affected:**

| File | Change |
|------|--------|
| `supabase/functions/worker-v1/steps.ts` | Replace prompt string at ~line 1054–1070. |

**Verify:**
- [x] v2 prompt is in place in the preset map
- [x] Wrapper logic produces correct final prompt (no "Create Create" duplication)
- [x] `${wordRange.min}` / `${wordRange.max}` interpolation confirmed working

**Rollback:** Revert the string in the preset map to the v1 prompt text.

---

### Phase 2 — Story Profile Update ✅ COMPLETED (March 16, 2026)

**Purpose:** Update the `two_doors` story profile to match the new beat structure and word counts.

**Tasks:**

| # | Task | Detail | Status |
|---|------|--------|--------|
| 2.1 | Update `beatStructure` | In `supabase/functions/run-job/story_profile.ts`, locate the `two_doors` profile (~line 1265). Change: `beatCount: 4` → `5`. `beatLabels: ["FRAME", "PATH_A", "PATH_B", "CUT"]` → `["HOOK", "FRAME", "PATH_A", "PATH_B", "QUESTION"]`. `minWordsPerBeat: 10` → `4`. `maxWordsPerBeat: 50` → `30`. | ✅ Done |
| 2.2 | Update `wordCount` | Change: `target: 110` → `80`. `variance: 15` → `10`. | ✅ Done |
| 2.3 | Update `voiceFormat.styleNotes` | Replace with: `"Short, punchy sentences. Framing device stated immediately. Two paths described with concrete, tangible life moments. Value conflict between paths. No poetic language. No literary flourishes. Each sentence must sound natural read aloud. Direct question at end matching the framing device."` | ✅ Done |
| 2.4 | Update `ending.allowedEndingTypes` | Confirm it includes `"direct_question"`. Current: `["open_loop", "direct_question"]` — no change needed. | ✅ Verified |

**Files affected:**

| File | Change |
|------|--------|
| `supabase/functions/run-job/story_profile.ts` | Update `two_doors` profile at ~line 1265. |

**Rollback:** Revert the profile config values.

---

### Phase 3 — DB Config Migration ✅ COMPLETED (March 16, 2026)

**Purpose:** Update the database word count configuration to match v2 targets.

**Tasks:**

| # | Task | Detail | Status |
|---|------|--------|--------|
| 3.1 | Update `brand_templates.config_overrides` | Updated via REST API PATCH: `word_target: 80`, `word_min: 70`, `word_max: 95`. Template ID: `a1ac6a70-492b-4424-92ff-cca671ca6e43`. | ✅ Done |
| 3.2 | Verify the update | Confirmed via GET — response shows `word_target: 80`, `word_min: 70`, `word_max: 95`. | ✅ Verified |

**Files affected:**

| File | Change |
|------|--------|
| Production DB | `brand_templates.config_overrides` updated for `two_doors` template |

**Rollback:** Run reverse UPDATE restoring `word_target=110, word_min=95, word_max=125`.

---

### Phase 4 — Quality Gates ✅ COMPLETED (March 16, 2026)

**Purpose:** Replace `gateTwoDoors()` with the v2 gate set (Section 6).

**Tasks:**

| # | Task | Detail | Status |
|---|------|--------|--------|
| 4.1 | Replace `gateTwoDoors()` function body | Replaced entire function body with v2 gates (G1–G8 hard gates, S1–S6 soft gates). `sharedDecisionGateChecks()` call preserved. | ✅ Done |
| 4.2 | Implement G1 (framing device in sentence one) | Broad regex with 40+ device types + alt pattern for possessive/demonstrative devices. | ✅ Done |
| 4.3 | Implement G2 (two paths described) | Transition language detection with primary + fallback regex. | ✅ Done |
| 4.4 | Implement G3 (value conflict present) | 8 value buckets (freedom, security, love, power, knowledge, peace, ambition, belonging). **Deployed in WARN MODE** — logs but does not fail. | ✅ Done (warn) |
| 4.5 | Implement G4 (no consequences revealed) | Cost/downside language regex. | ✅ Done |
| 4.6 | Implement G5 (direct final question) | ≤12 word check + softening language regex. | ✅ Done |
| 4.7 | Implement G6 (no supernatural) | Fantasy/supernatural regex. | ✅ Done |
| 4.8 | Implement G7 (no literal labels) | Label pattern regex ("Path A:", "Option 1:", etc.). | ✅ Done |
| 4.9 | Implement G8 (no reflection) | Last 2 non-question sentences checked for moralizing. | ✅ Done |
| 4.10 | Implement soft gates S1–S6 | Log-only via `console.log('[GATE] two_doors S# WARN: ...')`. | ✅ Done |
| 4.11 | Add word count override in `steps.ts` | Added after NGC override: `if (vibePreset === 'two_doors') { wordRange.min = 70; wordRange.max = 95; }` | ✅ Done |

**Files affected:**

| File | Change |
|------|--------|
| `supabase/functions/worker-v1/steps.ts` | Replace `gateTwoDoors()` body (~line 1520). Add word count override (~line 470). |

**Verify:**
- [x] All 8 hard gates implemented with correct regexes
- [x] All 6 soft gates log-only (not in failures array)
- [x] `sharedDecisionGateChecks()` still called first
- [x] Word count override produces correct range for `two_doors`
- [x] Existing `no_good_choice` and `one_rule_one_power` gates unaffected

**Rollback:** Revert `gateTwoDoors()` to the v1 implementation. Remove word count override.

---

### Phase 5 — Test Generation

**Purpose:** Validate that the new prompt + gates produce quality output.

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| 5.1 | Generate 20 stories | Invoke the pipeline for `two_doors` preset with the v2 prompt. Capture all generated stories, gate results, and any regeneration attempts. |
| 5.2 | Manual review | For each story, verify: (a) framing device appears in sentence 1, (b) both paths are genuinely desirable, (c) value conflict is clear, (d) no poetic language, (e) word count is 70–95, (f) final question is sharp and matches the device. |
| 5.3 | TTS pacing test | Generate audio for 10 scripts. Verify: (a) duration is 22–32s, (b) no awkward phrasing when read aloud, (c) pause timing feels natural. |
| 5.4 | Gate calibration | Review gate pass/fail rates. If G1 or G3 are failing > 50% of stories on first attempt, review the regex patterns and adjust. Expect some tuning on G3 (value conflict) — the keyword buckets may need expansion based on what GPT actually generates. |
| 5.5 | Engagement sniff test | Show 5 finished stories to 3 people. Ask which path they'd pick. If all 3 consistently agree on the same path for a given story, the value conflict is weak for that scenario. |

**Files affected:** None — testing only.

**Rollback:** N/A.

---

### Phase 6 — Deploy ✅ COMPLETED (March 16, 2026)

**Purpose:** Deploy the changes to production.

**Tasks:**

| # | Task | Detail | Status |
|---|------|--------|--------|
| 6.1 | Run DB migration | Updated `brand_templates.config_overrides` via REST API PATCH. Verified word counts: 80/70/95. | ✅ Done |
| 6.2 | Deploy `worker-v1` edge function | Deployed via `npx -y supabase functions deploy worker-v1 --no-verify-jwt --project-ref ustmetegzisztqqcjigt`. | ✅ Done |
| 6.3 | Deploy `run-job` edge function | Deployed via `npx -y supabase functions deploy run-job --no-verify-jwt --project-ref ustmetegzisztqqcjigt`. | ✅ Done |
| 6.4 | Push to GitHub | Commit `79c2b3a` pushed to `origin/master`. Render.com auto-deploy triggered. | ✅ Done |
| 6.5 | Verify health | Awaiting next scheduled `two_doors` job. | ⏳ Pending |

**Files affected:** Production deployment.

**Rollback:** Revert edge function to previous version. Reverse DB migration.

---

### Phase 7 — Production Monitoring

**Purpose:** Monitor live performance for 1–2 weeks.

**Tasks:**

| # | Task | Detail |
|---|------|--------|
| 7.1 | Monitor gate pass rates | Check `job_step_logs` daily. Target: 70%+ stories pass all hard gates on first generation attempt. |
| 7.2 | Monitor word counts | Verify generated stories land in the 70–95 range consistently. |
| 7.3 | Monitor engagement | After 20+ published `two_doors` videos, compare completion rate and comment rate vs. baseline. |
| 7.4 | Promote soft gates | After 2 weeks of data, review S1–S6 pass rates. Promote any soft gate to hard fail if it has a low false-positive rate and catches genuine quality issues. |
| 7.5 | Adjust value conflict gate | G3 may need keyword bucket expansion based on GPT's actual output patterns. Monitor false positives/negatives and adjust. |

**Rollback:** If v2 completion rate drops > 10% vs. v1 after 30+ published posts, revert all changes and diagnose.

---

<a name="13-final-production-recommendations"></a>
## 13. Final Production Recommendations

### What Has Been Deployed

- ✅ **Generation prompt v2** — deployed in `steps.ts`. 5-beat structure with value conflict pairs, strong/weak examples, expanded framing device list.
- ✅ **Beat structure (5-beat)** — deployed in `story_profile.ts`. HOOK → FRAME → PATH_A → PATH_B → QUESTION.
- ✅ **Word count targets** (80 target, 70–95 range) — deployed in `story_profile.ts`, `steps.ts` override, and `brand_templates.config_overrides`.
- ✅ **Quality gates G1–G8** — deployed in `steps.ts`. G3 (value conflict) in warn mode.
- ✅ **Soft gates S1–S6** — deployed as log-only. No hard failures.
- ✅ **DB migration** — `brand_templates` word counts updated (80/70/95).
- ✅ **Edge functions** — `worker-v1` and `run-job` both deployed.

### What Still Needs Real-World Testing

- **G3 (value conflict gate)** — Currently in **warn mode**. Monitor logs for 2 weeks. If false-positive rate is low, promote to hard fail.
- **Word count target of 80** — The reduction from 110 is significant. Monitor generated stories to verify 22–32s spoken duration. If paths feel too thin at 70 words, consider raising the floor to 75.
- **Framing device regex (G1)** — The device list is broad but GPT is creative. Monitor for valid devices that fail the regex and add them.
- **S4 (path balance)** — The "2x word count" heuristic is approximate. May need adjustment after seeing real output patterns.
- **S5 (both paths desirable)** — The negative language check may flag legitimate uses of contrast words. Monitor false positive rate.

### Voice Config

The current `two_doors` voice config uses `echo` (fallback: `onyx`). This is a deeper, more dramatic voice. Review whether this still fits the v2 tone (calmer, more direct, less dramatic). If the v2 stories feel too theatrical with `echo`, consider switching to `alloy` (same as NGC) or `shimmer` for a warmer tone. **Decision: defer to TTS testing in Phase 5.**

### Success Metrics

| Metric | Current Baseline | Target | Measurement |
|--------|-----------------|--------|-------------|
| **Avg completion rate** | Measure current | +20% vs v1 (shorter videos should complete more) | Platform analytics |
| **Comment rate** | Measure current | +25% vs v1 | Comments / views |
| **Comment contains choice** | Measure current | 60%+ of comments reference a side | Manual sample |
| **Avg watch time** | ~44–50s | 22–32s (but HIGHER completion %) | Platform analytics |
| **Loop/replay rate** | Measure current | +15% vs v1 | Platform analytics |
| **Share rate** | Measure current | +10% vs v1 | Shares / views |
| **Quality gate pass rate** | N/A | 70%+ on first generation | Pipeline logs |

---

## Appendix: Quick Reference Card

```
PRESET:          two_doors v2
BRAND:           Decide This Daily
NICHE:           Decision / value conflict
POV:             Second person ("you")
TONE:            Calm-provocative
WORD TARGET:     80 (range 70-95)
DURATION TARGET: 22-32s spoken
BEAT MAP:        HOOK → FRAME → PATH A → PATH B → QUESTION
VISUAL:          AI images — high-contrast cinematic (ai_images_contrast)
VOICE:           echo / onyx (review during TTS testing)
ENGAGEMENT:      Comments with choice + reasoning
OUTPUT STYLE:    Natural spoken phrasing — no poetic language, no literal labels
GOLDEN RULE:     Framing device in sentence one. Both paths desirable. Value conflict mandatory.
COMPLEMENT:      no_good_choice = "I want NEITHER" / two_doors = "I want BOTH"
```

---

## Appendix: File-by-File Change Map

| File | What Changes | Phase |
|------|-------------|-------|
| `supabase/functions/worker-v1/steps.ts` ~L1054 | Replace `two_doors` prompt string | Phase 1 |
| `supabase/functions/worker-v1/steps.ts` ~L470 | Add word count override for `two_doors` | Phase 4 |
| `supabase/functions/worker-v1/steps.ts` ~L1520 | Replace `gateTwoDoors()` function body | Phase 4 |
| `supabase/functions/run-job/story_profile.ts` ~L1265 | Update beat structure, word count, style notes | Phase 2 |
| New migration SQL | Update `brand_templates.config_overrides` word targets | Phase 3 |

---

## Appendix: Comparison with `no_good_choice` v2

| Dimension | `no_good_choice` v2 | `two_doors` v2 |
|-----------|---------------------|----------------|
| **Core mechanic** | Lose-lose (both options hurt) | Win-win conflict (both options desired) |
| **Beat count** | 7 | 5 |
| **Beat map** | HOOK → SITUATION → OPTION_A → COST_A → OPTION_B → COST_B → QUESTION | HOOK → FRAME → PATH_A → PATH_B → QUESTION |
| **Word target** | 95 (80–110) | 80 (70–95) |
| **Duration** | 40–50s | 22–32s |
| **Consequences** | Explicit, concrete, revealed | Hidden — viewer chooses blind |
| **Viewer emotion** | Discomfort ("I don't want either") | Longing ("I want both") |
| **Visual type** | Gameplay clips | AI images (high-contrast) |
| **Hook style** | Dilemma trigger (revelation, ultimatum) | Framing device (two objects/structures) |
| **Tone** | Provocative-neutral | Calm-provocative |
| **Engagement driver** | "Which is worse?" debate | "Which matters more?" debate |

---

## Addendum: v2.1 — Sensory Concreteness Patch (March 16, 2026)

> **Status:** DEPLOYED  
> **Commit:** Included in same deployment session as v2.0

### Problem

Test generations with the v2.0 prompt still produced abstract value labels instead of concrete life scenes:

- "life of luxury and glamour"
- "path of quiet fulfillment"
- "tranquility in every corner of your life"

These are **concept summaries**, not **filmable moments**. Short-form storytelling performs dramatically better when paths describe tangible scenes the viewer can visualize.

### Root Cause

The v2.0 prompt said "Make it CONCRETE and TANGIBLE" but didn't:
1. Show enough strong/weak examples per beat
2. Explicitly ban common abstract labels
3. Give the model a mental test ("What does this life look like on a random Tuesday?")
4. Require at least one location, action, or person per path

Without these guardrails, GPT defaults to philosophical summarization.

### Changes Made

#### 1. PATH_A / PATH_B Generation Rules (Updated)

Each path beat now requires:
- **A scene from a random Tuesday** — not a life philosophy
- **At least one concrete element**: a location (kitchen, airport, trail), an action (wake up, cook, build), or a person (partner, children, coworker)
- **Sensory or observable details** — things the viewer can see, hear, or physically experience

The prompt now includes the mental test:

> "Answer this question when writing each path: What does this life look like on a random Tuesday?"

**Strong/weak example pairs** are embedded directly in the PATH_A and PATH_B beat instructions:

| Weak (BANNED) | Strong (Required Style) |
|---------------|------------------------|
| "A life of freedom and adventure." | "You wake up in a different city every month. No alarm. No emails. Your suitcase is always half-packed." |
| "A life of warmth and connection." | "The same person sits across from you at dinner every night. Nobody checks the time." |
| "Luxury and glamour surround you." | "Cameras flash when you step out of the car. Your name is on the building." |
| "A path of quiet fulfillment." | "Kids run to the front door when they hear your car pull in." |
| "Tranquility in every corner of your life." | "A cabin. A dog. A book you've been meaning to finish. No one calls." |

#### 2. Banned Abstract Labels

The following words are now explicitly **banned** from PATH_A and PATH_B descriptions:

> luxury, fulfillment, happiness, peace, success, greatness, comfort, excitement, prosperity, contentment, serenity, tranquility, harmony, bliss, joy, glamour, elegance, prestige, satisfaction, purpose

These are value labels, not scenes. The model must **show** the life, not **name** it.

#### 3. Concreteness Requirement

Every path must contain at least one of:
- **A location**: kitchen, office, street, airport, mountains, cabin, studio
- **An action**: wake up, cook, walk, build, travel, speak, drive
- **A person**: partner, children, stranger, coworker, crowd, audience

The rule: **If you can't film it, rewrite it.**

#### 4. Soft Gate S7 — Sensory Concreteness (NEW)

Added `S7` to `gateTwoDoors()`. Log-only, does not block.

**Logic:**
- Scans path text for abstract labels (`luxury`, `fulfillment`, `happiness`, etc.)
- Scans for concrete indicators (locations, actions, people)
- Warns if abstract hits ≥ 2 and concrete hits = 0
- Warns if abstract count outweighs concrete count

**Log examples:**
```
[GATE] two_doors S7 WARN: Paths contain abstract labels (luxury, glamour) but no concrete imagery — paths should describe filmable life moments, not value summaries
[GATE] two_doors S7 WARN: Abstract language (3 hits) outweighs concrete imagery (1 hit) — aim for more specific, observable details
```

#### 5. Anti-Pattern Examples (Expanded)

| Pattern | Why It Fails | Fix |
|---------|-------------|-----|
| "A life of luxury and glamour." | Abstract value label — viewer can't picture it | "Your closet is the size of a studio apartment. Someone else parks your car." |
| "A path of quiet fulfillment." | Concept, not a scene | "You sit on the porch with coffee before anyone else wakes up. The only sound is birds." |
| "Tranquility in every corner of your life." | Philosophical summary | "A cabin. A dog. A book you've been meaning to finish. No one calls." |
| "Success beyond your wildest dreams." | Cliché + abstract | "You walk into a room and everyone already knows your name." |
| "A life filled with love and warmth." | Emotional label, nothing visible | "Tiny hands grab yours at the crosswalk. Someone saved you the last slice." |
| "Freedom to do anything you want." | Tells, doesn't show | "You book a flight at 2 AM. No one to tell. Passport always in your bag." |

### 3 Rewritten Example Stories (v2.1 Style)

#### Example 1: "Two Tickets"

> Two tickets sit on the counter.
>
> One is one-way. The other is round-trip. You can only take one.
>
> The one-way ticket drops you in a new city every three months. You learn the streets by getting lost. Your phone is full of photos but no one in them knows your last name.
>
> The round-trip brings you home every Friday. Same front door. Same dog losing its mind when you walk in. Your kid draws pictures of you at work and tapes them to the fridge.
>
> Which ticket do you grab?

*(82 words. Freedom vs. belonging. Both tangible. Both desirable.)*

#### Example 2: "Two Keys"

> Two keys. One gold. One iron.
>
> Each opens a completely different life. You can only turn one.
>
> The gold key opens a corner office on the 40th floor. Your calendar is packed. People pitch you ideas over lunch. Your signature changes things.
>
> The iron key opens a workshop behind your house. Sawdust on the floor. No meetings. You build things with your hands and sell them when you feel like it.
>
> Which key do you turn?

*(78 words. Ambition vs. peace. Concrete actions in both paths. No abstract labels.)*

#### Example 3: "Two Doors"

> Two doors appear in front of you.
>
> One opens. The other locks forever.
>
> Behind the first door, you wake up next to someone different every city. Rooftop bars. Red-eye flights. Your stories make strangers lean in.
>
> Behind the second door, the same person reaches for your hand in the dark. Sunday mornings last until noon. Your mug has a chip in it and you won't throw it away.
>
> Which door do you open?

*(75 words. Adventure vs. love. Every sentence is a scene.)*

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/worker-v1/steps.ts` ~L1080 | PATH_A/PATH_B beat instructions rewritten with concrete scene requirements + strong/weak examples |
| `supabase/functions/worker-v1/steps.ts` ~L1140 | RULES section: added banned abstract labels list + concreteness requirement |
| `supabase/functions/worker-v1/steps.ts` ~L1720 | New soft gate S7 (sensory concreteness) added after S6 |
