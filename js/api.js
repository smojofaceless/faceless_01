// =====================================================
// API FUNCTIONS
// =====================================================

/**
 * Create a new video generation job
 */
async function createJob(options) {
    const client = getSupabaseClient();
    
    if (!client) {
        throw new Error('Supabase is not configured. Please check your config.js has valid SUPABASE_URL and SUPABASE_ANON_KEY, or ensure the Supabase SDK is loaded.');
    }
    
    // Build the request body
    const requestBody = {
        // Theme and content
        theme: options.theme || 'general',
        vibe_preset: options.vibe_preset || 'slow_creepy',
        length_preset: options.duration || 'medium',
        visual_preset: options.visual_preset || 'forest',
        visual_source: options.visual_source || 'ai',
        image_model: options.image_model || 'gpt-4o',  // dall-e-3, gpt-4o, or flux
        art_style: options.art_style || 'cinematic-dark',
        scene_count: options.scene_count || 4,
        // Preview mode
        preview_only: options.preview_only || false,
        // Debug mode - skip video assembly
        skip_video_assembly: options.skip_video_assembly || false,
        // Video effects - Transitions
        effect_fade_in: options.effects?.fadeIn ?? true,
        effect_fade_out: options.effects?.fadeOut ?? true,
        effect_transitions: options.effects?.transitions ?? true,
        // Video effects - Disturbance & Glitch
        effect_glitch_flicker: options.effects?.glitchFlicker ?? false,
        effect_vhs_tracking: options.effects?.vhsTracking ?? false,
        effect_scanlines: options.effects?.scanlines ?? false,
        effect_filmgrain: options.effects?.filmGrain ?? false,
        // Video effects - Atmospheric
        effect_kenburns: options.effects?.kenburns ?? true,
        effect_filter: options.effects?.filter ?? true,
        effect_vignette: options.effects?.vignette ?? true,
        effect_light_flicker: options.effects?.lightFlicker ?? false,
        effect_cold_creep: options.effects?.coldColorCreep ?? false,
        // Video effects - Psychological
        effect_heartbeat_zoom: options.effects?.heartbeatZoom ?? false,
        effect_negative_flash: options.effects?.negativeFlash ?? false,
        effect_edge_darkening: options.effects?.edgeDarkeningCreep ?? false,
        // Audio settings
        audio_music: options.audio?.music ?? false,
        audio_track: options.audio?.track || '',
        audio_volume: options.audio?.volume ?? 15,
        audio_sfx: false,
        // Captions
        caption_style: options.caption_style || 'bold',
        highlight_scary: options.effects?.highlight ?? true,
    };
    
    // If custom style, include the custom style data
    if (options.art_style?.startsWith('custom-') && options.custom_style) {
        requestBody.custom_style = options.custom_style;
    }
    
    const { data, error } = await client.functions.invoke('create-job', {
        body: requestBody,
    });

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}

/**
 * Start running a video generation job (full render)
 */
async function runJob(jobId, options = {}) {
    const client = getSupabaseClient();
    
    const { data, error } = await client.functions.invoke('run-job', {
        body: { 
            job_id: jobId,
            preview_only: false,
            // Optional story overrides
            title: options.title,
            story_text: options.story_text,
        },
    });

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}

/**
 * Run a specific phase of video generation
 * @param {string} jobId - The job ID
 * @param {string} phase - The phase to run: 'audio', 'images', 'assemble'
 * @param {object} options - Optional parameters
 * @returns {object} Phase result with nextPhase indicator
 */
async function runJobPhase(jobId, phase, options = {}) {
    const client = getSupabaseClient();
    
    console.log(`[API] runJobPhase: job=${jobId.substring(0,8)}..., phase=${phase}`);
    const startTime = performance.now();
    
    const { data, error } = await client.functions.invoke('run-job', {
        body: { 
            job_id: jobId,
            phase: phase,
            preview_only: false,
            ...options
        },
    });
    
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[API] runJobPhase completed in ${elapsed}s:`, data);

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}

/**
 * Run preview mode (story generation only, synchronous)
 * @param {string} jobId - The job ID
 * @returns {object} Preview result with story, title, scenes
 */
async function runPreviewMode(jobId) {
    const client = getSupabaseClient();
    
    console.log(`[API] runPreviewMode: job=${jobId.substring(0,8)}...`);
    const startTime = performance.now();
    
    const { data, error } = await client.functions.invoke('run-job', {
        body: { 
            job_id: jobId,
            preview_only: true,
        },
    });
    
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[API] runPreviewMode completed in ${elapsed}s:`, data);

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}

