// =====================================================
// PHASE RUNNERS MODULE
// runPreviewMode, runAudioPhase, runImagesPhase, runAssemblePhase, runFullGeneration
// =====================================================

import { createClient } from "npm:@supabase/supabase-js@2.39.3";

import {
  corsHeaders,
  ELEVENLABS_VOICE_ID,
  ART_STYLE_CONFIG,
  LENGTH_CONFIG,
  VIBE_CONFIG,
  updateJob,
  getImageModel,
  getFreshJob,
  updateJobMeta,
  type StoryScene,
  type VideoOptions,
} from "./config.ts";

import { generateStory, generateStoryWithDNA, buildStoryPromptForDisplay, extractSceneKeywordsForPreview, extractSceneKeywords, createStoryAnchor, createVisualBeats, createSceneVisualContracts, buildFinalDallePrompt, buildFluxPrompt, fuseIntoCoherentScenes, calculateRecommendedSceneCount, runAlignmentCheck, scorePromptRelevance, repairVisualContract, computePromptHash, injectGroupCountsIntoContracts, verifyHumanCount, buildCountLockFallbackPrompt } from "./openai.ts";
import { generateAudio } from "./audio.ts";
import {
  getThemeGuidance,
  storeAndAnalyzeStory,
  getUniquenessConfig,
  type ThemeGuidance,
} from "./stories.ts";
import { searchPexelsForKeywords, searchVideosForScenes } from "./pexels.ts";
import { generateImage, getLastReplicateInputs, uploadRemoteImageToStorage } from "./images.ts";
import { 
  assembleVideoWithCreatomate, 
  checkCreatomateRender, 
  renderWithFFmpeg, 
  checkFFmpegRender, 
  shouldUseFFmpegRenderer,
  canUseParallelImageGeneration,
  startParallelImageGeneration,
  checkParallelImageStatus,
  type ParallelImageScene,
} from "./video.ts";
import {
  resolveEffectsProfile,
  legacyEffectsToProfile,
  profileToSummary,
  sanitizeEffectsProfile,
  SCHEMA_VERSION,
  type EffectsProfile,
} from "./effects_profile.ts";

import {
  resolveStoryProfile,
  sanitizeStoryProfile,
  getTemplateDefaults,
  getPresetProfile,
  profileToSummary as storyProfileToSummary,
  STORY_PROFILE_SCHEMA_VERSION,
  type StoryProfile,
  type PartialStoryProfile,
} from "./story_profile.ts";

import {
  buildStoryContract,
  checkCompliance,
  stripContractTags,
  processStoryOutput,
  complianceToLog,
  convertDNAToContract,
  type StoryContract,
  type ComplianceResult,
  type StoryDNA as ContractStoryDNA,
} from "./story_contract.ts";

import {
  buildStoryDebugPayload,
  buildMinimalDebugPayload,
  type StoryDebugPayload,
} from "./story_debug.ts";

import {
  analyzeVisualReadiness,
  type VisualReadinessReport,
} from "./visual_readiness.ts";

