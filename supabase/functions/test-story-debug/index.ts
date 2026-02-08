/**
 * TEST ENDPOINT: Story Debug Module Verification
 * 
 * This endpoint tests the story_debug and visual_readiness modules
 * without running a full job. Use for local development/debugging.
 * 
 * Usage:
 *   POST /test-story-debug
 *   Body: { "story": "Your test story text...", "niche": "horror" }
 * 
 * Returns: { story_debug, visual_readiness, test_metadata }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildStoryDebugPayload, buildMinimalDebugPayload } from "../run-job/story_debug.ts";
import { analyzeVisualReadiness } from "../run-job/visual_readiness.ts";
import { getTemplateDefaults, getPresetProfile, buildEffectiveStoryProfile } from "../run-job/story_profile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { 
      story = "A dark figure emerged from the shadows of the abandoned warehouse. The air grew cold. Sarah couldn't move, paralyzed by fear as the entity drew closer. Its face was wrong—twisted, flickering between forms she almost recognized. The lights exploded overhead. In the darkness, she heard it whisper her name.",
      niche = "horror",
      vibe_preset = "urban_legend",
      test_mode = "full" // "full" | "minimal" | "visual_only"
    } = body;

    const startTime = Date.now();
    const results: Record<string, unknown> = {};

    // Test Visual Readiness (works for any mode)
    console.log(`[TEST] Analyzing visual readiness for niche: ${niche}`);
    const visualReadiness = analyzeVisualReadiness(story, niche);
    results.visual_readiness = visualReadiness;

    if (test_mode === "visual_only") {
      return new Response(
        JSON.stringify({
          success: true,
          test_mode,
          visual_readiness: visualReadiness,
          test_metadata: {
            duration_ms: Date.now() - startTime,
            story_length: story.length,
            word_count: story.split(/\s+/).length,
          }
        }, null, 2),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profile for testing
    const templateDefaults = getTemplateDefaults(niche);
    const presetProfile = getPresetProfile(vibe_preset);
    const effectiveProfile = buildEffectiveStoryProfile(niche, templateDefaults, presetProfile);
    results.story_profile = effectiveProfile;

    if (test_mode === "minimal") {
      // Test minimal debug payload (legacy mode)
      console.log(`[TEST] Building minimal debug payload`);
      const minimalDebug = buildMinimalDebugPayload(niche, vibe_preset);
      results.story_debug = minimalDebug;
    } else {
      // Test full debug payload (DNA mode simulation)
      console.log(`[TEST] Building full debug payload`);
      
      // Simulate DNA generation results
      const mockDnaResults = {
        niche,
        vibe_preset,
        story_mode: 'auto' as const,
        resolved_profile: effectiveProfile,
        merge_sources: {
          hasTemplate: !!templateDefaults,
          hasPreset: !!presetProfile,
          hasBrand: false,
          hasUser: false,
        },
        contract: null,
        contract_summary: `Test contract for ${niche} / ${vibe_preset}`,
        raw_story: story,
        canonical_story: story,
        final_story: story,
        stripped_story: story,
        canonicalization: {
          changed: false,
          original: story,
          canonical: story,
          notes: ['Test mode - no canonicalization applied'],
        },
        truncation: {
          truncated: false,
          originalWordCount: story.split(/\s+/).length,
          finalWordCount: story.split(/\s+/).length,
        },
        compliance: {
          passed: true,
          hard_failures: [],
          soft_failures: [],
          warnings: [],
        },
        generation_method: 'contract_compliant',
        repair_attempted: false,
        repair_succeeded: false,
      };

      const fullDebug = buildStoryDebugPayload(mockDnaResults);
      results.story_debug = fullDebug;
    }

    // Return combined results
    return new Response(
      JSON.stringify({
        success: true,
        test_mode,
        niche,
        vibe_preset,
        ...results,
        test_metadata: {
          duration_ms: Date.now() - startTime,
          story_length: story.length,
          word_count: story.split(/\s+/).length,
          modules_tested: ['story_debug', 'visual_readiness', 'story_profile'],
        }
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[TEST] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }, null, 2),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
