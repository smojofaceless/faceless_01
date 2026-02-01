// =====================================================
// STORY STORAGE & UNIQUENESS MODULE
// VERSION: 2.0.0 - 2026-02-01
// 
// Purpose: Store generated stories and provide theme guidance
// for diversity WITHOUT costly API retries
// 
// Strategy: Lightweight theme rotation via positive prompt guidance
// =====================================================

// =====================================================
// TYPES
// =====================================================

export interface StoryRecord {
  id: string;
  created_at: string;
  title: string;
  story_text: string;
  hook: string | null;
  content_hash: string;
  title_hash: string;
  word_count: number;
  sentence_count: number;
  avg_sentence_length: number;
  bigram_fingerprint: string[];
  trigram_fingerprint: string[];
  keyword_fingerprint: string[];
  vibe_preset: string | null;
  length_preset: string | null;
  visual_preset: string | null;
  art_style: string | null;
  use_count: number;
  last_used_at: string;
  source_job_id: string | null;
  max_similarity_score: number | null;
  most_similar_story_id: string | null;
  meta: Record<string, any>;
}

export interface UniquenessConfig {
  exact_match_threshold: number;
  high_similarity_threshold: number;
  moderate_similarity_threshold: number;
  decay_rate: number;
  decay_half_life_days: number;
  lookback_days: number;
  max_stories_to_check: number;
  max_generation_attempts: number;
  uniqueness_enabled: boolean;
  store_all_stories: boolean;
}

export interface SimilarityResult {
  story_id: string;
  title: string;
  raw_similarity: number;
  age_weight: number;
  effective_similarity: number;
  days_old: number;
  similarity_breakdown: {
    content_hash_match: boolean;
    title_hash_match: boolean;
    bigram_similarity: number;
    trigram_similarity: number;
    keyword_similarity: number;
    text_similarity: number;
  };
}

export interface UniquenessCheckResult {
  is_unique: boolean;
  is_exact_duplicate: boolean;
  highest_similarity: number;
  effective_similarity: number;
  most_similar_story: SimilarityResult | null;
  all_similar_stories: SimilarityResult[];
  recommendation: 'accept' | 'reject' | 'warn';
  message: string;
}

export interface StoryInput {
  title: string;
  story: string;
  hook?: string;
}

export interface StoryMetadata {
  vibe_preset?: string;
  length_preset?: string;
  visual_preset?: string;
  art_style?: string;
  job_id?: string;
}

// =====================================================
// TEXT PROCESSING UTILITIES
// =====================================================

/**
 * Normalize text for consistent hashing and comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')       // Collapse whitespace
    .trim();
}

/**
 * Generate SHA-256 hash of text
 */
async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizeText(text));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract n-grams from text
 */
function extractNgrams(text: string, n: number): Map<string, number> {
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(w => w.length > 0);
  const ngrams = new Map<string, number>();
  
  for (let i = 0; i <= words.length - n; i++) {
    const ngram = words.slice(i, i + n).join(' ');
    ngrams.set(ngram, (ngrams.get(ngram) || 0) + 1);
  }
  
  return ngrams;
}

/**
 * Get top N most frequent n-grams as fingerprint
 */
function getTopNgrams(ngrams: Map<string, number>, topN: number = 50): string[] {
  return Array.from(ngrams.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([ngram]) => ngram);
}

/**
 * Extract keywords (important/unique terms) from text
 * Filters out common stop words and keeps meaningful terms
 */
function extractKeywords(text: string, topN: number = 30): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'that', 'this', 'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we',
    'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
    'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just',
    'into', 'over', 'after', 'before', 'between', 'through', 'during', 'up',
    'down', 'out', 'off', 'above', 'below', 'again', 'then', 'once', 'here',
    'there', 'about', 'back', 'now', 'as', 'if', 'because', 'until', 'while',
  ]);
  
  const normalized = normalizeText(text);
  const words = normalized.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  
  // Count word frequencies
  const wordCounts = new Map<string, number>();
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }
  
  // Return top keywords by frequency
  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

/**
 * Count sentences in text
 */
function countSentences(text: string): number {
  // Handle ellipses and other multi-period patterns
  const normalized = text.replace(/\.{2,}/g, '…');
  const sentences = normalized.match(/[^.!?…]+[.!?…]+/g) || [];
  return sentences.length || 1;
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: string[], set2: string[]): number {
  const s1 = new Set(set1);
  const s2 = new Set(set2);
  
  if (s1.size === 0 && s2.size === 0) return 1.0;
  if (s1.size === 0 || s2.size === 0) return 0.0;
  
  let intersection = 0;
  for (const item of s1) {
    if (s2.has(item)) intersection++;
  }
  
  const union = s1.size + s2.size - intersection;
  return intersection / union;
}