// =====================================================
// PREVIEW MODE (Synchronous - returns story quickly)
// =====================================================
export async function runPreviewMode(
  supabase: any,
  openaiKey: string,
  job: any,
  job_id: string,
  jobMeta: any
): Promise<Response> {
  await updateJob(supabase, job_id, { status: "generating", progress: 5 });

  // Scene count is for visual pacing, story length is based on length_preset
  const sceneCount = jobMeta.scene_count || 6;
  const visualPreset = job.visual_preset || "forest";
  const artStyle = jobMeta.art_style || "cinematic-dark";
  
  console.log(`[PREVIEW] Job vibe_preset: "${job.vibe_preset}"`);
  console.log(`Generating story (${job.length_preset}s preset, ${sceneCount} scenes, ${visualPreset} environment, vibe: ${job.vibe_preset})...`);
  
  // DNA-based generation is ALWAYS enabled for guaranteed uniqueness
  // The DNA system tracks component usage and applies rarity boosting + recency penalties
  // to ensure every story has a unique combination of elements
  const useDNA = jobMeta.use_dna !== false; // Only disable if explicitly set to false
  const genreProfile = jobMeta.genre || job.vibe_preset || 'urban_legend';
  
  console.log(`[PREVIEW] ===== GENERATION PATH DEBUG =====`);
  console.log(`[PREVIEW] jobMeta.use_dna = ${jobMeta.use_dna}`);
  console.log(`[PREVIEW] useDNA = ${useDNA}`);
  console.log(`[PREVIEW] job.vibe_preset = ${job.vibe_preset}`);
  console.log(`[PREVIEW] genreProfile = ${genreProfile}`);
  console.log(`[PREVIEW] ===================================`);
  
  // Platform for Visual DNA tuning (v5.0)
  // Can be specified in jobMeta or defaults based on job settings
  const targetPlatform = jobMeta.platform || 'default';
  
  // =====================================================
  // STORY PROFILE RESOLUTION (v1.0)
  // Merge: system -> template -> preset -> brand -> user
  // =====================================================
  const storyMode = jobMeta.story_mode || "auto";
  const niche = jobMeta.theme || "horror"; // Theme maps to niche for template selection
  
  // Resolve the story profile
  const resolvedStoryProfile = resolveStoryProfile({
    // System defaults are built into the resolver
    template: getTemplateDefaults(niche),
    preset: getPresetProfile(job.vibe_preset),
    // Brand-level overrides would come from brand.settings.storyProfile (future)
    user: storyMode === "custom" ? jobMeta.story_profile : undefined,
  });
  
  // Sanitize to ensure valid values
  const storyProfile = sanitizeStoryProfile(resolvedStoryProfile);
  
  console.log(`[STORY-PROFILE] Mode: ${storyMode}, Niche: ${niche}`);
  console.log(`[STORY-PROFILE] ${storyProfileToSummary(storyProfile)}`);
  
  let storyData: { title: string; story: string; hook: string };
  let dnaInfo: { dna: any; visual_dna: any; dna_display: string; visual_dna_display: string } | null = null;
  let storyId: string | null = null;
  let similarityInfo: { similarityScore: number; mostSimilarTitle: string | null; isLikelyUnique: boolean } | null = null;
  let themeGuidance: ThemeGuidance | undefined;
  
  if (useDNA) {
    // === DNA-BASED GENERATION (v5.0 - with Visual DNA sync) ===
    console.log(`[PREVIEW] Using DNA-based generation for guaranteed uniqueness...`);
    console.log(`[PREVIEW] Genre profile: ${genreProfile}`);
    console.log(`[PREVIEW] Target platform: ${targetPlatform}`);
    
    // Build story options from job config
    const storyOptions = {
      story_mode: (job as any).story_mode || 'auto',
      story_profile: (job as any).story_profile,
      niche: (job as any).niche || 'horror',
      vibe_preset: job.vibe_preset || genreProfile,
    };
    
    const dnaResult = await generateStoryWithDNA(
      supabase,
      openaiKey,
      job.length_preset,
      visualPreset,
      genreProfile,
      targetPlatform,
      job_id,
      storyOptions
    );
    
    storyData = {
      title: dnaResult.title,
      story: dnaResult.story,
      hook: dnaResult.hook,
    };
    
    dnaInfo = {
      dna: dnaResult.dna,
      visual_dna: dnaResult.visual_dna,
      dna_display: dnaResult.dna_display,
      visual_dna_display: dnaResult.visual_dna_display,
    };
    
    // Store contract system info
    (dnaInfo as any).story_profile = dnaResult.story_profile;
    (dnaInfo as any).compliance = dnaResult.compliance;
    (dnaInfo as any).contract_summary = dnaResult.contract_summary;
    (dnaInfo as any).generation_method = dnaResult.generation_method;
    (dnaInfo as any).raw_story = dnaResult.raw_story;
    (dnaInfo as any).canonicalization = dnaResult.canonicalization;
    (dnaInfo as any).truncation = dnaResult.truncation;
    
    console.log(`[PREVIEW] DNA story generated: "${storyData.title}"`);
    console.log(`[PREVIEW] Story DNA concept hash: ${dnaResult.dna.concept_hash}`);
    console.log(`[PREVIEW] Visual DNA: ${dnaResult.visual_dna.visual_style} / ${dnaResult.visual_dna.color_palette}`);
    console.log(`[PREVIEW] Generation method: ${dnaResult.generation_method}`);
    if (dnaResult.compliance) {
      console.log(`[PREVIEW] Compliance score: ${dnaResult.compliance.score}`);
    }
    
  } else {
    // === LEGACY GENERATION (with theme guidance) ===
    console.log(`[PREVIEW] Using legacy generation with theme guidance...`);
    
    const uniquenessConfig = await getUniquenessConfig(supabase);
    
    if (uniquenessConfig.uniqueness_enabled) {
      console.log(`[PREVIEW] Theme guidance enabled - fetching recent themes...`);
      themeGuidance = await getThemeGuidance(supabase, visualPreset);
      console.log(`[PREVIEW] Theme direction: ${themeGuidance.bucket} / ${themeGuidance.suggestedTheme}`);
    }
    
    // Generate story with theme guidance (SINGLE API call)
    storyData = await generateStory(
      openaiKey,
      job.vibe_preset,
      job.length_preset,
      visualPreset,
      artStyle,
      themeGuidance // Pass theme guidance to influence the prompt
    );
    
    // Store and analyze the story (for tracking, not rejection)
    if (uniquenessConfig.store_all_stories) {
      const result = await storeAndAnalyzeStory(supabase, storyData, {
        vibe_preset: job.vibe_preset,
        length_preset: job.length_preset,
        visual_preset: visualPreset,
        art_style: artStyle,
        job_id: job_id,
      }, themeGuidance);
      
      storyId = result.storyId;
      similarityInfo = {
        similarityScore: result.similarityScore,
        mostSimilarTitle: result.mostSimilarTitle,
        isLikelyUnique: result.isLikelyUnique,
      };
      console.log(`[PREVIEW] Story stored: ${storyId}, similarity: ${(result.similarityScore * 100).toFixed(1)}%`);
    }
  }

  const wordCount = storyData.story.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);
  
  // Use the story profile from DNA generation if available (most accurate)
  // Otherwise use the pre-resolved profile
  const effectiveStoryProfile = dnaInfo && (dnaInfo as any).story_profile 
    ? (dnaInfo as any).story_profile 
    : storyProfile;

  await updateJob(supabase, job_id, {
    progress: 25,
    title: storyData.title,
    story_text: storyData.story,
    story_word_count: wordCount,
    duration_sec: estimatedDuration,
    // Store Visual DNA and Story Profile in job meta for use in later phases
    meta: {
      ...jobMeta,
      visual_dna: dnaInfo?.visual_dna || null,
      story_dna: dnaInfo?.dna || null,
      // Story Profile for narrative enforcement (from DNA generation or pre-resolved)
      resolved_story_profile: effectiveStoryProfile,
      // Contract system info (if available)
      story_contract: dnaInfo ? {
        generation_method: (dnaInfo as any).generation_method,
        contract_summary: (dnaInfo as any).contract_summary,
        compliance: (dnaInfo as any).compliance,
        raw_story: (dnaInfo as any).raw_story,
      } : null,
    },
  });

  // Save story JSON
  const storyJson = JSON.stringify(storyData, null, 2);
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/story.json`, new Blob([storyJson]), {
      contentType: "application/json",
    });

  // Extract scene keywords for preview - use the user's requested scene count
  console.log(`Extracting scene keywords for ${sceneCount} scenes...`);
  const estimatedScenes = await extractSceneKeywordsForPreview(
    openaiKey,
    storyData.story,
    estimatedDuration,
    job.visual_preset || "forest",
    sceneCount  // Pass user's requested scene count
  );

  // Save scene data (using scene_data type for consistency with audio phase)
  for (let i = 0; i < estimatedScenes.length; i++) {
    const scene = estimatedScenes[i];
    await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "scene_data",
      storage_path: `scene_${i}`,
      meta: { 
        scene_index: i, 
        scene_text: scene.text,
        keywords: scene.keywords,
        start_time: scene.startTime,
        end_time: scene.endTime
      },
    });
  }

  await updateJob(supabase, job_id, { status: "preview", progress: 30 });

  // Count sentences for debug (use same logic as openai.ts)
  const storyNormalized = storyData.story.replace(/\.{2,}/g, '…');
  const sentences = storyNormalized.match(/[^.!?…]+[.!?…]+/g) || [];
  
  // FORCE version marker directly in response (bypass any module caching)
  const BUILD_VERSION = "2026-02-04T12:00:00Z";
  
  // Get configuration details for transparency
  const lengthConfig = LENGTH_CONFIG[job.length_preset as keyof typeof LENGTH_CONFIG] || LENGTH_CONFIG["60"];
  const vibeConfig = VIBE_CONFIG[job.vibe_preset as keyof typeof VIBE_CONFIG] || VIBE_CONFIG["slow_creepy"];
  const artStyleConfig = ART_STYLE_CONFIG[artStyle as keyof typeof ART_STYLE_CONFIG] || ART_STYLE_CONFIG["cinematic-dark"];
  
  // Build the enhanced prompt for display (human-readable version)
  // Use DNA display if available, otherwise build from legacy system
  const storyPrompt = dnaInfo 
    ? dnaInfo.dna_display 
    : buildStoryPromptForDisplay(job.vibe_preset, job.length_preset, visualPreset, artStyle);
  
  return new Response(
    JSON.stringify({
      success: true,
      status: "preview",
      job_id: job_id,
      title: storyData.title,
      story_text: storyData.story,
      word_count: wordCount,
      duration_sec: estimatedDuration,
      // GENERATION DETAILS - What went into creating this story
      generation_details: {
        // Generation method
        generation_method: useDNA ? "dna" : "legacy",
        // User's selections
        vibe_preset: job.vibe_preset,
        vibe_description: vibeConfig,
        length_preset: job.length_preset,
        target_duration_sec: lengthConfig.targetSeconds,
        word_range: `${lengthConfig.minWords}-${lengthConfig.maxWords} words`,
        visual_preset: job.visual_preset || "forest",
        art_style: jobMeta.art_style || "cinematic-dark",
        art_style_name: artStyleConfig.name,
        scene_count: sceneCount,
        image_model: jobMeta.image_model || "gpt-4o",
        // The actual prompt/DNA used
        story_prompt: storyPrompt,
        // Model info
        story_model: "gpt-4o-mini",
        story_temperature: useDNA ? 0.75 : 0.9,
        // Story tracking info
        story_id: storyId,
        // DNA info (if using DNA generation)
        dna: dnaInfo ? {
          genre: dnaInfo.dna.genre,
          concept_hash: dnaInfo.dna.concept_hash,
          era: dnaInfo.dna.era.label,
          location: dnaInfo.dna.location.label,
          states: dnaInfo.dna.specific_states,
          threat_behavior: dnaInfo.dna.threat_behavior.label,
          threat_manifestation: dnaInfo.dna.threat_manifestation.label,
          narrative_artifact: dnaInfo.dna.narrative_artifact.label,
          weird_axis: dnaInfo.dna.weird_axis.id,
          escalation: dnaInfo.dna.escalation.label,
          ending_knowledge: dnaInfo.dna.ending_knowledge.label,
          ending_imagery: dnaInfo.dna.ending_imagery.label,
          generation_attempt: dnaInfo.dna.generation_attempt,
        } : null,
        // Visual DNA info (derived from Story DNA - v5.0)
        visual_dna: dnaInfo?.visual_dna ? {
          visual_style: dnaInfo.visual_dna.visual_style,
          color_palette: dnaInfo.visual_dna.color_palette,
          camera_language: dnaInfo.visual_dna.camera_language,
          motion_profile: dnaInfo.visual_dna.motion_profile,
          lighting_profile: dnaInfo.visual_dna.lighting_profile,
          subject_scale: dnaInfo.visual_dna.subject_scale,
          frame_composition: dnaInfo.visual_dna.frame_composition,
          texture_artifacts: dnaInfo.visual_dna.texture_artifacts,
          platform: dnaInfo.visual_dna.platform,
        } : null,
        // Theme guidance for diversity (legacy)
        theme_guidance: themeGuidance ? {
          bucket: themeGuidance.bucket,
          suggested_theme: themeGuidance.suggestedTheme,
          suggested_setting: themeGuidance.suggestedSetting,
          recent_themes_avoided: themeGuidance.recentThemesAvoided,
        } : null,
        // Similarity tracking (for analytics, not rejection)
        similarity: similarityInfo ? {
          score: similarityInfo.similarityScore,
          most_similar_title: similarityInfo.mostSimilarTitle,
          is_likely_unique: similarityInfo.isLikelyUnique,
        } : null,
        // Story Profile v1.0 - narrative structure settings
        story_profile: {
          version: effectiveStoryProfile.version,
          schema_version: effectiveStoryProfile.schema_version,
          profile_name: effectiveStoryProfile.profile_name,
          profile_source: effectiveStoryProfile.profile_source,
          voice_format: effectiveStoryProfile.voiceFormat.format,
          motif_min_mentions: effectiveStoryProfile.motif.minMentions,
          motif_escalates: effectiveStoryProfile.motif.shouldEscalate,
          beat_count: effectiveStoryProfile.beatStructure.beatCount,
          beat_labels: effectiveStoryProfile.beatStructure.beatLabels,
          anti_closure: effectiveStoryProfile.ending.antiClosure,
          enforce_final_image: effectiveStoryProfile.ending.enforceFinalImage,
          ending_style: effectiveStoryProfile.ending.endingStyle,
          word_target: effectiveStoryProfile.wordCount.target,
          word_variance: effectiveStoryProfile.wordCount.variance,
          grounding_required: effectiveStoryProfile.beatStructure.requireGroundingDetail,
          era_level: effectiveStoryProfile.embodiment.eraLevel,
          output_mode: effectiveStoryProfile.outputMode?.mode ?? 'narrative',
        },
        // Story Contract System v1.0 - compliance tracking
        story_contract: (dnaInfo as any)?.compliance ? {
          generation_method: (dnaInfo as any).generation_method,
          contract_summary: (dnaInfo as any).contract_summary,
          compliance_score: (dnaInfo as any).compliance?.score,
          compliance_passed: (dnaInfo as any).compliance?.passed,
          beats_found: (dnaInfo as any).compliance?.metrics?.beatCount,
          beats_expected: effectiveStoryProfile.beatStructure.beatCount,
          motif_count: (dnaInfo as any).compliance?.metrics?.motifMentions,
          has_final_image: (dnaInfo as any).compliance?.metrics?.hasFinalImage,
          hard_failures: (dnaInfo as any).compliance?.hardFailures || [],
          issues: (dnaInfo as any).compliance?.issues || [],
          canonicalized: (dnaInfo as any).compliance?.canonicalized ?? false,
          canonicalization_notes: (dnaInfo as any).compliance?.canonicalizationNotes || [],
        } : null,
        // Pipeline metadata
        pipeline_metadata: {
          canonicalization: (dnaInfo as any)?.canonicalization ? {
            changed: (dnaInfo as any).canonicalization.changed,
            notes: (dnaInfo as any).canonicalization.notes,
          } : null,
          truncation: (dnaInfo as any)?.truncation ? {
            truncated: (dnaInfo as any).truncation.truncated,
            original_word_count: (dnaInfo as any).truncation.originalWordCount,
            final_word_count: (dnaInfo as any).truncation.finalWordCount,
          } : null,
        },
        // =====================================================
        // STORY DEBUG PAYLOAD v1.0 - Comprehensive debug info
        // =====================================================
        story_debug: dnaInfo ? buildStoryDebugPayload({
          niche: niche,
          vibe_preset: job.vibe_preset || genreProfile,
          story_mode: storyMode as 'auto' | 'custom',
          resolved_profile: effectiveStoryProfile,
          merge_sources: {
            hasTemplate: !!getTemplateDefaults(niche),
            hasPreset: !!getPresetProfile(job.vibe_preset),
            hasBrand: false, // Brand overrides not yet implemented
            hasUser: storyMode === 'custom',
          },
          contract: null, // Contract object not passed to response (too large)
          contract_summary: (dnaInfo as any).contract_summary || '',
          raw_story: (dnaInfo as any).raw_story || storyData.story,
          canonical_story: (dnaInfo as any).canonicalization?.changed 
            ? storyData.story // If canonicalized, the story is the canonical version
            : (dnaInfo as any).raw_story || storyData.story,
          final_story: storyData.story,
          stripped_story: storyData.story, // Tags are stripped in final output
          canonicalization: (dnaInfo as any).canonicalization,
          truncation: (dnaInfo as any).truncation,
          compliance: (dnaInfo as any).compliance,
          generation_method: (dnaInfo as any).generation_method || 'legacy_fallback',
          repair_attempted: (dnaInfo as any).generation_method === 'contract_repaired',
          repair_succeeded: (dnaInfo as any).generation_method === 'contract_repaired' && (dnaInfo as any).compliance?.passed,
          // v2.0: Pass word range and count check info
          repair_reasons: (dnaInfo as any).repair_reasons,
          post_fixes_applied: (dnaInfo as any).post_fixes_applied,
          final_source_text: (dnaInfo as any).final_source_text,
          word_range: (dnaInfo as any).word_range,
          word_count_check: (dnaInfo as any).word_count_check,
          // v2.1: Pass fallback autopsy fields
          fallback_reason: (dnaInfo as any).fallback_reason,
          contract_error: (dnaInfo as any).contract_error,
          contract_attempts: (dnaInfo as any).contract_attempts,
          best_contract_attempt: (dnaInfo as any).best_contract_attempt,
        }) : buildMinimalDebugPayload(niche, job.vibe_preset || 'unknown'),
        // Visual Readiness Analysis v2.1 - Use BEST available tagged text
        // Priority: best_contract_attempt.raw_with_tags > raw_story > storyData.story
        // Now uses profile-driven severity rules
        visual_readiness: (() => {
          // Determine best text source with tags for visual readiness
          let textForAnalysis = storyData.story; // Default: stripped
          let inputSource: 'canonical_with_tags' | 'raw_with_tags' | 'stripped' | 'unknown' | 'best_contract_attempt' = 'stripped';
          
          // Priority 1: best_contract_attempt.raw_with_tags (even if fallback occurred)
          if ((dnaInfo as any)?.best_contract_attempt?.raw_with_tags && 
              (dnaInfo as any)?.best_contract_attempt?.had_beat_tags) {
            textForAnalysis = (dnaInfo as any).best_contract_attempt.raw_with_tags;
            inputSource = 'best_contract_attempt';
            console.log(`[VISUAL-READINESS] Using best_contract_attempt (${(dnaInfo as any).best_contract_attempt.beat_count} beats)`);
          }
          // Priority 2: raw_story (current output with tags)
          else if ((dnaInfo as any)?.raw_story) {
            textForAnalysis = (dnaInfo as any).raw_story;
            inputSource = 'raw_with_tags';
          }
          
          // Get visual readiness severity config from profile (if available)
          const severityConfig = effectiveStoryProfile?.visualReadiness || undefined;
          
          return analyzeVisualReadiness(
            textForAnalysis,
            niche,
            (dnaInfo as any)?.compliance?.metrics?.groundingPerBeat,
            inputSource,
            severityConfig
          );
        })(),
      },
      // SCENE ANALYSIS - helps user understand scene distribution
      scene_analysis: {
        total_scenes: estimatedScenes.length,
        total_words: wordCount,
        avg_words_per_scene: Math.round(wordCount / estimatedScenes.length),
        recommended_max_scenes: Math.floor(wordCount / 15),
        // Scene count mode determines if fusion is applied
        scene_count_mode: jobMeta.scene_count_mode || 'strict',
        // Fusion estimate: scenes will be merged in audio phase if mode is 'auto' AND avg words < 12
        expected_after_fusion: (() => {
          const mode = jobMeta.scene_count_mode || 'strict';
          if (mode === 'strict') {
            return estimatedScenes.length; // Strict mode: no fusion
          }
          const avgWords = wordCount / estimatedScenes.length;
          if (avgWords < 12) {
            // Estimate fusion: target ~18 words/scene (midpoint of 12-24 range)
            const fusedCount = Math.max(Math.round(wordCount / 18), 1);
            return fusedCount;
          }
          return estimatedScenes.length; // No fusion expected
        })(),
        fusion_will_apply: (jobMeta.scene_count_mode || 'strict') === 'auto' && (wordCount / estimatedScenes.length) < 12,
        sentence_count: sentences.length,
        distribution_mode: sentences.length >= estimatedScenes.length ? "sentence-group" : "sentence-stretch",
        warnings: (() => {
          const warnings: string[] = [];
          const mode = jobMeta.scene_count_mode || 'strict';
          const avgWords = wordCount / estimatedScenes.length;
          if (mode === 'strict') {
            // In strict mode, warn but don't promise fusion
            if (avgWords < 8) warnings.push(`⚠️ ${estimatedScenes.length} scenes have < 8 words avg - consider reducing scene count`);
            else if (avgWords < 12) warnings.push(`ℹ️ Low words/scene (${Math.round(avgWords)}). Consider scene_count_mode: 'auto' for fusion.`);
          } else {
            // Auto mode warnings about fusion
            if (avgWords < 8) warnings.push(`⚠️ ${estimatedScenes.length} scenes have < 8 words avg - will be fused to ~${Math.max(Math.round(wordCount / 18), 1)} scenes after audio phase`);
            else if (avgWords < 12) warnings.push(`ℹ️ Scenes will be fused to ~${Math.max(Math.round(wordCount / 18), 1)} for better visual coherence (${Math.round(avgWords)} words/scene → ~18)`);
          }
          if (estimatedScenes.length > Math.floor(wordCount / 15)) warnings.push(`⚠️ Too many scenes (${estimatedScenes.length}) for story length (~${wordCount} words). Recommend ≤ ${Math.floor(wordCount / 15)} scenes.`);
          return warnings;
        })(),
      },
      // DEBUG INFO - will appear in browser console
      _debug: {
        version: "v4.0",
        build: BUILD_VERSION,
        requested_scenes: sceneCount,
        actual_scenes_returned: estimatedScenes.length,
        sentence_count: sentences.length,
        algorithm: sentences.length >= estimatedScenes.length ? "sentence-group" : "sentence-stretch",
        first_scene_text: estimatedScenes[0]?.text?.substring(0, 80),
        last_scene_text: estimatedScenes[estimatedScenes.length - 1]?.text?.substring(0, 80),
        empty_scene_count: estimatedScenes.filter(s => !s.text || s.text.trim() === '').length,
      },
      scenes: estimatedScenes.map((s, i) => ({
        index: i,
        text: s.text,
        keywords: s.keywords,
        startTime: s.startTime,
        endTime: s.endTime,
        word_count: s.text.split(/\s+/).length,
        // Image prompt will be populated after image generation
        image_prompt: null, // Placeholder - actual prompt shown after generation
      })),
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
}

// =====================================================
// PHASE 1: Generate Audio
// =====================================================
export async function runAudioPhase(
  supabase: any,
  openaiKey: string,
  elevenLabsKey: string,
  job: any,
  job_id: string,
  jobMeta: any
): Promise<{ status: string; nextPhase: string; message: string }> {
  console.log(`[AUDIO] Starting audio phase for job ${job_id}`);
  
  // Get story (should exist from preview)
  let storyData: { title: string; story: string };
  if (job.story_text && job.title) {
    storyData = { title: job.title, story: job.story_text };
  } else {
    console.log(`[AUDIO] No story found - generating with DNA system...`);
    
    const visualPreset = job.visual_preset || "forest";
    const artStyle = jobMeta.art_style || "cinematic-dark";
    
    // =====================================================
    // DNA-BASED GENERATION (Same as preview mode)
    // This ensures audio phase also gets counting horror, etc.
    // =====================================================
    const useDNA = jobMeta.use_dna !== false;
    const genreProfile = jobMeta.genre || job.vibe_preset || 'urban_legend';
    const targetPlatform = jobMeta.platform || 'default';
    
    console.log(`[AUDIO] Generation path: ${useDNA ? 'DNA' : 'legacy'}, genre: ${genreProfile}`);
    
    if (useDNA) {
      // DNA-based generation for guaranteed uniqueness and preset compliance
      const storyOptions = {
        story_mode: jobMeta.story_mode || 'auto',
        story_profile: jobMeta.story_profile,
        niche: jobMeta.theme || 'horror',
        vibe_preset: job.vibe_preset || genreProfile,
      };
      
      const dnaResult = await generateStoryWithDNA(
        supabase,
        openaiKey,
        job.length_preset,
        visualPreset,
        genreProfile,
        targetPlatform,
        job_id,
        storyOptions
      );
      
      storyData = {
        title: dnaResult.title,
        story: dnaResult.story,
      };
      
      // Store DNA info in job meta for later phases
      const updatedMeta = {
        ...jobMeta,
        visual_dna: dnaResult.visual_dna || null,
        story_dna: dnaResult.dna || null,
        story_contract: {
          generation_method: dnaResult.generation_method,
          contract_summary: dnaResult.contract_summary,
          compliance: dnaResult.compliance,
        },
      };
      
      // CRITICAL: Update local jobMeta reference so later spreads include DNA info
      Object.assign(jobMeta, updatedMeta);
      
      await updateJob(supabase, job_id, {
        progress: 25,
        title: storyData.title,
        story_text: storyData.story,
        meta: updatedMeta,
      });
      
      console.log(`[AUDIO] DNA story generated: "${storyData.title}" (method: ${dnaResult.generation_method})`);
      
    } else {
      // Legacy fallback (only if DNA explicitly disabled)
      const uniquenessConfig = await getUniquenessConfig(supabase);
      
      let themeGuidance: ThemeGuidance | undefined;
      if (uniquenessConfig.uniqueness_enabled) {
        console.log(`[AUDIO] Getting theme guidance for diversity...`);
        themeGuidance = await getThemeGuidance(supabase, visualPreset);
      }
      
      const generatedStory = await generateStory(
        openaiKey,
        job.vibe_preset,
        job.length_preset,
        visualPreset,
        artStyle,
        themeGuidance
      );
      
      storyData = {
        title: generatedStory.title,
        story: generatedStory.story,
      };
      
      if (uniquenessConfig.store_all_stories) {
        const result = await storeAndAnalyzeStory(supabase, generatedStory, {
          vibe_preset: job.vibe_preset,
          length_preset: job.length_preset,
          visual_preset: visualPreset,
          art_style: artStyle,
          job_id: job_id,
        }, themeGuidance);
        console.log(`[AUDIO] Story stored, similarity: ${(result.similarityScore * 100).toFixed(1)}%`);
      }
      
      await updateJob(supabase, job_id, {
        progress: 25,
        title: storyData.title,
        story_text: storyData.story,
      });
      
      console.log(`[AUDIO] Legacy story generated: "${storyData.title}"`);
    }
  }

  const wordCount = storyData.story.split(/\s+/).length;
  const estimatedDuration = Math.round((wordCount / 150) * 60);

  // Generate audio
  console.log("[AUDIO] Generating audio with word timestamps...");
  await updateJob(supabase, job_id, { progress: 30 });

  const audioResult = await generateAudio(
    elevenLabsKey,
    storyData.story,
    job.voice_id || ELEVENLABS_VOICE_ID
  );

  const actualDuration = audioResult.actualDuration || estimatedDuration;
  
  await updateJob(supabase, job_id, {
    progress: 45,
    duration_sec: actualDuration,
  });

  // Save captions
  const captionsData = { captions: audioResult.wordTimestamps };
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/captions.json`, new Blob([JSON.stringify(captionsData)]), {
      contentType: "application/json",
      upsert: true,
    });

  // Upload audio
  await supabase.storage
    .from("story-videos")
    .upload(`${job_id}/audio.mp3`, audioResult.audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  // Extract scene keywords with actual timestamps
  const userRequestedSceneCount = jobMeta.scene_count || 4;
  const storyWordCount = storyData.story.split(/\s+/).filter((w: string) => w.length > 0).length;
  const durationSec = jobMeta.duration || 60;
  const sceneCountMode = jobMeta.scene_count_mode || 'strict';  // Check mode BEFORE any scene count decisions
  
  console.log(`[AUDIO] Story analysis: ${storyWordCount} words, ${durationSec}s duration`);
  console.log(`[AUDIO] 🎯 scene_count_mode: ${sceneCountMode}`);
  console.log(`[AUDIO] 🎯 User requested scene count: ${userRequestedSceneCount}`);
  
  // Calculate recommended scene count to avoid micro-fragmentation
  const recommendation = calculateRecommendedSceneCount(storyWordCount, durationSec, 'reels');
  console.log(`[AUDIO] Recommended scenes: ${recommendation.min}-${recommendation.max}, optimal: ${recommendation.recommended}`);
  if (recommendation.warning) {
    console.warn(`[AUDIO] ⚠️ ${recommendation.warning}`);
  }
  
  // CRITICAL FIX: In STRICT mode, use user's exact request - NO CLAMPING
  // In AUTO mode, clamp to recommended range to avoid micro-fragmentation
  let targetSceneCount: number;
  if (sceneCountMode === 'strict') {
    targetSceneCount = userRequestedSceneCount;
    console.log(`[AUDIO] 🔒 STRICT mode: Using exact user request: ${targetSceneCount} scenes (ignoring recommendation)`);
    if (userRequestedSceneCount > recommendation.max) {
      console.warn(`[AUDIO] ⚠️ Warning: ${userRequestedSceneCount} scenes may result in micro-scenes (avg ${(storyWordCount / userRequestedSceneCount).toFixed(1)} words/scene)`);
    }
  } else {
    targetSceneCount = Math.min(Math.max(userRequestedSceneCount, recommendation.min), recommendation.max);
    if (targetSceneCount !== userRequestedSceneCount) {
      console.log(`[AUDIO] 🔄 AUTO mode: Adjusted scene count: ${userRequestedSceneCount} → ${targetSceneCount} (clamped to avoid micro-scenes)`);
    } else {
      console.log(`[AUDIO] 🔄 AUTO mode: Using ${targetSceneCount} scenes (within recommended range)`);
    }
  }
  
  console.log(`[AUDIO] Extracting scene keywords (target: ${targetSceneCount} scenes)...`);
  const rawScenes = await extractSceneKeywords(
    openaiKey,
    storyData.story,
    audioResult.wordTimestamps,
    job.visual_preset || "forest",
    targetSceneCount
  );
  
  // Apply Scene Coherence Layer - fuse micro-scenes (ONLY if mode is 'auto')
  // sceneCountMode already checked above, no need to re-read
  let coherentScenes: typeof rawScenes & { word_count: number; source_scene_indices: number[]; fusion_reason?: string }[];
  
  if (sceneCountMode === 'strict') {
    // STRICT MODE: No fusion, keep exact scene count
    console.log(`[AUDIO] 🔒 Strict mode: keeping ${rawScenes.length} scenes (fusion disabled)`);
    coherentScenes = rawScenes.map((s, i) => ({
      ...s,
      word_count: s.text.split(/\s+/).filter((w: string) => w.length > 0).length,
      source_scene_indices: [i],
    }));
  } else {
    // AUTO MODE: Apply fusion for coherence
    console.log(`[AUDIO] 🔄 Auto mode: applying scene fusion for coherence`);
    coherentScenes = fuseIntoCoherentScenes(rawScenes, storyWordCount);
  }
  const scenes = coherentScenes; // Use scenes going forward
  
  // Log fusion results (only relevant for auto mode)
  const fusedCount = coherentScenes.filter(s => s.source_scene_indices.length > 1).length;
  if (fusedCount > 0 && sceneCountMode === 'auto') {
    console.log(`[AUDIO] ✨ Scene fusion: ${rawScenes.length} → ${coherentScenes.length} scenes (${fusedCount} merges)`);
  }
  
  // Warn if still problematic
  const avgWords = storyWordCount / scenes.length;
  if (avgWords < 8) {
    console.warn(`[AUDIO] ⚠️ CRITICAL: Average ${avgWords.toFixed(1)} words/scene is too low for visual coherence!`);
  } else if (avgWords < 12) {
    console.warn(`[AUDIO] ⚠️ Average ${avgWords.toFixed(1)} words/scene is below optimal (12+)`);
  }

  // Save scenes to job_assets
  console.log(`[AUDIO] Saving ${scenes.length} coherent scenes to database...`);
  for (let i = 0; i < scenes.length; i++) {
    // Delete existing scene_data for this index first (in case of retry)
    await supabase.from("job_assets")
      .delete()
      .eq("job_id", job_id)
      .eq("type", "scene_data")
      .eq("storage_path", `scene_${i}`);
    
    const { error: sceneError } = await supabase.from("job_assets").insert({
      job_id: job_id,
      type: "scene_data",
      storage_path: `scene_${i}`,
      meta: { 
        scene_index: i, 
        scene_text: scenes[i].text,
        keywords: scenes[i].keywords,
        start_time: scenes[i].startTime,
        end_time: scenes[i].endTime,
        word_count: coherentScenes[i].word_count,
        source_scene_indices: coherentScenes[i].source_scene_indices,
        fusion_reason: coherentScenes[i].fusion_reason || null,
      },
    });
    
    if (sceneError) {
      console.error(`[AUDIO] Failed to save scene ${i}:`, sceneError);
    } else {
      console.log(`[AUDIO] ✓ Scene ${i} saved (${coherentScenes[i].word_count} words)`);
    }
  }

  // Update job meta with coherent scene count (may differ from user request in auto mode)
  const fusionApplied = scenes.length !== userRequestedSceneCount;
  await updateJob(supabase, job_id, { 
    progress: 50,
    meta: { 
      ...jobMeta, 
      audio_ready: true, 
      scenes_created: scenes.length,
      scene_count_original_request: userRequestedSceneCount,
      scene_count_after_fusion: scenes.length,
      // CANONICAL: Use scene_count_final for all downstream consumers
      scene_count_final: scenes.length,
      scene_count_mode: sceneCountMode,
      fusion_applied: fusionApplied && sceneCountMode === 'auto',
      story_word_count: storyWordCount,
      avg_words_per_scene: avgWords,
    }
  });

  console.log(`[AUDIO] Audio phase complete, ${scenes.length} coherent scenes ready`);
  console.log(`[AUDIO] Scene stats: ${storyWordCount} words / ${scenes.length} scenes = ${avgWords.toFixed(1)} words/scene`);
  
  return { status: "generating", nextPhase: "images", message: "Audio ready, starting images" };
}

