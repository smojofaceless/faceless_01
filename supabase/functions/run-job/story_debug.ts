/**
 * Story Debug Helper v1.0
 * 
 * Builds comprehensive debug payloads for story generation pipeline.
 * Collects profile resolution, contract compliance, canonicalization,
 * truncation, and repair data into a single debug object.
 * 
 * This data is used by the frontend debug panel to visualize
 * every step of the story generation pipeline.
 */

import type { StoryProfile, PartialStoryProfile } from './story_profile.ts';
import type { ComplianceResult, StoryContract } from './story_contract.ts';

// =====================================================
// TYPE DEFINITIONS
// =====================================================

/** Profile merge source tracking */
export interface ProfileMergeSources {
  system: boolean;
  template: boolean;
  preset: boolean;
  brand: boolean;
  user: boolean;
}

/** Profile resolution debug info */
export interface ProfileDebugInfo {
  story_mode: 'auto' | 'custom';
  resolved_profile_summary: string;
  merge_sources: ProfileMergeSources;
  key_fields: {
    output_mode: string;
    beat_count: number;
    beat_labels: string[];
    motif_min_mentions: number;
    motif_should_escalate: boolean;
    enforce_final_image: boolean;
    anti_closure: number;
    era_level: string;
    allow_legacy_fallback: boolean;
    repair_temperature: number;
    max_repair_attempts: number;
    word_target: number;
    word_variance: number;
  };
}

/** Contract debug info */
export interface ContractDebugInfo {
  contract_summary: string;
  beats_expected: number;
  beats_found: number;
  beat_labels_expected: string[];
  beat_labels_found: string[];
}

/** Canonicalization debug info */
export interface CanonicalizationDebugInfo {
  changed: boolean;
  notes: string[];
}

/** Truncation debug info */
export interface TruncationDebugInfo {
  truncated: boolean;
  original_word_count: number;
  final_word_count: number;
  notes: string[];
}

/** Compliance debug info */
export interface ComplianceDebugInfo {
  score: number;
  passed: boolean;
  hard_failures: string[];
  issues: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
  metrics: {
    word_count: number;
    beat_count: number;
    motif_mentions: number;
    unique_element_mentions: number;
    has_final_image: boolean;
    marker_count: number;
    grounding_details: number;
    // v2.0: Per-beat grounding
    grounding_per_beat?: Array<{ beat: number; count: number }>;
    grounding_missing_beats?: number[];
    // v2.0: Word count range validation
    word_count_in_range?: boolean;
    word_count_min?: number;
    word_count_max?: number;
  };
}

/** Method/repair debug info */
export interface MethodDebugInfo {
  generation_method: 'contract' | 'contract_repaired' | 'legacy_fallback';
  repair_attempted: boolean;
  repair_succeeded: boolean;
  repair_attempts?: number;
  // v2.0: Repair tracking
  repair_reasons?: string[];
  post_fixes_applied?: string[];
  final_source_text?: 'contract' | 'repaired' | 'truncated' | 'legacy';
}

/** v2.0: Word range debug info */
export interface WordRangeDebugInfo {
  min: number;
  max: number;
  target: number;
  variance: number;
}

/** v2.0: Word count check result */
export interface WordCountCheckInfo {
  in_range: boolean;
  actual: number;
  reason: string;
}

/** Story output texts */
export interface OutputTexts {
  raw_with_tags: string;
  canonical_with_tags: string;
  stripped_for_tts: string;
  final_story_text: string;
}

/** v2.1: Contract attempt tracking */
export interface ContractAttemptDebugInfo {
  stage: string;
  word_count: number;
  compliance_score?: number;
  hard_failures?: string[];
  had_tags: boolean;
}

/** v2.1: Best contract attempt preserved for debugging */
export interface BestContractAttemptDebugInfo {
  raw_with_tags: string;
  word_count: number;
  had_beat_tags: boolean;
  beat_count: number;
  compliance_score?: number;
  compliance_passed?: boolean;
}

