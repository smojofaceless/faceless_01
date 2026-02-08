/**
 * Visual Readiness Analyzer v2.0
 * 
 * Analyzes story text for visual renderability per beat.
 * Uses lightweight heuristics (no NLP library) to determine:
 * - Environment keywords (setting/location)
 * - Visual nouns (props, objects, characters)
 * - Grounding details (sensory/concrete elements)
 * - Action verbs (movement, physical activity)
 * 
 * v2.0 Changes:
 * - Proper beat tag parsing (synced with story_contract.ts)
 * - Per-beat grounding unified with compliance checker
 * - Severity rules: FAIL/WARNING/OK based on visual needs
 * - Enhanced environment keyword detection
 * 
 * Works across niches: horror, food, finance, motivation, etc.
 */

// =====================================================
// TYPE DEFINITIONS
// =====================================================

/** Visual readiness severity levels */
export type ReadinessSeverity = 'ok' | 'warning' | 'fail';

/** Flags indicating visual issues per beat */
export type VisualFlag = 
  | 'missing_grounding'
  | 'missing_environment'
  | 'missing_props'
  | 'missing_action'
  | 'too_abstract'
  | 'high_repetition';

/** Per-beat visual analysis result v2.1 */
export interface BeatVisualAnalysis {
  beat_number: number;
  beat_label: string;
  text: string;
  word_count: number;
  severity: ReadinessSeverity;
  /** Whether this beat's issues should block image generation */
  should_block: boolean;
  flags: VisualFlag[];
  reasons: string[];
  // Visual elements detected
  environment_tokens: string[];
  visual_nouns: string[];
  action_verbs: string[];
  grounding_count: number;
  /** Source of grounding count: 'compliance' or 'local' */
  grounding_source: 'compliance' | 'local';
  // Comparison metrics
  similarity_to_previous: number;
  score: number;
}

/** Visual readiness severity config (from StoryProfile) */
export interface VisualReadinessSeverityConfig {
  failOnMissingGrounding: boolean;
  warnOnMissingGrounding: boolean;
  failOnMissingEnvironment: boolean;
  warnOnMissingEnvironment: boolean;
  failOnAbstract: boolean;
  minScoreForReady: number;
}

/** Default severity config (lenient - warnings only) */
export const DEFAULT_SEVERITY_CONFIG: VisualReadinessSeverityConfig = {
  failOnMissingGrounding: false,
  warnOnMissingGrounding: true,
  failOnMissingEnvironment: false,
  warnOnMissingEnvironment: true,
  failOnAbstract: true,
  minScoreForReady: 30,
};

/** Full visual readiness report v2.1 */
export interface VisualReadinessReport {
  version: '2.1';
  niche: string;
  overall: ReadinessSeverity;
  /** Whether overall issues should block image generation */
  overall_should_block: boolean;
  ok_count: number;
  warn_count: number;
  fail_count: number;
  total_beats: number;
  per_beat: BeatVisualAnalysis[];
  summary: string;
  // v2.0: Input source tracking
  input_source: 'canonical_with_tags' | 'raw_with_tags' | 'stripped' | 'unknown' | 'best_contract_attempt';
  has_beat_tags: boolean;
  /** Whether compliance grounding data was used */
  used_compliance_grounding: boolean;
  /** Severity config that was applied */
  severity_config: VisualReadinessSeverityConfig;
  // Legacy compatibility (maps to per_beat)
  scenes?: BeatVisualAnalysis[];
  total_scenes?: number;
  ready_count?: number;
  warning_count?: number;
  error_count?: number;
  overall_flag?: 'ready' | 'warning' | 'error';
}

/** Parsed beat from story text */
interface ParsedBeat {
  beatNumber: number;
  beatLabel: string;
  text: string;
}

// =====================================================
// KEYWORD DICTIONARIES v2.0
// =====================================================

/** 
 * Environment keywords - expanded for better detection
 * Organized by category for easier maintenance
 */
