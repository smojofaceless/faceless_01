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
        length_preset: options.duration || 'medium',
        visual_preset: options.visual_preset || 'forest',
        visual_source: options.visual_source || 'dalle',
        art_style: options.art_style || 'cinematic-dark',
        scene_count: options.scene_count || 4,
        // Preview mode
        preview_only: options.preview_only || false,
        // Video effects
        effect_filter: options.effects?.filter ?? true,
        effect_kenburns: options.effects?.kenburns ?? true,
        effect_transitions: options.effects?.transitions ?? true,
        effect_vignette: options.effects?.vignette ?? true,
        // Audio (disabled by default now)
        audio_music: false,
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
 * Check the status of a job
 */
async function checkJob(jobId) {
    const client = getSupabaseClient();
    
    const { data, error } = await client.functions.invoke('check-job', {
        body: { job_id: jobId },
    });

    if (error) throw new Error(error.message);

    return data;
}
