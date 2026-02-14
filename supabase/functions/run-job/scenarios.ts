// =====================================================
// SCENARIOS MODULE - Curated Reddit-Inspired Horror Scenarios
// VERSION: 1.0.0 - 2026-02-12
// =====================================================
// Replaces live Reddit fetching (blocked by Reddit IP restrictions).
// Provides 24 curated horror scenarios across 5 subreddit styles
// that give each "reddit_trending_horror" story a unique thematic
// direction while the DNA system handles structural uniqueness.
// =====================================================

export interface HorrorScenario {
  /** Thematic category */
  category: string;
  /** Which subreddit style this mimics */
  subreddit_style: "nosleep" | "letsnotmeet" | "creepypasta" | "paranormal" | "shortscarystories";
  /** The core fear this taps into */
  core_fear: string;
  /** Setting hint for visual/atmosphere guidance */
  setting_hint: string;
  /** One-line premise that guides the AI */
  premise: string;
  /** Specific sensory details to include */
  sensory_anchors: string[];
  /** What makes this "Reddit-authentic" */
  reddit_flavor: string;
}

/** 24 curated scenarios across 5 subreddit styles */
export const HORROR_SCENARIOS: HorrorScenario[] = [
  // ── r/nosleep style (first-person, ongoing threat) ──
  {
    category: "digital_haunting",
    subreddit_style: "nosleep",
    core_fear: "technology betraying you",
    setting_hint: "apartment at night, blue screen glow",
    premise: "Someone discovers their smart home devices are responding to commands they never gave — and the responses are getting personal.",
    sensory_anchors: ["LED light shifting color", "speaker crackling", "notification chime at 3 AM"],
    reddit_flavor: "Posted as a desperate plea for help, with edits showing escalation in real-time",
  },
  {
    category: "wrong_number",
    subreddit_style: "nosleep",
    core_fear: "being watched by a stranger",
    setting_hint: "suburban house, curtains drawn",
    premise: "A series of wrong-number texts become increasingly specific about the recipient's daily routine.",
    sensory_anchors: ["phone vibrating", "curtain moving", "car idling outside"],
    reddit_flavor: "Screenshots included in the original post, commenters telling OP to call police",
  },
  {
    category: "night_shift",
    subreddit_style: "nosleep",
    core_fear: "isolation and vulnerability at work",
    setting_hint: "empty building, fluorescent lights humming",
    premise: "A night security guard notices the building has one more floor on the elevator panel than officially exists.",
    sensory_anchors: ["elevator ding", "footsteps above", "static on radio"],
    reddit_flavor: "Part 1 of a series, guard documenting each shift's discoveries",
  },
  {
    category: "sleep_paralysis",
    subreddit_style: "nosleep",
    core_fear: "helplessness in your own body",
    setting_hint: "dark bedroom, moonlight through blinds",
    premise: "Someone's sleep paralysis entity starts leaving physical evidence of its visits.",
    sensory_anchors: ["weight on chest", "breathing nearby", "scratch marks on wall"],
    reddit_flavor: "OP attaches photos of the evidence, each update more disturbing",
  },
  {
    category: "new_house",
    subreddit_style: "nosleep",
    core_fear: "your safe space is compromised",
    setting_hint: "old house, creaking wood, basement door",
    premise: "New homeowners find a room behind a wall that doesn't appear on any blueprint — and someone has been living in it.",
    sensory_anchors: ["musty air", "worn mattress", "food wrappers", "peephole drilled into wall"],
    reddit_flavor: "Posted with shaky phone photos, commenters identifying items in the hidden room",
  },

  // ── r/letsnotmeet style (real encounter, human threat) ──
  {
    category: "rideshare_horror",
    subreddit_style: "letsnotmeet",
    core_fear: "trapped with a dangerous stranger",
    setting_hint: "car interior at night, unfamiliar route",
    premise: "A rideshare passenger realizes the driver has locked the doors and is heading in the wrong direction.",
    sensory_anchors: ["child lock clicking", "GPS showing wrong route", "driver's eyes in rearview mirror"],
    reddit_flavor: "Written years after the event, with the calm detachment of someone who survived",
  },
  {
    category: "hiking_alone",
    subreddit_style: "letsnotmeet",
    core_fear: "being followed in the wilderness",
    setting_hint: "remote trail, dense forest, no cell signal",
    premise: "A solo hiker keeps finding trail markers that someone has altered to lead deeper into unmarked territory.",
    sensory_anchors: ["snapping twigs behind", "altered cairns", "carved symbols on trees"],
    reddit_flavor: "Factual retelling with GPS coordinates, commenters identifying the area",
  },
  {
    category: "neighbor_watching",
    subreddit_style: "letsnotmeet",
    core_fear: "the threat is next door",
    setting_hint: "suburban neighborhood, fence line, windows",
    premise: "Someone discovers their neighbor has been entering their house while they're at work — the pet camera caught everything.",
    sensory_anchors: ["door handle turning", "items slightly moved", "breathing on camera mic"],
    reddit_flavor: "Includes timestamps from the camera footage, escalating over weeks",
  },
  {
    category: "late_night_gas_station",
    subreddit_style: "letsnotmeet",
    core_fear: "nowhere to run",
    setting_hint: "empty gas station, highway, flickering lights",
    premise: "A traveler stops at a remote gas station and the attendant silently slides a note under the glass: 'Don't look at the van. Get in your car. Drive.'",
    sensory_anchors: ["buzzing fluorescent light", "van engine running", "gravel crunching"],
    reddit_flavor: "Short, punchy retelling — commenter verified the gas station exists",
  },
  {
    category: "online_dating",
    subreddit_style: "letsnotmeet",
    core_fear: "digital deception made real",
    setting_hint: "restaurant, then parking lot, then car chase",
    premise: "A first date reveals increasingly wrong details — the person knows things about you that weren't in your profile.",
    sensory_anchors: ["phone buzzing with unknown calls", "familiar perfume/cologne", "photos of your house on their phone"],
    reddit_flavor: "Posted as a warning to others, with advice on digital safety",
  },

  // ── r/creepypasta style (mythological, larger-than-life) ──
  {
    category: "radio_signal",
    subreddit_style: "creepypasta",
    core_fear: "forbidden knowledge",
    setting_hint: "amateur radio setup, late night, static-filled room",
    premise: "An amateur radio operator picks up a broadcast that describes events happening in their house — in real time — narrated by their own voice.",
    sensory_anchors: ["radio static", "own voice echoing", "descriptions matching reality"],
    reddit_flavor: "Formatted as a found document or transcript, clinical and unsettling",
  },
  {
    category: "backrooms",
    subreddit_style: "creepypasta",
    core_fear: "infinite entrapment",
    setting_hint: "yellow-lit office space, endless corridors, damp carpet",
    premise: "Someone clips through reality and finds themselves in an endless space of identical rooms — but the rooms are slowly changing to match places from their childhood.",
    sensory_anchors: ["fluorescent buzz", "wet carpet smell", "familiar wallpaper appearing"],
    reddit_flavor: "Wiki-style documentation with 'levels' and survival rules",
  },
  {
    category: "ritual_game",
    subreddit_style: "creepypasta",
    core_fear: "rules you can't undo",
    setting_hint: "dark room, candles, mirrors",
    premise: "Instructions for a 'game' circulate online — those who complete it gain something, but lose something they don't notice until it's too late.",
    sensory_anchors: ["candle flame bending wrong", "mirror reflection delayed", "cold spot in room"],
    reddit_flavor: "Formatted as instructions with bold warnings and 'DO NOT' rules",
  },
  {
    category: "lost_episode",
    subreddit_style: "creepypasta",
    core_fear: "corrupted innocence",
    setting_hint: "living room, old TV, VHS static",
    premise: "Someone finds an unaired episode of a children's show from the 90s — the characters seem aware they're being watched and beg for help.",
    sensory_anchors: ["VHS tracking lines", "distorted music", "characters breaking fourth wall"],
    reddit_flavor: "Includes episode descriptions and 'recovered' dialogue transcripts",
  },

  // ── r/paranormal style (unexplained, true-account feel) ──
  {
    category: "childhood_imaginary_friend",
    subreddit_style: "paranormal",
    core_fear: "what children see that adults can't",
    setting_hint: "family home, child's bedroom, hallway at night",
    premise: "Parents find old drawings by their child of an 'imaginary friend' — the friend's description matches a person who died in the house decades ago.",
    sensory_anchors: ["crayon drawings", "child laughing alone", "cold draft from closed room"],
    reddit_flavor: "Parent posting with photos of the drawings, asking if anyone recognizes the figure",
  },
  {
    category: "inherited_house",
    subreddit_style: "paranormal",
    core_fear: "the dead aren't gone",
    setting_hint: "old family farmhouse, dusty rooms, locked doors",
    premise: "After inheriting a relative's house, someone finds a journal documenting the exact same paranormal events they're now experiencing — written 40 years ago.",
    sensory_anchors: ["yellowed pages", "identical handwriting", "door opening on its own"],
    reddit_flavor: "Side-by-side comparison of journal entries and current experiences",
  },
  {
    category: "roadside_apparition",
    subreddit_style: "paranormal",
    core_fear: "things that shouldn't exist",
    setting_hint: "empty highway, fog, headlights cutting dark",
    premise: "Multiple drivers on the same stretch of highway report picking up the same hitchhiker — who vanishes from the back seat at the same mile marker.",
    sensory_anchors: ["fog parting", "rear view mirror empty", "wet seat after vanishing"],
    reddit_flavor: "Compiled from multiple accounts, with a map of sightings",
  },
  {
    category: "hospital_ghost",
    subreddit_style: "paranormal",
    core_fear: "death lingering where it happened",
    setting_hint: "hospital corridor, night shift, room 4B",
    premise: "Night shift nurses report a patient calling for help from a room that has been sealed off since a fire — the call button still works.",
    sensory_anchors: ["call button light blinking", "smoke smell", "voice through intercom"],
    reddit_flavor: "Posted by a nurse with a throwaway account, verified by other staff in comments",
  },
  {
    category: "cemetery_photograph",
    subreddit_style: "paranormal",
    core_fear: "proof of the impossible",
    setting_hint: "old cemetery, overcast, stone angels",
    premise: "Someone photographing gravestones for a genealogy project finds that every photo contains the same figure standing in the background — getting closer in each shot.",
    sensory_anchors: ["camera shutter", "figure in peripheral vision", "stone cold to touch"],
    reddit_flavor: "Posted with the actual photos, commenters enhancing and analyzing the figure",
  },

  // ── r/shortscarystories style (micro-horror, twist ending) ──
  {
    category: "mirror_wrong",
    subreddit_style: "shortscarystories",
    core_fear: "your reflection is not you",
    setting_hint: "bathroom, single mirror, harsh lighting",
    premise: "Someone notices their reflection blinks a half-second too late — and each day the delay gets longer.",
    sensory_anchors: ["mirror condensation", "reflection smiling", "light flickering"],
    reddit_flavor: "Under 500 words, devastating punchline in the last sentence",
  },
  {
    category: "baby_monitor",
    subreddit_style: "shortscarystories",
    core_fear: "something near your child",
    setting_hint: "nursery, dim night light, monitor screen",
    premise: "A parent checks the baby monitor and sees a second figure leaning over the crib — but they're the only adult in the house.",
    sensory_anchors: ["monitor static", "baby cooing", "shadow moving across screen"],
    reddit_flavor: "Told in present tense, ending mid-action as parent runs to the room",
  },
  {
    category: "voicemail_from_self",
    subreddit_style: "shortscarystories",
    core_fear: "temporal wrongness",
    setting_hint: "quiet room, phone screen glowing",
    premise: "Someone receives a voicemail from their own number — it's their own voice, crying, begging them not to go home tonight.",
    sensory_anchors: ["phone vibrating", "own voice distorted", "clock showing wrong time"],
    reddit_flavor: "Two paragraphs, gut-punch ending, 200+ upvotes in first hour",
  },
  {
    category: "counting_people",
    subreddit_style: "shortscarystories",
    core_fear: "something hiding among us",
    setting_hint: "group setting, campfire or dinner table",
    premise: "A group photo reveals one more person than was actually present — and no one can identify the extra face.",
    sensory_anchors: ["camera flash", "unfamiliar smile", "head count mismatch"],
    reddit_flavor: "Flash fiction format, the reveal IS the ending",
  },
  {
    category: "search_history",
    subreddit_style: "shortscarystories",
    core_fear: "someone using your identity",
    setting_hint: "desk, laptop screen, dark room",
    premise: "Someone checks their browser history and finds searches they never made — increasingly specific questions about how to dispose of a body their exact weight and height.",
    sensory_anchors: ["cursor moving on its own", "search timestamps at 3 AM", "webcam light on"],
    reddit_flavor: "Micro-fiction, under 300 words, each line more disturbing than the last",
  },
];

