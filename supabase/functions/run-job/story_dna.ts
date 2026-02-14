// =====================================================
// STORY DNA SYSTEM - Production-Grade Uniqueness Engine
// VERSION: 4.0.0 - 2026-02-08
// 
// Purpose: Generate mathematically unique story "DNA" before
// the AI writes anything. The AI is a RENDERER, not the
// source of uniqueness.
// 
// Architecture:
// 1. Generate DNA (all story parameters) combinatorially
// 2. Hash DNA to check for collisions
// 3. Pass DNA to AI as strict requirements
// 4. Store DNA with story for tracking
// 5. Ban recently-used concepts via negative memory
// 6. Adaptive weighting for entropy maximization (v3.0)
// 7. Genre profiles for tonal consistency (v3.1)
// 8. Story engine consolidation (v4.0)
//
// STORY ENGINES (v4.0):
// ---------------------
// Presets are now "STORY ENGINES", not genres/vibes/formats.
// Only two active engines are supported:
//   - urban_legend: Broad folklore documentary horror
//   - one_too_many: Counting horror (group has extra person)
//
// Deprecated presets (cosmic_horror, true_crime, analog_horror,
// neutral) map to urban_legend for backward compatibility.
// =====================================================

// NOTE: Uses built-in Web Crypto API (crypto.subtle.digest) - no external import needed

// =====================================================
// GENRE WEIGHTING PROFILES
// Each genre has different "gravitational fields" that
// bias selection toward genre-appropriate concepts while
// preserving entropy and uniqueness guarantees.
// 
// Multipliers: 0.0 = banned, 0.6-0.8 = suppressed, 
//              1.0 = neutral, 1.2-1.6 = boosted
// =====================================================

export type GenreProfile = {
  name: string;
  description: string;
  weights: {
    era?: Record<string, number>;
    location?: Record<string, number>;
    subgenre?: Record<string, number>;
    authority?: Record<string, number>;
    narrative_artifact?: Record<string, number>;
    threat_behavior?: Record<string, number>;
    threat_manifestation?: Record<string, number>;
    repeating_detail?: Record<string, number>;
    weird_axis?: Record<string, number>;
    escalation?: Record<string, number>;
    ending_knowledge?: Record<string, number>;
    ending_imagery?: Record<string, number>;
    emotion?: Record<string, number>;
  };
};

export const GENRE_PROFILES: Record<string, GenreProfile> = {
  // =====================================================
  // ACTIVE STORY ENGINES (v4.0)
  // Only two engines are actively supported.
  // All deprecated presets map to urban_legend.
  // =====================================================

  // ===== URBAN LEGEND - Primary Folklore Engine =====
  // Broad, flexible engine for documentary-style horror.
  // Authority denial, repeating motif, ambiguous ending.
  // Designed for high-volume auto-generation.
  urban_legend: {
    name: "Urban Legend",
    description: "Classic American folklore horror - whispered stories, suppressed truths, authorities hiding something",
    weights: {
      // Boost folklore-appropriate eras
      era: {
        "1970s_late": 1.4,      // Peak urban legend era
        "1980s_early": 1.3,
        "1960s_late": 1.2,
        "2000s_early": 0.7,     // Too modern
      },
      // Boost isolated/rural locations
      location: {
        "rural_highway": 1.4,
        "forest_trail": 1.3,
        "small_towns": 1.3,
        "lakeside_cabins": 1.2,
        "national_parks": 1.2,
        "suburban_sprawl": 0.8,
        "college_campus": 0.9,
      },
      // Boost oral/documentary formats
      narrative_artifact: {
        "oral_history": 1.5,
        "documentary_narration": 1.4,
        "newspaper_recap": 1.3,
        "witness_interview": 1.2,
        "police_memo": 1.1,
        "forum_post": 0.7,       // Too modern
        "research_footnote": 0.8,
      },
      // Boost coverup/suppression authorities
      authority: {
        "files_lost": 1.4,
        "active_coverup": 1.3,
        "witnesses_silenced": 1.3,
        "media_blackout": 1.2,
        "dismissed": 1.1,
        "alternative_explanation": 1.0,
      },
      // Boost watching/following behaviors (classic stalker horror)
      threat_behavior: {
        "watching": 1.4,
        "following": 1.3,
        "waiting": 1.2,
        "appearing": 1.2,
        "mimicking": 1.1,
        "broadcasting": 0.7,
      },
      // Boost humanoid manifestations
      threat_manifestation: {
        "humanoid_tall": 1.4,
        "humanoid_faceless": 1.3,
        "humanoid_dated": 1.3,
        "vehicle_black": 1.2,
        "shadow_independent": 1.1,
        "light_geometric": 0.7,   // Too sci-fi
        "distortion_visual": 0.8,
      },
      // Boost unresolved/ongoing endings
      ending_knowledge: {
        "ongoing": 1.4,
        "suppressed": 1.3,
        "unresolved": 1.2,
        "inherited": 1.2,
        "cyclical": 1.1,
        "partial": 0.8,          // Too much resolution
      },
      // Boost watching/empty imagery
      ending_imagery: {
        "watching_treeline": 1.4,
        "empty_road": 1.3,
        "fog_rolling": 1.2,
        "children_dreaming": 1.2,
        "sealed_files": 1.1,
      },
      // Boost dread/paranoia emotions
      emotion: {
        "dread": 1.4,
        "paranoia": 1.3,
        "unease": 1.2,
        "isolation": 1.2,
        "recognition": 1.1,
        "insignificance": 0.8,   // More cosmic horror
      },
    },
  },

  // ===== ONE TOO MANY - Counting Horror Engine =====
  // Specialized micro-engine for "extra person in group" stories.
  // Requires TropePack for group_type, container, evidence variations.
  // Always uses counting_horror contract with N→N+1 consistency.
  one_too_many: {
    name: "One Too Many",
    description: "Counting horror - the group has one extra person that no one can identify",
    weights: {
      // Boost contemporary/recent eras (group trips, road trips, camping)
      era: {
        "2000s_early": 1.4,
        "1990s_late": 1.3,
        "1980s_late": 1.2,
        "1970s_late": 1.1,
      },
      // Boost enclosed/confined locations (vans, elevators, cabins)
      location: {
        "lakeside_cabins": 1.5,   // Classic "cabin with friends"
        "rural_highway": 1.4,     // Van/road trip setting
        "forest_trail": 1.3,      // Hiking group
        "motel_room": 1.3,        // Hotel/motel gathering
        "small_towns": 1.2,
      },
      // Boost witness-style narration (counting requires observer POV)
      narrative_artifact: {
        "witness_interview": 1.5,
        "documentary_narration": 1.4,
        "oral_history": 1.3,
        "forum_post": 1.1,        // Reddit-style "this happened to my friend group"
      },
      // The core weird axis - counting_wrong is heavily boosted
      weird_axis: {
        "counting_wrong": 2.5,    // HEAVILY BOOSTED - core premise
        "photos_closer": 1.3,     // Evidence variation
        "photos_show_more": 1.3,  // Extra person in photos
        "names_forgotten": 1.2,   // Can't remember who's extra
        "reflection_delayed": 1.1,
      },
      // Boost humanoid manifestations (the "extra" is person-shaped)
      threat_manifestation: {
        "humanoid_faceless": 1.5,
        "humanoid_dated": 1.3,
        "humanoid_tall": 1.2,
        "reflection": 1.2,
      },
      // Boost passive behaviors (it blends in, doesn't attack)
      threat_behavior: {
        "mimicking": 1.5,         // Blending with the group
        "appearing": 1.4,
        "watching": 1.3,
        "waiting": 1.2,
      },
      // Boost proof-based endings
      ending_imagery: {
        "photograph_changing": 1.5, // Photo shows extra person
        "silent_recording": 1.3,    // Camera caught it
        "watching_treeline": 1.2,   // Figure still there
      },
      // Boost paranoia (who's real?)
      emotion: {
        "paranoia": 1.5,
        "wrongness": 1.4,
        "dread": 1.2,
        "isolation": 1.1,
      },
    },
  },

  // ===== REDDIT TRENDING HORROR - Internet Horror Retelling Engine =====
  // Transforms trending Reddit horror posts into original animated horror.
  // KEY DIFFERENTIATOR from urban_legend:
  //   - Modern era (smartphones, smart homes, apps) NOT retro
  //   - Domestic/suburban settings NOT rural backroads
  //   - Technology-mediated threats (cameras, devices, apps) NOT folklore entities
  //   - Personal encounter narration NOT documentary/oral history
  //   - Domestic closing images (dark window, phone screen) NOT treeline/empty road
  //   - Paranoia/violation emotions NOT dread/isolation
  reddit_trending_horror: {
    name: "Reddit Trending Horror",
    description: "Modern internet horror retold as chilling animated shorts — Reddit's scariest posts turned cinematic",
    weights: {
      // MODERN eras only — smartphones, smart homes, forums
      era: {
        "2000s_early": 1.6,       // Peak Reddit horror era
        "1990s_late": 1.3,        // Dial-up era creepy
        "1980s_late": 0.6,        // Too retro — that's urban_legend territory
        "1970s_late": 0.3,        // Way too analog
        "1960s_late": 0.2,        // Suppress hard — this is urban_legend DNA
      },
      // DOMESTIC/SUBURBAN — Reddit horror happens at home, at work, in your car
      location: {
        "suburban_sprawl": 1.7,   // #1: Houses, apartments, neighborhoods
        "college_campus": 1.4,    // Dorm rooms, campus at night
        "motel_room": 1.3,       // Travel horror
        "small_towns": 1.0,      // Neutral (shared with UL, don't over-boost)
        "forest_trail": 0.8,     // Suppress — too UL
        "lakeside_cabins": 0.7,  // Suppress — too UL
        "rural_highway": 0.5,    // Suppress hard — core UL territory
        "national_parks": 0.5,   // Suppress — core UL territory
      },
      // PERSONAL/DIGITAL narration — internet storytelling, not folklore
      narrative_artifact: {
        "forum_post": 1.6,         // #1: Internet storytelling tone
        "witness_interview": 1.4,  // "Let me tell you what happened"
        "oral_history": 0.8,       // Suppress — core UL artifact
        "documentary_narration": 0.7, // Suppress — core UL artifact
        "newspaper_recap": 0.5,    // Suppress — too formal
        "police_memo": 0.6,
        "research_footnote": 0.4,
      },
      // TECHNOLOGY-MEDIATED and domestic intrusion threats
      threat_behavior: {
        "mimicking": 1.6,         // #1: Something copying you — peak internet horror
        "appearing": 1.5,         // Showing up where it shouldn't
        "watching": 1.2,          // De-boost vs UL (1.4→1.2)
        "waiting": 1.1,           // Slight presence
        "following": 1.0,         // Neutral (UL has 1.3)
        "broadcasting": 1.3,      // Boost — messages, calls, signals (UL has 0.7)
      },
      // MODERN manifestations — shadows, distortions, digital glitches
      threat_manifestation: {
        "shadow_independent": 1.5, // #1: Autonomous shadow — internet horror staple
        "distortion_visual": 1.4,  // Visual wrongness, uncanny valley
        "humanoid_faceless": 1.0,  // Neutral (UL has 1.3, don't re-boost)
        "humanoid_tall": 0.8,     // Suppress — too Slenderman/UL
        "humanoid_dated": 0.6,    // Suppress — period clothing = UL territory
        "vehicle_black": 0.5,     // Suppress — black van = UL territory
        "light_geometric": 1.2,   // Boost — screen glows, device lights
      },
      // ONGOING/UNRESOLVED — "it's still happening" Reddit horror feel
      ending_knowledge: {
        "ongoing": 1.6,            // #1: "Update: it happened again last night"
        "unresolved": 1.3,
        "cyclical": 1.2,          // Boost — it repeats (UL has 1.1)
        "suppressed": 0.8,        // Suppress — authority suppression = UL
        "inherited": 0.7,         // Suppress — generational = UL
        "partial": 1.0,           // The poster only knows part of the truth
      },
      // DOMESTIC closing images — NOT treeline/empty road (that's UL)
      ending_imagery: {
        "watching_treeline": 0.6,  // Suppress hard — core UL imagery
        "empty_road": 0.5,        // Suppress hard — core UL imagery
        "fog_rolling": 0.8,       // Slightly suppress
        "children_dreaming": 1.2,  // Domestic — kid involved
        "sealed_files": 0.6,      // Suppress — authority = UL
        // These are conceptual guides for the AI even if not literal weight keys:
        // dark_window, phone_screen, empty_hallway, device_blinking
      },
      // VIOLATION/PARANOIA emotions — your safe space is compromised
      emotion: {
        "paranoia": 1.6,          // #1: Am I being watched? (flip from UL where dread is #1)
        "unease": 1.4,            // Something is off in my own home
        "recognition": 1.3,       // Boost — "wait, I know that face" internet horror
        "dread": 1.0,             // Neutral (UL has 1.4 — don't compete)
        "isolation": 0.8,         // Suppress — physical isolation = UL territory
        "insignificance": 0.5,    // Suppress — cosmic = different genre entirely
      },
    },
  },
};