/**
 * Check the status of a job (with retry for transient errors)
 */
async function checkJob(jobId, retries = 3) {
    const client = getSupabaseClient();
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { data, error } = await client.functions.invoke('check-job', {
                body: { job_id: jobId },
            });

            if (error) {
                // Check if it's a transient error (502, 503, network issues)
                const isTransient = error.message?.includes('502') || 
                                   error.message?.includes('503') || 
                                   error.message?.includes('Failed to send') ||
                                   error.message?.includes('network');
                
                if (isTransient && attempt < retries) {
                    console.log(`[API] checkJob attempt ${attempt} failed (transient), retrying in ${attempt * 1000}ms...`);
                    await new Promise(r => setTimeout(r, attempt * 1000));
                    continue;
                }
                throw new Error(error.message);
            }

            return data;
        } catch (err) {
            if (attempt === retries) {
                throw new Error(`Failed to send a request to the Edge Function`);
            }
            console.log(`[API] checkJob attempt ${attempt} threw, retrying...`);
            await new Promise(r => setTimeout(r, attempt * 1000));
        }
    }
}

/**
 * Re-render video for an existing job (uses existing images + audio)
 * This skips the expensive audio/image generation phases
 */
async function reRenderVideo(jobId) {
    const client = getSupabaseClient();
    
    // First fetch the current job to get its meta
    const { data: job, error: fetchError } = await client
        .from('jobs')
        .select('meta')
        .eq('id', jobId)
        .single();
    
    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    
    // Clear render-related fields from meta
    const updatedMeta = { ...(job.meta || {}) };
    delete updatedMeta.video_render_id;
    delete updatedMeta.render_status;
    delete updatedMeta.ffmpeg_render_id;
    
    // Reset the job status so it can be re-processed
    const { error: updateError } = await client
        .from('jobs')
        .update({ 
            status: 'generating',
            progress: 70,  // Set to assemble phase
            error: null,
            meta: updatedMeta
        })
        .eq('id', jobId);
    
    if (updateError) throw new Error(`Failed to reset job: ${updateError.message}`);
    
    // Delete existing final_mp4 asset so a new one can be created
    await client
        .from('job_assets')
        .delete()
        .eq('job_id', jobId)
        .eq('type', 'final_mp4');
    
    // Trigger the assemble phase directly
    const { data, error } = await client.functions.invoke('run-job', {
        body: { 
            job_id: jobId,
            phase: 'assemble',  // Skip audio and images phases
        },
    });

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}
// =====================================================
// AUDIO LIBRARY FUNCTIONS
// =====================================================

const AUDIO_BUCKET = 'story-videos';
const AUDIO_PATH = 'music';

/**
 * List all audio tracks in the library
 */
async function listAudioTracks() {
    const client = getSupabaseClient();
    
    const { data, error } = await client.storage
        .from(AUDIO_BUCKET)
        .list(AUDIO_PATH, {
            sortBy: { column: 'name', order: 'asc' }
        });
    
    if (error) throw new Error(`Failed to list audio: ${error.message}`);
    
    // Filter to only audio files
    return (data || []).filter(file => 
        file.name && /\.(mp3|wav|m4a|ogg)$/i.test(file.name)
    );
}

/**
 * Upload an audio track to the library
 */
