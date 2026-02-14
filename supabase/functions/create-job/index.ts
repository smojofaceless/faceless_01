import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

interface CreateJobRequest {
  // Content settings
  theme?: string;
  // v4.0: Only two active story engines. Deprecated presets map to urban_legend on backend.
  vibe_preset?: "urban_legend" | "one_too_many" | "reddit_trending_horror";
  length_preset?: "short" | "medium" | "long" | "30" | "45" | "60" | "90" | "120";
  visual_preset?: "forest" | "hallway" | "attic" | "foggy" | "rain";
  visual_source?: "pexels" | "ai";
  image_model?: "dall-e-3" | "gpt-4o" | "flux";  // AI image model selection
  art_style?: string; // Built-in style key or "custom-*" for custom styles
  custom_style?: {    // Custom style data (only when art_style starts with "custom-")
    name: string;
    basePrompt: string;
    colorOverride: string;
    technicalStyle: string;
    negativePrompt: string;
  };
  scene_count?: number;
  // Scene count mode: 'strict' = exact count (no fusion), 'auto' = allow fusion for coherence
  scene_count_mode?: "strict" | "auto";
  // DNA/advanced settings
  era?: string;           // e.g., "1970s", "1980s"
  tone?: number;          // 0-1 scale
  ending?: string;        // e.g., "suppressed", "cyclical"
  pace?: string;          // e.g., "slow", "fast"
  platform?: string;      // e.g., "reels", "tiktok", "shorts"
  visual_dna_override?: any;  // Optional Visual DNA override
  // Preview mode
  preview_only?: boolean;
  // Debug mode - skip video assembly
  skip_video_assembly?: boolean;
  // Effects - Transitions
  effect_fade_in?: boolean;
  effect_fade_out?: boolean;
  effect_transitions?: boolean;
  // Effects - Disturbance & Glitch
  effect_glitch_flicker?: boolean;
  effect_vhs_tracking?: boolean;
  effect_scanlines?: boolean;
  effect_filmgrain?: boolean;
  // Effects - Atmospheric
  effect_kenburns?: boolean;
  effect_filter?: boolean;
  effect_vignette?: boolean;
  effect_light_flicker?: boolean;
  effect_cold_creep?: boolean;
  // Effects - Psychological
  effect_heartbeat_zoom?: boolean;
  effect_negative_flash?: boolean;
  effect_edge_darkening?: boolean;
  // Effects Profile (v1.0) - intensity-based effects configuration
  // When provided, this overrides individual effect_* booleans
  effects_profile?: {
    version?: string;
    transitions?: { enabled?: boolean; intensity?: number; type?: string; duration?: number };
    kenburns?: { enabled?: boolean; intensity?: number; zoom_amount?: number; speed?: number; direction?: string };
    color_grade?: { enabled?: boolean; intensity?: number; preset?: string; contrast?: number; saturation?: number; brightness?: number; temperature?: number };
    vignette?: { enabled?: boolean; intensity?: number; radius?: number; softness?: number };
    film_grain?: { enabled?: boolean; intensity?: number; size?: number; color?: boolean };
    scanlines?: { enabled?: boolean; intensity?: number; spacing?: number; thickness?: number; flicker?: boolean };
    vhs?: { enabled?: boolean; intensity?: number; tracking_noise?: number; color_bleed?: number; tape_crinkle?: number; jitter?: number };
    glitch?: { enabled?: boolean; intensity?: number; frequency?: number; duration?: number; rgb_shift?: number; block_shift?: boolean };
    light_flicker?: { enabled?: boolean; intensity?: number; frequency?: number; variation?: number };
    fade?: { fade_in?: boolean; fade_in_duration?: number; fade_out?: boolean; fade_out_duration?: number };
    edge_darken?: { enabled?: boolean; intensity?: number; creep_speed?: number };
    heartbeat_zoom?: { enabled?: boolean; intensity?: number };
    negative_flash?: { enabled?: boolean; intensity?: number };
  };
  // Effects mode: 'auto' = derive from preset, 'custom' = use effects_profile overrides
  effects_mode?: "auto" | "custom";
  // Story Profile (v1.0) - narrative structure configuration
  // When provided, this overrides default story generation behavior
  story_profile?: {
    version?: string;
    voiceFormat?: { format?: string; structuralMarkers?: string[]; enforceMarkers?: boolean; povConstraint?: string; styleNotes?: string };
    motif?: { minMentions?: number; shouldEscalate?: boolean; distribution?: string };
    uniqueElement?: { minAppearances?: number; requireEscalation?: boolean; finalMentionPosition?: string };
    beatStructure?: { beatCount?: number; beatLabels?: string[]; requireGroundingDetail?: boolean; groundingTypes?: string[] };
    embodiment?: { eraLevel?: string; requirePeriodObjects?: boolean; requireLocationSensory?: boolean };
    authority?: { style?: string; minDetailSentences?: number };
    ending?: { antiClosure?: number; enforceFinalImage?: boolean; allowedEndingTypes?: string[]; takeaway?: { enabled?: boolean; style?: string } };
    wordCount?: { target?: number; variance?: number; priority?: string };
  };
  // Story mode: 'auto' = derive from niche/preset, 'custom' = use story_profile overrides
  story_mode?: "auto" | "custom";
  // Audio
  audio_music?: boolean;
  audio_track?: string;
  audio_volume?: number;
  audio_sfx?: boolean;
  // Captions
  caption_style?: string;
  highlight_scary?: boolean;
}