// =====================================================
// DEPRECATED PRESET MAPPING
// For backward compatibility, deprecated presets map to urban_legend
// =====================================================
const DEPRECATED_PRESET_MAP: Record<string, string> = {
  cosmic_horror: 'urban_legend',
  true_crime: 'urban_legend',
  analog_horror: 'urban_legend',
  neutral: 'urban_legend',
  slow_creepy: 'urban_legend',
  punchy_shock: 'urban_legend',
  atmospheric: 'urban_legend',
};

// =====================================================
// TROPE PACKS - Preset-specific randomization pools
// Allows micro-presets to randomize within a narrow lane
// =====================================================

export interface TropePack {
  name: string;
  /** Group type variations (who's together) */
  group_types: string[];
  /** Container/setting variations (where they're trapped) */
  containers: string[];
  /** Evidence source variations (how they discover proof) */
  evidence_sources: string[];
  /** Glitch variations (what else goes wrong) */
  glitches: string[];
  /** Count phrases for unique element detection */
  count_phrases: string[];
  /** External witnesses who confirm the count (optional) */
  external_witnesses?: string[];
  /** Group size variations with start/extra counts (optional) */
  group_sizes?: Array<{ start: number; extra: number; description: string }>;
  /** Dialogue lines for acknowledging the count (optional) */
  dialogue_lines?: string[];
}

export const TROPE_PACKS: Record<string, TropePack> = {
  one_too_many: {
    name: "One Too Many",
    group_types: [
      "college friends on a road trip",
      "coworkers at a team retreat",
      "family members on a camping trip",
      "hikers in a guided group",
      "wedding party staying at a cabin",
      "students on a field trip",
      "old friends reuniting for a birthday",
      "neighbors evacuating together",
    ],
    containers: [
      "rented van",
      "hotel hallway",
      "elevator",
      "subway car",
      "lakeside cabin",
      "ferry deck",
      "bus",
      "mountain lodge",
      "rental car",
      "campfire circle",
      "motel room",
      "train car",
      "small boat",
      "ski lift gondola",
      "escape room",
    ],
    evidence_sources: [
      "group photo on someone's phone",
      "dashcam footage",
      "security camera still",
      "bathroom mirror reflection",
      "group selfie",
      "receipt showing wrong headcount",
      "reservation confirmation showing wrong party size",
      "polaroid from that night",
      "video doorbell footage",
      "CCTV playback at gas station",
      "hotel key card log",
      "restaurant bill showing wrong covers",
    ],
    glitches: [
      "clock keeps resetting to the same time",
      "doors won't unlock from inside",
      "windows won't roll down no matter what",
      "radio keeps playing the same song on loop",
      "GPS keeps rerouting to the same dead end",
      "phones show different times for everyone",
      "camera is missing frames from the trip",
      "no cell service despite showing full bars",
      "car won't start until everyone gets out and back in",
      "lights flicker whenever someone mentions the count",
      "engine dies every time they try to leave",
      "AC blasts cold air even when turned off",
    ],
    // External witnesses who notice something wrong
    external_witnesses: [
      "gas station attendant counting heads",
      "security guard reviewing footage",
      "motel clerk checking keys returned",
      "toll booth operator counting passengers",
      "restaurant host counting chairs needed",
      "park ranger doing headcount",
      "bus driver counting tickets",
      "ferry worker counting life jackets issued",
    ],
    // Starting group sizes (just numbers, no pre-written descriptions to leak)
    group_sizes: [
      { start: 4, extra: 5 },
      { start: 5, extra: 6 },
      { start: 6, extra: 7 },
      { start: 7, extra: 8 },
      { start: 8, extra: 9 },
    ],
    // Phrases that indicate the count anomaly (for unique element detection)
    count_phrases: [
      "we're one too many",
      "count again",
      "still wrong",
      "that's not right",
      "there should only be",
      "who's the extra one",
      "one more than there should be",
      "the count kept coming up wrong",
      "count didn't match",
      "extra person",
      "extra seat was taken",
      "the number was always one higher",
      "one nobody recognized",
      "couldn't account for",
      "I think we're one too many",
      "count one more time",
      "always came up one over",
      "but we only booked for",
      "the math doesn't work",
      "someone who wasn't there before",
    ],
    // Dialogue lines for acknowledgment (generic, no specific numbers)
    dialogue_lines: [
      "I think we're one too many.",
      "Wait... count again.",
      "That can't be right.",
      "Who's the extra?",
      "Someone check the count.",
      "The number's wrong.",
      "Count them again.",
      "There's one more than there should be.",
    ],
  },
};

/**
 * Get a trope pack by name
 */
export function getTropePack(packName: string): TropePack | null {
  return TROPE_PACKS[packName] || null;
}

/**
 * Pick random elements from a trope pack for story variation
 */
export function pickFromTropePack(packName: string): {
  group_type: string;
  container: string;
  evidence_source: string;
  glitch: string;
  count_phrase: string;
  external_witness: string;
  group_size: { start: number; extra: number };
  dialogue_line: string;
} | null {
  const pack = TROPE_PACKS[packName];
  if (!pack) return null;
  
  const groupSize = pack.group_sizes 
    ? pack.group_sizes[Math.floor(Math.random() * pack.group_sizes.length)]
    : { start: 5, extra: 6 };
  
  return {
    group_type: pack.group_types[Math.floor(Math.random() * pack.group_types.length)],
    container: pack.containers[Math.floor(Math.random() * pack.containers.length)],
    evidence_source: pack.evidence_sources[Math.floor(Math.random() * pack.evidence_sources.length)],
    glitch: pack.glitches[Math.floor(Math.random() * pack.glitches.length)],
    count_phrase: pack.count_phrases[Math.floor(Math.random() * pack.count_phrases.length)],
    external_witness: pack.external_witnesses 
      ? pack.external_witnesses[Math.floor(Math.random() * pack.external_witnesses.length)]
      : "someone outside the group",
    group_size: groupSize,
    dialogue_line: pack.dialogue_lines
      ? pack.dialogue_lines[Math.floor(Math.random() * pack.dialogue_lines.length)]
        .replace('[N]', String(groupSize.start))
      : `We only came with ${groupSize.start}.`,
  };
}

/**
 * Get genre profile multiplier for a specific component
 * Returns 1.0 if no profile or no weight defined
 */
export function getGenreMultiplier(
  profile: GenreProfile | null,
  dimension: keyof GenreProfile['weights'],
  componentId: string
): number {
  if (!profile || !profile.weights[dimension]) {
    return 1.0;
  }
  return profile.weights[dimension]![componentId] ?? 1.0;
}

// =====================================================
// DNA DIMENSION DEFINITIONS
// Each dimension has multiple options, creating billions
// of possible combinations
// =====================================================

/**
 * Era/Time Period - When the story takes place
 * 12 options
 */
export const ERA_OPTIONS = [
  { id: "1940s_postwar", label: "late 1940s", context: "post-WWII America, returning soldiers, new suburbs" },
  { id: "1950s_atomic", label: "mid-1950s", context: "atomic age, Cold War paranoia, conformity" },
  { id: "1950s_late", label: "late 1950s", context: "rock and roll, drive-ins, small-town America" },
  { id: "1960s_early", label: "early 1960s", context: "pre-Vietnam innocence, space race, civil rights" },
  { id: "1960s_late", label: "late 1960s", context: "counterculture, social upheaval, moon landing" },
  { id: "1970s_early", label: "early 1970s", context: "Vietnam era, oil crisis, urban decay" },
  { id: "1970s_late", label: "late 1970s", context: "serial killer era, disco, urban legends" },
  { id: "1980s_early", label: "early 1980s", context: "Reagan era, Cold War peak, suburban horror" },
  { id: "1980s_late", label: "late 1980s", context: "satanic panic, VHS era, mall culture" },
  { id: "1990s_early", label: "early 1990s", context: "pre-internet, end of Cold War, grunge" },
  { id: "1990s_late", label: "late 1990s", context: "early internet, Y2K anxiety, suburban ennui" },
  { id: "2000s_early", label: "early 2000s", context: "post-9/11 paranoia, surveillance state, digital transition" },
];