/** v2.1: Fallback autopsy debug info */
export interface FallbackAutopsyDebugInfo {
  triggered: boolean;
  reason?: string;
  error?: {
    message: string;
    stage: string;
    stack?: string;
  };
  contract_attempts?: ContractAttemptDebugInfo[];
  best_contract_attempt?: BestContractAttemptDebugInfo;
}

/** Complete story debug payload */
export interface StoryDebugPayload {
  enabled: boolean;
  timestamp: string;
  niche: string;
  vibe_preset: string;
  profile: ProfileDebugInfo;
  contract: ContractDebugInfo;
  canonicalization: CanonicalizationDebugInfo;
  truncation: TruncationDebugInfo;
  compliance: ComplianceDebugInfo | null;
  method: MethodDebugInfo;
  output: OutputTexts;
  // v2.0: Word count enforcement
  word_range?: WordRangeDebugInfo;
  word_count_check?: WordCountCheckInfo;
  // v2.1: Fallback autopsy
  fallback_autopsy?: FallbackAutopsyDebugInfo;
}

// =====================================================
// DEBUG PAYLOAD BUILDER
// =====================================================

/**
 * Build a comprehensive story debug payload from generation results
 */
export function buildStoryDebugPayload(params: {
  niche: string;
  vibe_preset: string;
  story_mode: 'auto' | 'custom';
  resolved_profile: StoryProfile;
  merge_sources: {
    hasTemplate: boolean;
    hasPreset: boolean;
    hasBrand: boolean;
    hasUser: boolean;
  };
  contract: StoryContract | null;
  contract_summary: string;
  raw_story: string;
  canonical_story?: string;
  final_story: string;
  stripped_story: string;
  canonicalization?: { changed: boolean; notes: string[] };
  truncation?: { truncated: boolean; originalWordCount: number; finalWordCount: number; notes?: string[] };
  compliance: ComplianceResult | null;
  generation_method: 'contract' | 'contract_repaired' | 'legacy_fallback';
  repair_attempted?: boolean;
  repair_succeeded?: boolean;
  // v2.0: New tracking fields
  repair_reasons?: string[];
  post_fixes_applied?: string[];
  final_source_text?: 'contract' | 'repaired' | 'truncated' | 'legacy';
  word_range?: { min: number; max: number; target: number; variance: number };
  word_count_check?: { in_range: boolean; actual: number; reason: string };
  // v2.1: Fallback autopsy fields
  fallback_reason?: string;
  contract_error?: { message: string; stack?: string; stage: string };
  contract_attempts?: Array<{ stage: string; word_count: number; compliance_score?: number; hard_failures?: string[]; had_tags: boolean }>;
  best_contract_attempt?: { raw_with_tags: string; compliance: any; word_count: number; had_beat_tags: boolean; beat_count: number };
}): StoryDebugPayload {
  const { resolved_profile, contract, compliance } = params;
  
  // Build profile debug info
  const profileDebug: ProfileDebugInfo = {
    story_mode: params.story_mode,
    resolved_profile_summary: buildProfileSummary(resolved_profile),
    merge_sources: {
      system: true, // Always has system defaults
      template: params.merge_sources.hasTemplate,
      preset: params.merge_sources.hasPreset,
      brand: params.merge_sources.hasBrand,
      user: params.merge_sources.hasUser,
    },
    key_fields: {
      output_mode: resolved_profile.outputMode?.mode || 'narrative',
      beat_count: resolved_profile.beatStructure.beatCount,
      beat_labels: resolved_profile.beatStructure.beatLabels,
      motif_min_mentions: resolved_profile.motif.minMentions,
      motif_should_escalate: resolved_profile.motif.shouldEscalate,
      enforce_final_image: resolved_profile.ending.enforceFinalImage,
      anti_closure: resolved_profile.ending.antiClosure,
      era_level: resolved_profile.embodiment.eraLevel,
      allow_legacy_fallback: resolved_profile.generation?.allowLegacyFallback ?? true,
      repair_temperature: resolved_profile.generation?.repairTemperature ?? 0.15,
      max_repair_attempts: resolved_profile.generation?.maxRepairAttempts ?? 1,
      word_target: resolved_profile.wordCount.target,
      word_variance: resolved_profile.wordCount.variance,
    },
  };
  
  // Build contract debug info
  const contractDebug: ContractDebugInfo = {
    contract_summary: params.contract_summary || 'No contract',
    beats_expected: contract?.expectedBeats.length || resolved_profile.beatStructure.beatCount,
    beats_found: compliance?.metrics?.beatCount || 0,
    beat_labels_expected: contract?.expectedBeats || resolved_profile.beatStructure.beatLabels.map((l, i) => `[BEAT_${i + 1}:${l}]`),
    beat_labels_found: extractFoundBeats(params.canonical_story || params.raw_story),
  };
  
  // Build canonicalization debug info
  const canonDebug: CanonicalizationDebugInfo = {
    changed: params.canonicalization?.changed ?? false,
    notes: params.canonicalization?.notes || [],
  };
  
  // Build truncation debug info
  const truncDebug: TruncationDebugInfo = {
    truncated: params.truncation?.truncated ?? false,
    original_word_count: params.truncation?.originalWordCount ?? countWords(params.raw_story),
    final_word_count: params.truncation?.finalWordCount ?? countWords(params.final_story),
    notes: params.truncation?.truncated 
      ? [`Truncated at sentence boundary from ${params.truncation.originalWordCount} to ${params.truncation.finalWordCount} words`]
      : [],
  };
  
  // Build compliance debug info
  const complianceDebug: ComplianceDebugInfo | null = compliance ? {
    score: compliance.score,
    passed: compliance.passed,
    hard_failures: compliance.hardFailures || [],
    issues: (compliance.issues || []).map(issue => ({
      type: issue.type,
      severity: issue.severity,
      message: issue.message,
    })),
    metrics: {
      word_count: compliance.metrics?.wordCount || 0,
      beat_count: compliance.metrics?.beatCount || 0,
      motif_mentions: compliance.metrics?.motifMentions || 0,
      unique_element_mentions: compliance.metrics?.uniqueElementMentions || 0,
      has_final_image: compliance.metrics?.hasFinalImage ?? false,
      marker_count: compliance.metrics?.markerCount || 0,
      grounding_details: compliance.metrics?.groundingDetails || 0,
      // v2.0: Per-beat grounding metrics
      grounding_per_beat: compliance.metrics?.groundingPerBeat,
      grounding_missing_beats: compliance.metrics?.groundingMissingBeats,
      word_count_in_range: compliance.metrics?.wordCountInRange,
      word_count_min: compliance.metrics?.wordCountMin,
      word_count_max: compliance.metrics?.wordCountMax,
    },
  } : null;
  
  // Build method debug info
  const methodDebug: MethodDebugInfo = {
    generation_method: params.generation_method,
    repair_attempted: params.repair_attempted ?? (params.generation_method === 'contract_repaired'),
    repair_succeeded: params.repair_succeeded ?? (params.generation_method === 'contract_repaired'),
    // v2.0: Detailed repair tracking
    repair_reasons: params.repair_reasons,
    post_fixes_applied: params.post_fixes_applied,
    final_source_text: params.final_source_text,
  };
  
  // Build output texts
  const outputTexts: OutputTexts = {
    raw_with_tags: params.raw_story,
    canonical_with_tags: params.canonical_story || params.raw_story,
    stripped_for_tts: params.stripped_story,
    final_story_text: params.final_story,
  };
  
  // v2.1: Build fallback autopsy if relevant
  const fallbackAutopsy: FallbackAutopsyDebugInfo | undefined = 
    params.generation_method === 'legacy_fallback' || params.fallback_reason
      ? {
          triggered: params.generation_method === 'legacy_fallback',
          reason: params.fallback_reason,
          error: params.contract_error ? {
            message: params.contract_error.message,
            stage: params.contract_error.stage,
            stack: params.contract_error.stack,
          } : undefined,
          contract_attempts: params.contract_attempts?.map(a => ({
            stage: a.stage,
            word_count: a.word_count,
            compliance_score: a.compliance_score,
            hard_failures: a.hard_failures,
            had_tags: a.had_tags,
          })),
          best_contract_attempt: params.best_contract_attempt ? {
            raw_with_tags: params.best_contract_attempt.raw_with_tags,
            word_count: params.best_contract_attempt.word_count,
            had_beat_tags: params.best_contract_attempt.had_beat_tags,
            beat_count: params.best_contract_attempt.beat_count,
            compliance_score: params.best_contract_attempt.compliance?.score,
            compliance_passed: params.best_contract_attempt.compliance?.passed,
          } : undefined,
        }
      : undefined;
  
  return {
    enabled: true,
    timestamp: new Date().toISOString(),
    niche: params.niche,
    vibe_preset: params.vibe_preset,
    profile: profileDebug,
    contract: contractDebug,
    canonicalization: canonDebug,
    truncation: truncDebug,
    compliance: complianceDebug,
    method: methodDebug,
    output: outputTexts,
    // v2.0: Word count enforcement
    word_range: params.word_range,
    word_count_check: params.word_count_check,
    // v2.1: Fallback autopsy
    fallback_autopsy: fallbackAutopsy,
  };
}