/**
 * Calculate cosine similarity between two texts using TF-IDF-like weighting
 */
function cosineSimilarity(text1: string, text2: string): number {
  const words1 = normalizeText(text1).split(/\s+/);
  const words2 = normalizeText(text2).split(/\s+/);
  
  // Build word frequency maps
  const freq1 = new Map<string, number>();
  const freq2 = new Map<string, number>();
  
  for (const word of words1) {
    freq1.set(word, (freq1.get(word) || 0) + 1);
  }
  for (const word of words2) {
    freq2.set(word, (freq2.get(word) || 0) + 1);
  }
  
  // Get all unique words
  const allWords = new Set([...freq1.keys(), ...freq2.keys()]);
  
  // Calculate dot product and magnitudes
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  for (const word of allWords) {
    const v1 = freq1.get(word) || 0;
    const v2 = freq2.get(word) || 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

// =====================================================
// CORE SIMILARITY FUNCTIONS
// =====================================================

/**
 * Compute comprehensive similarity between two stories
 */
export function computeSimilarity(
  story1: { title: string; story_text: string; bigram_fingerprint?: string[]; trigram_fingerprint?: string[]; keyword_fingerprint?: string[]; content_hash?: string; title_hash?: string },
  story2: { title: string; story_text: string; bigram_fingerprint?: string[]; trigram_fingerprint?: string[]; keyword_fingerprint?: string[]; content_hash?: string; title_hash?: string }
): { similarity: number; breakdown: SimilarityResult['similarity_breakdown'] } {
  
  // Check for exact matches first
  const contentHashMatch = !!(story1.content_hash && story2.content_hash && 
                           story1.content_hash === story2.content_hash);
  const titleHashMatch = !!(story1.title_hash && story2.title_hash && 
                         story1.title_hash === story2.title_hash);
  
  if (contentHashMatch) {
    return {
      similarity: 1.0,
      breakdown: {
        content_hash_match: true,
        title_hash_match: titleHashMatch,
        bigram_similarity: 1.0,
        trigram_similarity: 1.0,
        keyword_similarity: 1.0,
        text_similarity: 1.0,
      }
    };
  }
  
  // Compute n-gram similarities if fingerprints available
  let bigramSim = 0;
  let trigramSim = 0;
  let keywordSim = 0;
  
  if (story1.bigram_fingerprint && story2.bigram_fingerprint) {
    bigramSim = jaccardSimilarity(story1.bigram_fingerprint, story2.bigram_fingerprint);
  } else {
    // Compute on the fly
    const bigrams1 = getTopNgrams(extractNgrams(story1.story_text, 2));
    const bigrams2 = getTopNgrams(extractNgrams(story2.story_text, 2));
    bigramSim = jaccardSimilarity(bigrams1, bigrams2);
  }
  
  if (story1.trigram_fingerprint && story2.trigram_fingerprint) {
    trigramSim = jaccardSimilarity(story1.trigram_fingerprint, story2.trigram_fingerprint);
  } else {
    const trigrams1 = getTopNgrams(extractNgrams(story1.story_text, 3));
    const trigrams2 = getTopNgrams(extractNgrams(story2.story_text, 3));
    trigramSim = jaccardSimilarity(trigrams1, trigrams2);
  }
  
  if (story1.keyword_fingerprint && story2.keyword_fingerprint) {
    keywordSim = jaccardSimilarity(story1.keyword_fingerprint, story2.keyword_fingerprint);
  } else {
    const kw1 = extractKeywords(story1.story_text);
    const kw2 = extractKeywords(story2.story_text);
    keywordSim = jaccardSimilarity(kw1, kw2);
  }
  
  // Compute text similarity
  const textSim = cosineSimilarity(story1.story_text, story2.story_text);
  
  // Weighted combination of similarity measures
  // Trigrams and keywords are most important for detecting similar stories
  const similarity = (
    bigramSim * 0.15 +
    trigramSim * 0.30 +
    keywordSim * 0.25 +
    textSim * 0.30
  );
  
  return {
    similarity: Math.min(1.0, similarity),
    breakdown: {
      content_hash_match: contentHashMatch,
      title_hash_match: titleHashMatch,
      bigram_similarity: bigramSim,
      trigram_similarity: trigramSim,
      keyword_similarity: keywordSim,
      text_similarity: textSim,
    }
  };
}

/**
 * Compute age-based weight for a story
 * Older stories have lower weight (more acceptable to repeat)
 */
export function computeAgeWeight(
  createdAt: Date | string,
  decayRate: number = 0.023,  // ~30 day half-life
  lookbackDays: number = 90
): number {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const daysOld = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  
  // If older than lookback, weight is 0 (don't penalize reuse)
  if (daysOld > lookbackDays) {
    return 0.0;
  }
  
  // Exponential decay
  const weight = Math.exp(-decayRate * daysOld);
  
  return Math.max(0.0, Math.min(1.0, weight));
}

/**
 * Compute effective similarity (raw similarity * age weight)
 */
export function computeEffectiveSimilarity(
  rawSimilarity: number,
  createdAt: Date | string,
  decayRate: number = 0.023,
  lookbackDays: number = 90
): number {
  const ageWeight = computeAgeWeight(createdAt, decayRate, lookbackDays);
  return rawSimilarity * ageWeight;
}

// =====================================================
// DATABASE OPERATIONS
// =====================================================

/**
 * Get uniqueness configuration from database
 */
export async function getUniquenessConfig(
  supabase: any,
  configName: string = 'default'
): Promise<UniquenessConfig> {
  const { data, error } = await supabase
    .from('story_uniqueness_config')
    .select('*')
    .eq('config_name', configName)
    .single();
  
  if (error || !data) {
    console.log(`[STORIES] Config '${configName}' not found, using defaults`);
    // Return defaults
    return {
      exact_match_threshold: 0.95,
      high_similarity_threshold: 0.75,
      moderate_similarity_threshold: 0.5,
      decay_rate: 0.023,
      decay_half_life_days: 30,
      lookback_days: 90,
      max_stories_to_check: 1000,
      max_generation_attempts: 5,
      uniqueness_enabled: true,
      store_all_stories: true,
    };
  }
  
  return data;
}

/**
 * Update uniqueness configuration
 */
export async function updateUniquenessConfig(
  supabase: any,
  updates: Partial<UniquenessConfig>,
  configName: string = 'default'
): Promise<void> {
  const { error } = await supabase
    .from('story_uniqueness_config')
    .update(updates)
    .eq('config_name', configName);
  
  if (error) {
    console.error('[STORIES] Failed to update config:', error);
    throw error;
  }
  
  console.log(`[STORIES] Updated config '${configName}'`);
}

/**
 * Prepare story data for storage
 */
export async function prepareStoryData(
  story: StoryInput,
  metadata: StoryMetadata = {}
): Promise<Partial<StoryRecord>> {
  const contentHash = await hashText(story.story);
  const titleHash = await hashText(story.title);
  
  const words = story.story.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const sentenceCount = countSentences(story.story);
  const avgSentenceLength = wordCount / sentenceCount;
  
  const bigramFingerprint = getTopNgrams(extractNgrams(story.story, 2));
  const trigramFingerprint = getTopNgrams(extractNgrams(story.story, 3));
  const keywordFingerprint = extractKeywords(story.story);
  
  return {
    title: story.title,
    story_text: story.story,
    hook: story.hook || null,
    content_hash: contentHash,
    title_hash: titleHash,
    word_count: wordCount,
    sentence_count: sentenceCount,
    avg_sentence_length: avgSentenceLength,
    bigram_fingerprint: bigramFingerprint,
    trigram_fingerprint: trigramFingerprint,
    keyword_fingerprint: keywordFingerprint,
    vibe_preset: metadata.vibe_preset || null,
    length_preset: metadata.length_preset || null,
    visual_preset: metadata.visual_preset || null,
    art_style: metadata.art_style || null,
    source_job_id: metadata.job_id || null,
  };
}

/**
 * Store a story in the database
 */
export async function storeStory(
  supabase: any,
  story: StoryInput,
  metadata: StoryMetadata = {},
  similarityInfo?: { maxSimilarity: number; mostSimilarId: string | null }
): Promise<string> {
  const storyData = await prepareStoryData(story, metadata);
  
  // Add similarity info if available
  if (similarityInfo) {
    storyData.max_similarity_score = similarityInfo.maxSimilarity;
    storyData.most_similar_story_id = similarityInfo.mostSimilarId;
  }
  
  const { data, error } = await supabase
    .from('stories')
    .insert(storyData)
    .select('id')
    .single();
  
  if (error) {
    console.error('[STORIES] Failed to store story:', error);
    throw error;
  }
  
  console.log(`[STORIES] Stored story "${story.title}" with ID: ${data.id}`);
  return data.id;
}

/**
 * Get recent stories for comparison
 */
export async function getRecentStories(
  supabase: any,
  config: UniquenessConfig,
  filterPresets?: { vibe_preset?: string; visual_preset?: string; length_preset?: string }
): Promise<StoryRecord[]> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - config.lookback_days);
  
  let query = supabase
    .from('stories')
    .select('*')
    .gte('created_at', lookbackDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(config.max_stories_to_check);
  
  // Optionally filter by presets to focus comparison
  // This is commented out by default as we want to check against ALL recent stories
  // if (filterPresets?.vibe_preset) {
  //   query = query.eq('vibe_preset', filterPresets.vibe_preset);
  // }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('[STORIES] Failed to fetch recent stories:', error);
    throw error;
  }
  
  return data || [];
}