/**
 * Location Types - Where the story takes place
 * 15 options
 */
export const LOCATION_OPTIONS = [
  { id: "rural_highway", label: "rural highways", imagery: "empty roads, passing headlights, roadside diners" },
  { id: "forest_trail", label: "forest trails", imagery: "ancient trees, fog, overgrown paths" },
  { id: "coastal_town", label: "coastal towns", imagery: "fog horns, rocky shores, fishing villages" },
  { id: "desert_highway", label: "desert stretches", imagery: "endless sand, heat shimmer, ghost towns" },
  { id: "mountain_roads", label: "mountain roads", imagery: "switchbacks, drop-offs, isolation" },
  { id: "midwest_farmland", label: "midwest farmland", imagery: "cornfields, silos, vast emptiness" },
  { id: "swamp_bayou", label: "southern swamps", imagery: "spanish moss, murky water, gators" },
  { id: "industrial_ruins", label: "industrial ruins", imagery: "abandoned factories, rust, decay" },
  { id: "small_towns", label: "small towns", imagery: "main streets, church steeples, everyone knows everyone" },
  { id: "suburban_sprawl", label: "suburban developments", imagery: "identical houses, cul-de-sacs, manicured lawns" },
  { id: "college_campus", label: "college campuses", imagery: "old buildings, empty libraries, late nights" },
  { id: "national_parks", label: "national parks", imagery: "ranger stations, hiking trails, wilderness" },
  { id: "border_towns", label: "border towns", imagery: "crossing points, dual cultures, smuggling routes" },
  { id: "mining_towns", label: "mining towns", imagery: "abandoned shafts, ghost towns, buried secrets" },
  { id: "lakeside_cabins", label: "lakeside areas", imagery: "summer camps, docks, black water" },
];

/**
 * Subgenres - What type of horror story
 * 10 options
 */
export const SUBGENRE_OPTIONS = [
  { id: "urban_legend", label: "urban legend", tone: "factual documentary, presented as suppressed history" },
  { id: "true_crime", label: "faux true-crime", tone: "investigation report, cold case file" },
  { id: "witness_account", label: "witness compilation", tone: "multiple perspectives, conflicting details" },
  { id: "found_document", label: "found document", tone: "discovered journal, old recording, leaked memo" },
  { id: "broadcast_interruption", label: "broadcast incident", tone: "radio signal, TV interruption, emergency alert" },
  { id: "missing_persons", label: "missing persons case", tone: "search efforts, last known sighting" },
  { id: "government_coverup", label: "government coverup", tone: "classified files, whistleblower account" },
  { id: "recurring_phenomenon", label: "recurring phenomenon", tone: "pattern across decades, same thing keeps happening" },
  { id: "local_folklore", label: "local folklore", tone: "oral tradition, generational warnings" },
  { id: "investigation_closed", label: "closed investigation", tone: "case suddenly dropped, witnesses silenced" },
];

/**
 * Authority Response - How officials react
 * 8 options
 */
export const AUTHORITY_OPTIONS = [
  { id: "files_lost", label: "files lost", phrase: "all records were later reported missing from the archives" },
  { id: "dismissed", label: "dismissed reports", phrase: "local authorities dismissed the reports as mass hysteria" },
  { id: "active_coverup", label: "active coverup", phrase: "federal agents arrived and confiscated all evidence" },
  { id: "investigation_closed", label: "investigation quietly closed", phrase: "the investigation was abruptly closed without explanation" },
  { id: "witnesses_silenced", label: "witnesses relocated", phrase: "key witnesses were offered relocation and never spoke publicly again" },
  { id: "official_denial", label: "official denial", phrase: "authorities released a statement categorically denying any unusual activity" },
  { id: "media_blackout", label: "media blackout", phrase: "local newspapers were pressured to stop covering the incidents" },
  { id: "alternative_explanation", label: "alternative explanation given", phrase: "officials attributed the events to swamp gas and overactive imaginations" },
];

/**
 * Narrative Artifact Type - The "voice" or format of the telling
 * 10 options - reduces tonal repetition even when concepts overlap
 */
export const NARRATIVE_ARTIFACT_OPTIONS = [
  { id: "police_memo", label: "archived police memo", voice: "dry, bureaucratic, focused on dates and locations" },
  { id: "newspaper_recap", label: "local newspaper recap", voice: "journalistic, quotes from locals, sensationalized headlines" },
  { id: "research_footnote", label: "research paper footnote", voice: "academic, citations, clinical detachment" },
  { id: "witness_interview", label: "witness interview summary", voice: "first-person quotes, emotional, inconsistent details" },
  { id: "agency_report", label: "internal agency report", voice: "redacted sections, formal language, classified mentions" },
  { id: "radio_transcript", label: "radio broadcast transcript", voice: "conversational, interruptions, background noise described" },
  { id: "forum_post", label: "archived forum post", voice: "informal, speculative, links to other cases" },
  { id: "documentary_narration", label: "documentary narration", voice: "measured, ominous, building tension" },
  { id: "oral_history", label: "oral history compilation", voice: "multiple generations, folklore elements, warnings" },
  { id: "deathbed_confession", label: "deathbed testimony", voice: "urgent, guilt-ridden, long-held secrets" },
];

/**
 * Threat BEHAVIOR - What the threat DOES
 * 10 options - separated from manifestation for uniqueness explosion
 */
export const THREAT_BEHAVIOR_OPTIONS = [
  { id: "watching", label: "watching", description: "watching from a fixed point, never moving, always observing" },
  { id: "following", label: "following", description: "following at a constant distance, maintaining the same gap no matter the speed" },
  { id: "appearing", label: "appearing", description: "appearing in unexpected places, always just within peripheral vision" },
  { id: "calling", label: "calling", description: "calling out, using familiar voices or names" },
  { id: "signaling", label: "signaling", description: "signaling with lights, sounds, or gestures in repeating patterns" },
  { id: "waiting", label: "waiting", description: "waiting at specific locations, as if it knew where people would go" },
  { id: "mimicking", label: "mimicking", description: "mimicking human behavior poorly, like someone learning to act normal" },
  { id: "gathering", label: "gathering", description: "gathering in groups that grow larger each night" },
  { id: "retreating", label: "retreating", description: "retreating when approached but never fully disappearing" },
  { id: "broadcasting", label: "broadcasting", description: "broadcasting signals or messages on frequencies that shouldn't exist" },
];

/**
 * Threat MANIFESTATION - What the threat IS / looks like
 * 12 options - combined with behavior for massive uniqueness
 */
export const THREAT_MANIFESTATION_OPTIONS = [
  { id: "humanoid_tall", label: "tall humanoid", description: "a figure too tall to be human, proportions just slightly wrong" },
  { id: "humanoid_faceless", label: "faceless figure", description: "a human shape with no discernible features where a face should be" },
  { id: "humanoid_dated", label: "anachronistic figure", description: "a person dressed decades out of time, as if from old photographs" },
  { id: "vehicle_black", label: "black vehicle", description: "a black vehicle with no plates, windows too dark to see through" },
  { id: "light_geometric", label: "geometric lights", description: "lights moving in impossible geometric patterns" },
  { id: "sound_pattern", label: "repeating sound", description: "a sequence of sounds—three notes, a rhythm—heard by witnesses miles apart" },
  { id: "reflection", label: "wrong reflection", description: "something visible only in reflections, mirrors, or photographs" },
  { id: "shadow_independent", label: "independent shadow", description: "a shadow that moves independently of any source" },
  { id: "distortion_visual", label: "visual distortion", description: "a blur or shimmer in the air, like heat haze but localized" },
  { id: "animal_wrong", label: "wrong animals", description: "animals behaving in coordinated, unnatural ways" },
  { id: "object_appearing", label: "appearing objects", description: "objects—photographs, symbols, messages—appearing in impossible places" },
  { id: "environmental", label: "environmental anomaly", description: "temperature drops, static, pressure changes with no visible source" },
];

/**
 * Repeating Detail Categories - What specific visual repeats
 * 8 categories, each with variants
 */
export const REPEATING_DETAIL_OPTIONS = [
  // Face/head details
  { id: "face_covered", category: "face", description: "face obscured by a pale cloth" },
  { id: "face_blank", category: "face", description: "a face with no features, smooth like an egg" },
  { id: "face_too_wide", category: "face", description: "a smile that stretched too wide, showing too many teeth" },
  { id: "eyes_wrong", category: "face", description: "eyes that reflected light when there was none" },
  { id: "eyes_black", category: "face", description: "eyes entirely black, no whites visible" },
  // Posture/movement details
  { id: "posture_still", category: "posture", description: "standing perfectly still, not even breathing" },
  { id: "posture_tilted", category: "posture", description: "head always tilted at the same unnatural angle" },
  { id: "movement_wrong", category: "posture", description: "moving in a way that suggested the joints bent backwards" },
  { id: "movement_stop", category: "posture", description: "freezing mid-step whenever someone looked directly at it" },
  // Clothing/appearance details
  { id: "clothing_dated", category: "appearance", description: "wearing clothes from the wrong decade" },
  { id: "clothing_wet", category: "appearance", description: "clothes always dripping wet, even in dry weather" },
  { id: "appearance_faded", category: "appearance", description: "colors washed out, like an old photograph" },
  // Environmental details
  { id: "env_cold", category: "environment", description: "temperature dropping sharply wherever it appeared" },
  { id: "env_smell", category: "environment", description: "a smell of ozone and copper, always preceding the sighting" },
  { id: "env_static", category: "environment", description: "all radios nearby filling with static" },
  { id: "env_animals", category: "environment", description: "dogs refusing to go near the area for days after" },
];

/**
 * Weird Axis - The unique "wrongness" of this story
 * 20 options - this is what makes each story feel different
 */