const ENVIRONMENT_KEYWORDS: Record<string, string[]> = {
  // Natural outdoor environments
  forest: ['forest', 'woods', 'trees', 'branches', 'leaves', 'path', 'trail', 'clearing', 'grove', 'undergrowth', 'canopy'],
  nature: ['mountain', 'hill', 'valley', 'cliff', 'cave', 'rock', 'stone', 'grass', 'meadow', 'garden', 'park'],
  water: ['ocean', 'sea', 'lake', 'river', 'stream', 'pond', 'beach', 'shore', 'water', 'waves', 'boat', 'dock', 'pier', 'bridge'],
  
  // Coastal environments (NEW - expanded for saltwater/shoreline contexts)
  coastal: [
    'coast', 'coastal', 'shoreline', 'shore', 'beach', 'ocean', 'sea', 'bay', 'harbor', 'harbour',
    'dock', 'pier', 'tide', 'tidal', 'wave', 'gull', 'seagull', 'salt air', 'saltwater', 'boardwalk',
    'marina', 'cove', 'inlet', 'jetty', 'wharf', 'lighthouse', 'buoy', 'seawall', 'cliff', 'bluff'
  ],
  
  // Urban environments
  urban: ['city', 'street', 'building', 'apartment', 'office', 'alley', 'sidewalk', 'downtown', 'block', 'corner', 'plaza'],
  commercial: ['store', 'shop', 'mall', 'restaurant', 'diner', 'cafe', 'bar', 'hotel', 'motel', 'lobby', 'parking'],
  
  // Indoor environments
  indoor: ['room', 'house', 'home', 'kitchen', 'bedroom', 'living room', 'bathroom', 'hallway', 'attic', 'basement', 'closet', 'garage'],
  furniture: ['chair', 'table', 'desk', 'bed', 'couch', 'sofa', 'shelf', 'cabinet', 'counter', 'drawer'],
  
  // Rural/countryside
  rural: ['farm', 'field', 'barn', 'countryside', 'road', 'highway', 'dirt road', 'fence', 'gate', 'pasture', 'orchard'],
  
  // Institutional
  institutional: ['hospital', 'school', 'church', 'library', 'station', 'facility', 'clinic', 'asylum', 'prison', 'lab', 'laboratory'],
  
  // Location nouns (built environment - should count as "environment" context)
  location_nouns: [
    'town', 'village', 'city', 'street', 'alley', 'road', 'highway', 'campus', 'library',
    'station', 'diner', 'motel', 'warehouse', 'office', 'bedroom', 'hallway', 'attic', 'basement',
    'neighborhood', 'district', 'suburb', 'outskirt', 'intersection', 'overpass', 'underpass',
    'corridor', 'stairwell', 'rooftop', 'courtyard', 'patio', 'porch', 'veranda'
  ],
  
  // Weather/atmosphere
  weather: ['fog', 'mist', 'rain', 'storm', 'wind', 'snow', 'clouds', 'sky', 'air'],
  
  // Time of day / lighting
  lighting: ['night', 'dark', 'darkness', 'midnight', 'evening', 'dusk', 'shadow', 'moonlight', 'morning', 'afternoon', 
             'daylight', 'sunlight', 'bright', 'noon', 'dawn', 'twilight', 'lamp', 'light', 'glow', 'dim'],
};

/**
 * Action verbs - physical/visual actions that translate well to imagery
 */
const ACTION_VERBS: string[] = [
  // Movement
  'walk', 'run', 'move', 'turn', 'step', 'jump', 'climb', 'crawl', 'enter', 'leave', 'approach',
  'drive', 'ride', 'fly', 'fall', 'drop', 'rise', 'lift', 'push', 'pull', 'grab', 'reach',
  // Interaction
  'open', 'close', 'lock', 'unlock', 'knock', 'break', 'touch', 'hold', 'pick', 'put', 'place',
  'hit', 'throw', 'catch', 'cut', 'pour', 'stir', 'mix', 'cook', 'eat', 'drink',
  // Looking
  'look', 'watch', 'see', 'stare', 'glance', 'peer', 'scan', 'notice', 'spot', 'find',
  // Communication (visual)
  'point', 'wave', 'nod', 'shake', 'gesture', 'signal', 'show', 'reveal', 'hide',
];