/**
 * Build a human-readable profile summary
 */
function buildProfileSummary(profile: StoryProfile): string {
  const parts: string[] = [];
  
  parts.push(`${profile.profile_name || 'unnamed'}`);
  parts.push(`${profile.beatStructure.beatCount} beats`);
  parts.push(`${profile.wordCount.target}±${profile.wordCount.variance} words`);
  parts.push(`motif×${profile.motif.minMentions}`);
  
  if (profile.ending.enforceFinalImage) {
    parts.push('final_image:required');
  }
  
  if (profile.ending.antiClosure >= 0.7) {
    parts.push('antiClosure:high');
  }
  
  if (profile.outputMode?.mode && profile.outputMode.mode !== 'narrative') {
    parts.push(`mode:${profile.outputMode.mode}`);
  }
  
  return parts.join(' | ');
}

/**
 * Extract found beat tags from story text
 */
function extractFoundBeats(story: string): string[] {
  const beatPattern = /\[BEAT_\d+:[^\]]+\]/g;
  const matches = story.match(beatPattern) || [];
  return matches;
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Build a minimal debug payload for legacy generation mode
 * Still returns enabled: true so debug panel renders, but with minimal data
 */
export function buildMinimalDebugPayload(niche: string, vibe: string): StoryDebugPayload {
  return {
    enabled: true, // Always enabled so debug panel renders
    timestamp: new Date().toISOString(),
    niche,
    vibe_preset: vibe,
    profile: {
      story_mode: 'auto',
      resolved_profile_summary: 'Legacy generation - no contract/profile data',
      merge_sources: {
        system: true,
        template: false,
        preset: false,
        brand: false,
        user: false,
      },
      key_fields: {
        output_mode: 'narrative',
        beat_count: 4,
        beat_labels: [],
        motif_min_mentions: 2,
        motif_should_escalate: false,
        enforce_final_image: false,
        anti_closure: 0.3,
        era_level: 'name_only',
        allow_legacy_fallback: true,
        repair_temperature: 0.15,
        max_repair_attempts: 1,
        word_target: 140,
        word_variance: 20,
      },
    },
    contract: {
      contract_summary: 'Legacy mode - no StoryContract used',
      beats_expected: 0,
      beats_found: 0,
      beat_labels_expected: [],
      beat_labels_found: [],
    },
    canonicalization: {
      changed: false,
      notes: ['Legacy mode - canonicalization not applied'],
    },
    truncation: {
      truncated: false,
      original_word_count: 0,
      final_word_count: 0,
      notes: ['Legacy mode - truncation not applied'],
    },
    compliance: null,
    method: {
      generation_method: 'legacy_fallback',
      repair_attempted: false,
      repair_succeeded: false,
    },
    output: {
      raw_with_tags: '',
      canonical_with_tags: '',
      stripped_for_tts: '',
      final_story_text: '',
    },
  };
}