export const WEIRD_AXIS_OPTIONS = [
  { id: "distance_constant", description: "it maintained exactly the same distance, no matter how fast you ran" },
  { id: "photos_closer", description: "in every photograph, it appeared slightly closer than it had been in person" },
  { id: "memories_fade", description: "witnesses would forget details within hours, only the fear remained" },
  { id: "maps_wrong", description: "the location couldn't be found on any map, though multiple people had been there" },
  { id: "time_wrong", description: "clocks would show different times for people standing next to each other" },
  { id: "direction_wrong", description: "every compass pointed toward the same coordinates, regardless of where you stood" },
  { id: "counting_wrong", description: "there was always one more person in the group than there should have been" },
  { id: "sound_delayed", description: "sounds arrived seconds after they should have, like watching a badly dubbed film" },
  { id: "shadow_independent", description: "its shadow moved independently, often reaching toward people before it did" },
  { id: "reflection_delayed", description: "its reflection appeared in mirrors moments after it had already passed" },
  { id: "names_forgotten", description: "no one could remember the names of the people who disappeared" },
  { id: "roads_change", description: "the road they'd taken didn't exist the next day, according to locals" },
  { id: "photos_show_more", description: "photographs showed things standing in the background that no one had seen" },
  { id: "radio_predicts", description: "the radio broadcast described events that hadn't happened yet" },
  { id: "children_remember", description: "only children could see it clearly; adults saw only a blur" },
  { id: "writing_appears", description: "the same message would appear written in condensation on windows" },
  { id: "electronics_fail", description: "all electronics would die within a specific radius, then restart showing the same time" },
  { id: "dreams_shared", description: "everyone in the area reported the same dream on the same night" },
  { id: "photos_change", description: "in old photographs, its face would appear where there had been none before" },
  { id: "voices_recorded", description: "recordings made in the area contained voices no one had heard while recording" },
];

/**
 * Escalation Patterns - How the horror builds
 * 8 options
 */
export const ESCALATION_OPTIONS = [
  { id: "sightings_to_missing", label: "sightings → disappearances", description: "first just sightings, then people started going missing" },
  { id: "one_to_many", label: "one witness → many", description: "what one person saw, soon hundreds were reporting" },
  { id: "distant_to_close", label: "distant → close", description: "first seen far away, each sighting brought it closer" },
  { id: "night_to_day", label: "night → daylight", description: "what happened only at night began appearing in broad daylight" },
  { id: "rural_to_urban", label: "rural → urban", description: "started in remote areas, then appeared in cities" },
  { id: "passive_to_active", label: "passive → active", description: "at first it only watched, then it started approaching" },
  { id: "individual_to_group", label: "individuals → groups", description: "single people first, then entire families" },
  { id: "physical_to_psychological", label: "physical → psychological", description: "physical sightings gave way to shared nightmares and paranoia" },
];

/**
 * Ending Knowledge - What is KNOWN at the end (resolution status)
 * 8 options - separated from imagery to preserve ambiguity
 */
export const ENDING_KNOWLEDGE_OPTIONS = [
  { id: "unresolved", label: "unresolved", description: "the case remains officially open, with no new leads in decades" },
  { id: "suppressed", label: "suppressed", description: "files were sealed, witnesses silenced, official explanation rejected by all involved" },
  { id: "forgotten", label: "forgotten", description: "the events faded from memory, only rediscovered in archived records" },
  { id: "ongoing", label: "ongoing", description: "reports continue to this day, following the same pattern" },
  { id: "inherited", label: "inherited", description: "the phenomenon passed to the next generation, children now reporting the same experiences" },
  { id: "cyclical", label: "cyclical", description: "researchers identified a pattern—the events recur at specific intervals" },
  { id: "partial", label: "partially explained", description: "some details were explained, but the core mystery remained" },
  { id: "denied", label: "officially denied", description: "authorities maintain nothing happened, contradicting all evidence" },
];

/**
 * Ending Imagery - The FINAL IMAGE the reader is left with
 * 10 options - separated from knowledge for visual uniqueness
 */
export const ENDING_IMAGERY_OPTIONS = [
  { id: "watching_treeline", label: "figure at treeline", description: "a figure still visible at the edge of the woods, watching" },
  { id: "empty_road", label: "empty road", description: "the stretch of road, empty now, but locals still won't drive it after dark" },
  { id: "silent_recording", label: "silent recording", description: "the last recording, cutting to three hours of silence" },
  { id: "coordinates_appearing", label: "coordinates appearing", description: "the same coordinates, still appearing on malfunctioning devices" },
  { id: "sealed_files", label: "sealed files", description: "a file cabinet, locked until 2050, containing things no one will discuss" },
  { id: "children_dreaming", label: "children dreaming", description: "children who never met the witnesses, dreaming the same dreams" },
  { id: "photograph_changing", label: "photograph changing", description: "an old photograph, where a new figure appears each time someone looks" },
  { id: "fog_rolling", label: "fog rolling in", description: "fog rolling across the area, as it always does before the sightings resume" },
  { id: "lights_distant", label: "distant lights", description: "lights in the distance, moving in the same patterns, waiting" },
  { id: "message_reappearing", label: "message reappearing", description: "the same words, appearing again in condensation, in dust, in frost" },
];

/**
 * Emotional Aftertaste - How the reader should feel
 * 8 options
 */
export const EMOTION_OPTIONS = [
  { id: "unease", description: "lingering unease, checking over your shoulder" },
  { id: "dread", description: "slow-building dread, the feeling something is inevitable" },
  { id: "paranoia", description: "paranoia, wondering what you might have missed" },
  { id: "isolation", description: "profound isolation, realizing no one would believe you" },
  { id: "insignificance", description: "cosmic insignificance, being noticed by something vast" },
  { id: "wrongness", description: "fundamental wrongness, reality not working as it should" },
  { id: "recognition", description: "uncomfortable recognition, this could happen to you" },
  { id: "curiosity_fear", description: "morbid curiosity mixed with fear, wanting to know more" },
];

// =====================================================
// DNA STRUCTURE
// =====================================================

export interface StoryDNA {
  // Core identification
  dna_id: string;           // UUID for this DNA
  concept_hash: string;     // Hash of core concept (behavior + manifestation + weird_axis + escalation)
  full_hash: string;        // Hash of entire DNA for exact match detection
  genre: string;            // Which genre profile was used (v3.1)
  
  // Temporal
  era: typeof ERA_OPTIONS[number];
  
  // Spatial
  location: typeof LOCATION_OPTIONS[number];
  specific_states: string[];  // 2-3 specific US states
  
  // Narrative
  subgenre: typeof SUBGENRE_OPTIONS[number];
  authority: typeof AUTHORITY_OPTIONS[number];
  narrative_artifact: typeof NARRATIVE_ARTIFACT_OPTIONS[number];  // NEW: voice/format
  
  // Horror Elements - SPLIT for uniqueness explosion
  threat_behavior: typeof THREAT_BEHAVIOR_OPTIONS[number];       // What it DOES
  threat_manifestation: typeof THREAT_MANIFESTATION_OPTIONS[number]; // What it IS
  repeating_detail: typeof REPEATING_DETAIL_OPTIONS[number];
  weird_axis: typeof WEIRD_AXIS_OPTIONS[number];
  
  // Structure
  escalation: typeof ESCALATION_OPTIONS[number];
  ending_knowledge: typeof ENDING_KNOWLEDGE_OPTIONS[number];     // Resolution status
  ending_imagery: typeof ENDING_IMAGERY_OPTIONS[number];         // Final visual
  
  // Emotional
  emotion: typeof EMOTION_OPTIONS[number];
  
  // Generation metadata
  created_at: string;
  generation_attempt: number;
  banned_concepts_avoided: string[];
}

// =====================================================
// US STATES FOR GEOGRAPHIC DIVERSITY
// =====================================================

const US_STATES_BY_REGION: Record<string, string[]> = {
  northeast: ["Maine", "New Hampshire", "Vermont", "Massachusetts", "Rhode Island", "Connecticut", "New York", "New Jersey", "Pennsylvania"],
  southeast: ["Virginia", "West Virginia", "Kentucky", "Tennessee", "North Carolina", "South Carolina", "Georgia", "Florida", "Alabama", "Mississippi", "Louisiana", "Arkansas"],
  midwest: ["Ohio", "Michigan", "Indiana", "Illinois", "Wisconsin", "Minnesota", "Iowa", "Missouri", "North Dakota", "South Dakota", "Nebraska", "Kansas"],
  southwest: ["Texas", "Oklahoma", "New Mexico", "Arizona"],
  west: ["Colorado", "Wyoming", "Montana", "Idaho", "Utah", "Nevada", "California", "Oregon", "Washington", "Alaska", "Hawaii"],
};

/**
 * Get 2-3 geographically connected states for credibility
 */
function getConnectedStates(): string[] {
  const regions = Object.keys(US_STATES_BY_REGION);
  const region = regions[Math.floor(Math.random() * regions.length)];
  const states = US_STATES_BY_REGION[region];
  
  // Pick 2-3 adjacent states
  const startIdx = Math.floor(Math.random() * (states.length - 2));
  const count = Math.random() < 0.5 ? 2 : 3;
  
  return states.slice(startIdx, startIdx + count);
}

// =====================================================
// DNA GENERATION
// =====================================================

/**
 * Generate a random element from an array
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =====================================================
// ADAPTIVE WEIGHTING SYSTEM
// The more something is used, the harder it becomes to reappear.
// The rarer something is, the more gravity it gains.
// =====================================================

interface ComponentUsage {
  [componentId: string]: number;
}

interface AdaptiveWeights {
  era: ComponentUsage;
  location: ComponentUsage;
  subgenre: ComponentUsage;
  authority: ComponentUsage;
  narrative_artifact: ComponentUsage;
  threat_behavior: ComponentUsage;
  threat_manifestation: ComponentUsage;
  repeating_detail: ComponentUsage;
  weird_axis: ComponentUsage;
  escalation: ComponentUsage;
  ending_knowledge: ComponentUsage;
  ending_imagery: ComponentUsage;
  emotion: ComponentUsage;
  total_stories: number;
}

/**
 * Fetch component usage counts from the database
 */