// =====================================================
// PHASE 2: Generate Images (one at a time for reliability)
// =====================================================
export async function runImagesPhase(
  supabase: any,
  openaiKey: string,
  pexelsKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  visualSource: string,
  artStyle: string,
  customStyle: any,
  imageModel?: string | null  // Optional: specific model selection from job
): Promise<{ status: string; nextPhase: string; message: string }> {
  console.log(`[IMAGES] Starting images phase for job ${job_id}`);
  
  // =====================================================
  // ART STYLE PRESET OVERRIDE (v5.7 - ALWAYS FORCE)
  // =====================================================
  // Force specific art styles for certain presets to maintain visual identity
  // v5.7: ALWAYS force uncanny-illustrated for one_too_many, regardless of 
  // what art style was passed. This ensures Visual DNA is suppressed.
  let effectiveArtStyle = artStyle;
  if (job.vibe_preset === 'one_too_many') {
    // One Too Many MUST ALWAYS use uncanny-illustrated to avoid photorealism
    // This also triggers Visual DNA suppression in buildFinalDallePrompt
    if (artStyle !== 'uncanny-illustrated') {
      console.log(`[IMAGES] ⚡ FORCING art style override: one_too_many preset forces 'uncanny-illustrated' (was '${artStyle}')`);
    }
    effectiveArtStyle = 'uncanny-illustrated';
  }
  // Use the effective art style from here on
  artStyle = effectiveArtStyle;
  
  // =====================================================
  // LEASE-BASED LOCK CHECK
  // =====================================================
  // Re-fetch job meta to get the LATEST state (not stale from caller)
  const { data: freshJob, error: fetchError } = await supabase
    .from("jobs")
    .select("meta")
    .eq("id", job_id)
    .single();
  
  if (fetchError) {
    console.error(`[IMAGES] Failed to fetch job:`, fetchError);
    throw new Error("Failed to fetch job for images phase");
  }
  
  const freshMeta = freshJob?.meta || {};
  // CRITICAL: Lease must be SHORTER than edge function wall clock limit (~60s)
  // If function gets hard-killed, lease expires and next poll can retry
  // Prep work (story anchor, visual beats, contracts) is now done in audio phase,
  // so images phase only does image generation
  const leaseMs = 75 * 1000; // 75 seconds - just over edge function timeout
  const now = Date.now();
  const existingLease = new Date(freshMeta.images_phase_lease_until || 0).getTime();
  
  // If another instance has an active lease, exit immediately
  if (freshMeta.images_phase_running && existingLease > now) {
    const remaining = Math.round((existingLease - now) / 1000);
    console.log(`[IMAGES] ⚠️ BLOCKED - Another instance has active lease (${remaining}s remaining). Exiting.`);
    return { status: "generating", nextPhase: "images", message: "Images phase already in progress" };
  }
  
  // Acquire lease (simple update - the check above handles race conditions well enough)
  const leaseUntil = new Date(now + leaseMs).toISOString();
  const { error: lockError } = await supabase
    .from("jobs")
    .update({ 
      meta: { 
        ...freshMeta, 
        images_phase_running: true,
        images_phase_lease_until: leaseUntil,
        images_phase_started_at: new Date().toISOString()
      }
    })
    .eq("id", job_id);
  
  if (lockError) {
    console.error(`[IMAGES] Failed to acquire lock:`, lockError);
    return { status: "generating", nextPhase: "images", message: "Lock acquisition failed" };
  }
  
  console.log(`[IMAGES] ✓ Lock acquired, lease until ${leaseUntil}`);
  
  // CRITICAL: Preserve scene_count from original jobMeta parameter
  // The freshMeta from DB might not have it if it wasn't saved properly
  const originalSceneCount = jobMeta.scene_count;
  
  // Update jobMeta to use our freshly locked state, but preserve scene_count
  jobMeta = { 
    ...freshMeta, 
    images_phase_running: true, 
    images_phase_lease_until: leaseUntil,
    // Preserve scene_count: use original param > freshMeta > default 4
    scene_count: originalSceneCount || freshMeta.scene_count || 4
  };
  
  console.log(`[IMAGES] Scene count: ${jobMeta.scene_count} (original: ${originalSceneCount}, db: ${freshMeta.scene_count})`);
  
  const resolvedImageModel = getImageModel(imageModel || undefined);
  
  // Log model selection for debugging
  console.log(`[IMAGES] 🔧 Model selection debug:`);
  console.log(`[IMAGES]   - imageModel param: ${imageModel}`);
  console.log(`[IMAGES]   - jobMeta.image_model: ${jobMeta.image_model}`);
  console.log(`[IMAGES]   - ENV IMAGE_MODEL: ${Deno.env.get("IMAGE_MODEL")}`);
  console.log(`[IMAGES]   - Resolved to: ${resolvedImageModel}`);
  
  // Store generation logs in job meta for frontend debug panel
  const generationLogs: string[] = jobMeta.generation_logs || [];
  generationLogs.push(`[${new Date().toISOString()}] Image model: ${resolvedImageModel} (param: ${imageModel || 'null'}, meta: ${jobMeta.image_model || 'null'})`);

  // Update progress to show images phase started
  await updateJob(supabase, job_id, {
    progress: 55,
    meta: { 
      ...jobMeta, 
      resolved_image_model: resolvedImageModel,
      generation_logs: generationLogs,
    }
  });
  
  // Get scene data
  const { data: sceneAssets } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "scene_data")
    .order("meta->scene_index", { ascending: true });

  let scenes: StoryScene[];
  
  if (!sceneAssets || sceneAssets.length === 0) {
    console.log("[IMAGES] No scene data found, creating from story text...");
    
    // Fallback: create scenes from story text
    if (!job.story_text) {
      throw new Error("No scene data and no story text. Run audio phase first.");
    }
    
    // Split story into scenes - USE REQUESTED SCENE COUNT
    const sentences = job.story_text.match(/[^.!?]+[.!?]+/g) || [job.story_text];
    const requestedSceneCount = jobMeta.scene_count || 4;
    const sceneCount = Math.min(requestedSceneCount, sentences.length); // Don't exceed sentence count
    const sentencesPerScene = Math.ceil(sentences.length / sceneCount);
    const duration = job.duration_sec || 60;
    const sceneDuration = duration / sceneCount;
    
    console.log(`[IMAGES] Fallback scene creation: ${sentences.length} sentences -> ${sceneCount} scenes (requested: ${requestedSceneCount})`);
    
    scenes = [];
    for (let i = 0; i < sceneCount; i++) {
      const start = i * sentencesPerScene;
      const end = Math.min(start + sentencesPerScene, sentences.length);
      const sceneText = sentences.slice(start, end).join(' ').trim();
      
      scenes.push({
        text: sceneText,
        keywords: [],
        startTime: i * sceneDuration,
        endTime: (i + 1) * sceneDuration,
        videoUrl: "",
      });
    }
    
    console.log(`[IMAGES] Created ${scenes.length} scenes from story text`);
  } else {
    // Convert from database format
    scenes = sceneAssets.map((a: any) => ({
      text: a.meta.scene_text,
      keywords: a.meta.keywords || [],
      startTime: a.meta.start_time,
      endTime: a.meta.end_time,
      videoUrl: "",
    }));
    console.log(`[IMAGES] Loaded ${scenes.length} scenes from database`);
  }

  // Get the target scene count - PRIORITIZE fused count from audio phase
  // This ensures we generate all scenes that fusion created, not the original request
  const fusedSceneCount = jobMeta.scene_count_final || jobMeta.scene_count_after_fusion || jobMeta.scenes_created;
  const requestedSceneCount = jobMeta.scene_count || 4;
  const actualSceneCount = scenes.length;
  
  // If fusion was applied, use fused count. Otherwise fall back to original request
  const targetSceneCount = fusedSceneCount || requestedSceneCount;
  
  console.log(`[IMAGES] Scene count check: db=${actualSceneCount}, fused=${fusedSceneCount}, requested=${requestedSceneCount}, target=${targetSceneCount}`);
  
  // Only limit if we have MORE scenes than expected (rare - usually from retry/race condition)
  // But NEVER reduce below fused count - that's our single source of truth
  if (actualSceneCount > targetSceneCount) {
    console.log(`[IMAGES] WARNING: Found ${actualSceneCount} scenes but target is ${targetSceneCount}. Limiting to target count.`);
    scenes = scenes.slice(0, targetSceneCount);
  } else if (actualSceneCount < targetSceneCount) {
    console.log(`[IMAGES] NOTE: Only ${actualSceneCount} scenes exist (target: ${targetSceneCount}). Will generate all ${actualSceneCount}.`);
  }
  
  // After potential trimming, scenes.length is our actual target
  const finalSceneCount = scenes.length;
  console.log(`[IMAGES] Target: ${finalSceneCount} images`);

  // Check how many images already generated
  const { data: existingImages } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", job_id)
    .eq("type", "dalle_image");

  const imagesGenerated = existingImages?.length || 0;
  console.log(`[IMAGES] ${imagesGenerated}/${scenes.length} images already generated, using model: ${resolvedImageModel}`);

  if (imagesGenerated >= scenes.length) {
    // All images done
    await updateJob(supabase, job_id, { progress: 70 });
    return { status: "generating", nextPhase: "assemble", message: "All images ready" };
  }

  // Generate images based on source
  // Support both legacy "dalle" and new "ai" visual source
  if (visualSource === "dalle" || visualSource === "ai") {
    // AI IMAGE GENERATION: Generate ONE image at a time for reliability
    // This way if we timeout, we've at least saved some images
    
    // Get art style config
    let styleConfig;
    if (artStyle.startsWith('custom-') && customStyle) {
      styleConfig = {
        name: customStyle.name || "Custom Style",
        basePrompt: customStyle.basePrompt || "",
      };
    } else {
      styleConfig = ART_STYLE_CONFIG[artStyle] || ART_STYLE_CONFIG["cinematic-dark"];
    }
    
    // ========== INCREMENTAL PREP WORK ==========
    // Do ONE prep step per function call to avoid timeout
    // Each step is cached, so next call continues where we left off
    
    // STEP 1: Story Anchor
    let storyAnchor = jobMeta.story_anchor;
    if (!storyAnchor) {
      console.log("[IMAGES] PREP STEP 1/3: Creating Story Anchor...");
      const storyText = job.story_text || scenes.map(s => s.text).join(" ");
      storyAnchor = await createStoryAnchor(openaiKey, storyText, job.visual_preset || "forest", artStyle, customStyle);
      
      // Save anchor to meta and RELEASE LOCK - let next call do the next step
      await updateJob(supabase, job_id, { 
        meta: { 
          ...jobMeta, 
          story_anchor: storyAnchor,
          images_phase_running: false, // CRITICAL: Release the running flag!
          images_phase_lease_until: new Date(0).toISOString() // Release lock
        }
      });
      console.log("[IMAGES] Story Anchor created. Releasing lock for next prep step.");
      return { status: "generating", nextPhase: "images", message: "Story anchor ready, continuing prep..." };
    }
    
    // STEP 2: Visual Beats
    let visualBeats = jobMeta.visual_beats;
    if (!visualBeats) {
      console.log("[IMAGES] PREP STEP 2/3: Creating visual beats...");
      visualBeats = await createVisualBeats(openaiKey, scenes, storyAnchor);
      
      // Save beats and RELEASE LOCK - let next call do the next step
      await updateJob(supabase, job_id, { 
        meta: { 
          ...jobMeta, 
          story_anchor: storyAnchor, 
          visual_beats: visualBeats,
          images_phase_running: false, // CRITICAL: Release the running flag!
          images_phase_lease_until: new Date(0).toISOString() // Release lock
        }
      });
      console.log("[IMAGES] Visual beats created. Releasing lock for next prep step.");
      return { status: "generating", nextPhase: "images", message: "Visual beats ready, continuing prep..." };
    }
    
    // STEP 3: Visual Contracts
    let visualContracts = jobMeta.visual_contracts;
    if (!visualContracts) {
      console.log("[IMAGES] PREP STEP 3/3: Creating visual contracts (prose → literal frames)...");
      visualContracts = await createSceneVisualContracts(openaiKey, scenes, storyAnchor, visualBeats);
      
      // ========== GROUP COUNT INJECTION (One Too Many preset) ==========
      // If the story DNA has counting_horror data, inject group counts into contracts
      const storyDNA = jobMeta.story_dna;
      const countingHorror = storyDNA?.counting_horror;
      if (countingHorror && job.vibe_preset === 'one_too_many') {
        console.log(`[IMAGES] Injecting group counts for One Too Many preset...`);
        visualContracts = injectGroupCountsIntoContracts(visualContracts, scenes, countingHorror);
      }
      
      // ========== ALIGNMENT SELF-CHECK ==========
      // Verify contracts align with narration before proceeding
      const alignmentCheck = runAlignmentCheck(scenes, visualContracts);
      console.log(`[IMAGES] ${alignmentCheck.summary}`);
      
      // Save alignment stats to job meta for debugging
      const alignmentStats = {
        overall_score: alignmentCheck.overallScore,
        scenes_needing_repair: alignmentCheck.needsRepair,
        excellent_count: alignmentCheck.sceneResults.filter(r => r.score >= 0.8).length,
        poor_count: alignmentCheck.sceneResults.filter(r => r.score < 0.4).length,
        checked_at: new Date().toISOString(),
      };
      
      // Attach contracts to beats
      for (let i = 0; i < visualBeats.length; i++) {
        if (visualContracts[i]) {
          visualBeats[i].visualContract = visualContracts[i];
        }
      }
      
      // Save contracts and RELEASE LOCK - let next call generate images
      await updateJob(supabase, job_id, { 
        meta: { 
          ...jobMeta, 
          story_anchor: storyAnchor, 
          visual_beats: visualBeats, 
          visual_contracts: visualContracts,
          alignment_stats: alignmentStats,
          images_phase_running: false, // CRITICAL: Release the running flag!
          images_phase_lease_until: new Date(0).toISOString() // Release lock
        }
      });
      console.log(`[IMAGES] Visual contracts created: ${visualContracts.length}. Releasing lock for image generation.`);
      return { status: "generating", nextPhase: "images", message: "All prep done, ready to generate images..." };
    }
    
    // All prep done - re-attach contracts to beats from cache
    for (let i = 0; i < visualBeats.length; i++) {
      if (visualContracts[i]) {
        visualBeats[i].visualContract = visualContracts[i];
      }
    }
    console.log("[IMAGES] All prep work cached, proceeding to image generation...");
    
    await updateJob(supabase, job_id, { progress: 62 });
    
    // =====================================================
    // PARALLEL IMAGE GENERATION (via FFmpeg server)
    // Much faster: 4-6 images at once instead of 1-at-a-time
    // =====================================================
    const useParallelGeneration = canUseParallelImageGeneration() && imagesGenerated === 0;
    
    if (useParallelGeneration) {
      console.log("[IMAGES] 🚀 Using PARALLEL image generation via FFmpeg server");
      
      // Check if we already started a parallel job
      const existingImageJobId = jobMeta.parallel_image_job_id;
      
      if (existingImageJobId) {
        // Poll existing parallel job
        console.log(`[IMAGES] Checking existing parallel job: ${existingImageJobId}`);
        
        try {
          const status = await checkParallelImageStatus(existingImageJobId);
          
          if (status.status === 'processing') {
            // Still processing - release lock but keep parallel_image_in_progress to prevent re-triggers
            console.log(`[IMAGES] Parallel job in progress: ${status.completed}/${status.total} complete`);
            await updateJobMeta(supabase, job_id, (meta) => ({
              ...meta,
              images_phase_running: false,
              parallel_image_in_progress: true, // Keep this flag to prevent duplicate triggers
              images_phase_lease_until: new Date(0).toISOString(),
              parallel_last_status: status.completed, // Track progress for UI
              generation_logs: [
                ...(meta.generation_logs || []),
                `[${new Date().toISOString()}] Parallel generation: ${status.completed}/${status.total} images complete`
              ]
            }));
            return { 
              status: "generating", 
              nextPhase: "images", 
              message: `Parallel: ${status.completed}/${status.total} images` 
            };
          }
          
          if (status.status === 'complete' || status.status === 'partial') {
            // Job done - save images to database
            console.log(`[IMAGES] Parallel job complete: ${status.completed}/${status.total} images`);
            console.log(`[IMAGES] Expected scene count: ${scenes.length}`);
            
            for (const img of status.images) {
              if (img.success && img.url) {
                // CRITICAL: Only accept images for valid scene indices
                // Reject any indices outside our expected scene range
                const sceneIndex = img.index;
                if (sceneIndex < 0 || sceneIndex >= scenes.length) {
                  console.warn(`[IMAGES] ⚠️ Rejecting image with invalid scene_index ${sceneIndex} (expected 0-${scenes.length - 1})`);
                  continue;
                }
                
                // Check if already saved (idempotency)
                const { data: existing } = await supabase
                  .from("job_assets")
                  .select("id")
                  .eq("job_id", job_id)
                  .eq("type", "dalle_image")
                  .eq("meta->>scene_index", String(sceneIndex))
                  .maybeSingle();
                
                if (!existing) {
                  // Use OUR scene data for core fields, but prefer parallel server meta for generated fields
                  const scene = scenes[sceneIndex];
                  const beat = visualBeats[sceneIndex] || {
                    sceneIndex: sceneIndex,
                    visualBeat: scene.text.substring(0, 100),
                    cameraAngle: "medium shot",
                    focus: "the atmosphere",
                    moodLevel: 5,
                  };
                  
                  // Parallel server returns the prompt as dalle_prompt in meta
                  const savedPrompt = img.meta?.dalle_prompt || '';
                  
                  // v5.6: Determine if Visual DNA was suppressed (uncanny-illustrated mode)
                  const isUncannyIllustrated = artStyle === 'uncanny-illustrated';
                  const visualDNASuppressed = isUncannyIllustrated && !!visualDNA;
                  
                  await supabase.from("job_assets").insert({
                    job_id: job_id,
                    type: "dalle_image",
                    storage_path: img.url,
                    public_url: img.url,
                    meta: {
                      scene_index: sceneIndex,
                      scene_text: scene.text,
                      keywords: img.meta?.keywords || scene.keywords || [],
                      start_time: scene.startTime,
                      end_time: scene.endTime,
                      source: "parallel",
                      image_model: img.meta?.image_model || resolvedImageModel || "unknown",
                      art_style: img.meta?.art_style || styleConfig.name || "Unknown",
                      // v5.6: Art style override and config details
                      art_style_override: isUncannyIllustrated ? 'uncanny-illustrated' : null,
                      style_config: {
                        name: styleConfig.name,
                        basePrompt_preview: (styleConfig.basePrompt || '').substring(0, 100),
                        colorOverride_preview: (styleConfig.colorOverride || '').substring(0, 80),
                        technicalStyle_preview: (styleConfig.technicalStyle || '').substring(0, 80),
                      },
                      dalle_prompt: savedPrompt,
                      // PROMPT VERIFICATION FIELDS (Ground Truth from parallel server)
                      prompt_final: savedPrompt,
                      prompt_len: img.meta?.prompt_len || savedPrompt.length || 0,
                      prompt_preview_start: img.meta?.prompt_preview_start || savedPrompt.substring(0, 300),
                      prompt_preview_end: img.meta?.prompt_preview_end || savedPrompt.substring(Math.max(0, savedPrompt.length - 200)),
                      prompt_mode: img.meta?.prompt_mode || null,
                      // Visual components
                      visual_beat: img.meta?.visual_beat || beat.visualBeat || null,
                      visual_contract: img.meta?.visual_contract || null,
                      // v5.6: Visual DNA with suppression status
                      visual_dna: visualDNA ? {
                        style: visualDNA.visual_style,
                        palette: visualDNA.color_palette,
                        lighting: visualDNA.lighting_profile,
                      } : (img.meta?.visual_dna || null),
                      visual_dna_suppressed: visualDNASuppressed,
                      visual_dna_suppressed_reason: visualDNASuppressed ? 'uncanny-illustrated mode overrides Visual DNA' : null,
                      mood_level: img.meta?.mood_level || beat.moodLevel || null,
                      camera_angle: img.meta?.camera_angle || beat.cameraAngle || null,
                      continuity_rules: storyAnchor.continuityRules || null,
                      character_description: storyAnchor.characterDescription || null,
                      generated_at: img.meta?.generated_at || new Date().toISOString(),
                      is_permanent: true, // Parallel images are already uploaded to storage
                    },
                  });
                  console.log(`[IMAGES] ✓ Saved parallel image for scene ${sceneIndex + 1}/${scenes.length} (art_override=${isUncannyIllustrated ? 'uncanny-illustrated' : 'none'}, dna_suppressed=${visualDNASuppressed})`);
                }
              }
            }
            
            // Mark parallel complete - only set images_complete if ALL succeeded
            const allParallelSucceeded = status.failed === 0;
            
            // Release the atomic lock on completion
            const lockToken = jobMeta.parallel_lock_token;
            if (lockToken) {
              await supabase.rpc('release_parallel_lock', { p_job_id: job_id, p_lock_token: lockToken }).catch(() => {});
              console.log(`[IMAGES] Released parallel lock: ${lockToken}`);
            }
            
            await updateJobMeta(supabase, job_id, (meta) => ({
              ...meta,
              images_phase_running: false,
              images_complete: allParallelSucceeded, // Only complete if no failures!
              parallel_image_job_id: null,
              parallel_image_in_progress: false, // Clear the flag
              parallel_lock_token: null, // Clear lock token
              parallel_images_completed: status.completed,
              parallel_images_failed: status.failed,
              generation_logs: [
                ...(meta.generation_logs || []),
                `[${new Date().toISOString()}] ${allParallelSucceeded ? '✅' : '⚠️'} Parallel generation ${allParallelSucceeded ? 'complete' : 'partial'}: ${status.completed}/${status.total} images in ${status.total_time_seconds}s`
              ]
            }));
            
            if (allParallelSucceeded) {
              await updateJob(supabase, job_id, { progress: 70 });
              return { status: "generating", nextPhase: "assemble", message: `All ${status.completed} images ready (parallel)` };
            } else {
              // Some images failed - RETURN and let next poll cycle handle sequential fallback
              // This ensures we re-check existingImages count fresh
              console.log(`[IMAGES] ⚠️ ${status.failed} images failed in parallel, releasing lock for sequential fallback`);
              return { 
                status: "generating", 
                nextPhase: "images", 
                message: `Parallel: ${status.completed}/${status.total} done, ${status.failed} need sequential fallback` 
              };
            }
          }
          
          if (status.status === 'failed') {
            console.error(`[IMAGES] ❌ Parallel job failed: ${status.error}`);
            // Release lock on failure and clear the failed job ID so we can retry
            const lockToken = jobMeta.parallel_lock_token;
            if (lockToken) {
              await supabase.rpc('release_parallel_lock', { p_job_id: job_id, p_lock_token: lockToken }).catch(() => {});
            }
            await updateJobMeta(supabase, job_id, (meta) => ({
              ...meta,
              parallel_image_job_id: null,
              parallel_lock_token: null,
              generation_logs: [
                ...(meta.generation_logs || []),
                `[${new Date().toISOString()}] [ERROR] Parallel generation failed: ${status.error}`
              ]
            }));
            // Fall through to one-at-a-time generation
          }
        } catch (pollError) {
          console.error(`[IMAGES] Error polling parallel job:`, pollError);
          // Fall through to one-at-a-time generation
        }
      } else {
        // ATOMIC LOCK ACQUISITION: Use DB function to prevent race conditions
        // Generate unique lock token for this request
        const lockToken = crypto.randomUUID();
        
        // Try to acquire lock atomically (returns true if acquired)
        const { data: lockResult, error: lockError } = await supabase
          .rpc('acquire_parallel_lock', {
            p_job_id: job_id,
            p_lock_token: lockToken,
            p_lock_duration_seconds: 300 // 5 minute lock
          });
        
        if (lockError) {
          console.error(`[IMAGES] Lock acquisition error:`, lockError);
          // Fallback to simple check if RPC fails (DB migration not yet applied)
          const { data: freshJob } = await supabase
            .from("jobs")
            .select("meta")
            .eq("id", job_id)
            .single();
          
          const freshMeta = freshJob?.meta || {};
          if (freshMeta.parallel_image_in_progress || freshMeta.parallel_image_job_id) {
            console.log(`[IMAGES] ⚠️ Another request already started parallel generation, skipping`);
            return { 
              status: "generating", 
              nextPhase: "images", 
              message: "Parallel generation already in progress (fallback check)" 
            };
          }
        } else if (!lockResult) {
          console.log(`[IMAGES] ⚠️ Failed to acquire parallel lock - another request owns it`);
          return { 
            status: "generating", 
            nextPhase: "images", 
            message: "Parallel generation already in progress (atomic lock)" 
          };
        }
        
        console.log(`[IMAGES] ✅ Acquired parallel lock: ${lockToken}`);
        
        // Start new parallel job
        console.log(`[IMAGES] Starting new parallel image generation job...`);
        
        // Get Visual DNA from job meta (v5.0) - outside the map for logging
        const visualDNA = jobMeta.visual_dna || null;
        
        // Build scene prompts for parallel generation (with hash computation)
        const parallelScenes: ParallelImageScene[] = await Promise.all(scenes.map(async (scene, i) => {
          const beat = visualBeats[i] || {
            sceneIndex: i,
            visualBeat: scene.text.substring(0, 100),
            cameraAngle: "medium shot",
            focus: "the atmosphere",
            moodLevel: 5,
          };
          
          // Build prompt based on model
          let prompt: string;
          if (resolvedImageModel === "flux") {
            prompt = buildFluxPrompt(
              storyAnchor,
              beat,
              i,
              scenes.length,
              styleConfig,
              artStyle.startsWith('custom-'),
              visualDNA,
              artStyle // v5.7: Pass art style for uncanny-illustrated protection
            );
          } else {
            prompt = buildFinalDallePrompt(
              storyAnchor,
              beat,
              i,
              scenes.length,
              styleConfig,
              artStyle.startsWith('custom-'),
              job.visual_preset || "forest",
              visualDNA,
              artStyle // Pass art style for uncanny-illustrated protection
            );
          }
          
          // Determine prompt_mode for this scene
          const promptMode = beat.visualContract ? "final_prompt" : 
                           (storyAnchor.fullAnchorPrompt ? "anchor_only" : 
                           (scene.keywords?.length > 0 ? "keywords_fallback" : "text_fallback"));
          
          // Compute prompt hash for ground-truth tracing (v5.1)
          const promptHash = await computePromptHash(prompt);
          
          return {
            index: i,
            prompt: prompt,
            prompt_len: prompt.length,
            prompt_hash: promptHash,  // v5.1: Ground-truth hash
            prompt_preview_start: prompt.substring(0, 300),
            prompt_preview_end: prompt.substring(Math.max(0, prompt.length - 200)),
            prompt_mode: promptMode,
            text: scene.text,
            keywords: scene.keywords || [],
            start_time: scene.startTime,
            end_time: scene.endTime,
            visual_beat: beat.visualBeat || null,
            visual_contract: beat.visualContract ? {
              location: beat.visualContract.location,
              characterPose: beat.visualContract.characterPose,
              actionFrozen: beat.visualContract.actionFrozen,
            } : null,
            visual_dna: visualDNA ? {
              style: visualDNA.visual_style,
              palette: visualDNA.color_palette,
              lighting: visualDNA.lighting_profile,
            } : null,
            mood_level: beat.moodLevel || null,
            camera_angle: beat.cameraAngle || null,
          };
        }));
        
        // =====================================================
        // GROUND-TRUTH LOGGING FOR PARALLEL MODE (v5.1)
        // =====================================================
        console.log(`\n========== GROUND TRUTH: PARALLEL BATCH (${parallelScenes.length} scenes) ==========`);
        console.log(`[GROUND-TRUTH] job_id: ${job_id}`);
        console.log(`[GROUND-TRUTH] model: ${resolvedImageModel}`);
        console.log(`[GROUND-TRUTH] visual_dna: ${visualDNA ? `style=${visualDNA.visual_style}, palette=${visualDNA.color_palette}` : 'NONE'}`);
        console.log(`[GROUND-TRUTH] art_style: ${styleConfig.name}`);
        
        // Log first and last scene prompts for verification
        if (parallelScenes.length > 0) {
          const first = parallelScenes[0];
          console.log(`[GROUND-TRUTH] Scene 1 prompt_hash: ${first.prompt_hash}`);
          console.log(`[GROUND-TRUTH] Scene 1 prompt_len: ${first.prompt_len}`);
          console.log(`[GROUND-TRUTH] Scene 1 prompt_mode: ${first.prompt_mode}`);
          console.log(`[GROUND-TRUTH] Scene 1 prompt_start: "${first.prompt_preview_start?.substring(0, 200).replace(/\\n/g, '↵')}..."`);
          console.log(`[GROUND-TRUTH] Scene 1 has_contract: ${!!first.visual_contract}`);
        }
        if (parallelScenes.length > 1) {
          const last = parallelScenes[parallelScenes.length - 1];
          console.log(`[GROUND-TRUTH] Scene ${parallelScenes.length} prompt_hash: ${last.prompt_hash}`);
          console.log(`[GROUND-TRUTH] Scene ${parallelScenes.length} prompt_len: ${last.prompt_len}`);
          console.log(`[GROUND-TRUTH] Scene ${parallelScenes.length} prompt_mode: ${last.prompt_mode}`);
          console.log(`[GROUND-TRUTH] Scene ${parallelScenes.length} prompt_start: "${last.prompt_preview_start?.substring(0, 200).replace(/\\n/g, '↵')}..."`);
        }
        console.log(`==========================================================\n`);
        
        // =====================================================
        // SCENE COUNT DIAGNOSTIC LOG (v5.2 - strict mode fix)
        // =====================================================
        console.log(`\n========== SCENE COUNT DIAGNOSTIC ==========`);
        console.log(`[DIAGNOSTIC] requested_scene_count: ${jobMeta.scene_count}`);
        console.log(`[DIAGNOSTIC] scene_count_mode: ${jobMeta.scene_count_mode || 'strict'}`);
        console.log(`[DIAGNOSTIC] scene_count_final: ${jobMeta.scene_count_final}`);
        console.log(`[DIAGNOSTIC] scenes.length being sent to FFmpeg: ${scenes.length}`);
        console.log(`[DIAGNOSTIC] parallelScenes.length: ${parallelScenes.length}`);
        if (jobMeta.scene_count !== scenes.length) {
          console.error(`[DIAGNOSTIC] ⚠️ MISMATCH: User requested ${jobMeta.scene_count} but sending ${scenes.length}!`);
        } else {
          console.log(`[DIAGNOSTIC] ✅ Scene count matches user request`);
        }
        console.log(`============================================\n`);
        
        try {
          const { imageJobId } = await startParallelImageGeneration(
            job_id,
            parallelScenes,
            resolvedImageModel as "gpt-4o" | "dall-e-3" | "flux",
            styleConfig.name,
            storyAnchor
          );
          
          // Save job ID and lock token - prevents duplicate triggers
          await updateJobMeta(supabase, job_id, (meta) => ({
            ...meta,
            parallel_image_job_id: imageJobId,
            parallel_image_in_progress: true, // FLAG: Prevents check-job from re-triggering
            parallel_lock_token: lockToken, // Store our lock token
            images_phase_running: false,
            images_phase_lease_until: new Date(0).toISOString(),
            generation_logs: [
              ...(meta.generation_logs || []),
              `[${new Date().toISOString()}] 🚀 Started parallel image generation: ${imageJobId} (${scenes.length} images, ${resolvedImageModel})`
            ]
          }));
          
          console.log(`[IMAGES] Parallel job started: ${imageJobId}. Lock token: ${lockToken}`);
          return { 
            status: "generating", 
            nextPhase: "images", 
            message: `Parallel generation started (${scenes.length} images)` 
          };
        } catch (startError) {
          console.error(`[IMAGES] Failed to start parallel job:`, startError);
          // Release lock on failure
          await supabase.rpc('release_parallel_lock', { p_job_id: job_id, p_lock_token: lockToken }).catch(() => {});
          // Fall through to one-at-a-time generation
          await updateJobMeta(supabase, job_id, (meta) => ({
            ...meta,
            generation_logs: [
              ...(meta.generation_logs || []),
              `[${new Date().toISOString()}] [ERROR] Parallel start failed, falling back to sequential: ${(startError as Error).message}`
            ]
          }));
        }
      }
    }
    
    // =====================================================
    // SEQUENTIAL IMAGE GENERATION (fallback / legacy)
    // One image at a time to avoid edge function timeout
    // =====================================================
    console.log("[IMAGES] Using SEQUENTIAL image generation (one at a time)");
    
    // For FLUX: Get reference image URL from scene 0 (if already generated)
    let referenceImageUrl: string | undefined = undefined;
    if (resolvedImageModel === "flux" && imagesGenerated > 0) {
      // Fetch scene 0's image URL from database
      const { data: scene0Asset } = await supabase
        .from("job_assets")
        .select("storage_path")
        .eq("job_id", job_id)
        .eq("type", "dalle_image")
        .eq("meta->>scene_index", "0")
        .single();
      
      if (scene0Asset?.storage_path) {
        referenceImageUrl = scene0Asset.storage_path;
        console.log(`[FLUX] Retrieved scene 0 as reference for character consistency`);
      }
    }
    
    // Generate remaining images one at a time
    for (let i = imagesGenerated; i < scenes.length; i++) {
      const scene = scenes[i];
      const beat = visualBeats[i] || {
        sceneIndex: i,
        visualBeat: scene.text.substring(0, 100),
        cameraAngle: "medium shot",
        focus: "the atmosphere",
        moodLevel: 5,
      };
      
      // DEBUG: Log scene text and beat to verify uniqueness
      console.log(`[IMAGES] === Scene ${i + 1}/${scenes.length} ===`);
      console.log(`[IMAGES] Scene text: "${scene.text.substring(0, 80)}..."`);
      console.log(`[IMAGES] Visual beat: "${beat.visualBeat?.substring(0, 80)}..."`);
      console.log(`[IMAGES] Generating with ${resolvedImageModel}...`);
      
      if (beat.visualContract) {
        console.log(`[CONTRACT] Location: ${beat.visualContract.location}`);
        console.log(`[CONTRACT] Pose: ${beat.visualContract.characterPose}`);
      }
      
      const isCustomStyle = artStyle.startsWith('custom-');
      const visualPreset = job.visual_preset || "forest";
      const visualDNA = jobMeta.visual_dna || null;
      
      // Log Visual DNA if present
      if (visualDNA) {
        console.log(`[VISUAL-DNA] Using style: ${visualDNA.visual_style} / ${visualDNA.color_palette}`);
      }
      
      // Refresh lease for each image (heartbeat) - use fresh meta to avoid stale overwrites
      await updateJobMeta(supabase, job_id, (currentMeta) => ({
        ...currentMeta,
        generation_logs: [
          ...(currentMeta.generation_logs || []),
          `[${new Date().toISOString()}] Generating scene ${i + 1}/${scenes.length} with ${resolvedImageModel}${visualDNA ? ` (Visual DNA: ${visualDNA.visual_style})` : ''}`
        ],
        images_phase_lease_until: new Date(Date.now() + leaseMs).toISOString() // Refresh lease
      }));
      
      // Build prompt - use FLUX-specific prompt for FLUX model (shorter, simpler)
      let imagePrompt: string;
      if (resolvedImageModel === "flux") {
        imagePrompt = buildFluxPrompt(
          storyAnchor,
          beat,
          i,
          scenes.length,
          styleConfig,
          isCustomStyle,
          visualDNA,
          artStyle // v5.7: Pass art style for uncanny-illustrated protection
        );
      } else {
        // DALL-E 3 / GPT-4o use the full detailed prompt
        imagePrompt = buildFinalDallePrompt(
          storyAnchor,
          beat,
          i,
          scenes.length,
          styleConfig,
          isCustomStyle,
          visualPreset,
          visualDNA,
          artStyle // Pass art style for uncanny-illustrated protection
        );
      }
      
      // =====================================================
      // GROUND-TRUTH PROMPT LOGGING (Right before generation)
      // =====================================================
      const promptMode = beat.visualContract ? "final_prompt" : 
                         (storyAnchor.fullAnchorPrompt ? "anchor_only" : 
                         (scene.keywords?.length > 0 ? "keywords_fallback" : "text_fallback"));
      
      console.log(`\n========== GROUND TRUTH: SCENE ${i + 1}/${scenes.length} ==========`);
      console.log(`[GROUND-TRUTH] job_id: ${job_id}`);
      console.log(`[GROUND-TRUTH] scene_index: ${i}`);
      console.log(`[GROUND-TRUTH] prompt_mode: ${promptMode}`);
      console.log(`[GROUND-TRUTH] prompt_len: ${imagePrompt.length} chars`);
      console.log(`[GROUND-TRUTH] prompt_preview_start: "${imagePrompt.substring(0, 300).replace(/\n/g, '↵')}..."`);
      console.log(`[GROUND-TRUTH] prompt_preview_end: "...${imagePrompt.substring(Math.max(0, imagePrompt.length - 200)).replace(/\n/g, '↵')}"`);
      console.log(`[GROUND-TRUTH] narration: "${scene.text.substring(0, 120)}..."`);
      console.log(`[GROUND-TRUTH] has_visual_beat: ${!!beat.visualBeat}`);
      console.log(`[GROUND-TRUTH] has_visual_contract: ${!!beat.visualContract}`);
      console.log(`[GROUND-TRUTH] visual_dna: ${visualDNA ? `style=${visualDNA.visual_style}, palette=${visualDNA.color_palette}, lighting=${visualDNA.lighting_profile}` : 'NONE'}`);
      console.log(`[GROUND-TRUTH] model: ${resolvedImageModel}`);
      console.log(`[GROUND-TRUTH] source: sequential`);
      if (beat.visualContract) {
        console.log(`[GROUND-TRUTH] contract_location: "${beat.visualContract.location}"`);
        console.log(`[GROUND-TRUTH] contract_pose: "${beat.visualContract.characterPose}"`);
        console.log(`[GROUND-TRUTH] contract_action: "${beat.visualContract.actionFrozen?.substring(0, 80)}..."`);
      }
      console.log(`==========================================================\n`);
      
      // =====================================================
      // PROMPT MODE GATE (v5.1) - Block fallback prompts
      // Force repair until final_prompt or fail with error
      // =====================================================
      const MAX_REPAIR_ATTEMPTS = 2;
      let repairAttempts = 0;
      let currentPromptMode = promptMode;
      
      // If not final_prompt, we MUST repair before proceeding
      while (["keywords_fallback", "text_fallback", "anchor_only"].includes(currentPromptMode) && repairAttempts < MAX_REPAIR_ATTEMPTS) {
        console.log(`[PROMPT-GATE] Scene ${i + 1}: BLOCKED - prompt_mode="${currentPromptMode}" (attempt ${repairAttempts + 1}/${MAX_REPAIR_ATTEMPTS})`);
        repairAttempts++;
        
        try {
          // Create a minimal contract if none exists
          if (!beat.visualContract) {
            beat.visualContract = {
              sceneIndex: i,
              location: storyAnchor.environment?.split(",")[0] || "dark setting",
              characterPose: "tense posture",
              facialExpression: "fear",
              visibleObjects: [],
              supernaturalElement: null,
              cameraDistance: "medium",
              lightingSource: "dim light",
              actionFrozen: scene.text.substring(0, 80),
              forbiddenElements: ["text", "words", "watermarks"],
              continuityFromPrev: i === 0 ? "establishing shot" : "same as previous",
              evidenceRule: `Scene ${i + 1} must match narration`,
            };
          }
          
          // Force repair
          const repairedContract = await repairVisualContract(
            openaiKey,
            i,
            scene.text,
            beat.visualContract,
            ["forced_repair_from_fallback_mode"],
            { vibe: jobMeta.vibe }
          );
          
          beat.visualContract = repairedContract;
          
          // Rebuild prompt
          if (resolvedImageModel === "flux") {
            imagePrompt = buildFluxPrompt(storyAnchor, beat, i, scenes.length, styleConfig, isCustomStyle, visualDNA, artStyle);
          } else {
            imagePrompt = buildFinalDallePrompt(storyAnchor, beat, i, scenes.length, styleConfig, isCustomStyle, visualPreset, visualDNA, artStyle);
          }
          
          // Re-check mode
          currentPromptMode = beat.visualContract ? "final_prompt" : currentPromptMode;
          
          console.log(`[PROMPT-GATE] Scene ${i + 1}: Repaired, new prompt_len=${imagePrompt.length}, mode=${currentPromptMode}`);
          
        } catch (gateRepairError) {
          console.error(`[PROMPT-GATE] Scene ${i + 1}: Repair attempt ${repairAttempts} failed:`, gateRepairError);
        }
      }
      
      // If still not final_prompt after max attempts, log error but proceed (graceful degradation)
      if (["keywords_fallback", "text_fallback", "anchor_only"].includes(currentPromptMode)) {
        console.error(`[PROMPT-GATE] Scene ${i + 1}: FAILED to achieve final_prompt after ${MAX_REPAIR_ATTEMPTS} attempts. Proceeding with ${currentPromptMode}`);
      }
      
      // =====================================================
      // COMPUTE PROMPT HASH (v5.1) - Ground truth tracing
      // =====================================================
      const promptHash = await computePromptHash(imagePrompt);
      console.log(`[PROMPT-HASH] Scene ${i + 1}: hash=${promptHash} (len=${imagePrompt.length})`);
      
      // =====================================================
      // RELEVANCE SCORING + AUTO-REPAIR (v5.1 - hardened)
      // Check if prompt properly captures the visual contract
      // Require ≥2 objects, location match, threat match
      // =====================================================
      let relevanceResult: any = { 
        relevance_score: 1.0, 
        missing_elements: [] as string[], 
        reason: "No scoring needed", 
        needs_repair: false,
        failure_type: "ok",
        matched_objects: [],
        mismatched_fields: [],
      };
      let repairAttempted = repairAttempts > 0; // Track if we already repaired in gate
      
      if (beat.visualContract && currentPromptMode === "final_prompt") {
        relevanceResult = await scorePromptRelevance(
          openaiKey,
          i,
          scene.text,
          {
            ...beat.visualContract,
            continuity: beat.visualContract.continuity,
          },
          imagePrompt
        );
        
        console.log(`[RELEVANCE] Scene ${i + 1}: score=${(relevanceResult.relevance_score * 100).toFixed(0)}%, failure=${relevanceResult.failure_type}`);
        console.log(`[RELEVANCE] Scene ${i + 1}: matched=[${relevanceResult.matched_objects?.join(", ")}], mismatched=[${relevanceResult.mismatched_fields?.join(", ")}]`);
        
        // AUTO-REPAIR: If score < 0.65 or missing required objects
        if (relevanceResult.needs_repair && !repairAttempted) {
          console.log(`[RELEVANCE] Scene ${i + 1}: REPAIRING - ${relevanceResult.failure_type}`);
          repairAttempted = true;
          
          try {
            // Repair the visual contract with stricter constraints
            const repairedContract = await repairVisualContract(
              openaiKey,
              i,
              scene.text,
              beat.visualContract,
              relevanceResult.missing_elements,
              { vibe: jobMeta.vibe }
            );
            
            // Update the beat with repaired contract
            beat.visualContract = repairedContract;
            
            // Rebuild prompt with repaired contract
            if (resolvedImageModel === "flux") {
              imagePrompt = buildFluxPrompt(
                storyAnchor,
                beat,
                i,
                scenes.length,
                styleConfig,
                isCustomStyle,
                visualDNA,
                artStyle // v5.7: Pass art style for uncanny-illustrated protection
              );
            } else {
              imagePrompt = buildFinalDallePrompt(
                storyAnchor,
                beat,
                i,
                scenes.length,
                styleConfig,
                isCustomStyle,
                visualPreset,
                visualDNA,
                artStyle // Pass art style for uncanny-illustrated protection
              );
            }
            
            // Recompute hash after repair
            const newPromptHash = await computePromptHash(imagePrompt);
            console.log(`[PROMPT-HASH] Scene ${i + 1}: AFTER REPAIR hash=${newPromptHash} (was ${promptHash})`);
            
            // Re-score after repair
            const reScored = await scorePromptRelevance(
              openaiKey,
              i,
              scene.text,
              {
                ...beat.visualContract,
                continuity: beat.visualContract.continuity,
              },
              imagePrompt
            );
            
            console.log(`[RELEVANCE] Scene ${i + 1}: AFTER REPAIR - score=${(reScored.relevance_score * 100).toFixed(0)}% (was ${(relevanceResult.relevance_score * 100).toFixed(0)}%)`);
            console.log(`[RELEVANCE] Scene ${i + 1}: NEW matched=[${reScored.matched_objects?.join(", ")}]`);
            
            // Update relevance result for meta storage
            relevanceResult = {
              ...reScored,
              missing_elements: [...relevanceResult.missing_elements, ...reScored.missing_elements],
              reason: `Repaired (${relevanceResult.failure_type}): ${reScored.reason}`,
            };
            
          } catch (repairError) {
            console.error(`[RELEVANCE] Scene ${i + 1}: Repair failed, using original prompt:`, repairError);
          }
        }
      }
      
      // CRITICAL: Check if this scene's image already exists BEFORE generating
      // This prevents duplicate API calls when phase is triggered multiple times
      const { data: existingSceneImages } = await supabase
        .from("job_assets")
        .select("id, storage_path, meta")
        .eq("job_id", job_id)
        .eq("type", "dalle_image");
      
      // Filter by scene_index manually (JSON path queries can be unreliable)
      const existingSceneImage = existingSceneImages?.find(
        (img: any) => img.meta?.scene_index === i
      );
      
      if (existingSceneImage?.storage_path) {
        console.log(`[IMAGES] Scene ${i + 1} already has image, SKIPPING generation: ${existingSceneImage.storage_path.substring(0, 50)}...`);
        continue;
      }
      
      // Strict mode: fail if model unavailable instead of silently falling back
      // Set to false in job meta if you want automatic fallback to DALL-E 3
      const strictImageModel = jobMeta.strict_image_model ?? true;
      
      // TIMEOUT WRAPPER: Edge functions can timeout at ~60s (free) or ~150s (Pro)
      // GPT-4o images can take 30-50+ seconds
      // Set to 45s to leave 15s buffer for DB saves, error handling, and cleanup
      // This prevents the edge function from being killed while saving results
      const IMAGE_TIMEOUT_MS = 45 * 1000; // 45 seconds - safe buffer for edge functions
      
      let imageUrl: string | null = null;
      try {
        const imagePromise = generateImage(
          openaiKey,
          imagePrompt,
          i,
          resolvedImageModel,
          referenceImageUrl,  // Pass reference for FLUX character consistency
          strictImageModel    // Pass strict mode flag
        );
        
        // Race between image generation and timeout
        const timeoutPromise = new Promise<string | null>((_, reject) => {
          setTimeout(() => reject(new Error(`Image generation timed out after ${IMAGE_TIMEOUT_MS/1000}s - will retry on next poll`)), IMAGE_TIMEOUT_MS);
        });
        
        const rawImageUrl = await Promise.race([imagePromise, timeoutPromise]);
        
        // Upload to Supabase Storage to prevent URL expiry issues
        if (rawImageUrl) {
          try {
            imageUrl = await uploadRemoteImageToStorage(
              supabase,
              "story-videos",
              `${job_id}/images/scene_${i}.webp`,
              rawImageUrl
            );
          } catch (uploadErr) {
            console.warn(`[IMAGES] Storage upload failed, using original URL:`, uploadErr);
            imageUrl = rawImageUrl; // Fallback to original URL
          }
        }
        
        // =====================================================
        // COUNT LOCK VERIFICATION + RETRY (v5.2)
        // =====================================================
        // If this scene has a group_count, verify the image shows the correct number
        // Retry up to 2 more times with progressively stricter prompts if wrong
        const groupCount = beat.visualContract?.group_count;
        if (groupCount && imageUrl && resolvedImageModel !== "flux") {
          const expectedCount = groupCount.expected;
          const MAX_COUNT_RETRIES = 2;
          let countVerified = false;
          let bestImageUrl = imageUrl;
          let bestDelta = Infinity;
          
          console.log(`[COUNT-VERIFY] Scene ${i + 1}: Verifying COUNT LOCK (expected=${expectedCount})`);
          
          // Verify initial image
          const initialVerify = await verifyHumanCount(openaiKey, imageUrl, expectedCount);
          const initialDelta = Math.abs(initialVerify.detectedCount - expectedCount);
          
          if (initialVerify.ok) {
            console.log(`[COUNT-VERIFY] Scene ${i + 1}: ✅ Initial image PASSED (${initialVerify.detectedCount}/${expectedCount})`);
            countVerified = true;
          } else {
            console.log(`[COUNT-VERIFY] Scene ${i + 1}: ❌ Initial image FAILED (detected=${initialVerify.detectedCount}, expected=${expectedCount})`);
            bestDelta = initialDelta;
            
            // Retry with stricter prompts
            for (let retry = 1; retry <= MAX_COUNT_RETRIES && !countVerified; retry++) {
              console.log(`[COUNT-VERIFY] Scene ${i + 1}: Retry ${retry}/${MAX_COUNT_RETRIES} with stricter prompt...`);
              
              // Build fallback prompt with simplified composition
              const fallbackPrompt = buildCountLockFallbackPrompt(
                expectedCount,
                beat.visualContract?.location || "interior scene",
                groupCount.is_wrong,
                styleConfig
              );
              
              try {
                // Generate new image with fallback prompt
                const retryRawUrl = await generateImage(
                  openaiKey,
                  fallbackPrompt,
                  i,
                  resolvedImageModel,
                  referenceImageUrl,
                  false // Don't be strict on model for retries
                );
                
                if (retryRawUrl) {
                  // Upload retry image
                  let retryImageUrl: string;
                  try {
                    retryImageUrl = await uploadRemoteImageToStorage(
                      supabase,
                      "story-videos",
                      `${job_id}/images/scene_${i}_retry${retry}.webp`,
                      retryRawUrl
                    );
                  } catch {
                    retryImageUrl = retryRawUrl;
                  }
                  
                  // Verify retry image
                  const retryVerify = await verifyHumanCount(openaiKey, retryImageUrl, expectedCount);
                  const retryDelta = Math.abs(retryVerify.detectedCount - expectedCount);
                  
                  if (retryVerify.ok) {
                    console.log(`[COUNT-VERIFY] Scene ${i + 1}: ✅ Retry ${retry} PASSED (${retryVerify.detectedCount}/${expectedCount})`);
                    imageUrl = retryImageUrl;
                    countVerified = true;
                  } else {
                    console.log(`[COUNT-VERIFY] Scene ${i + 1}: ❌ Retry ${retry} FAILED (detected=${retryVerify.detectedCount})`);
                    // Keep the image with smallest delta
                    if (retryDelta < bestDelta) {
                      bestDelta = retryDelta;
                      bestImageUrl = retryImageUrl;
                    }
                  }
                }
              } catch (retryError) {
                console.error(`[COUNT-VERIFY] Scene ${i + 1}: Retry ${retry} error:`, retryError);
              }
            }
            
            // If no retry passed, use the best candidate
            if (!countVerified) {
              console.log(`[COUNT-VERIFY] Scene ${i + 1}: ⚠️ All retries failed, using best candidate (delta=${bestDelta})`);
              imageUrl = bestImageUrl;
            }
          }
          
          // Log verification result to job meta
          await updateJobMeta(supabase, job_id, (meta) => ({
            ...meta,
            generation_logs: [
              ...(meta.generation_logs || []),
              `[${new Date().toISOString()}] [COUNT-VERIFY] Scene ${i + 1}: expected=${expectedCount}, verified=${countVerified}`
            ]
          }));
        }
        
        // Store first scene as reference if FLUX (use stored URL for stability)
        if (i === 0 && imageUrl && resolvedImageModel === "flux") {
          referenceImageUrl = imageUrl;
          console.log(`[FLUX] Scene 1 stored as reference for character consistency`);
          await updateJobMeta(supabase, job_id, (meta) => ({
            ...meta,
            generation_logs: [
              ...(meta.generation_logs || []),
              `[${new Date().toISOString()}] [FLUX] Scene 1 stored as reference for consistency`
            ]
          }));
        }
      } catch (imgError: any) {
        const errorMessage = imgError?.message || String(imgError);
        console.error(`[IMAGES] Scene ${i + 1} generation error:`, errorMessage);
        
        // Check if this is a timeout error - if so, release lock and return
        // The job will be retried on the next poll cycle
        const isTimeoutError = errorMessage.includes('timed out') || errorMessage.includes('timeout');
        
        // Try to log the error and release lock - use try/catch to prevent cascade failures
        // If this fails (e.g., edge function being killed), the lease will naturally expire
        try {
          await updateJobMeta(supabase, job_id, (meta) => ({
            ...meta,
            generation_logs: [
              ...(meta.generation_logs || []),
              `[${new Date().toISOString()}] [ERROR] Scene ${i + 1}: ${errorMessage.substring(0, 200)}`
            ],
            // Release lock if timeout - allow next poll to retry
            ...(isTimeoutError ? {
              images_phase_running: false,
              images_phase_lease_until: new Date(0).toISOString(),
            } : {})
          }));
        } catch (metaError) {
          // Failed to update meta - log but don't throw
          // The 75-second lease will naturally expire and allow retry
          console.warn(`[IMAGES] Failed to update meta after error (lease will expire):`, metaError);
        }
        
        // If timeout, return immediately - let next poll cycle retry
        if (isTimeoutError) {
          console.log(`[IMAGES] Timeout detected, releasing lock for retry on next poll`);
          return { 
            status: "generating", 
            nextPhase: "images", 
            message: `Scene ${i + 1} timed out, will retry on next poll` 
          };
        }
        
        // For non-timeout errors, use a static fallback image
        // (Can't use Pexels without the key being passed to this function)
        console.log(`[IMAGES] Scene ${i + 1} using static fallback image`);
        imageUrl = "https://images.pexels.com/photos/1591382/pexels-photo-1591382.jpeg?auto=compress&cs=tinysrgb&w=1260";
      }
      
      // Save to database IMMEDIATELY
      // Determine correct source/type based on actual model used
      const assetSource = resolvedImageModel === "flux" ? "ai" : 
                          resolvedImageModel === "gpt-4o" ? "ai" : "dalle";
      
      // Check if URL is from Supabase Storage (permanent) vs temporary
      const isSupabaseUrl = imageUrl?.includes('supabase.co');
      
      // Determine if Visual DNA was suppressed (uncanny-illustrated mode)
      const isUncannyIllustrated = artStyle === 'uncanny-illustrated';
      const visualDNASuppressed = isUncannyIllustrated && !!visualDNA;
      
      // Build comprehensive meta with prompt verification fields
      // Compute final hash for ground-truth verification
      const finalPromptHash = await computePromptHash(imagePrompt);
      
      const promptMeta = {
        scene_index: i, 
        scene_text: scene.text,
        keywords: scene.keywords,
        start_time: scene.startTime,
        end_time: scene.endTime,
        source: "sequential",
        image_model: resolvedImageModel,
        art_style: artStyle,
        art_style_override: isUncannyIllustrated ? 'uncanny-illustrated' : null,
        // STYLE CONFIG (what was actually used)
        style_config: {
          name: styleConfig.name,
          basePrompt_preview: (styleConfig.basePrompt || '').substring(0, 100),
          colorOverride_preview: (styleConfig.colorOverride || '').substring(0, 80),
          technicalStyle_preview: (styleConfig.technicalStyle || '').substring(0, 80),
        },
        // PROMPT VERIFICATION FIELDS (Ground Truth v5.1)
        prompt_final: imagePrompt,  // FULL PROMPT - this is what was actually sent
        prompt_len: imagePrompt.length,
        prompt_hash: finalPromptHash,  // SHA-256 hash for end-to-end tracing
        prompt_preview_start: imagePrompt.substring(0, 300),
        prompt_preview_end: imagePrompt.substring(Math.max(0, imagePrompt.length - 200)),
        prompt_mode: currentPromptMode,  // Use the final mode after any repairs
        // Visual components used
        visual_beat: beat.visualBeat || null,
        visual_contract: beat.visualContract ? {
          location: beat.visualContract.location,
          characterPose: beat.visualContract.characterPose,
          actionFrozen: beat.visualContract.actionFrozen,
          visibleObjects: beat.visualContract.visibleObjects,
          forbiddenElements: beat.visualContract.forbiddenElements,
          evidenceRule: beat.visualContract.evidenceRule,
          group_count: beat.visualContract.group_count || null,
        } : null,
        // VISUAL DNA STATUS (v5.5)
        visual_dna: visualDNA ? {
          style: visualDNA.visual_style,
          palette: visualDNA.color_palette,
          lighting: visualDNA.lighting_profile,
          composition: visualDNA.frame_composition,
          textures: visualDNA.texture_artifacts || [],
          camera: visualDNA.camera_language || null,
          motion: visualDNA.motion_profile || null,
        } : null,
        visual_dna_suppressed: visualDNASuppressed,
        visual_dna_suppressed_reason: visualDNASuppressed ? 'uncanny-illustrated mode overrides Visual DNA' : null,
        mood_level: beat.moodLevel,
        camera_angle: beat.cameraAngle,
        continuity_rules: storyAnchor.continuityRules || null,
        character_description: storyAnchor.characterDescription || null,
        generated_at: new Date().toISOString(),
        is_permanent: isSupabaseUrl,
        // RELEVANCE SCORING (v5.1 - hardened)
        relevance_score: relevanceResult.relevance_score,
        relevance_missing: relevanceResult.missing_elements,
        relevance_reason: relevanceResult.reason,
        relevance_repaired: repairAttempted,
        relevance_failure_type: relevanceResult.failure_type || "ok",
        relevance_matched_objects: relevanceResult.matched_objects || [],
        relevance_mismatched_fields: relevanceResult.mismatched_fields || [],
      };
      
      console.log(`[GROUND-TRUTH] Scene ${i + 1} FINAL: hash=${finalPromptHash}, mode=${currentPromptMode}, relevance=${(relevanceResult.relevance_score * 100).toFixed(0)}%, visual_dna_suppressed=${visualDNASuppressed}`);
      
      const { error: insertError } = await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "dalle_image",
        storage_path: imageUrl,
        public_url: isSupabaseUrl ? imageUrl : null,
        meta: promptMeta,
      });
      
      if (insertError) {
        console.error(`[IMAGES] Scene ${i + 1} DB insert error:`, insertError);
      } else {
        console.log(`[IMAGES] ✓ Scene ${i + 1} saved to database`);
      }
      
      // Update progress
      const imageProgress = 63 + Math.floor((i + 1) / scenes.length * 6);
      await updateJob(supabase, job_id, { progress: imageProgress });
      
      // =====================================================
      // CRITICAL: Generate ONE image per function call to avoid timeout
      // Edge functions have 60-150s timeout, but image generation can take 30-60s each
      // Release the lock and return - check-job will trigger another run for next scene
      // =====================================================
      if (i < scenes.length - 1) {
        console.log(`[IMAGES] ✓ Scene ${i + 1}/${scenes.length} done. Releasing lock for next poll cycle.`);
        
        // Release lock but keep images_complete false so check-job triggers next run
        await updateJobMeta(supabase, job_id, (meta) => ({
          ...meta,
          images_phase_running: false,
          images_phase_lease_until: new Date(0).toISOString(), // Expired lease
          last_image_generated: i + 1,
        }));
        
        // Return immediately - check-job will see more images needed and trigger another run
        return { 
          status: "generating", 
          nextPhase: "images", 
          message: `Image ${i + 1}/${scenes.length} generated, releasing for next cycle` 
        };
      }
    }
    
    // Check final count
    const { data: allImages } = await supabase
      .from("job_assets")
      .select("*")
      .eq("job_id", job_id)
      .eq("type", "dalle_image");

    // Store Replicate inputs in job meta for debugging (using fresh meta)
    const replicateInputs = getLastReplicateInputs();
    
    if (allImages?.length >= scenes.length) {
      await updateJobMeta(supabase, job_id, (meta) => ({
        ...meta,
        images_phase_running: false, 
        images_complete: true,
        replicate_inputs: replicateInputs.length > 0 ? replicateInputs : undefined
      }));
      await updateJob(supabase, job_id, { progress: 70 });
      return { status: "generating", nextPhase: "assemble", message: "All images ready" };
    } else {
      // More images still needed (shouldn't happen but just in case)
      await updateJobMeta(supabase, job_id, (meta) => ({
        ...meta,
        images_phase_running: false,
        replicate_inputs: replicateInputs.length > 0 ? replicateInputs : undefined
      }));
      return { status: "generating", nextPhase: "images", message: `${allImages?.length || 0}/${scenes.length} images generated` };
    }
  } else {
    // Pexels videos - fast, can do all at once
    const scenesWithVisuals = await searchVideosForScenes(pexelsKey, scenes, job.visual_preset || "forest");
    
    for (let i = 0; i < scenesWithVisuals.length; i++) {
      await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "bg_video",
        storage_path: scenesWithVisuals[i].videoUrl || "",
        meta: { scene_index: i, source: "pexels" },
      });
    }

    await updateJob(supabase, job_id, { progress: 70 });
    return { status: "generating", nextPhase: "assemble", message: "Videos ready" };
  }
}