/**
 * Grounding patterns - sensory/concrete details (synced with story_contract.ts)
 */
const GROUNDING_PATTERNS: RegExp[] = [
  // Sound
  /\b(sound(ed|s)?|noise|hum|buzz|creak|whisper|echo|static|ring(ing)?|click|bang|thud|rustle)\b/gi,
  // Smell
  /\b(smell(ed|s)?|scent|odor|stench|aroma|reek|fragrance)\b/gi,
  // Touch/temperature
  /\b(touch(ed)?|felt|cold|warm|hot|rough|smooth|wet|damp|dry|sticky|soft|hard|sharp)\b/gi,
  // Vision
  /\b(saw|see|watch|glow|shine|dark(ness)?|light|shadow|flicker|flash|gleam|glint|bright)\b/gi,
  // Taste
  /\b(taste(d)?|bitter|sweet|sour|salty|metallic)\b/gi,
  // Objects (concrete nouns that serve as visual anchors)
  /\b(phone|radio|car|door|window|mirror|photograph|tape|camera|clock|lamp|book|paper|box|bag|key|knife|gun)\b/gi,
];

/** Niche-specific renderability requirements */
const NICHE_REQUIREMENTS: Record<string, {
  requiredCategories: string[];
  preferredNouns: string[];
  warningPatterns: string[];
  allowAbstract: boolean;
  requireDistinctFinal: boolean;
}> = {
  horror: {
    requiredCategories: ['object', 'setting'],
    preferredNouns: ['figure', 'shadow', 'door', 'window', 'hand', 'eye', 'face', 'light', 'sound', 'voice', 'child', 'man', 'woman', 'creature'],
    warningPatterns: ['thought', 'felt', 'wondered', 'seemed', 'appeared'],
    allowAbstract: true,  // Horror allows ambiguity
    requireDistinctFinal: true,  // Final frame must be visual
  },
  food: {
    requiredCategories: ['ingredient', 'tool', 'action'],
    preferredNouns: ['pan', 'pot', 'knife', 'bowl', 'plate', 'oven', 'chef', 'ingredient', 'food', 'dish', 'sauce', 'meat', 'vegetable', 'spice'],
    warningPatterns: ['delicious', 'amazing', 'wonderful', 'best'],
    allowAbstract: false,  // Food needs concrete items
    requireDistinctFinal: false,
  },
  finance: {
    requiredCategories: ['number', 'example', 'object'],
    preferredNouns: ['chart', 'phone', 'screen', 'computer', 'receipt', 'wallet', 'card', 'money', 'bank', 'document', 'number', 'percent', 'dollar'],
    warningPatterns: ['might', 'could', 'generally', 'typically'],
    allowAbstract: false,  // Finance needs concrete examples
    requireDistinctFinal: false,
  },
  motivation: {
    requiredCategories: ['action', 'setting'],
    preferredNouns: ['person', 'hand', 'face', 'road', 'mountain', 'sunrise', 'crowd', 'stage', 'podium', 'medal', 'trophy'],
    warningPatterns: ['just', 'simply', 'always', 'never'],
    allowAbstract: true,  // Motivation can be emotional
    requireDistinctFinal: false,
  },
  generic: {
    requiredCategories: ['object', 'setting'],
    preferredNouns: ['person', 'place', 'thing', 'object', 'scene'],
    warningPatterns: [],
    allowAbstract: true,
    requireDistinctFinal: false,
  },
};

/** Common stopwords to filter */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'it', 'its',
  'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having', 'do',
  'does', 'did', 'doing', 'would', 'could', 'should', 'might', 'must',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you',
  'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself', 'they', 'them', 'their', 'theirs',
  'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'am', 'is', 'are', 'be',
]);

/** Noun-like suffix patterns */
const NOUN_SUFFIXES = ['tion', 'ment', 'ness', 'ity', 'er', 'or', 'ist', 'ing', 'ance', 'ence'];