async function getComponentUsageCounts(supabase: any): Promise<AdaptiveWeights> {
  // Get total story count
  const { count: totalCount } = await supabase
    .from('story_dna')
    .select('*', { count: 'exact', head: true });
  
  const totalStories = totalCount || 0;
  
  // Initialize empty usage maps
  const weights: AdaptiveWeights = {
    era: {},
    location: {},
    subgenre: {},
    authority: {},
    narrative_artifact: {},
    threat_behavior: {},
    threat_manifestation: {},
    repeating_detail: {},
    weird_axis: {},
    escalation: {},
    ending_knowledge: {},
    ending_imagery: {},
    emotion: {},
    total_stories: totalStories,
  };
  
  // If no stories yet, return empty weights (will use uniform distribution)
  if (totalStories === 0) {
    console.log('[DNA] No stories yet, using uniform weights');
    return weights;
  }
  
  // Fetch usage counts from the component frequency view
  const { data: frequencyData, error } = await supabase
    .from('story_dna_component_frequency')
    .select('component_type, component_id, usage_count');
  
  if (error) {
    console.error('[DNA] Error fetching component frequency:', error);
    return weights;
  }
  
  // Populate the weights object
  for (const row of frequencyData || []) {
    const type = row.component_type as keyof Omit<AdaptiveWeights, 'total_stories'>;
    if (weights[type] && row.component_id) {
      weights[type][row.component_id] = row.usage_count;
    }
  }
  
  console.log(`[DNA] Loaded usage counts for ${totalStories} stories`);
  return weights;
}

/**
 * Calculate rarity multiplier using sqrt decay
 * Formula: min(3.0, sqrt(N / (k + 1)))
 * 
 * - Rare components get boosted (up to 3x)
 * - Popular ones decay naturally
 * - Smooth curve, no sharp cliffs
 */
function calculateRarityMultiplier(
  totalStories: number,
  componentUsage: number,
  maxMultiplier: number = 3.0
): number {
  if (totalStories === 0) return 1.0;
  const rawMultiplier = Math.sqrt(totalStories / (componentUsage + 1));
  return Math.min(maxMultiplier, rawMultiplier);
}

/**
 * Calculate recency penalty
 * If used in recent stories: 0.3 (harsh penalty)
 * Otherwise: 1.0 (no penalty)
 */
function calculateRecencyPenalty(
  componentId: string,
  recentlyUsedIds: string[],
  penaltyFactor: number = 0.3
): number {
  return recentlyUsedIds.includes(componentId) ? penaltyFactor : 1.0;
}

/**
 * Calculate effective weight for a component (v3.1 with genre profiles)
 * effective_weight = base_weight × rarity_multiplier × recency_penalty × genre_multiplier
 */
function calculateEffectiveWeight(
  componentId: string,
  totalStories: number,
  usageCount: number,
  recentlyUsedIds: string[],
  genreMultiplier: number = 1.0,
  baseWeight: number = 1.0
): number {
  const rarityMultiplier = calculateRarityMultiplier(totalStories, usageCount);
  const recencyPenalty = calculateRecencyPenalty(componentId, recentlyUsedIds);
  return baseWeight * rarityMultiplier * recencyPenalty * genreMultiplier;
}

/**
 * Roulette wheel selection (weighted random)
 * Higher weight = higher probability of selection
 */
function rouletteWheelSelect<T extends { id: string }>(
  options: T[],
  weights: number[]
): T {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  // If all weights are zero, fall back to uniform random
  if (totalWeight === 0) {
    return pickRandom(options);
  }
  
  let random = Math.random() * totalWeight;
  
  for (let i = 0; i < options.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return options[i];
    }
  }
  
  // Fallback (shouldn't reach here)
  return options[options.length - 1];
}

/**
 * Weighted pick with adaptive weighting + genre profiles (v3.1)
 * This is the core of the anti-entropy system
 * 
 * Final formula: base × rarity × recency × genre
 */
function weightedPick<T extends { id: string }>(
  options: T[],
  usageCounts: ComponentUsage,
  totalStories: number,
  recentlyUsedIds: string[] = [],
  genreProfile: GenreProfile | null = null,
  dimension: keyof GenreProfile['weights'] | null = null
): T {
  // Calculate effective weights for each option
  const weights = options.map(opt => {
    const usage = usageCounts[opt.id] || 0;
    const genreMultiplier = (genreProfile && dimension) 
      ? getGenreMultiplier(genreProfile, dimension, opt.id) 
      : 1.0;
    return calculateEffectiveWeight(opt.id, totalStories, usage, recentlyUsedIds, genreMultiplier);
  });
  
  // Log top/bottom weights for debugging
  const weightedOptions = options.map((opt, i) => ({ 
    id: opt.id, 
    weight: weights[i],
    usage: usageCounts[opt.id] || 0,
    genreBoost: (genreProfile && dimension) ? getGenreMultiplier(genreProfile, dimension, opt.id) : 1.0
  }));
  const sorted = [...weightedOptions].sort((a, b) => b.weight - a.weight);
  
  if (totalStories > 0 && sorted.length > 0) {
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    console.log(`[DNA]   Top: ${top?.id} (w=${top?.weight.toFixed(2)}, used=${top?.usage}x, genre=${top?.genreBoost})`);
    console.log(`[DNA]   Low: ${bottom?.id} (w=${bottom?.weight.toFixed(2)}, used=${bottom?.usage}x, genre=${bottom?.genreBoost})`);
  }
  
  return rouletteWheelSelect(options, weights);
}

/**
 * Generate a SHA-256 hash of a string
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

/**
 * Generate concept hash (the core "what makes this story unique")
 * Now includes: behavior + manifestation + weird_axis + escalation
 * This 4-axis concept hash explodes uniqueness even further
 */
async function generateConceptHash(
  threatBehavior: typeof THREAT_BEHAVIOR_OPTIONS[number],
  threatManifestation: typeof THREAT_MANIFESTATION_OPTIONS[number],
  weirdAxis: typeof WEIRD_AXIS_OPTIONS[number],
  escalation: typeof ESCALATION_OPTIONS[number]
): Promise<string> {
  const conceptString = `${threatBehavior.id}|${threatManifestation.id}|${weirdAxis.id}|${escalation.id}`;
  return await hashString(conceptString);
}

/**
 * Generate full DNA hash (for exact duplicate detection)
 */
async function generateFullHash(dna: Partial<StoryDNA>): Promise<string> {
  const fullString = [
    dna.era?.id,
    dna.location?.id,
    dna.subgenre?.id,
    dna.authority?.id,
    dna.narrative_artifact?.id,
    dna.threat_behavior?.id,
    dna.threat_manifestation?.id,
    dna.repeating_detail?.id,
    dna.weird_axis?.id,
    dna.escalation?.id,
    dna.ending_knowledge?.id,
    dna.ending_imagery?.id,
    dna.emotion?.id,
  ].join('|');
  return await hashString(fullString);
}

/**
 * Check if a concept hash already exists in the database
 */
async function conceptHashExists(
  supabase: any,
  conceptHash: string,
  lookbackDays: number = 30
): Promise<boolean> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  
  const { data, error } = await supabase
    .from('story_dna')
    .select('id')
    .eq('concept_hash', conceptHash)
    .gte('created_at', lookbackDate.toISOString())
    .limit(1);
  
  if (error) {
    console.error('[DNA] Error checking concept hash:', error);
    return false; // Allow generation if DB check fails
  }
  
  return data && data.length > 0;
}

/**
 * Get recently used concept IDs to avoid
 * Updated for split threat (behavior + manifestation) and split ending (knowledge + imagery)
 */
export async function getRecentlyUsedConcepts(
  supabase: any,
  lookbackDays: number = 7,
  limit: number = 20
): Promise<{
  threatBehaviors: string[];
  threatManifestations: string[];
  weirdAxes: string[];
  escalations: string[];
  repeatingDetails: string[];
  endingKnowledges: string[];
  endingImageries: string[];
}> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  
  const { data, error } = await supabase
    .from('story_dna')
    .select('threat_behavior_id, threat_manifestation_id, weird_axis_id, escalation_id, repeating_detail_id, ending_knowledge_id, ending_imagery_id')
    .gte('created_at', lookbackDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error || !data) {
    console.log('[DNA] No recent DNA found or error:', error?.message);
    return { threatBehaviors: [], threatManifestations: [], weirdAxes: [], escalations: [], repeatingDetails: [], endingKnowledges: [], endingImageries: [] };
  }
  
  return {
    threatBehaviors: [...new Set(data.map((d: any) => d.threat_behavior_id).filter(Boolean))],
    threatManifestations: [...new Set(data.map((d: any) => d.threat_manifestation_id).filter(Boolean))],
    weirdAxes: [...new Set(data.map((d: any) => d.weird_axis_id).filter(Boolean))],
    escalations: [...new Set(data.map((d: any) => d.escalation_id).filter(Boolean))],
    repeatingDetails: [...new Set(data.map((d: any) => d.repeating_detail_id).filter(Boolean))],
    endingKnowledges: [...new Set(data.map((d: any) => d.ending_knowledge_id).filter(Boolean))],
    endingImageries: [...new Set(data.map((d: any) => d.ending_imagery_id).filter(Boolean))],
  };
}

/**
 * Pick an option avoiding recently used ones
 */
function pickAvoidingRecent<T extends { id: string }>(
  options: T[],
  recentIds: string[],
  fallbackToAny: boolean = true
): T {
  // Filter out recently used
  const available = options.filter(opt => !recentIds.includes(opt.id));
  
  if (available.length > 0) {
    return pickRandom(available);
  }
  
  // If all options were recently used, pick any (with warning)
  if (fallbackToAny) {
    console.log('[DNA] All options recently used, picking randomly');
    return pickRandom(options);
  }
  
  // Should never reach here
  return pickRandom(options);
}

/**
 * Generate a unique Story DNA with ADAPTIVE WEIGHTING + GENRE PROFILES
 * This is the main function - creates a complete DNA structure
 * that hasn't been used before (checks concept hash)
 * 
 * V3.1: Now uses genre-aware adaptive weighting
 * - Rare concepts get boosted (rarity multiplier)
 * - Recently used concepts get penalized (recency penalty)
 * - Genre profiles shape the "gravitational field" of selection
 * - Each dimension independently weighted for combinatorial explosion
 * 
 * @param supabase - Database client
 * @param genreName - Which genre profile to use ('urban_legend' or 'one_too_many')
 * @param maxAttempts - Max retries for unique concept hash
 */
