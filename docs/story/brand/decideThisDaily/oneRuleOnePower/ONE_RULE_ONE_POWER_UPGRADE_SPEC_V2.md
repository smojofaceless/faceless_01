# One Rule One Power — v2 Upgrade Spec

**Preset:** `one_rule_one_power`  
**Brand:** Decide This Daily (`45c229a5-e647-49d2-8912-d5fa24f66fda`)  
**Template ID:** `6119fd02-7af4-4315-863b-e1064387249b`  
**Date:** 2025-07-17  

---

## 1 — Word Count

| Field | v1 | v2 |
|-------|----|----|
| target | 100 | 95 |
| min | 85 | 80 |
| max | 115 | 110 |
| variance | 15 | 10 |

Shorter, punchier scripts. Add word count override in `steps.ts` (80-110).

---

## 2 — Beat Structure (4 → 5)

| # | Beat | Purpose | Target Words |
|---|------|---------|-------------|
| 1 | HOOK | State the power in one clean sentence. Second person. | 8-15 |
| 2 | QUICK IMAGINATION | 1-2 sentences: let the viewer picture using it. Imply, don't list. | 15-25 |
| 3 | THE RULE | The single restriction. Punchy, ≤2 sentences. Must be visceral & specific. | 10-20 |
| 4 | IMPLICATION | What the rule actually costs. One concrete scenario showing the real weight. | 15-25 |
| 5 | QUESTION | "Would you take it?" or similar. ≤8 words. | 3-8 |

---

## 3 — Writing Style Rules

- Second person throughout ("You can now...")
- Calm, confident tone — like offering a deal, not threatening
- No filler: ban "imagine", "think about", "picture this", "what if I told you", "here's the thing", "let that sink in", "in other words"
- No softening: ban "might", "perhaps", "could potentially", "in the long run"
- No horror framing
- No listing scenarios ("You could X, Y, and Z")
- The RULE must make the power genuinely hard to use, not impossible and not trivial
- Allow 1-2 brief scenario implications (imply, don't enumerate)

---

## 4 — Punchy Rule Delivery

The restriction/rule beat must:
- Land in ≤2 sentences
- Use concrete, visceral language (not abstract concepts)
- Feel like a gut-punch, not a footnote
- Examples of strong rules:
  - "But every time you use it, you lose one year of your life."
  - "But you can never use it on someone you love."
  - "But anyone within 10 feet feels your pain doubled."

---

## 5 — Strong Ending

Final question must be ≤8 words. Examples:
- "Would you take it?"
- "Still worth it?"
- "Would you risk it?"
- "Deal?"

---

## 6 — Quality Gates

### Hard Gates (block generation)

| Gate | Check | Logic |
|------|-------|-------|
| G1 | Power in first sentence | First sentence must contain power/ability language |
| G2 | Single rule only | Exactly one restriction — detect multiple "but" clauses |
| G3 | Rule clarity | Rule/restriction language must be present and ≤2 sentences |
| G4 | No filler language | Banned phrases: imagine, think about, picture this, what if I told you, here's the thing, let that sink in, in other words |
| G5 | Short final question | Last sentence ≤8 words |
| G6 | Word count | Within 80-110 range |

### Inherited from `sharedDecisionGateChecks()`

- Word count bounds (min/max)
- Second-person voice
- No first-person narrator
- No confession framing

---

## 7 — Anti-Patterns

Reject stories that:
- List scenarios ("You could fly to Paris, time travel, read minds...")
- Have multiple restrictions (one rule only)
- Use abstract/philosophical restrictions ("but it changes who you are")
- Make the power useless (restriction too harsh)
- Make the restriction trivial (no real cost)
- Use horror framing (death, blood, torture)
- End with reflection or commentary instead of a clean question

---

## 8 — Example Stories (reference quality)

### Example A — Time Freeze
> You can freeze time whenever you want. Everything stops — people, traffic, the world around you. You could walk through a frozen city, take anything, go anywhere. But here's the rule: while time is frozen, you still age. Every hour you steal costs you an hour of your life. Would you take it?

### Example B — Lie Detection  
> You can tell when anyone is lying. Every conversation, every promise, every "I'm fine" — you hear the truth underneath. But you can never unhear it. Even the small lies people tell to be kind. Would you still want to know?

### Example C — Healing Touch
> You can heal any injury with a touch. Broken bones, deep cuts, years of pain — gone in seconds. But every wound you heal transfers to your own body. You feel every fracture, every sting, every ache. Still worth it?

---

## 9 — Implementation Phases

| Phase | Scope | Status |
|-------|-------|--------|
| P1 | Prompt replacement (5-beat) | 🔲 |
| P2 | Quality gates G1-G6 | 🔲 |
| P3 | Story profile update (4→5 beats) | 🔲 |
| P4 | Word count override (80-110) | 🔲 |
| P5 | DB migration (target 95, range 80-110) | 🔲 |
| P6 | Deploy worker-v1 + run-job | 🔲 |
