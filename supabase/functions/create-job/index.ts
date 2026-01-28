import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
};

interface CreateJobRequest {
  // Content settings
  theme?: string;
  length_preset?: "short" | "medium" | "long" | "30" | "45" | "60" | "90";
  visual_preset?: "forest" | "hallway" | "attic" | "foggy" | "rain";
  visual_source?: "pexels" | "dalle";
  art_style?: string; // Built-in style key or "custom-*" for custom styles
  custom_style?: {    // Custom style data (only when art_style starts with "custom-")
    name: string;
    basePrompt: string;
    colorOverride: string;
    technicalStyle: string;
    negativePrompt: string;
  };
  scene_count?: number;
  // Preview mode
  preview_only?: boolean;
  // Effects
  effect_filter?: boolean;
  effect_kenburns?: boolean;
  effect_transitions?: boolean;
  effect_vignette?: boolean;
  // Audio
  audio_music?: boolean;
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
    '30': '30',
    '45': '45',
    '60': '60',
    '90': '90',
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
      visual_source: body.visual_source || "dalle",
      art_style: body.art_style || "cinematic-dark",
      scene_count: body.scene_count || 4,
      effect_filter: body.effect_filter !== false,
      effect_kenburns: body.effect_kenburns !== false,
      effect_transitions: body.effect_transitions !== false,
      effect_vignette: body.effect_vignette !== false,
      audio_music: body.audio_music === true,
      audio_sfx: body.audio_sfx === true,
      caption_style: body.caption_style || "bold",
      highlight_scary: body.highlight_scary !== false,
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
        vibe_preset: "slow_creepy",
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

    // If preview mode, generate story immediately
    if (isPreview) {
      // Generate story with GPT
      const theme = body.theme || "general";
      const durationSec = parseInt(lengthPreset);
      const sceneCount = body.scene_count || 4;
      
      const themePrompts: Record<string, string> = {
        general: "a creepy first-person horror story",
        paranormal: "a first-person ghost/paranormal encounter story",
        creature: "a first-person monster/creature horror story",
        psychological: "a first-person psychological horror story with an unreliable narrator",
        folklore: "a first-person urban legend or folklore horror story",
        cosmic: "a first-person cosmic/lovecraftian horror story",
      };
      
      const storyPrompt = themePrompts[theme] || themePrompts.general;
      
      console.log(`Generating story for theme: ${theme}, duration: ${durationSec}s`);
      
      try {
        const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `You are a viral horror story writer. Write ${storyPrompt} for a ${durationSec}-second video narration.

Requirements:
- First person perspective ("I")
- Present tense for immediacy
- ${sceneCount} distinct visual scenes/moments
- Hook in first sentence
- Building dread
- Shocking twist ending
- About ${Math.round(durationSec * 2.5)} words
- NO dialogue tags, NO "I said"
- Punchy, short sentences

Return JSON: {"title": "Catchy 3-5 word title", "story": "The full story text"}`,
              },
              {
                role: "user",
                content: "Write the horror story now.",
              },
            ],
            temperature: 0.9,
            response_format: { type: "json_object" },
          }),
        });

        if (!gptResponse.ok) {
          const errorText = await gptResponse.text();
          console.error(`GPT error: ${gptResponse.status} - ${errorText}`);
          throw new Error(`Failed to generate story: ${gptResponse.status}`);
        }

        const gptData = await gptResponse.json();
        console.log(`GPT response received, parsing...`);
        const storyData = JSON.parse(gptData.choices[0].message.content);
        console.log(`Story generated: ${storyData.title}`);

        // Update job with story
        await supabase.from("jobs").update({
          status: "preview",
          progress: 25,
          title: storyData.title,
          story_text: storyData.story,
        }).eq("id", job.id);

        // Split story into scenes
        const sentences = storyData.story.match(/[^.!?]+[.!?]+/g) || [storyData.story];
        const sentencesPerScene = Math.ceil(sentences.length / sceneCount);
        const scenes = [];
        
        for (let i = 0; i < sceneCount; i++) {
          const start = i * sentencesPerScene;
          const end = Math.min(start + sentencesPerScene, sentences.length);
          const sceneText = sentences.slice(start, end).join(' ').trim();
          scenes.push({
            index: i,
            text: sceneText,
            keywords: [],
            startTime: 0,
            endTime: 0,
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: "preview",
            job_id: job.id,
            title: storyData.title,
            story_text: storyData.story,
            scenes: scenes,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
        
      } catch (storyError) {
        console.error(`Story generation failed:`, storyError);
        // Update job to failed state (not 'error' - must be valid status)
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
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