export async function generateStoryDNA(
  supabase: any,
  genreName: string = 'urban_legend',
  maxAttempts: number = 10
): Promise<StoryDNA> {
  // v4.0: Map deprecated presets to active engines
  const resolvedGenre = DEPRECATED_PRESET_MAP[genreName] || genreName;
  
  // Load genre profile (fallback to urban_legend if not found)
  const genreProfile = GENRE_PROFILES[resolvedGenre] || GENRE_PROFILES.urban_legend;
  console.log(`[DNA] Generating unique story DNA (v4.0 - engine: ${genreProfile.name})...`);
  if (resolvedGenre !== genreName) {
    console.log(`[DNA] Note: '${genreName}' is deprecated, using '${resolvedGenre}'`);
  }
  console.log(`[DNA] Genre description: ${genreProfile.description}`);
  
  // Fetch usage counts for adaptive weighting
  const weights = await getComponentUsageCounts(supabase);
  console.log(`[DNA] Total stories for weighting: ${weights.total_stories}`);
  
  // Get recently used concepts for recency penalty
  const recentConcepts = await getRecentlyUsedConcepts(supabase, 7, 50);
  console.log(`[DNA] Recent concepts: ${recentConcepts.threatBehaviors.length} behaviors, ${recentConcepts.threatManifestations.length} manifestations, ${recentConcepts.weirdAxes.length} weird axes`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[DNA] Generation attempt ${attempt}/${maxAttempts}`);
    
    // === GENRE-AWARE ADAPTIVE WEIGHTED SELECTION ===
    // Each dimension uses weighted random based on rarity, recency, AND genre profile
    
    console.log('[DNA] Selecting era...');
    const era = weightedPick(ERA_OPTIONS, weights.era, weights.total_stories, [], genreProfile, 'era');
    
    console.log('[DNA] Selecting location...');
    const location = weightedPick(LOCATION_OPTIONS, weights.location, weights.total_stories, [], genreProfile, 'location');
    
    console.log('[DNA] Selecting subgenre...');
    const subgenre = weightedPick(SUBGENRE_OPTIONS, weights.subgenre, weights.total_stories, [], genreProfile, 'subgenre');
    
    console.log('[DNA] Selecting authority...');
    const authority = weightedPick(AUTHORITY_OPTIONS, weights.authority, weights.total_stories, [], genreProfile, 'authority');
    
    console.log('[DNA] Selecting narrative artifact...');
    const narrativeArtifact = weightedPick(NARRATIVE_ARTIFACT_OPTIONS, weights.narrative_artifact, weights.total_stories, [], genreProfile, 'narrative_artifact');
    
    // Core uniqueness elements - include recency penalty
    console.log('[DNA] Selecting threat behavior (with recency penalty)...');
    const threatBehavior = weightedPick(THREAT_BEHAVIOR_OPTIONS, weights.threat_behavior, weights.total_stories, recentConcepts.threatBehaviors, genreProfile, 'threat_behavior');
    
    console.log('[DNA] Selecting threat manifestation (with recency penalty)...');
    const threatManifestation = weightedPick(THREAT_MANIFESTATION_OPTIONS, weights.threat_manifestation, weights.total_stories, recentConcepts.threatManifestations, genreProfile, 'threat_manifestation');
    
    console.log('[DNA] Selecting weird axis (with recency penalty)...');
    const weirdAxis = weightedPick(WEIRD_AXIS_OPTIONS, weights.weird_axis, weights.total_stories, recentConcepts.weirdAxes, genreProfile, 'weird_axis');
    
    console.log('[DNA] Selecting escalation...');
    const escalation = weightedPick(ESCALATION_OPTIONS, weights.escalation, weights.total_stories, recentConcepts.escalations, genreProfile, 'escalation');
    
    console.log('[DNA] Selecting repeating detail...');
    const repeatingDetail = weightedPick(REPEATING_DETAIL_OPTIONS, weights.repeating_detail, weights.total_stories, recentConcepts.repeatingDetails, genreProfile, 'repeating_detail');
    
    console.log('[DNA] Selecting ending knowledge...');
    const endingKnowledge = weightedPick(ENDING_KNOWLEDGE_OPTIONS, weights.ending_knowledge, weights.total_stories, recentConcepts.endingKnowledges, genreProfile, 'ending_knowledge');
    
    console.log('[DNA] Selecting ending imagery...');
    const endingImagery = weightedPick(ENDING_IMAGERY_OPTIONS, weights.ending_imagery, weights.total_stories, recentConcepts.endingImageries, genreProfile, 'ending_imagery');
    
    console.log('[DNA] Selecting emotion...');
    const emotion = weightedPick(EMOTION_OPTIONS, weights.emotion, weights.total_stories, [], genreProfile, 'emotion');
    
    // Generate concept hash (now includes behavior + manifestation)
    const conceptHash = await generateConceptHash(threatBehavior, threatManifestation, weirdAxis, escalation);
    
    // Check if this concept combination already exists
    const exists = await conceptHashExists(supabase, conceptHash, 60); // 60 day lookback for concepts
    
    if (!exists) {
      // Generate full hash
      const partialDNA = {
        era, location, subgenre, authority, narrative_artifact: narrativeArtifact,
        threat_behavior: threatBehavior, threat_manifestation: threatManifestation,
        repeating_detail: repeatingDetail, weird_axis: weirdAxis,
        escalation, ending_knowledge: endingKnowledge, ending_imagery: endingImagery, emotion
      };
      const fullHash = await generateFullHash(partialDNA);
      
      const dna: StoryDNA = {
        dna_id: crypto.randomUUID(),
        concept_hash: conceptHash,
        full_hash: fullHash,
        genre: genreProfile.name,
        era,
        location,
        specific_states: getConnectedStates(),
        subgenre,
        authority,
        narrative_artifact: narrativeArtifact,
        threat_behavior: threatBehavior,
        threat_manifestation: threatManifestation,
        repeating_detail: repeatingDetail,
        weird_axis: weirdAxis,
        escalation,
        ending_knowledge: endingKnowledge,
        ending_imagery: endingImagery,
        emotion,
        created_at: new Date().toISOString(),
        generation_attempt: attempt,
        banned_concepts_avoided: [
          ...recentConcepts.threatBehaviors,
          ...recentConcepts.threatManifestations,
          ...recentConcepts.weirdAxes,
        ],
      };
      
      // =====================================================
      // PRESET-AWARE DNA LANE LOCK: one_too_many
      // HARD OVERRIDE - Forces counting horror DNA
      // No generic horror elements allowed
      // =====================================================
      if (genreName === 'one_too_many') {
        console.log(`[DNA] 🔒 Applying one_too_many HARD lane lock...`);
        
        // Get random elements from trope pack for variety
        const tropePick = pickFromTropePack('one_too_many');
        
        if (tropePick) {
          // HARD OVERRIDE: Threat is the extra person (not generic entity)
          dna.threat_behavior = {
            id: 'count_appears',
            label: 'appears in counts',
            description: `appears ONLY when people count, recount, or review records; the extra ${tropePick.group_size.extra}th person is visible in every headcount but invisible to casual observation`,
          } as typeof dna.threat_behavior;
          
          dna.threat_manifestation = {
            id: 'extra_person',
            label: 'extra person',
            description: `an extra person who was never meant to be there; no one invited them, no one recognizes them, yet they fit in perfectly`,
          } as typeof dna.threat_manifestation;
          
          // HARD OVERRIDE: Repeating detail = numbers coming up wrong
          dna.repeating_detail = {
            id: 'numbers_wrong',
            category: 'counting',
            description: `group of ${tropePick.group_size.start} keeps counting ${tropePick.group_size.extra} people - one extra that shouldn't exist`,
          } as typeof dna.repeating_detail;
          
          // HARD OVERRIDE: Weird axis = the counting phrase
          dna.weird_axis = {
            id: 'counting_wrong',
            description: `"${tropePick.count_phrase}" - and no one can identify who the extra one is`,
          } as typeof dna.weird_axis;
          
          // HARD OVERRIDE: Ending = photo/video proof showing one too many
          dna.ending_imagery = {
            id: 'proof_n_plus_one',
            label: 'visual proof',
            description: `${tropePick.evidence_source} showing exactly ${tropePick.group_size.extra} people (should be ${tropePick.group_size.start}) with extra face looking at camera`,
          } as typeof dna.ending_imagery;
          
          // HARD OVERRIDE: Escalation = recount → confusion → glitches
          const countingEscalation = `group of ${tropePick.group_size.start} always recounts to ${tropePick.group_size.extra}; confusion about who's extra; memory fog when trying to identify; then ${tropePick.glitch}`;
          dna.escalation = {
            id: 'counting_escalation',
            label: 'count escalation',
            description: countingEscalation,
          } as typeof dna.escalation;
          
          // Store full trope pick for contract builder
          (dna as any).trope_selection = tropePick;
          (dna as any).counting_horror = {
            start_count: tropePick.group_size.start,
            wrong_count: tropePick.group_size.extra,
            container: tropePick.container,
            glitch: tropePick.glitch,
            external_witness: tropePick.external_witness,
            dialogue: tropePick.dialogue_line,
            evidence: tropePick.evidence_source,
          };
          
          console.log(`[DNA]   🔒 HARD LANE LOCK: one_too_many`);
          console.log(`[DNA]   Group: ${tropePick.group_type}`);
          console.log(`[DNA]   Size: ${tropePick.group_size.start} → ${tropePick.group_size.extra}`);
          console.log(`[DNA]   Container: ${tropePick.container}`);
          console.log(`[DNA]   Glitch: ${tropePick.glitch}`);
          console.log(`[DNA]   Witness: ${tropePick.external_witness}`);
          console.log(`[DNA]   Evidence: ${tropePick.evidence_source}`);
          console.log(`[DNA]   Dialogue: "${tropePick.dialogue_line}"`);
        }
      }
      
      console.log(`[DNA] ✅ Generated unique DNA on attempt ${attempt} (genre: ${genreProfile.name}):`);
      console.log(`[DNA]   Genre: ${genreProfile.name}`);
      console.log(`[DNA]   Era: ${era.label}`);
      console.log(`[DNA]   Location: ${location.label}`);
      console.log(`[DNA]   Artifact: ${narrativeArtifact.label}`);
      console.log(`[DNA]   Threat: ${threatBehavior.label} + ${threatManifestation.label}`);
      console.log(`[DNA]   Weird Axis: ${weirdAxis.id}`);
      console.log(`[DNA]   Ending: ${endingKnowledge.label} / ${endingImagery.label}`);
      console.log(`[DNA]   Concept Hash: ${conceptHash}`);
      
      return dna;
    }
    
    console.log(`[DNA] ⚠️ Attempt ${attempt}: Concept hash ${conceptHash} already exists, retrying...`);
  }
  
  // If we exhausted attempts, generate anyway with warning (very rare with 28T combinations)
  console.warn(`[DNA] ❌ Could not find unique concept in ${maxAttempts} attempts, generating with random fallback`);
  
  const era = pickRandom(ERA_OPTIONS);
  const location = pickRandom(LOCATION_OPTIONS);
  const subgenre = pickRandom(SUBGENRE_OPTIONS);
  const authority = pickRandom(AUTHORITY_OPTIONS);
  const narrativeArtifact = pickRandom(NARRATIVE_ARTIFACT_OPTIONS);
  const threatBehavior = pickRandom(THREAT_BEHAVIOR_OPTIONS);
  const threatManifestation = pickRandom(THREAT_MANIFESTATION_OPTIONS);
  const weirdAxis = pickRandom(WEIRD_AXIS_OPTIONS);
  const escalation = pickRandom(ESCALATION_OPTIONS);
  const repeatingDetail = pickRandom(REPEATING_DETAIL_OPTIONS);
  const endingKnowledge = pickRandom(ENDING_KNOWLEDGE_OPTIONS);
  const endingImagery = pickRandom(ENDING_IMAGERY_OPTIONS);
  const emotion = pickRandom(EMOTION_OPTIONS);
  
  const conceptHash = await generateConceptHash(threatBehavior, threatManifestation, weirdAxis, escalation);
  const partialDNA = {
    era, location, subgenre, authority, narrative_artifact: narrativeArtifact,
    threat_behavior: threatBehavior, threat_manifestation: threatManifestation,
    repeating_detail: repeatingDetail, weird_axis: weirdAxis,
    escalation, ending_knowledge: endingKnowledge, ending_imagery: endingImagery, emotion
  };
  const fullHash = await generateFullHash(partialDNA);
  
  return {
    dna_id: crypto.randomUUID(),
    concept_hash: conceptHash,
    full_hash: fullHash,
    genre: genreProfile.name,
    era,
    location,
    specific_states: getConnectedStates(),
    subgenre,
    authority,
    narrative_artifact: narrativeArtifact,
    threat_behavior: threatBehavior,
    threat_manifestation: threatManifestation,
    repeating_detail: repeatingDetail,
    weird_axis: weirdAxis,
    escalation,
    ending_knowledge: endingKnowledge,
    ending_imagery: endingImagery,
    emotion,
    created_at: new Date().toISOString(),
    generation_attempt: maxAttempts + 1,
    banned_concepts_avoided: [],
  };
}