/**
 * Check if a story is unique against existing stories
 */
export async function checkStoryUniqueness(
  supabase: any,
  story: StoryInput,
  metadata: StoryMetadata = {},
  configOverrides?: Partial<UniquenessConfig>
): Promise<UniquenessCheckResult> {
  console.log(`[STORIES] Checking uniqueness for: "${story.title}"`);
  
  // Get configuration
  const config = await getUniquenessConfig(supabase);
  const effectiveConfig = { ...config, ...configOverrides };
  
  // If uniqueness checking is disabled, always accept
  if (!effectiveConfig.uniqueness_enabled) {
    console.log('[STORIES] Uniqueness checking disabled, accepting story');
    return {
      is_unique: true,
      is_exact_duplicate: false,
      highest_similarity: 0,
      effective_similarity: 0,
      most_similar_story: null,
      all_similar_stories: [],
      recommendation: 'accept',
      message: 'Uniqueness checking disabled',
    };
  }
  
  // Get recent stories
  const existingStories = await getRecentStories(supabase, effectiveConfig);
  console.log(`[STORIES] Comparing against ${existingStories.length} existing stories`);
  
  if (existingStories.length === 0) {
    return {
      is_unique: true,
      is_exact_duplicate: false,
      highest_similarity: 0,
      effective_similarity: 0,
      most_similar_story: null,
      all_similar_stories: [],
      recommendation: 'accept',
      message: 'No existing stories to compare against',
    };
  }
  
  // Prepare the new story's fingerprints
  const newStoryData = await prepareStoryData(story, metadata);
  
  // Compare against all existing stories
  const similarStories: SimilarityResult[] = [];
  let highestRawSimilarity = 0;
  let highestEffectiveSimilarity = 0;
  let mostSimilar: SimilarityResult | null = null;
  let isExactDuplicate = false;
  
  for (const existing of existingStories) {
    const { similarity, breakdown } = computeSimilarity(
      {
        title: story.title,
        story_text: story.story,
        bigram_fingerprint: newStoryData.bigram_fingerprint as string[],
        trigram_fingerprint: newStoryData.trigram_fingerprint as string[],
        keyword_fingerprint: newStoryData.keyword_fingerprint as string[],
        content_hash: newStoryData.content_hash,
        title_hash: newStoryData.title_hash,
      },
      {
        title: existing.title,
        story_text: existing.story_text,
        bigram_fingerprint: existing.bigram_fingerprint,
        trigram_fingerprint: existing.trigram_fingerprint,
        keyword_fingerprint: existing.keyword_fingerprint,
        content_hash: existing.content_hash,
        title_hash: existing.title_hash,
      }
    );
    
    const daysOld = (Date.now() - new Date(existing.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const ageWeight = computeAgeWeight(existing.created_at, effectiveConfig.decay_rate, effectiveConfig.lookback_days);
    const effectiveSim = similarity * ageWeight;
    
    // Check for exact duplicate
    if (breakdown.content_hash_match) {
      isExactDuplicate = true;
    }
    
    const result: SimilarityResult = {
      story_id: existing.id,
      title: existing.title,
      raw_similarity: similarity,
      age_weight: ageWeight,
      effective_similarity: effectiveSim,
      days_old: daysOld,
      similarity_breakdown: breakdown,
    };
    
    // Track highest similarities
    if (similarity > highestRawSimilarity) {
      highestRawSimilarity = similarity;
    }
    if (effectiveSim > highestEffectiveSimilarity) {
      highestEffectiveSimilarity = effectiveSim;
      mostSimilar = result;
    }
    
    // Only include stories above moderate threshold in results
    if (similarity >= effectiveConfig.moderate_similarity_threshold) {
      similarStories.push(result);
    }
  }
  
  // Sort by effective similarity
  similarStories.sort((a, b) => b.effective_similarity - a.effective_similarity);
  
  // Determine recommendation
  let recommendation: 'accept' | 'reject' | 'warn';
  let message: string;
  let isUnique = true;
  
  if (isExactDuplicate || highestRawSimilarity >= effectiveConfig.exact_match_threshold) {
    recommendation = 'reject';
    isUnique = false;
    message = `Exact or near-exact duplicate found (${(highestRawSimilarity * 100).toFixed(1)}% similar)`;
  } else if (highestEffectiveSimilarity >= effectiveConfig.high_similarity_threshold) {
    recommendation = 'reject';
    isUnique = false;
    message = `Too similar to recent story (${(highestEffectiveSimilarity * 100).toFixed(1)}% effective similarity)`;
  } else if (highestEffectiveSimilarity >= effectiveConfig.moderate_similarity_threshold) {
    recommendation = 'warn';
    isUnique = true;  // Accept but warn
    message = `Moderately similar to existing story (${(highestEffectiveSimilarity * 100).toFixed(1)}% effective similarity)`;
  } else {
    recommendation = 'accept';
    isUnique = true;
    message = 'Story is sufficiently unique';
  }
  
  console.log(`[STORIES] Uniqueness check result: ${recommendation} - ${message}`);
  if (mostSimilar) {
    console.log(`[STORIES] Most similar: "${mostSimilar.title}" (${mostSimilar.days_old.toFixed(1)} days old, ${(mostSimilar.raw_similarity * 100).toFixed(1)}% raw, ${(mostSimilar.effective_similarity * 100).toFixed(1)}% effective)`);
  }
  
  return {
    is_unique: isUnique,
    is_exact_duplicate: isExactDuplicate,
    highest_similarity: highestRawSimilarity,
    effective_similarity: highestEffectiveSimilarity,
    most_similar_story: mostSimilar,
    all_similar_stories: similarStories.slice(0, 10),  // Return top 10
    recommendation,
    message,
  };
}

/**
 * Mark a story as used (increment use count and update last_used_at)
 */
export async function markStoryUsed(supabase: any, storyId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_story_use_count', { story_id: storyId });
  
  if (error) {
    // Fallback to direct update if RPC doesn't exist
    const { error: updateError } = await supabase
      .from('stories')
      .update({
        use_count: supabase.sql`use_count + 1`,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', storyId);
    
    if (updateError) {
      console.error('[STORIES] Failed to mark story as used:', updateError);
    }
  }
}

/**
 * Link a job to a story
 */
export async function linkJobToStory(
  supabase: any,
  jobId: string,
  storyId: string,
  reuseInfo?: { was_reused: boolean; similarity_score?: number; original_story_id?: string }
): Promise<void> {
  const updateData: any = {
    story_id: storyId,
  };
  
  if (reuseInfo) {
    updateData.story_reuse_info = reuseInfo;
  }
  
  const { error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', jobId);
  
  if (error) {
    console.error('[STORIES] Failed to link job to story:', error);
  }
}

// =====================================================
// HIGH-LEVEL WORKFLOW FUNCTIONS
// =====================================================

/**
 * Generate a unique story with retry logic
 * This wraps the story generation function with uniqueness checking
 */
export async function generateUniqueStory(
  supabase: any,
  generateStoryFn: () => Promise<StoryInput>,
  metadata: StoryMetadata = {},
  configOverrides?: Partial<UniquenessConfig>
): Promise<{
  story: StoryInput;
  storyId: string;
  attempts: number;
  uniquenessResult: UniquenessCheckResult;
}> {
  const config = await getUniquenessConfig(supabase);
  const effectiveConfig = { ...config, ...configOverrides };
  
  let lastResult: UniquenessCheckResult | null = null;
  let lastStory: StoryInput | null = null;
  
  for (let attempt = 1; attempt <= effectiveConfig.max_generation_attempts; attempt++) {
    console.log(`[STORIES] Generation attempt ${attempt}/${effectiveConfig.max_generation_attempts}`);
    
    // Generate a new story
    const story = await generateStoryFn();
    lastStory = story;
    
    // Check uniqueness
    const result = await checkStoryUniqueness(supabase, story, metadata, effectiveConfig);
    lastResult = result;
    
    if (result.recommendation === 'accept' || result.recommendation === 'warn') {
      // Store the story
      let storyId: string;
      
      if (effectiveConfig.store_all_stories) {
        storyId = await storeStory(supabase, story, metadata, {
          maxSimilarity: result.highest_similarity,
          mostSimilarId: result.most_similar_story?.story_id || null,
        });
      } else {
        storyId = crypto.randomUUID();  // Generate a fake ID if not storing
      }
      
      // Link to job if job_id provided
      if (metadata.job_id) {
        await linkJobToStory(supabase, metadata.job_id, storyId, {
          was_reused: false,
          similarity_score: result.highest_similarity,
        });
      }
      
      return {
        story,
        storyId,
        attempts: attempt,
        uniquenessResult: result,
      };
    }
    
    console.log(`[STORIES] Story rejected (attempt ${attempt}): ${result.message}`);
  }
  
  // All attempts exhausted - use the last generated story anyway
  console.warn(`[STORIES] Max attempts reached, using last generated story despite similarity`);
  
  let storyId: string;
  if (effectiveConfig.store_all_stories && lastStory) {
    storyId = await storeStory(supabase, lastStory, metadata, {
      maxSimilarity: lastResult?.highest_similarity || 0,
      mostSimilarId: lastResult?.most_similar_story?.story_id || null,
    });
  } else {
    storyId = crypto.randomUUID();
  }
  
  if (metadata.job_id && lastStory) {
    await linkJobToStory(supabase, metadata.job_id, storyId, {
      was_reused: false,
      similarity_score: lastResult?.highest_similarity,
    });
  }
  
  return {
    story: lastStory!,
    storyId,
    attempts: effectiveConfig.max_generation_attempts,
    uniquenessResult: lastResult!,
  };
}

/**
 * Get story statistics for analytics
 */
export async function getStoryStats(supabase: any): Promise<{
  total_stories: number;
  stories_last_7_days: number;
  stories_last_30_days: number;
  avg_similarity_at_generation: number;
  by_vibe: Record<string, number>;
  by_visual: Record<string, number>;
}> {
  // Total count
  const { count: total } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });
  
  // Last 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const { count: last7 } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo.toISOString());
  
  // Last 30 days
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const { count: last30 } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthAgo.toISOString());
  
  // Average similarity
  const { data: simData } = await supabase
    .from('stories')
    .select('max_similarity_score')
    .not('max_similarity_score', 'is', null);
  
  const avgSim = simData && simData.length > 0
    ? simData.reduce((sum: number, s: any) => sum + s.max_similarity_score, 0) / simData.length
    : 0;
  
  // By vibe preset
  const { data: vibeData } = await supabase
    .from('stories')
    .select('vibe_preset');
  
  const byVibe: Record<string, number> = {};
  for (const row of vibeData || []) {
    const vibe = row.vibe_preset || 'unknown';
    byVibe[vibe] = (byVibe[vibe] || 0) + 1;
  }
  
  // By visual preset
  const { data: visualData } = await supabase
    .from('stories')
    .select('visual_preset');
  
  const byVisual: Record<string, number> = {};
  for (const row of visualData || []) {
    const visual = row.visual_preset || 'unknown';
    byVisual[visual] = (byVisual[visual] || 0) + 1;
  }
  
  return {
    total_stories: total || 0,
    stories_last_7_days: last7 || 0,
    stories_last_30_days: last30 || 0,
    avg_similarity_at_generation: avgSim,
    by_vibe: byVibe,
    by_visual: byVisual,
  };
}

// =====================================================
// THEME GUIDANCE SYSTEM (Cost-Effective Diversity)
// =====================================================

/**
 * Theme buckets for rotation - grouped by atmosphere/setting
 */
const THEME_BUCKETS: Record<string, { themes: string[]; settings: string[]; elements: string[] }> = {
  water: {
    themes: ["drowning", "deep sea", "isolation at sea", "underwater horror", "maritime mystery"],
    settings: ["ocean", "lake", "flooded basement", "abandoned ship", "coastal town"],
    elements: ["water", "darkness below", "something surfacing", "distant lights", "endless depth"],
  },
  forest: {
    themes: ["getting lost", "being watched", "ancient evil", "wrong turn", "cabin horror"],
    settings: ["deep woods", "abandoned trail", "foggy forest", "overgrown path", "clearing at night"],
    elements: ["trees", "fog", "rustling", "eyes in darkness", "unnatural silence"],
  },
  urban: {
    themes: ["stalker", "empty city", "wrong floor", "late night transit", "abandoned building"],
    settings: ["subway", "parking garage", "empty office", "apartment hallway", "closed mall"],
    elements: ["flickering lights", "footsteps", "security camera", "locked doors", "elevator"],
  },
  domestic: {
    themes: ["home invasion", "something in the house", "familiar turned wrong", "childhood fear", "family secret"],
    settings: ["attic", "basement", "childhood bedroom", "empty house", "mirror"],
    elements: ["creaking floors", "shadows", "photographs", "locked room", "familiar voice"],
  },
  cosmic: {
    themes: ["incomprehensible", "wrong stars", "time distortion", "reality breaking", "ancient presence"],
    settings: ["observatory", "empty field at night", "space station", "desert", "mountain peak"],
    elements: ["stars", "void", "geometry", "scale", "insignificance"],
  },
  technological: {
    themes: ["AI gone wrong", "surveillance", "digital haunting", "phone call from nowhere", "glitch in reality"],
    settings: ["server room", "smart home", "hospital", "research facility", "radio station"],
    elements: ["screens", "static", "recordings", "automated voice", "malfunction"],
  },
};

/**
 * Horror elements that work across all themes
 */
const UNIVERSAL_HORROR_ELEMENTS = [
  "a figure that shouldn't be there",
  "something following at a distance",
  "a sound that repeats",
  "eyes that reflect wrong",
  "a smile that's too wide",
  "movement in peripheral vision",
  "a door that was closed",
  "a voice that sounds familiar",
  "something pretending to be human",
  "the feeling of being watched",
];

export interface ThemeGuidance {
  bucket: string;
  suggestedTheme: string;
  suggestedSetting: string;
  suggestedElement: string;
  promptAddition: string;
  recentThemesAvoided: string[];
}

/**
 * Get recent dominant themes from stored stories (lightweight query)
 */
export async function getRecentThemes(
  supabase: any,
  lookbackDays: number = 7,
  limit: number = 10
): Promise<string[]> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  
  const { data, error } = await supabase
    .from('stories')
    .select('keyword_fingerprint, visual_preset')
    .gte('created_at', lookbackDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error || !data || data.length === 0) {
    console.log('[STORIES] No recent stories found for theme analysis');
    return [];
  }
  
  // Collect all keywords from recent stories
  const allKeywords: string[] = [];
  const visualPresets: string[] = [];
  
  for (const story of data) {
    if (story.keyword_fingerprint && Array.isArray(story.keyword_fingerprint)) {
      allKeywords.push(...story.keyword_fingerprint.slice(0, 10)); // Top 10 keywords per story
    }
    if (story.visual_preset) {
      visualPresets.push(story.visual_preset);
    }
  }
  
  // Add visual presets as themes too
  allKeywords.push(...visualPresets);
  
  // Count frequency
  const freq = new Map<string, number>();
  for (const kw of allKeywords) {
    freq.set(kw, (freq.get(kw) || 0) + 1);
  }
  
  // Return top themes sorted by frequency
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme]) => theme);
}