// =====================================================
// ANALYSIS FUNCTIONS
// =====================================================

/**
 * Extract likely nouns from text using heuristics
 * (No NLP library - uses suffix patterns and position)
 */
function extractVisualNouns(text: string, nicheNouns: string[]): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  
  const nouns = new Set<string>();
  
  for (const word of words) {
    // Check if it's a niche-preferred noun
    if (nicheNouns.some(n => word.includes(n) || n.includes(word))) {
      nouns.add(word);
      continue;
    }
    
    // Check for noun-like suffixes
    if (NOUN_SUFFIXES.some(suffix => word.endsWith(suffix))) {
      nouns.add(word);
      continue;
    }
    
    // Capitalized words (after first position) are often proper nouns/subjects
    // (not applicable since we lowercase, but keeping logic for reference)
  }
  
  // Also look for words that commonly appear as objects
  const objectWords = words.filter(w => 
    /^(car|door|window|phone|light|road|house|room|table|chair|book|bag|box|clock|wall|floor|ceiling|sky|sun|moon|star|tree|plant|flower|animal|bird|dog|cat|man|woman|child|person|body|hand|face|eye|head|foot|arm|leg)s?$/.test(w)
  );
  
  objectWords.forEach(w => nouns.add(w));
  
  return Array.from(nouns).slice(0, 10); // Limit to top 10
}

/**
 * Check for abstract/non-visual patterns
 */
function hasAbstractPatterns(text: string, warningPatterns: string[]): string[] {
  const textLower = text.toLowerCase();
  const found: string[] = [];
  
  for (const pattern of warningPatterns) {
    if (textLower.includes(pattern)) {
      found.push(pattern);
    }
  }
  
  // Generic abstract patterns
  const abstractPatterns = [
    { pattern: /\bfelt\s+(that|like)\b/i, reason: 'abstract feeling' },
    { pattern: /\bthought\s+(about|of|that)\b/i, reason: 'abstract thought' },
    { pattern: /\bseemed\s+to\b/i, reason: 'uncertain description' },
    { pattern: /\bsomething\s+(was|felt|seemed)\b/i, reason: 'vague subject' },
    { pattern: /\bit\s+was\s+as\s+if\b/i, reason: 'simile without visual' },
  ];
  
  for (const { pattern, reason } of abstractPatterns) {
    if (pattern.test(text)) {
      found.push(reason);
    }
  }
  
  return found;
}

/**
 * Parse story into beats/scenes v2.0
 * Uses the same beat tag regex as story_contract.ts for consistency
 * Returns array of { beatNumber, beatLabel, text } objects
 */
