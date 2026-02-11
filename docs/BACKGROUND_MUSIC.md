# Background Music V1

> **Version:** 1.1 (hardened)  
> **Date:** February 10, 2026  
> **Roadmap:** Item #10  
> **Status:** Implemented + Production Hardened  
> **Migration:** `20260210009_background_music_v1.sql`  
> **Worker:** v2.7 | **Renderer:** v3.2.1

### v1.1 Hardening (Feb 10, 2026)

1. **Soft failure safeguards** — `executeMusicStep` catch block now soft-fails (`success: true, skipped: true`) instead of hard-failing the job. Always persists a `job_assets` record even on error. Warning snapshots with structured codes: `music_missing_file`, `music_selection_failed`.
2. **Renderer backward compat** — `mixBackgroundMusic()` handles null/missing/partial `musicConfig` safely. Volume clamped to 0-100. Downloaded music file validated (min 1KB). `music_config.enabled === false` skips mixing cleanly.
3. **FFmpeg filter order verified** — Volume → fade-in → fade-out (all pre-mix on music stream only) → sidechaincompress (music compressed, narration as sidechain key) → amix. Narration is never touched by fades or volume.
4. **Track looping** — `loopable` flag passed from worker to renderer via `music_config.loopable`. Renderer conditionally applies `-stream_loop -1` only when `loopable !== false`. Default: true for backward compat.
5. **Asset paths + bucket consistency** — Verified: all references use `STORAGE_BUCKET` const (`story-videos`). `pathForBrandMusic()` output matches migration seed paths exactly.
6. **Smoke tests M1-M6** — Added 6 edge-case tests covering: missing file warning, quiet narration ducking, long video + short music looping, retry determinism, soft failure persistence, renderer backward compat.

---

## Overview

Background Music V1 adds pre-licensed background music to generated videos with:

- **1–3 tracks per brand** stored in `music_tracks` table
- **Audio ducking** — music volume automatically lowers during narration
- **Fade in/out** — smooth transitions at video start and end
- **Brand preferences** stored in `brand_templates.config_overrides.music`
- **Deterministic selection** — same job always gets the same track

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Worker V1 Pipeline                │
│                                                     │
│  Story → Uniqueness → Scenes → Voice →              │
│  ┌──────────────┐                                   │
│  │ MUSIC STEP   │  1. Load brand config (RPC)       │
│  │ (no API cost)│  2. Load tracks from DB (RPC)     │
│  │              │  3. hash(job_id+brand_id) % count  │
│  │              │  4. Store track URL + config       │
│  └──────┬───────┘                                   │
│         ↓                                           │
│  Images → Subtitles →                               │
│  ┌──────────────┐                                   │
│  │ ASSEMBLE     │  Passes music_url + music_config   │
│  │              │  to FFmpeg renderer                │
│  └──────┬───────┘                                   │
│         ↓                                           │
│  Upload → Schedule                                  │
└─────────────────────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────────────┐
│              FFmpeg Renderer v3.2                    │
│                                                     │
│  mixBackgroundMusic():                              │
│    1. Volume reduction (default_volume)             │
│    2. Fade-in (afade t=in)                          │
│    3. Fade-out (afade t=out)                        │
│    4. Sidechain ducking (sidechaincompress)          │
│    5. amix: narration + processed music             │
└─────────────────────────────────────────────────────┘
```

---

## Schema

### `music_tracks` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Human-readable ID, e.g. `ambient_dark_01` |
| `brand_id` | UUID | FK to brands |
| `display_name` | TEXT | Friendly name |
| `file_path` | TEXT | Storage path: `brands/{brand_id}/music/{id}.mp3` |
| `duration_seconds` | INT | Track duration |
| `loopable` | BOOLEAN | Can loop seamlessly |
| `bpm` | INT | Optional BPM |
| `mood` | TEXT | dark, tense, eerie, ambient, dramatic, melancholic |
| `energy` | TEXT | low, medium, high |
| `tags` | TEXT[] | Additional tags |
| `vibe_presets` | TEXT[] | Compatible presets (empty = all) |
| `is_active` | BOOLEAN | Soft-delete |

**Primary Key:** `(id, brand_id)` — same track ID can exist per brand.

### `brand_templates.config_overrides.music` (JSONB)

```json
{
  "enabled": true,
  "default_volume": 0.18,
  "ducking": {
    "enabled": true,
    "duck_volume": 0.08,
    "attack_ms": 150,
    "release_ms": 250
  },
  "fade": {
    "in_ms": 800,
    "out_ms": 1200
  }
}
```

If not configured, system defaults are used (via `get_brand_music_config` RPC).

---

## RPCs

| RPC | Purpose | Auth |
|-----|---------|------|
| `get_brand_music_config(brand_id)` | Get merged music config (brand overrides + defaults) | SECURITY DEFINER |
| `get_brand_music_tracks(brand_id, vibe_preset?)` | Get active tracks, optionally filtered by vibe | SECURITY DEFINER |
| `select_music_track_deterministic(job_id, brand_id, vibe_preset?)` | Hash-based deterministic selection | SECURITY DEFINER |

---

## Asset Naming & Storage

### Brand-Level Music Tracks

```
brands/{brand_id}/music/ambient_dark_01.mp3
brands/{brand_id}/music/tension_pulse_01.mp3
brands/{brand_id}/music/eerie_piano_01.mp3
```

Tracks are stored once per brand. Multiple jobs reference the same file — no duplication.

### Job Assets

| Type | Idempotency Key | Content |
|------|-----------------|---------|
| `music` | `{job_id}:music_select` | Selected track info, config, URL |

The music step does NOT copy the track to a per-job path. It references the brand-level file directly.

### Path Builders (helpers.ts)

```typescript
pathForBrandMusic(brandId, trackId)  // brands/{brand_id}/music/{track_id}.mp3
pathForJobMusic(brandId, jobId)      // brands/{brand_id}/jobs/{job_id}/audio/music.mp3 (reserved for future)
```

---

## Worker Integration

### Music Step (v2 — DB-driven)

1. **Idempotency check:** If `job_assets` has `{job_id}:music_select` with `track_id` + `music_config` → skip
2. **Load brand config:** `get_brand_music_config(brand_id)` returns merged defaults + overrides
3. **Check enabled:** If `config.enabled === false` → skip with `music_enabled: false`
4. **Load tracks:** `get_brand_music_tracks(brand_id, vibe_preset)` returns eligible tracks
5. **Fallback:** If no DB tracks → use hardcoded vibe→track map
6. **Deterministic selection:** `hash(job_id + brand_id)` → `index % track_count`
7. **Get public URL:** `Supabase.storage.getPublicUrl(track_path)`
8. **Store:** `job_assets` + `jobs.meta.{music_track_id, music_url, music_config, music_enabled}`

### Assemble Step (updated)

Reads music config from `job.meta.music_config` and passes to renderer:

```json
{
  "music_url": "https://storage.../brands/.../music/ambient_dark_01.mp3",
  "music_volume": 18,
  "music_config": {
    "ducking": { "enabled": true, "duck_volume": 0.08, "attack_ms": 150, "release_ms": 250 },
    "fade": { "in_ms": 800, "out_ms": 1200 }
  }
}
```

---

## FFmpeg Audio Mixing Strategy

### Filter Chain

```
[1:a] → volume(0.18) → afade(in) → afade(out) → sidechaincompress → amix → [out]
```

### With Ducking (default)

```
[1:a]volume=0.18[mvol]
[mvol]afade=t=in:st=0:d=0.8[mfin]
[mfin]afade=t=out:st=58.8:d=1.2[mfout]
[mfout][0:a]sidechaincompress=threshold=0.02:ratio=7:attack=0.150:release=0.250:level_sc=1.0[ducked]
[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=2[out]
```

### Without Ducking (simple)

```
[1:a]volume=0.15[mvol]
[0:a][mvol]amix=inputs=2:duration=first:dropout_transition=2[out]
```

### How Ducking Works

| Parameter | Value | Effect |
|-----------|-------|--------|
| `threshold` | 0.02 | Very sensitive — catches even quiet narration |
| `ratio` | 6-8 | Aggressive compression when voice present |
| `attack` | 0.15s | Quick duck (150ms) — voice heard immediately |
| `release` | 0.25s | Natural swell-back (250ms) — not jarring |
| `level_sc` | 1.0 | Sidechain input at full sensitivity |

### Why It Won't Clip

1. Music is pre-attenuated to 18% BEFORE any processing
2. `sidechaincompress` only **reduces** music — never amplifies
3. `amix duration=first` ensures output matches video length
4. `dropout_transition=2` provides smooth falloff if one stream ends early

### Duration Mismatches

| Scenario | Handling |
|----------|----------|
| Music shorter than video | `-stream_loop -1` loops infinitely |
| Music longer than video | `duration=first` in amix truncates to video length |
| Music exactly right | Works as-is |

---

## Cost Controls & Failure Semantics

### Music Step (FREE)

- No external API calls → no cost tracking
- No concurrency slots needed
- No budget check

### Music Mixing (Part of Render)

- Counted as `ffmpeg_renderer` usage in the assemble step
- `render_seconds` incremented for the entire video render (which includes mixing)
- No separate cost entry for music mixing

### Failure Behavior

| Scenario | Classification | Retryable |
|----------|---------------|-----------|
| Music step: DB query fails | `transient` | ✅ Yes |
| Music step: No tracks found | Fallback to hardcoded | ✅ Auto-handled |
| Music step: Track not in storage | Warning logged, null URL | ✅ Auto-handled |
| Render: Music mix FFmpeg error | Renders without music (warning) | ✅ Soft failure |
| Render: Music download fails | Renders without music (warning) | ✅ Soft failure |

**Key design:** Music failures are soft — the video renders without music rather than failing the entire job. The renderer catches music errors and continues.

---

## Logging & Observability

### StepLogger Events

| Event | Step | Data |
|-------|------|------|
| `started` | music | Standard start event |
| `snapshot` | music | `{ track_id, display_name, mood, volume, ducking_enabled, fade_in_ms, fade_out_ms, track_count, selection_index }` |
| `completed` | music | Duration, track info |
| `snapshot` | assemble | Updated: `{ has_music, music_track, music_volume, ducking_enabled }` |

### Console Logs

```
[MUSIC] Deterministic selection: hash=a3f1b2c4 → index 1/3 → ambient_dark_01
[MUSIC] ✓ Selected: ambient_dark_01 (Dark Ambient Drone), volume=0.18, ducking=true
[ASSEMBLE] Music: YES, volume=18%, ducking=true
```

---

## Explicit Non-Goals (v1)

| Feature | Status | Reason |
|---------|--------|--------|
| Adaptive music (mood-reactive) | ❌ Not in v1 | Requires per-scene analysis |
| Multi-track layering | ❌ Not in v1 | Complexity, memory concerns |
| Per-scene music switching | ❌ Not in v1 | Single track per video in v1 |
| User-uploaded tracks | ❌ Not in v1 | Licensing concerns, UI needed |
| Music generation APIs | ❌ Never | Pre-licensed tracks only |
| Beat-sync to visuals | ❌ Not in v1 | Requires BPM analysis |

---

## Default Tracks (Seed Data)

| Track ID | Display Name | Mood | Energy | Vibe Presets |
|----------|-------------|------|--------|--------------|
| `ambient_dark_01` | Dark Ambient Drone | dark | low | urban_legend, nosleep, backrooms |
| `tension_pulse_01` | Tension Pulse | tense | medium | one_too_many, glitch |
| `eerie_piano_01` | Eerie Piano Melody | eerie | low | urban_legend, nosleep, one_too_many |

**Note:** Actual MP3 files must be uploaded to Storage at `brands/{brand_id}/music/{track_id}.mp3` before music will be heard in videos.

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/migrations/20260210009_background_music_v1.sql` | New: music_tracks table, 3 RPCs, RLS, seed data |
| `supabase/functions/worker-v1/helpers.ts` | New: `pathForBrandMusic()`, `pathForJobMusic()` |
| `supabase/functions/worker-v1/steps.ts` | Rewritten: `executeMusicStep()` v2 (DB-driven), updated `assembleWithRenderer()` |
| `supabase/functions/worker-v1/index.ts` | Version bump to v2.7 |
| `video-renderer/server.js` | Upgraded: `mixBackgroundMusic()` v2 (ducking + fades), `/render` accepts `music_config` |

---

## Related Documentation

- [ROADMAP.md](ROADMAP.md) — Item #10
- [BACKGROUND_MUSIC_SMOKE_TESTS.md](BACKGROUND_MUSIC_SMOKE_TESTS.md) — Verification tests
- [ASSET_NAMING_CONVENTION.md](ASSET_NAMING_CONVENTION.md) — Storage paths
- [COST_CONTROLS.md](COST_CONTROLS.md) — Cost tracking