/**
 * Determine which theme bucket to suggest based on recent usage
 */
function selectContrastingBucket(recentThemes: string[]): string {
  const bucketNames = Object.keys(THEME_BUCKETS);
  
  if (recentThemes.length === 0) {
    // No history, pick randomly
    return bucketNames[Math.floor(Math.random() * bucketNames.length)];
  }
  
  // Score each bucket by how much it overlaps with recent themes
  const bucketScores: Record<string, number> = {};
  
  for (const [bucketName, bucket] of Object.entries(THEME_BUCKETS)) {
    let overlapScore = 0;
    const allBucketTerms = [...bucket.themes, ...bucket.settings, ...bucket.elements];
    
    for (const term of allBucketTerms) {
      for (const recentTheme of recentThemes) {
        // Check for partial matches
        if (term.includes(recentTheme) || recentTheme.includes(term)) {
          overlapScore += 2;
        }
        // Check for word overlap
        const termWords = term.toLowerCase().split(/\s+/);
        const themeWords = recentTheme.toLowerCase().split(/\s+/);
        for (const tw of termWords) {
          if (themeWords.includes(tw) && tw.length > 3) {
            overlapScore += 1;
          }
        }
      }
    }
    
    bucketScores[bucketName] = overlapScore;
  }
  
  // Pick the bucket with LOWEST overlap (most contrasting)
  const sortedBuckets = Object.entries(bucketScores).sort((a, b) => a[1] - b[1]);
  
  // Add some randomness among the top 2-3 least-used buckets
  const topChoices = sortedBuckets.slice(0, 3);
  const selected = topChoices[Math.floor(Math.random() * topChoices.length)];
  
  console.log(`[STORIES] Bucket scores: ${JSON.stringify(bucketScores)}`);
  console.log(`[STORIES] Selected contrasting bucket: ${selected[0]} (score: ${selected[1]})`);
  
  return selected[0];
}