// Map duration presets
function mapDuration(preset: string): string {
  const map: Record<string, string> = {
    'short': '30',
    'medium': '45',
    'long': '60',
    'extended': '90',
    'full': '120',
    '30': '30',
    '45': '45',
    '60': '60',
    '90': '90',
    '120': '120',
  };
  return map[preset] || '45';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: CreateJobRequest = await req.json().catch(() => ({}));

    // Build options meta object
    const optionsMeta: Record<string, any> = {
      theme: body.theme || "general",
      visual_source: body.visual_source || "ai",
      image_model: body.image_model || "gpt-4o",  // Default to GPT-4o for balanced cost/quality
      art_style: body.art_style || "cinematic-dark",
      scene_count: body.scene_count || 4,
      scene_count_mode: body.scene_count_mode || "strict",  // Default to strict (no fusion)
      skip_video_assembly: body.skip_video_assembly === true,
      // Transitions - store explicit boolean values
      effect_fade_in: body.effect_fade_in === true,
      effect_fade_out: body.effect_fade_out === true,
      effect_transitions: body.effect_transitions === true,
      // Disturbance & Glitch
      effect_glitch_flicker: body.effect_glitch_flicker === true,
      effect_vhs_tracking: body.effect_vhs_tracking === true,
      effect_scanlines: body.effect_scanlines === true,
      effect_filmgrain: body.effect_filmgrain === true,
      // Atmospheric - store explicit boolean values  
      effect_kenburns: body.effect_kenburns === true,
      effect_filter: body.effect_filter === true,
      effect_vignette: body.effect_vignette === true,
      effect_light_flicker: body.effect_light_flicker === true,
      effect_cold_creep: body.effect_cold_creep === true,
      // Psychological
      effect_heartbeat_zoom: body.effect_heartbeat_zoom === true,
      effect_negative_flash: body.effect_negative_flash === true,
      effect_edge_darkening: body.effect_edge_darkening === true,
      // Audio
      audio_music: body.audio_music === true,
      audio_track: body.audio_track || '',
      audio_volume: body.audio_volume ?? 15,
      audio_sfx: body.audio_sfx === true,
      // Captions
      caption_style: body.caption_style || "bold",
      highlight_scary: body.highlight_scary !== false,
      // DNA/advanced settings
      era: body.era || null,
      tone: body.tone ?? null,
      ending: body.ending || null,
      pace: body.pace || null,
      platform: body.platform || "default",
      visual_dna_override: body.visual_dna_override || null,
      // Effects Profile v1.0 - intensity-based effects
      effects_mode: body.effects_mode || "auto",  // auto = derive from preset, custom = use overrides
      effects_profile: body.effects_profile || null,  // User overrides for effects (when effects_mode=custom)
      // Story Profile v1.0 - narrative structure enforcement
      story_mode: body.story_mode || "auto",  // auto = derive from niche/preset, custom = use overrides
      story_profile: body.story_profile || null,  // User overrides for story (when story_mode=custom)
    };
    
    // If custom style, include the custom style data in meta
    if (body.art_style?.startsWith('custom-') && body.custom_style) {
      optionsMeta.custom_style = body.custom_style;
    }

    const lengthPreset = mapDuration(body.length_preset || 'medium');
    const isPreview = body.preview_only === true;

    console.log(`Creating job: length=${lengthPreset}, preview=${isPreview}`);
    console.log(`Options meta:`, JSON.stringify(optionsMeta));

    // Create job
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        status: isPreview ? "generating" : "queued",
        progress: isPreview ? 5 : 0,
        length_preset: lengthPreset,
        vibe_preset: body.vibe_preset || "slow_creepy",
        visual_preset: body.visual_preset || "forest",
        voice_id: "pNInz6obpgDQGcFmaJgB", // Adam voice
        prompt_version: "v1",
        meta: optionsMeta,
      })
      .select()
      .single();

    if (error) {
      console.error("Job creation error:", error);
      throw new Error(`Failed to create job: ${error.message} (code: ${error.code})`);
    }
    
    console.log(`Job created: ${job.id}`);

    // If preview mode, call run-job to generate story (which has all the vibe-specific prompts)
    if (isPreview) {
      console.log(`[PREVIEW] Calling run-job for story generation (vibe: ${body.vibe_preset || 'slow_creepy'})...`);
      
      // Get the run-job URL (same project, different function)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const runJobUrl = `${supabaseUrl}/functions/v1/run-job`;
      
      try {
        const runJobResponse = await fetch(runJobUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            job_id: job.id,
            preview_only: true,
          }),
        });
        
        if (!runJobResponse.ok) {
          const errorText = await runJobResponse.text();
          console.error(`run-job error: ${runJobResponse.status} - ${errorText}`);
          throw new Error(`Failed to generate story: ${runJobResponse.status}`);
        }
        
        // Return the run-job response directly (it has all the story data)
        const runJobData = await runJobResponse.json();
        console.log(`[PREVIEW] Story generated via run-job: ${runJobData.title || 'untitled'}`);
        
        return new Response(
          JSON.stringify(runJobData),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
        
      } catch (storyError: any) {
        console.error(`Story generation failed:`, storyError);
        // Update job to failed state
        await supabase.from("jobs").update({
          status: "failed",
          error: storyError.message,
        }).eq("id", job.id);
        
        throw storyError;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: job.id,
        message: "Job created successfully. Call run-job to start generation.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("[CREATE-JOB] fatal", {
      message: error?.message,
      stack: error?.stack,
    });
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
        stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