// =====================================================
// PHASE 3: Assemble Video
// =====================================================
export async function runAssemblePhase(
  supabase: any,
  creatomateKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  options: VideoOptions
): Promise<{ status: string; nextPhase: string | null; message: string }> {
  console.log(`[ASSEMBLE] Starting assemble phase for job ${job_id}`);
  
  // Log music settings for debugging
  console.log(`[ASSEMBLE] 🎵 Music settings: enabled=${options.music}, track="${options.musicTrack}", volume=${options.musicVolume}%`);

  // Determine renderer to use
  const useFFmpeg = shouldUseFFmpegRenderer();
  console.log(`[ASSEMBLE] Using ${useFFmpeg ? "FFmpeg" : "Creatomate"} renderer`);

  // Check if assemble phase is already running
  // BUT: Also check if render_id exists - if not, the previous attempt crashed before starting render
  if (jobMeta.assemble_phase_running) {
    const startedAt = new Date(jobMeta.assemble_phase_started_at || 0).getTime();
    const elapsed = Date.now() - startedAt;
    const hasRenderId = !!jobMeta.render_id;
    
    if (elapsed < 3 * 60 * 1000 && hasRenderId) {
      // Phase is running AND render was started - skip
      console.log(`[ASSEMBLE] Phase already running (started ${elapsed/1000}s ago) with render_id=${jobMeta.render_id}, skipping`);
      return { status: "rendering", nextPhase: "assemble", message: "Assemble phase already in progress" };
    } else if (elapsed < 3 * 60 * 1000 && !hasRenderId) {
      // Phase marked as running but no render_id - previous attempt crashed before render started
      console.log(`[ASSEMBLE] ⚠️ Stale lock detected (no render_id after ${elapsed/1000}s). Clearing and retrying...`);
      // Continue to retry
    } else {
      // Lock expired - proceed with retry
      console.log(`[ASSEMBLE] Lock expired (${elapsed/1000}s ago). Proceeding with retry...`);
    }
  }
  
  // Mark phase as running with assembly tracking timestamps (v3.2)
  const assembleStartedAt = new Date().toISOString();
  const assembleTimeoutAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 minutes
  
  await updateJob(supabase, job_id, {
    progress: 72,
    meta: { 
      ...jobMeta, 
      assemble_phase_running: true,
      assemble_phase_started_at: assembleStartedAt,
      assemble_started_at: assembleStartedAt, // Canonical field for UI
      assemble_timeout_at: assembleTimeoutAt, // When UI should consider it timed out
      renderer: useFFmpeg ? "ffmpeg" : "creatomate",
      render_status: "preparing",
      render_progress: 0,
    }
  });

  // =====================================================
  // WRAP ENTIRE DATA FETCH IN TRY-CATCH TO RELEASE LOCK ON FAILURE
  // =====================================================
  let audioUrlData: { publicUrl: string };
  let captionsData: { captions: Array<{ word: string; start: number; end: number }> };
  let imageAssets: any[];
  let sceneAssets: any[];
  
  try {
    // Get audio URL
    const audioResult = supabase.storage
      .from("story-videos")
      .getPublicUrl(`${job_id}/audio.mp3`);
    audioUrlData = audioResult.data;
    console.log(`[ASSEMBLE] Audio URL: ${audioUrlData.publicUrl.substring(0, 80)}...`);

    // Get captions
    console.log(`[ASSEMBLE] Downloading captions...`);
    const { data: captionsBlob, error: captionsError } = await supabase.storage
      .from("story-videos")
      .download(`${job_id}/captions.json`);
    
    if (captionsError) {
      throw new Error(`Captions download error: ${captionsError.message}`);
    }
    if (!captionsBlob) {
      throw new Error(`Captions file not found for job ${job_id}`);
    }
    
    console.log(`[ASSEMBLE] Parsing captions blob (size: ${captionsBlob.size} bytes)...`);
    const captionsText = await captionsBlob.text();
    captionsData = JSON.parse(captionsText);
    console.log(`[ASSEMBLE] ✓ Loaded ${captionsData.captions?.length || 0} caption words`);

    // Get images/videos
    console.log(`[ASSEMBLE] Fetching image assets...`);
    const { data: imgAssets, error: imageError } = await supabase
      .from("job_assets")
      .select("*")
      .eq("job_id", job_id)
      .in("type", ["dalle_image", "bg_video"]);
    
    if (imageError) {
      throw new Error(`Image assets query failed: ${imageError.message}`);
    }
    imageAssets = imgAssets || [];
    console.log(`[ASSEMBLE] ✓ Found ${imageAssets.length} image assets`);

    // Get scene data
    console.log(`[ASSEMBLE] Fetching scene data...`);
    const { data: scnAssets, error: sceneError } = await supabase
      .from("job_assets")
      .select("*")
      .eq("job_id", job_id)
      .eq("type", "scene_data");
    
    if (sceneError) {
      throw new Error(`Scene assets query failed: ${sceneError.message}`);
    }
    sceneAssets = scnAssets || [];
    console.log(`[ASSEMBLE] ✓ Found ${sceneAssets.length} scene assets`);

    if (!imageAssets.length || !sceneAssets.length) {
      throw new Error(`Missing assets: ${imageAssets.length} images, ${sceneAssets.length} scenes`);
    }
  } catch (dataFetchError) {
    // Release lock on failure so retry can work
    console.error(`[ASSEMBLE] ❌ Data fetch failed:`, (dataFetchError as Error).message);
    console.error(`[ASSEMBLE] Stack:`, (dataFetchError as Error).stack);
    
    await updateJob(supabase, job_id, {
      progress: 71,
      meta: { 
        ...jobMeta, 
        assemble_phase_running: false,
        assemble_error: (dataFetchError as Error).message,
        assemble_retry_count: (jobMeta.assemble_retry_count || 0) + 1
      }
    });
    
    throw dataFetchError; // Re-throw to return 500 with error message
  }

  if (!imageAssets?.length || !sceneAssets?.length) {
    throw new Error("Missing images or scene data");
  }

  // Sort by scene_index numerically (JSON path ordering can be unreliable)
  const sortedScenes = [...sceneAssets].sort((a, b) => 
    (a.meta?.scene_index ?? 0) - (b.meta?.scene_index ?? 0)
  );
  const sortedImages = [...imageAssets].sort((a, b) => 
    (a.meta?.scene_index ?? 0) - (b.meta?.scene_index ?? 0)
  );
  
  // Build a map of scene_index -> image for reliable matching
  const imageBySceneIndex = new Map<number, any>();
  for (const img of sortedImages) {
    const idx = img.meta?.scene_index ?? -1;
    if (idx >= 0) {
      imageBySceneIndex.set(idx, img);
    }
  }
  
  console.log(`[ASSEMBLE] Matching ${sortedScenes.length} scenes to ${sortedImages.length} images`);
  console.log(`[ASSEMBLE] Scene indices: ${sortedScenes.map(s => s.meta?.scene_index).join(', ')}`);
  console.log(`[ASSEMBLE] Image indices: ${sortedImages.map(i => i.meta?.scene_index).join(', ')}`);

  // Build scenes with visuals - match by scene_index, not array position
  const scenes: StoryScene[] = sortedScenes.map((s: any) => {
    const sceneIndex = s.meta?.scene_index ?? 0;
    const matchingImage = imageBySceneIndex.get(sceneIndex);
    
    if (!matchingImage) {
      console.warn(`[ASSEMBLE] ⚠️ No image found for scene ${sceneIndex}: "${s.meta?.scene_text?.substring(0, 50)}..."`);
    } else {
      console.log(`[ASSEMBLE] Scene ${sceneIndex} → Image: ${matchingImage.storage_path?.substring(0, 60)}...`);
    }
    
    return {
      text: s.meta.scene_text,
      keywords: s.meta.keywords || [],
      startTime: s.meta.start_time,
      endTime: s.meta.end_time,
      videoUrl: matchingImage?.storage_path || "",
    };
  });

  const visualSource = imageAssets[0]?.type === "dalle_image" ? "dalle" : "pexels";
  
  // Extract mood levels from visual_beats for intelligent Ken Burns effect selection
  // visual_beats[i].moodLevel: 1-10 (1=calm, 10=intense/scary)
  const visualBeats = jobMeta.visual_beats || [];
  const moodLevels = scenes.map((_, i) => {
    const beat = visualBeats[i];
    // Default to 5 (medium) if no mood data available
    return beat?.moodLevel ?? 5;
  });
  console.log(`[ASSEMBLE] 🎭 Mood levels for Ken Burns: [${moodLevels.join(', ')}]`);
  
  // v3.1: Resolve effects profile with intensity controls
  // Priority: user overrides → preset defaults → art_style adjustments → system defaults
  const vibePreset = job.vibe_preset || "slow_creepy";
  const artStyle = jobMeta.art_style || "cinematic-dark";
  
  // v5.14: Extract Visual DNA from job meta for FFmpeg filter binding
  // CRITICAL: Suppress Visual DNA for uncanny-illustrated to prevent color tint
  // The illustrated style should NOT have Visual DNA color grading applied
  const rawVisualDNA = jobMeta.visual_dna || null;
  const isUncannyIllustrated = artStyle === 'uncanny-illustrated';
  const visualDNA = isUncannyIllustrated ? null : rawVisualDNA;
  
  if (rawVisualDNA) {
    console.log(`[ASSEMBLE] 🎨 Visual DNA detected:`);
    console.log(`[ASSEMBLE]   Style: ${rawVisualDNA.visual_style}`);
    console.log(`[ASSEMBLE]   Palette: ${rawVisualDNA.color_palette}`);
    console.log(`[ASSEMBLE]   Motion: ${rawVisualDNA.motion_profile}`);
    console.log(`[ASSEMBLE]   Platform: ${rawVisualDNA.platform}`);
    if (isUncannyIllustrated) {
      console.log(`[ASSEMBLE] ⚠️ UNCANNY-ILLUSTRATED OVERRIDE: Suppressing Visual DNA for video render`);
      console.log(`[ASSEMBLE]   Reason: Illustrated style should not have photographic color grading`);
    }
  }
  const effectsMode = jobMeta.effects_mode || "auto";
  
  // Get user overrides if custom mode, sanitize to prevent FFmpeg crashes
  let userEffectsOverrides: Partial<EffectsProfile> | null = null;
  if (effectsMode === "custom" && jobMeta.effects_profile) {
    try {
      userEffectsOverrides = sanitizeEffectsProfile(jobMeta.effects_profile);
      console.log(`[ASSEMBLE] Custom effects_profile sanitized (schema_version: ${SCHEMA_VERSION})`);
    } catch (err) {
      console.warn(`[ASSEMBLE] ⚠️ Failed to sanitize effects_profile, using preset defaults:`, (err as Error).message);
      // Fall back to null (will use preset defaults)
    }
  }
  
  // Convert legacy boolean effects to profile format for backwards compatibility
  const legacyOverrides = legacyEffectsToProfile(jobMeta);
  
  // Resolve final effects profile (fail-soft: returns valid profile even on error)
  let effectsProfile: EffectsProfile;
  try {
    effectsProfile = resolveEffectsProfile(
      vibePreset,
      artStyle,
      userEffectsOverrides || legacyOverrides
    );
  } catch (err) {
    console.warn(`[ASSEMBLE] ⚠️ resolveEffectsProfile failed, using system defaults:`, (err as Error).message);
    effectsProfile = resolveEffectsProfile(vibePreset, artStyle, null);
  }
  
  console.log(`[ASSEMBLE] 🎛️ Effects Profile (schema_version: ${SCHEMA_VERSION}):`);
  console.log(`[ASSEMBLE]   Mode: ${effectsMode}`);
  console.log(`[ASSEMBLE]   Vibe: ${vibePreset}, Art: ${artStyle}`);
  console.log(`[ASSEMBLE]   Active: ${profileToSummary(effectsProfile)}`);
  
  let renderId: string;
  
  if (useFFmpeg) {
    // Use FFmpeg renderer - wrap in try/catch to handle failures gracefully
    console.log("[ASSEMBLE] Calling FFmpeg renderer...");
    try {
      const result = await renderWithFFmpeg(
        audioUrlData.publicUrl,
        scenes,
        job.duration_sec || 60,
        options,
        job_id, // Pass job_id for direct Supabase upload
        captionsData.captions, // Pass captions for text overlay
        moodLevels, // Pass mood intensities for intelligent Ken Burns
        visualDNA, // v3.0: Pass Visual DNA for deterministic aesthetic binding
        effectsProfile // v3.1: Pass effects profile with intensity controls
      );
      renderId = result.renderId;
    } catch (ffmpegError) {
      // FFmpeg render failed to start - release lock and let check-job retry
      console.error(`[ASSEMBLE] FFmpeg render failed to start:`, (ffmpegError as Error).message);
      await updateJob(supabase, job_id, {
        progress: 71, // Stay at 71% to indicate ready for assembly but not started
        meta: { 
          ...jobMeta, 
          assemble_phase_running: false, // Release lock
          assemble_error: (ffmpegError as Error).message,
          assemble_retry_count: (jobMeta.assemble_retry_count || 0) + 1
        }
      });
      return { 
        status: "generating", 
        nextPhase: "assemble", 
        message: `FFmpeg error: ${(ffmpegError as Error).message}. Will retry...` 
      };
    }
  } else {
    // Use Creatomate
    console.log("[ASSEMBLE] Calling Creatomate...");
    renderId = await assembleVideoWithCreatomate(
      creatomateKey,
      audioUrlData.publicUrl,
      captionsData.captions,
      scenes,
      job.duration_sec || 60,
      options,
      visualSource
    );
  }

  // Save render job info
  await supabase.from("job_assets").upsert({
    job_id: job_id,
    type: "render_job",
    storage_path: renderId,
    meta: { 
      render_id: renderId, 
      status: "rendering", 
      started_at: new Date().toISOString(),
      renderer: useFFmpeg ? "ffmpeg" : "creatomate"
    },
  }, {
    onConflict: "job_id,type"
  });

  await updateJob(supabase, job_id, { 
    status: "rendering",
    progress: 75,
    meta: { 
      ...jobMeta, 
      render_id: renderId, 
      renderer: useFFmpeg ? "ffmpeg" : "creatomate",
      render_status: "processing",
      render_progress: 0,
      assemble_started_at: jobMeta.assemble_started_at || new Date().toISOString(),
      assemble_timeout_at: jobMeta.assemble_timeout_at || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }
  });

  // For FFmpeg renders: return immediately and let check-job poll for completion
  // This avoids edge function timeout issues for long renders
  // v3.2: Return consistent response with render_id for UI tracking
  if (useFFmpeg) {
    console.log(`[ASSEMBLE] FFmpeg render started (${renderId}), returning to let check-job poll`);
    return { 
      status: "assembling",  // Changed from "rendering" for UI clarity
      nextPhase: "poll",     // Signal UI to poll, not call run-job again
      message: "FFmpeg render started, polling for completion...",
      // @ts-ignore - Adding custom fields for UI
      render_id: renderId,
      job_id: job_id,
    };
  }

  // For Creatomate: still do short polling (it's usually faster)
  const maxWaitTime = 2 * 60 * 1000; // 2 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    let renderStatus;
    if (useFFmpeg) {
      renderStatus = await checkFFmpegRender(renderId);
    } else {
      renderStatus = await checkCreatomateRender(creatomateKey, renderId);
    }
    
    if (renderStatus.status === "succeeded" && renderStatus.url) {
      // Save final video (delete existing then insert to avoid constraint issues)
      await supabase.from("job_assets")
        .delete()
        .eq("job_id", job_id)
        .eq("type", "final_mp4");
      
      const { error: insertError } = await supabase.from("job_assets").insert({
        job_id: job_id,
        type: "final_mp4",
        storage_path: renderStatus.url,
        public_url: renderStatus.url,
        meta: { render_id: renderId, status: "complete", renderer: useFFmpeg ? "ffmpeg" : "creatomate" },
      });
      
      if (insertError) {
        console.error("[ASSEMBLE] Failed to save final_mp4:", insertError);
      } else {
        console.log(`[ASSEMBLE] Final video saved: ${renderStatus.url}`);
      }

      await updateJob(supabase, job_id, {
        status: "complete",
        progress: 100,
      });

      console.log(`[ASSEMBLE] Job ${job_id} complete!`);
      return { status: "complete", nextPhase: null, message: "Video ready!" };
    } else if (renderStatus.status === "failed") {
      const errorMsg = (renderStatus as any).error || (renderStatus as any).error_message || "Unknown error";
      throw new Error(`Render failed: ${errorMsg}`);
    }

    // Update progress
    const progress = 75 + Math.floor((renderStatus.progress || 0) * 0.25);
    await updateJob(supabase, job_id, { progress });
  }

  // Still rendering, will continue on next poll
  return { status: "rendering", nextPhase: "assemble", message: "Still rendering..." };
}