/**
 * Generate theme guidance for story generation
 * This is the main function - call it before generating a story
 */
export async function getThemeGuidance(
  supabase: any,
  visualPreset?: string
): Promise<ThemeGuidance> {
  // Get recent themes
  const recentThemes = await getRecentThemes(supabase, 7, 10);
  console.log(`[STORIES] Recent themes: ${recentThemes.slice(0, 5).join(', ') || 'none'}`);
  
  // Select a contrasting bucket
  let selectedBucket = selectContrastingBucket(recentThemes);
  
  // If visual preset matches a bucket, consider using it (but with fresh elements)
  if (visualPreset && THEME_BUCKETS[visualPreset]) {
    // 30% chance to use the visual preset's bucket anyway for coherence
    if (Math.random() < 0.3) {
      selectedBucket = visualPreset;
      console.log(`[STORIES] Using visual preset bucket for coherence: ${selectedBucket}`);
    }
  }
  
  const bucket = THEME_BUCKETS[selectedBucket];
  
  // Pick random elements from the bucket
  const suggestedTheme = bucket.themes[Math.floor(Math.random() * bucket.themes.length)];
  const suggestedSetting = bucket.settings[Math.floor(Math.random() * bucket.settings.length)];
  const suggestedElement = bucket.elements[Math.floor(Math.random() * bucket.elements.length)];
  
  // Pick a universal horror element too
  const universalElement = UNIVERSAL_HORROR_ELEMENTS[Math.floor(Math.random() * UNIVERSAL_HORROR_ELEMENTS.length)];
  
  // Build the prompt addition (POSITIVE guidance, not negative)
  const promptAddition = `
═══════════════════════════════════════
THEME DIRECTION (for variety):
═══════════════════════════════════════
Focus on: ${suggestedTheme}
Setting lean: ${suggestedSetting}
Key element to include: ${suggestedElement}
Horror beat: ${universalElement}
`;

  console.log(`[STORIES] Theme guidance: ${suggestedTheme} / ${suggestedSetting} / ${suggestedElement}`);
  
  return {
    bucket: selectedBucket,
    suggestedTheme,
    suggestedSetting,
    suggestedElement,
    promptAddition,
    recentThemesAvoided: recentThemes.slice(0, 3),
  };
}