function parseStoryIntoBeats(story: string): ParsedBeat[] {
  const beats: ParsedBeat[] = [];
  
  // Beat tag pattern - handles whitespace variants
  // Matches: [BEAT_1:OPENING], [BEAT_2: EARLY_REPORTS], etc.
  const beatTagRegex = /\[\s*BEAT_(\d+)\s*:\s*([^\]]+?)\s*\]/g;
  
  // Find all beat tags and their positions
  const beatTags: Array<{ beatNumber: number; beatLabel: string; startIndex: number; endIndex: number }> = [];
  let match;
  
  while ((match = beatTagRegex.exec(story)) !== null) {
    beatTags.push({
      beatNumber: parseInt(match[1], 10),
      beatLabel: match[2].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  
  if (beatTags.length > 0) {
    // Extract text for each beat (content between this tag and the next)
    for (let i = 0; i < beatTags.length; i++) {
      const tag = beatTags[i];
      const textStart = tag.endIndex;
      const textEnd = i < beatTags.length - 1 ? beatTags[i + 1].startIndex : story.length;
      const text = story.slice(textStart, textEnd).trim();
      
      beats.push({
        beatNumber: tag.beatNumber,
        beatLabel: tag.beatLabel,
        text,
      });
    }
  } else {
    // No beat tags - split by paragraphs as fallback
    const paragraphs = story.split(/\n\n+/).filter(p => p.trim());
    
    if (paragraphs.length >= 3) {
      paragraphs.forEach((p, i) => {
        beats.push({
          beatNumber: i + 1,
          beatLabel: `PARAGRAPH_${i + 1}`,
          text: p.trim(),
        });
      });
    } else {
      // Single chunk
      beats.push({
        beatNumber: 1,
        beatLabel: 'CONTENT',
        text: story.trim(),
      });
    }
  }
  
  return beats;
}

/**
 * Strong location nouns - if ≥2 present, don't flag missing_environment
 * These represent concrete "built environment" settings that are filmable
 */
const STRONG_LOCATION_NOUNS = new Set([
  'town', 'village', 'city', 'street', 'alley', 'road', 'highway',
  'campus', 'library', 'station', 'diner', 'motel', 'warehouse', 'office',
  'bedroom', 'hallway', 'attic', 'basement', 'house', 'home', 'apartment',
  'church', 'hospital', 'school', 'bar', 'restaurant', 'store', 'shop',
  'neighborhood', 'district', 'suburb', 'intersection', 'bridge', 'tunnel',
  'coast', 'shore', 'beach', 'pier', 'dock', 'harbor', 'marina', 'boardwalk',
]);

/**
 * Extract environment tokens from text v2.1
 * Returns array of detected environment keywords
 * Uses improved plural/suffix matching for better detection
 */
function extractEnvironmentTokens(text: string): string[] {
  const textLower = text.toLowerCase();
  const found = new Set<string>();
  
  for (const [category, keywords] of Object.entries(ENVIRONMENT_KEYWORDS)) {
    for (const keyword of keywords) {
      // Handle multi-word keywords (e.g., "salt air", "living room")
      if (keyword.includes(' ')) {
        // Check for exact phrase or with optional 's' on last word
        const words = keyword.split(' ');
        const lastWord = words[words.length - 1];
        const prefix = words.slice(0, -1).join(' ');
        
        // Match "salt air" or "living rooms" (pluralized last word)
        const phrasePattern = new RegExp(
          `\\b${prefix}\\s+${lastWord}s?\\b`,
          'i'
        );
        if (phrasePattern.test(text)) {
          found.add(keyword);
        }
      } else {
        // Single words: match base, plural (-s, -es), and common suffixes
        // Examples: town/towns, wave/waves, gull/gulls, beach/beaches
        const baseWord = keyword.replace(/s$/, ''); // Normalize to singular
        
        // Pattern: word boundary + base + optional (s, es, 's, ed, ing, y→ies)
        const pattern = new RegExp(
          `\\b${baseWord}(s|es|'s|ed|ing)?\\b`,
          'i'
        );
        if (pattern.test(text)) {
          found.add(keyword);
        }
      }
    }
  }
  
  return Array.from(found).slice(0, 12); // Increased limit for more context
}

/**
 * Count strong location nouns in text
 * Used to suppress missing_environment warnings when built environment is clear
 */
function countStrongLocationNouns(text: string): number {
  const textLower = text.toLowerCase();
  let count = 0;
  
  for (const noun of STRONG_LOCATION_NOUNS) {
    // Match singular and plural forms
    const pattern = new RegExp(`\\b${noun}s?\\b`, 'i');
    if (pattern.test(textLower)) {
      count++;
    }
  }
  
  return count;
}

/**
 * Extract action verbs from text
 */
function extractActionVerbs(text: string): string[] {
  const textLower = text.toLowerCase();
  const found = new Set<string>();
  
  for (const verb of ACTION_VERBS) {
    // Match verb and common conjugations (walk, walks, walked, walking)
    const pattern = new RegExp(`\\b${verb}(s|ed|ing)?\\b`, 'i');
    if (pattern.test(text)) {
      found.add(verb);
    }
  }
  
  return Array.from(found).slice(0, 8);
}

/**
 * Count grounding details using patterns from story_contract.ts
 */
function countGroundingDetails(text: string): number {
  let count = 0;
  
  for (const pattern of GROUNDING_PATTERNS) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  
  return count;
}

/**
 * Calculate keyword similarity between two texts
 */
function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  const words1 = new Set(
    text1.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  );
  
  const words2 = new Set(
    text2.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  );
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Analyze a single beat for visual readiness v2.1
 * Now uses profile-driven severity rules
 */
function analyzeBeat(
  beat: ParsedBeat,
  previousText: string | null,
  niche: string,
  isLastBeat: boolean,
  severityConfig: VisualReadinessSeverityConfig,
  complianceGroundingCount?: number
): BeatVisualAnalysis {
  const requirements = NICHE_REQUIREMENTS[niche] || NICHE_REQUIREMENTS.generic;
  const flags: VisualFlag[] = [];
  const reasons: string[] = [];
  
  // Extract visual elements
  const visualNouns = extractVisualNouns(beat.text, requirements.preferredNouns);
  const environmentTokens = extractEnvironmentTokens(beat.text);
  const actionVerbs = extractActionVerbs(beat.text);
  const wordCount = beat.text.split(/\s+/).filter(w => w.length > 0).length;
  
  // Grounding: use compliance if available, otherwise local detection
  let groundingCount: number;
  let groundingSource: 'compliance' | 'local';
  
  if (complianceGroundingCount !== undefined) {
    groundingCount = complianceGroundingCount;
    groundingSource = 'compliance';
  } else {
    groundingCount = countGroundingDetails(beat.text);
    groundingSource = 'local';
  }
  
  // Count strong location nouns for environment suppression logic
  const strongLocationCount = countStrongLocationNouns(beat.text);
  
  // Calculate similarity
  const similarity = previousText ? calculateSimilarity(beat.text, previousText) : 0;
  
  // =====================================================
  // FLAG DETECTION v2.1 (Profile-Aware)
  // =====================================================
  
  // Grounding check - only flag if configured to warn/fail
  if (groundingCount === 0 && (severityConfig.warnOnMissingGrounding || severityConfig.failOnMissingGrounding)) {
    flags.push('missing_grounding');
    reasons.push(`No sensory/grounding details detected (source: ${groundingSource})`);
  }
  
  // Environment check - SUPPRESS if ≥2 strong location nouns present
  if (environmentTokens.length === 0 && strongLocationCount < 2) {
    if (severityConfig.warnOnMissingEnvironment || severityConfig.failOnMissingEnvironment) {
      flags.push('missing_environment');
      reasons.push('No environment/setting keywords detected');
    }
  } else if (environmentTokens.length === 0 && strongLocationCount >= 2) {
    // Don't flag - location nouns provide sufficient context
    reasons.push(`Environment: ${strongLocationCount} location nouns present (suppressed warning)`);
  }
  
  // Props/visual nouns check
  if (visualNouns.length === 0) {
    flags.push('missing_props');
    reasons.push('No concrete visual nouns/props detected');
  }
  
  // Action check
  if (actionVerbs.length === 0 && !requirements.allowAbstract) {
    flags.push('missing_action');
    reasons.push('No physical action verbs detected');
  }
  
  // Abstract patterns check
  const abstractIssues = hasAbstractPatterns(beat.text, requirements.warningPatterns);
  if (abstractIssues.length > 0 && !requirements.allowAbstract) {
    flags.push('too_abstract');
    reasons.push(`Abstract patterns: ${abstractIssues.slice(0, 3).join(', ')}`);
  }
  
  // Repetition check
  if (similarity > 0.4) {
    flags.push('high_repetition');
    reasons.push(`High similarity to previous beat (${Math.round(similarity * 100)}%)`);
  }
  
  // =====================================================
  // SCORING v2.1 (Penalty-based, not severity-determining)
  // =====================================================
  let score = 100;
  if (flags.includes('missing_grounding')) score -= 15;  // Reduced from 30
  if (flags.includes('missing_environment')) score -= 15; // Reduced from 20
  if (flags.includes('missing_props')) score -= 20;
  if (flags.includes('missing_action')) score -= 10;
  if (flags.includes('too_abstract')) score -= 15;
  if (flags.includes('high_repetition')) score -= 10;
  score = Math.max(0, score);
  
  // =====================================================
  // SEVERITY DETERMINATION v2.1 (Profile-Driven)
  // =====================================================
  let severity: ReadinessSeverity = 'ok';
  let shouldBlock = false;
  
  const hasNoGrounding = flags.includes('missing_grounding');
  const hasNoEnvironment = flags.includes('missing_environment');
  const hasNoProps = flags.includes('missing_props');
  const hasNoAction = flags.includes('missing_action');
  
  // FAIL condition 1: Truly abstract (nothing visual at all)
  // This is the only hard fail: no props AND no actions AND no environment AND no strong locations
  const isTrulyAbstract = hasNoProps && hasNoAction && hasNoEnvironment && strongLocationCount < 1;
  
  if (isTrulyAbstract && severityConfig.failOnAbstract) {
    severity = 'fail';
    shouldBlock = true;
    reasons.push('FAIL: Beat is not depictable (no visual elements)');
  }
  // FAIL condition 2: Missing grounding only if profile says to fail
  else if (hasNoGrounding && severityConfig.failOnMissingGrounding) {
    severity = 'fail';
    shouldBlock = true;
    reasons.push('FAIL: Profile requires grounding details');
  }
  // FAIL condition 3: Missing environment only if profile says to fail
  else if (hasNoEnvironment && severityConfig.failOnMissingEnvironment) {
    severity = 'fail';
    shouldBlock = true;
    reasons.push('FAIL: Profile requires environment context');
  }
  // FAIL condition 4: Score below minimum threshold
  else if (score < severityConfig.minScoreForReady) {
    severity = 'fail';
    shouldBlock = true;
    reasons.push(`FAIL: Score ${score} below minimum ${severityConfig.minScoreForReady}`);
  }
  // WARNING conditions: any flag present
  else if (flags.length > 0) {
    severity = 'warning';
    shouldBlock = false;
  }
  
  // Special handling for final beat in niches that require distinct visual
  if (isLastBeat && requirements.requireDistinctFinal) {
    if (visualNouns.length < 2 && severity === 'ok') {
      flags.push('missing_props');
      reasons.push('Final frame needs distinct visual elements');
      severity = 'warning';
    }
  }
  
  // If no issues, note it's ready
  if (flags.length === 0) {
    reasons.push('Visual elements present');
  }
  
  return {
    beat_number: beat.beatNumber,
    beat_label: beat.beatLabel,
    text: beat.text,
    word_count: wordCount,
    severity,
    should_block: shouldBlock,
    flags,
    reasons,
    environment_tokens: environmentTokens,
    visual_nouns: visualNouns,
    action_verbs: actionVerbs,
    grounding_count: groundingCount,
    grounding_source: groundingSource,
    similarity_to_previous: Math.round(similarity * 100),
    score,
  };
}

// =====================================================
// MAIN EXPORT v2.1
// =====================================================

/**
 * Analyze a story for visual readiness v2.1
 * 
 * Key changes in v2.1:
 * - Profile-driven severity rules (failOnMissingGrounding, etc.)
 * - Uses compliance grounding data when available (single source of truth)
 * - overall_should_block indicates if issues truly block image generation
 * - Missing grounding/environment are WARNING by default, not FAIL
 * - Only truly abstract beats (nothing visual) cause FAIL
 * 
 * @param story - The story text (with or without beat tags)
 * @param niche - The content niche (horror, food, finance, motivation, generic)
 * @param complianceGrounding - Optional grounding data from compliance checker for unification
 * @param inputSource - Where the input text came from
 * @param severityConfig - Profile-driven severity rules (optional, uses defaults if not provided)
 * @returns Complete visual readiness report with per-beat analysis
 */
export function analyzeVisualReadiness(
  story: string, 
  niche: string = 'generic',
  complianceGrounding?: Array<{ beat: number; count: number }>,
  inputSource?: 'canonical_with_tags' | 'raw_with_tags' | 'stripped' | 'unknown' | 'best_contract_attempt',
  severityConfig?: Partial<VisualReadinessSeverityConfig>
): VisualReadinessReport {
  const normalizedNiche = niche.toLowerCase();
  const validNiche = NICHE_REQUIREMENTS[normalizedNiche] ? normalizedNiche : 'generic';
  
  // Merge severity config with defaults
  const config: VisualReadinessSeverityConfig = {
    ...DEFAULT_SEVERITY_CONFIG,
    ...severityConfig,
  };
  
  // Check if input has beat tags
  const beatTagPattern = /\[\s*BEAT_\d+\s*:\s*[^\]]+\s*\]/;
  const hasBeatTags = beatTagPattern.test(story);
  
  // Determine input source
  const resolvedInputSource = inputSource || (hasBeatTags ? 'raw_with_tags' : 'stripped');
  
  // Build compliance grounding lookup map for efficient access
  const complianceGroundingMap = new Map<number, number>();
  if (complianceGrounding) {
    for (const g of complianceGrounding) {
      complianceGroundingMap.set(g.beat, g.count);
    }
  }
  
  // Parse into beats
  const beats = parseStoryIntoBeats(story);
  
  // Analyze each beat
  const perBeat: BeatVisualAnalysis[] = [];
  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let blockCount = 0;
  
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const previousText = i > 0 ? beats[i - 1].text : null;
    const isLastBeat = i === beats.length - 1;
    
    // Get compliance grounding for this beat (if available)
    const complianceGroundingCount = complianceGroundingMap.has(beat.beatNumber)
      ? complianceGroundingMap.get(beat.beatNumber)
      : undefined;
    
    const analysis = analyzeBeat(
      beat, 
      previousText, 
      validNiche, 
      isLastBeat,
      config,
      complianceGroundingCount
    );
    
    perBeat.push(analysis);
    
    if (analysis.severity === 'ok') okCount++;
    else if (analysis.severity === 'warning') warnCount++;
    else failCount++;
    
    if (analysis.should_block) blockCount++;
  }
  
  // Calculate overall status
  let overall: ReadinessSeverity = 'ok';
  let overallShouldBlock = false;
  
  if (blockCount > 0) {
    overall = 'fail';
    overallShouldBlock = true;
  } else if (failCount > 0) {
    // Has fails but none are blocking (shouldn't happen, but handle gracefully)
    overall = 'fail';
    overallShouldBlock = false;
  } else if (warnCount > beats.length * 0.3) {
    overall = 'warning';
  }
  
  // Build summary
  let summary: string;
  if (blockCount > 0) {
    summary = `${blockCount} beat(s) are not depictable and will block image generation`;
  } else if (failCount > 0) {
    summary = `${failCount} beat(s) have visual issues (non-blocking)`;
  } else if (warnCount > 0) {
    summary = `${warnCount} beat(s) have minor visual concerns (non-blocking)`;
  } else {
    summary = 'All beats have sufficient visual elements';
  }
  
  // Add input source info
  if (!hasBeatTags && complianceGrounding && complianceGrounding.length > 1) {
    summary += ' (WARNING: Input text had no beat tags - analyzing as single block)';
  }
  
  return {
    version: '2.1',
    niche: validNiche,
    overall,
    overall_should_block: overallShouldBlock,
    ok_count: okCount,
    warn_count: warnCount,
    fail_count: failCount,
    total_beats: beats.length,
    per_beat: perBeat,
    summary,
    // v2.0: Input source tracking
    input_source: resolvedInputSource,
    has_beat_tags: hasBeatTags,
    // v2.1: Compliance grounding tracking
    used_compliance_grounding: complianceGrounding !== undefined && complianceGrounding.length > 0,
    severity_config: config,
    // Legacy compatibility fields
    scenes: perBeat,
    total_scenes: beats.length,
    ready_count: okCount,
    warning_count: warnCount,
    error_count: failCount,
    overall_flag: overall === 'ok' ? 'ready' : overall === 'warning' ? 'warning' : 'error',
  };
}
