// =====================================================
// API FUNCTIONS
// =====================================================

/**
 * Create a new video generation job
 */
async function createJob(options) {
    const client = getSupabaseClient();
    
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