/**
 * Pick a horror scenario with setting deduplication.
 * Avoids recently used settings by checking the last N scenarios' setting_hints.
 * 
 * @param recentSettings - Array of recently used setting_hint values to avoid
 * @returns A horror scenario that hasn't been used recently
 */
export function pickHorrorScenario(recentSettings: string[] = []): HorrorScenario {
  // Try to find a scenario whose setting hasn't been used recently
  const available = HORROR_SCENARIOS.filter(
    s => !recentSettings.includes(s.setting_hint)
  );

  const pool = available.length > 0 ? available : HORROR_SCENARIOS;
  const idx = Math.floor(Math.random() * pool.length);
  
  const picked = pool[idx];
  console.log(`[SCENARIO] Picked: "${picked.category}" (${picked.subreddit_style}) — ${picked.core_fear}`);
  console.log(`[SCENARIO] Setting: ${picked.setting_hint}`);
  console.log(`[SCENARIO] Pool size: ${pool.length}/${HORROR_SCENARIOS.length} (${recentSettings.length} settings avoided)`);
  
  return picked;
}

/**
 * Build a prompt injection for Reddit-inspired horror scenarios.
 * This is appended to the contract prompt to add thematic direction.
 */
export function buildScenarioPromptInjection(scenario: HorrorScenario): string {
  return `
═══════════════════════════════════════
🎭 REDDIT-INSPIRED HORROR DIRECTION
═══════════════════════════════════════
This story should feel like a viral ${scenario.subreddit_style === 'nosleep' ? 'r/nosleep' :
  scenario.subreddit_style === 'letsnotmeet' ? 'r/LetsNotMeet' :
  scenario.subreddit_style === 'creepypasta' ? 'r/creepypasta' :
  scenario.subreddit_style === 'paranormal' ? 'r/Paranormal' :
  'r/shortscarystories'} post.

THEMATIC PREMISE (use as inspiration, not verbatim):
${scenario.premise}

CORE FEAR TO EXPLOIT: ${scenario.core_fear}
ATMOSPHERE/SETTING DIRECTION: ${scenario.setting_hint}

SENSORY DETAILS TO WEAVE IN (pick 2-3):
${scenario.sensory_anchors.map(a => `- ${a}`).join('\n')}

IMPORTANT:
- Do NOT mention Reddit, subreddits, or "OP"
- Do NOT copy the premise literally — use it as thematic direction
- The DNA contract specifications above take priority for structure
- Use this scenario to flavor the CONTENT, not override the FORMAT
═══════════════════════════════════════`;
}

/**
 * Get the index of a scenario in the HORROR_SCENARIOS array.
 * Useful for storing which scenario was used.
 */
export function getScenarioIndex(scenario: HorrorScenario): number {
  return HORROR_SCENARIOS.findIndex(
    s => s.category === scenario.category && s.subreddit_style === scenario.subreddit_style
  );
}