/**
 * Store DNA in the database
 * UPDATED: Now stores split threat (behavior + manifestation), 
 * narrative artifact, and split ending (knowledge + imagery)
 */
export async function storeDNA(
  supabase: any,
  dna: StoryDNA,
  storyId?: string,
  jobId?: string
): Promise<void> {
  const { error } = await supabase
    .from('story_dna')
    .insert({
      id: dna.dna_id,
      concept_hash: dna.concept_hash,
      full_hash: dna.full_hash,
      genre: dna.genre,
      era_id: dna.era.id,
      era_label: dna.era.label,
      location_id: dna.location.id,
      location_label: dna.location.label,
      specific_states: dna.specific_states,
      subgenre_id: dna.subgenre.id,
      authority_id: dna.authority.id,
      narrative_artifact_id: dna.narrative_artifact.id,
      narrative_artifact_label: dna.narrative_artifact.label,
      threat_behavior_id: dna.threat_behavior.id,
      threat_behavior_description: dna.threat_behavior.description,
      threat_manifestation_id: dna.threat_manifestation.id,
      threat_manifestation_description: dna.threat_manifestation.description,
      repeating_detail_id: dna.repeating_detail.id,
      repeating_detail_description: dna.repeating_detail.description,
      weird_axis_id: dna.weird_axis.id,
      weird_axis_description: dna.weird_axis.description,
      escalation_id: dna.escalation.id,
      ending_knowledge_id: dna.ending_knowledge.id,
      ending_knowledge_description: dna.ending_knowledge.description,
      ending_imagery_id: dna.ending_imagery.id,
      ending_imagery_description: dna.ending_imagery.description,
      emotion_id: dna.emotion.id,
      generation_attempt: dna.generation_attempt,
      story_id: storyId || null,
      job_id: jobId || null,
      created_at: dna.created_at,
    });
  
  if (error) {
    console.error('[DNA] Error storing DNA:', error);
    throw error;
  }
  
  console.log(`[DNA] Stored DNA ${dna.dna_id.substring(0, 8)}...`);
}

// =====================================================
// PROMPT BUILDING
// =====================================================

/**
 * Build the AI prompt from DNA
 * The AI is now a RENDERER - it must follow these exact specifications
 * 
 * UPDATED: Now uses split threat (behavior + manifestation), 
 * narrative artifact for voice, and split ending (knowledge + imagery)
 */
export function buildPromptFromDNA(
  dna: StoryDNA,
  wordCount: { min: number; max: number },
  visualEnvironment: string
): string {
  // Build the combined threat description
  const threatDescription = `${dna.threat_manifestation.description}, ${dna.threat_behavior.description}`;
  
  return `You are writing a faux–true crime horror story. The DNA of this story has been PRE-DETERMINED. You MUST follow ALL specifications exactly.

═══════════════════════════════════════
📋 STORY DNA (NON-NEGOTIABLE):
═══════════════════════════════════════

⏰ ERA: "In the ${dna.era.label}..." (${dna.era.context})

📍 LOCATIONS: ${dna.specific_states.join(', ')} - specifically ${dna.location.label}
   Imagery: ${dna.location.imagery}

📰 FORMAT: ${dna.subgenre.label}
   Tone: ${dna.subgenre.tone}

📜 NARRATIVE VOICE: ${dna.narrative_artifact.label}
   Style: ${dna.narrative_artifact.voice}

👁️ THE THREAT:
   What it IS: ${dna.threat_manifestation.description}
   What it DOES: ${dna.threat_behavior.description}

🔄 REPEATING DETAIL (must appear 2-3 times): ${dna.repeating_detail.description}

❓ THE WEIRD AXIS (what makes this story unique): ${dna.weird_axis.description}

📈 ESCALATION: ${dna.escalation.description}

🏛️ AUTHORITY RESPONSE: ${dna.authority.phrase}

🔚 ENDING:
   Resolution Status: ${dna.ending_knowledge.description}
   Final Image: ${dna.ending_imagery.description}

💭 EMOTIONAL AFTERTASTE: ${dna.emotion.description}

═══════════════════════════════════════
📐 STRUCTURE (FOLLOW EXACTLY):
═══════════════════════════════════════

1. OPENING: Start with "In the ${dna.era.label}..." using the ${dna.narrative_artifact.label} voice

2. EARLY REPORTS: Describe initial encounters with ${threatDescription}. Include the repeating detail.

3. PATTERN: The same ${dna.repeating_detail.category} detail appears in reports from different locations.

4. THE WEIRD PART: Introduce the weird axis - ${dna.weird_axis.description}

5. ESCALATION: ${dna.escalation.description}

6. AUTHORITY: ${dna.authority.phrase}

7. ENDING: ${dna.ending_knowledge.description}. Final image: ${dna.ending_imagery.description}

═══════════════════════════════════════
📏 WORD COUNT (CRITICAL):
═══════════════════════════════════════
- MINIMUM: ${wordCount.min} words
- MAXIMUM: ${wordCount.max} words

═══════════════════════════════════════
🎭 TONE REQUIREMENTS:
═══════════════════════════════════════
- Use the ${dna.narrative_artifact.label} voice: ${dna.narrative_artifact.voice}
- Third person or passive voice (no "I" unless quoting witnesses)
- Documentary feel - THIS REALLY HAPPENED
- Calm, measured narration - the horror comes from the facts

═══════════════════════════════════════
🌲 VISUAL ENVIRONMENT:
═══════════════════════════════════════
${visualEnvironment}

═══════════════════════════════════════
🚫 DO NOT:
═══════════════════════════════════════
- Use first person narration (quotes are OK)
- Add elements not in the DNA
- Change the threat behavior or manifestation
- Change the weird axis
- Add a different ending
- Use real names (use roles: "a farmer", "the sheriff")

Return ONLY valid JSON:
{
  "title": "Short mysterious title (3-5 words)",
  "hook": "The opening sentence starting with 'In the ${dna.era.label}...'",
  "story": "The complete story"
}`;
}

/**
 * Build negative memory injection for prompts
 * This actively pushes the model away from recent concepts
 * UPDATED: Now uses split threat dimensions
 */
export function buildNegativeMemoryInjection(
  recentConcepts: Awaited<ReturnType<typeof getRecentlyUsedConcepts>>
): string {
  if (recentConcepts.threatBehaviors.length === 0 && 
      recentConcepts.threatManifestations.length === 0 && 
      recentConcepts.weirdAxes.length === 0) {
    return '';
  }
  
  const recentBehaviors = recentConcepts.threatBehaviors
    .map(id => THREAT_BEHAVIOR_OPTIONS.find(t => t.id === id)?.description)
    .filter(Boolean)
    .slice(0, 3);
  
  const recentManifestations = recentConcepts.threatManifestations
    .map(id => THREAT_MANIFESTATION_OPTIONS.find(t => t.id === id)?.description)
    .filter(Boolean)
    .slice(0, 3);
  
  const recentWeirdAxes = recentConcepts.weirdAxes
    .map(id => WEIRD_AXIS_OPTIONS.find(w => w.id === id)?.description)
    .filter(Boolean)
    .slice(0, 5);
  
  if (recentBehaviors.length === 0 && recentManifestations.length === 0 && recentWeirdAxes.length === 0) {
    return '';
  }
  
  return `
═══════════════════════════════════════
🚫 AVOID THESE (recently used):
═══════════════════════════════════════
${recentBehaviors.length > 0 ? `Recent threat behaviors to avoid:\n${recentBehaviors.map(t => `- ${t}`).join('\n')}` : ''}
${recentManifestations.length > 0 ? `Recent threat types to avoid:\n${recentManifestations.map(t => `- ${t}`).join('\n')}` : ''}
${recentWeirdAxes.length > 0 ? `Recent concepts to avoid:\n${recentWeirdAxes.map(w => `- ${w}`).join('\n')}` : ''}

DO NOT use similar imagery or concepts.
`;
}