// =====================================================
// FULL GENERATION (Legacy - kept for backward compatibility)
// =====================================================
export async function runFullGeneration(
  supabase: any,
  openaiKey: string,
  elevenLabsKey: string,
  creatomateKey: string,
  pexelsKey: string,
  job: any,
  job_id: string,
  jobMeta: any,
  options: VideoOptions,
  visualSource: string,
  artStyle: string,
  customStyle: any
): Promise<{ status: string; message: string }> {
  try {
    console.log(`[BG] Starting full generation for job ${job_id}`);

    // Run audio phase
    await runAudioPhase(supabase, openaiKey, elevenLabsKey, job, job_id, jobMeta);
    
    // Refresh job data
    const { data: refreshedJob } = await supabase.from("jobs").select("*").eq("id", job_id).single();
    const refreshedMeta = refreshedJob?.meta || jobMeta;
    
    // Run images phase
    await runImagesPhase(supabase, openaiKey, pexelsKey, refreshedJob || job, job_id, refreshedMeta, visualSource, artStyle, customStyle);
    
    // Refresh again
    const { data: refreshedJob2 } = await supabase.from("jobs").select("*").eq("id", job_id).single();
    const refreshedMeta2 = refreshedJob2?.meta || refreshedMeta;
    
    // Run assemble phase
    const result = await runAssemblePhase(supabase, creatomateKey, refreshedJob2 || job, job_id, refreshedMeta2, options);
    
    return { status: result.status, message: result.message };

  } catch (error) {
    console.error(`[BG] Job ${job_id} failed:`, error);
    
    await updateJob(supabase, job_id, {
      status: "failed",
      error: (error as Error).message,
    });
    
    return { status: "failed", message: (error as Error).message };
  }
}