async function uploadAudioTrack(file) {
    const client = getSupabaseClient();
    
    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${AUDIO_PATH}/${safeName}`;
    
    const { data, error } = await client.storage
        .from(AUDIO_BUCKET)
        .upload(path, file, {
            cacheControl: '3600',
            upsert: true, // Replace if exists
            contentType: file.type || 'audio/mpeg'
        });
    
    if (error) throw new Error(`Failed to upload audio: ${error.message}`);
    
    return data;
}

/**
 * Delete an audio track from the library
 */
async function removeAudioTrack(filename) {
    const client = getSupabaseClient();
    
    const path = `${AUDIO_PATH}/${filename}`;
    
    const { error } = await client.storage
        .from(AUDIO_BUCKET)
        .remove([path]);
    
    if (error) throw new Error(`Failed to delete audio: ${error.message}`);
}

/**
 * Get the public URL for an audio track
 */
function getAudioTrackUrl(filename) {
    const supabaseUrl = CONFIG?.SUPABASE_URL || 'https://ustmetegzisztqqcjigt.supabase.co';
    return `${supabaseUrl}/storage/v1/object/public/${AUDIO_BUCKET}/${AUDIO_PATH}/${filename}`;
}

// =====================================================
// DIRECT OPENAI STORY GENERATION (Client-side)
// Uses API keys from settings
// =====================================================

/**
 * Generate a story using direct OpenAI API call
 * This uses the client-side API keys from settings
 */
async function generateStory(options) {
    // Get API key from settings
    const openaiKey = window.apiKeys?.get('openai');
    
    if (!openaiKey) {
        throw new Error('OpenAI API key not configured. Please add it in Settings.');
    }
    
    // Extract options
    const settings = options.settings || options;
    const niche = options.niche || settings.niche || 'general';
    const customPrompt = options.prompt; // Template-provided prompt
    
    // Get niche-specific config if available
    const nicheConfig = window.getNicheConfig ? window.getNicheConfig(niche) : null;
    const promptPrefix = nicheConfig?.promptPrefix || '';
    
    // Build the system prompt
    let systemPrompt = `You are a creative content writer specializing in short-form video scripts.
Create engaging, attention-grabbing content that works well for TikTok, YouTube Shorts, and Instagram Reels.
Write in a natural, conversational style that hooks viewers from the first sentence.
${promptPrefix}

IMPORTANT: Always return valid JSON. Parse your response carefully.`;

    // Use the template's custom prompt if provided, otherwise build a generic one
    let userPrompt;
    
    if (customPrompt) {
        // Template provided its own prompt - use it directly
        // This allows templates to define their own output format (facts, story, etc.)
        userPrompt = customPrompt;
    } else {
        // Build a generic prompt
        const contentType = settings.contentType || settings.category || 'story';
        const style = settings.style || settings.visualStyle || 'engaging';
        const duration = settings.duration || 'medium';
        const topic = settings.topic || settings.theme || niche;
        const sceneCount = settings.sceneCount || 5;
        const imagePromptSuffix = nicheConfig?.imagePromptSuffix || '';
        
        // Get word count target based on duration
        const wordTargets = {
            short: { min: 80, max: 120 },
            medium: { min: 120, max: 180 },
            long: { min: 180, max: 250 }
        };
        const words = wordTargets[duration] || wordTargets.medium;
        
        userPrompt = `Create a ${contentType} about "${topic}".

Requirements:
- Length: ${words.min}-${words.max} words (for a ${duration} video)
- Style: ${style}
- Niche/Theme: ${niche}
- Number of natural scene breaks: ${sceneCount}

Format your response as JSON:
{
    "title": "Catchy title",
    "story": "The full story text with natural paragraph breaks",
    "scenes": [
        { "text": "Scene 1 text", "imagePrompt": "Visual description for this scene${imagePromptSuffix}" },
        { "text": "Scene 2 text", "imagePrompt": "Visual description for this scene${imagePromptSuffix}" }
    ],
    "hook": "First attention-grabbing sentence"
}`;
    }

    try {
        console.log('[API] Generating content with prompt:', userPrompt.substring(0, 200) + '...');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.8,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(error.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0]?.message?.content) {
            throw new Error('Invalid response from OpenAI API');
        }
        
        const content = JSON.parse(data.choices[0].message.content);
        console.log('[API] Generated content:', content);
        
        // Return the raw content - let the video-generator handle the format
        return {
            success: true,
            ...content
        };
    } catch (error) {
        console.error('[API] Story generation error:', error);
        throw new Error(`Story generation failed: ${error.message}`);
    }
}

// =====================================================
// API NAMESPACE - Global access to all API functions
// =====================================================

const API = {
    // Job management
    createJob,
    runJob,
    runJobPhase,
    runPreviewMode,
    checkJob,
    reRenderVideo,
    
    // Content generation
    generateStory,
    
    // Audio library
    listAudioTracks,
    uploadAudioTrack,
    removeAudioTrack,
    getAudioTrackUrl
};

// Also expose individual functions for direct access
window.createJob = createJob;
window.runJob = runJob;
window.runJobPhase = runJobPhase;
window.runPreviewMode = runPreviewMode;
window.checkJob = checkJob;

// Export to global scope
window.API = API;