/**
 * Build a simplified display version of the DNA for the UI
 * V3: Now shows adaptive weighting system is active
 */
export function buildDNADisplaySummary(dna: StoryDNA): string {
  return `STORY DNA v3.0 (Adaptive Weighting)

🧬 Selection Method: Entropy-maximizing weighted random
   Rare concepts boosted • Recently used penalized

📍 Setting: ${dna.era.label}, ${dna.specific_states.join(', ')}
   Location type: ${dna.location.label}

📜 Voice: ${dna.narrative_artifact.label}
   Style: ${dna.narrative_artifact.voice}

👁️ Threat:
   What: ${dna.threat_manifestation.description}
   Behavior: ${dna.threat_behavior.description}

🔄 Repeating Detail: ${dna.repeating_detail.description}

❓ Unique Element: ${dna.weird_axis.description}

📈 Escalation: ${dna.escalation.label}

🏛️ Authority: ${dna.authority.label}

🔚 Ending:
   Resolution: ${dna.ending_knowledge.label}
   Final Image: ${dna.ending_imagery.description.substring(0, 40)}...

💭 Emotional Target: ${dna.emotion.description}

🔑 Concept Hash: ${dna.concept_hash}
📊 Generation Attempt: ${dna.generation_attempt}`;
}

// =====================================================
// STATISTICS
// =====================================================

/**
 * Calculate theoretical combination space
 * UPDATED: Now includes split threat (behavior × manifestation), 
 * narrative artifact, and split ending (knowledge × imagery)
 * 
 * New formula: ~49.8 BILLION combinations (up from ~4.1B)
 */
export function getCombinatorialSpace(): number {
  return (
    ERA_OPTIONS.length *                    // 12
    LOCATION_OPTIONS.length *               // 15
    SUBGENRE_OPTIONS.length *               // 10
    AUTHORITY_OPTIONS.length *              // 8
    NARRATIVE_ARTIFACT_OPTIONS.length *     // 10 NEW
    THREAT_BEHAVIOR_OPTIONS.length *        // 10 (was combined threat: 12)
    THREAT_MANIFESTATION_OPTIONS.length *   // 12 NEW
    REPEATING_DETAIL_OPTIONS.length *       // 16
    WEIRD_AXIS_OPTIONS.length *             // 20
    ESCALATION_OPTIONS.length *             // 8
    ENDING_KNOWLEDGE_OPTIONS.length *       // 8 (was combined ending: 10)
    ENDING_IMAGERY_OPTIONS.length *         // 10 NEW
    EMOTION_OPTIONS.length                  // 8
  );
}

/**
 * Get DNA system statistics
 */
export async function getDNAStats(supabase: any): Promise<{
  total_dna_generated: number;
  unique_concepts: number;
  combinatorial_space: number;
  coverage_percent: number;
  most_used_threats: { id: string; count: number }[];
  most_used_weird_axes: { id: string; count: number }[];
}> {
  // Get total DNA count
  const { count: totalCount } = await supabase
    .from('story_dna')
    .select('*', { count: 'exact', head: true });
  
  // Get unique concept count
  const { data: uniqueConcepts } = await supabase
    .from('story_dna')
    .select('concept_hash')
    .limit(10000);
  
  const uniqueConceptCount = new Set(uniqueConcepts?.map((d: any) => d.concept_hash) || []).size;
  
  // Get threat behavior usage
  const { data: behaviorUsage } = await supabase
    .from('story_dna')
    .select('threat_behavior_id')
    .limit(1000);
  
  const behaviorCounts: Record<string, number> = {};
  for (const d of behaviorUsage || []) {
    behaviorCounts[d.threat_behavior_id] = (behaviorCounts[d.threat_behavior_id] || 0) + 1;
  }
  
  // Get threat manifestation usage
  const { data: manifestationUsage } = await supabase
    .from('story_dna')
    .select('threat_manifestation_id')
    .limit(1000);
  
  const manifestationCounts: Record<string, number> = {};
  for (const d of manifestationUsage || []) {
    manifestationCounts[d.threat_manifestation_id] = (manifestationCounts[d.threat_manifestation_id] || 0) + 1;
  }
  
  // Get weird axis usage
  const { data: weirdAxisUsage } = await supabase
    .from('story_dna')
    .select('weird_axis_id')
    .limit(1000);
  
  const weirdAxisCounts: Record<string, number> = {};
  for (const d of weirdAxisUsage || []) {
    weirdAxisCounts[d.weird_axis_id] = (weirdAxisCounts[d.weird_axis_id] || 0) + 1;
  }
  
  const combinatorialSpace = getCombinatorialSpace();
  
  return {
    total_dna_generated: totalCount || 0,
    unique_concepts: uniqueConceptCount,
    combinatorial_space: combinatorialSpace,
    coverage_percent: (uniqueConceptCount / combinatorialSpace) * 100,
    most_used_behaviors: Object.entries(behaviorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count })),
    most_used_manifestations: Object.entries(manifestationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count })),
    most_used_weird_axes: Object.entries(weirdAxisCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count })),
  };
}

// =====================================================
// ENTROPY MONITORING
// Track Shannon entropy per dimension to detect drift
// =====================================================

/**
 * Calculate Shannon entropy for a distribution
 * Higher entropy = more uniform distribution (good)
 * Lower entropy = concentration on few options (bad - drift)
 * Max entropy = log2(n) where n = number of options
 */
function calculateShannonEntropy(counts: Record<string, number>, totalOptions: number): number {
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
  if (total === 0) return Math.log2(totalOptions); // Max entropy if no data
  
  let entropy = 0;
  for (const count of Object.values(counts)) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  
  return entropy;
}

/**
 * Get entropy health report for all dimensions
 * Returns normalized entropy (0-1) where 1 = perfectly uniform, 0 = all same option
 */
export async function getEntropyHealth(supabase: any): Promise<{
  overall_health: number;
  dimensions: {
    name: string;
    entropy: number;
    max_entropy: number;
    normalized: number;
    status: 'healthy' | 'warning' | 'critical';
  }[];
  recommendations: string[];
}> {
  const weights = await getComponentUsageCounts(supabase);
  
  const dimensions = [
    { name: 'era', counts: weights.era, options: ERA_OPTIONS.length },
    { name: 'location', counts: weights.location, options: LOCATION_OPTIONS.length },
    { name: 'subgenre', counts: weights.subgenre, options: SUBGENRE_OPTIONS.length },
    { name: 'authority', counts: weights.authority, options: AUTHORITY_OPTIONS.length },
    { name: 'narrative_artifact', counts: weights.narrative_artifact, options: NARRATIVE_ARTIFACT_OPTIONS.length },
    { name: 'threat_behavior', counts: weights.threat_behavior, options: THREAT_BEHAVIOR_OPTIONS.length },
    { name: 'threat_manifestation', counts: weights.threat_manifestation, options: THREAT_MANIFESTATION_OPTIONS.length },
    { name: 'repeating_detail', counts: weights.repeating_detail, options: REPEATING_DETAIL_OPTIONS.length },
    { name: 'weird_axis', counts: weights.weird_axis, options: WEIRD_AXIS_OPTIONS.length },
    { name: 'escalation', counts: weights.escalation, options: ESCALATION_OPTIONS.length },
    { name: 'ending_knowledge', counts: weights.ending_knowledge, options: ENDING_KNOWLEDGE_OPTIONS.length },
    { name: 'ending_imagery', counts: weights.ending_imagery, options: ENDING_IMAGERY_OPTIONS.length },
    { name: 'emotion', counts: weights.emotion, options: EMOTION_OPTIONS.length },
  ];
  
  const results = dimensions.map(dim => {
    const entropy = calculateShannonEntropy(dim.counts, dim.options);
    const maxEntropy = Math.log2(dim.options);
    const normalized = maxEntropy > 0 ? entropy / maxEntropy : 1;
    
    let status: 'healthy' | 'warning' | 'critical';
    if (normalized >= 0.8) status = 'healthy';
    else if (normalized >= 0.6) status = 'warning';
    else status = 'critical';
    
    return {
      name: dim.name,
      entropy: Math.round(entropy * 100) / 100,
      max_entropy: Math.round(maxEntropy * 100) / 100,
      normalized: Math.round(normalized * 100) / 100,
      status,
    };
  });
  
  const overallHealth = results.reduce((sum, r) => sum + r.normalized, 0) / results.length;
  
  const recommendations: string[] = [];
  for (const dim of results) {
    if (dim.status === 'critical') {
      recommendations.push(`CRITICAL: ${dim.name} has very low entropy (${dim.normalized}). Consider forcing rare options.`);
    } else if (dim.status === 'warning') {
      recommendations.push(`WARNING: ${dim.name} entropy is declining (${dim.normalized}). Adaptive weighting should help.`);
    }
  }
  
  if (recommendations.length === 0) {
    recommendations.push('All dimensions are healthy. Adaptive weighting is maintaining good entropy.');
  }
  
  return {
    overall_health: Math.round(overallHealth * 100) / 100,
    dimensions: results,
    recommendations,
  };
}

// =====================================================
// GENRE PROFILE HELPERS
// =====================================================

/**
 * Get list of available genre profiles
 * Useful for UI dropdowns or API documentation
 */
export function getAvailableGenres(): { id: string; name: string; description: string }[] {
  return Object.entries(GENRE_PROFILES).map(([id, profile]) => ({
    id,
    name: profile.name,
    description: profile.description,
  }));
}

/**
 * Get a specific genre profile by ID
 * Returns urban_legend if not found (v4.0 - no more neutral)
 */
export function getGenreProfile(genreName: string): GenreProfile {
  // v4.0: Map deprecated presets to active engines
  const resolvedGenre = DEPRECATED_PRESET_MAP[genreName] || genreName;
  return GENRE_PROFILES[resolvedGenre] || GENRE_PROFILES.urban_legend;
}