/**
 * Simplified story generation - NO retries, just store and track
 * Call this AFTER generating a story to store it and get similarity info
 */
export async function storeAndAnalyzeStory(
  supabase: any,
  story: StoryInput,
  metadata: StoryMetadata = {},
  themeGuidance?: ThemeGuidance
): Promise<{
  storyId: string;
  similarityScore: number;
  mostSimilarTitle: string | null;
  isLikelyUnique: boolean;
}> {
  // Get config
  const config = await getUniquenessConfig(supabase);
  
  // Check similarity (for analytics only, not for rejection)
  let similarityScore = 0;
  let mostSimilarTitle: string | null = null;
  let mostSimilarId: string | null = null;
  
  if (config.uniqueness_enabled) {
    const uniquenessResult = await checkStoryUniqueness(supabase, story, metadata);
    similarityScore = uniquenessResult.highest_similarity;
    mostSimilarTitle = uniquenessResult.most_similar_story?.title || null;
    mostSimilarId = uniquenessResult.most_similar_story?.story_id || null;
    
    console.log(`[STORIES] Similarity check: ${(similarityScore * 100).toFixed(1)}% (${uniquenessResult.recommendation})`);
  }
  
  // Always store the story
  const storyId = await storeStory(supabase, story, metadata, {
    maxSimilarity: similarityScore,
    mostSimilarId: mostSimilarId,
  });
  
  // Add theme guidance info to story meta if provided
  if (themeGuidance) {
    await supabase
      .from('stories')
      .update({
        meta: {
          theme_bucket: themeGuidance.bucket,
          suggested_theme: themeGuidance.suggestedTheme,
          suggested_setting: themeGuidance.suggestedSetting,
          recent_themes_avoided: themeGuidance.recentThemesAvoided,
        }
      })
      .eq('id', storyId);
  }
  
  // Link to job if provided
  if (metadata.job_id) {
    await linkJobToStory(supabase, metadata.job_id, storyId, {
      was_reused: false,
      similarity_score: similarityScore,
    });
  }
  
  return {
    storyId,
    similarityScore,
    mostSimilarTitle,
    isLikelyUnique: similarityScore < 0.5, // Below 50% is "unique enough"
  };
}