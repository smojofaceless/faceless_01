// =====================================================
// API FUNCTIONS
// =====================================================

/**
 * Create a new video generation job
 */
async function createJob(options) {
    const client = getSupabaseClient();
    
    const { data, error } = await client.functions.invoke('create-job', {
        body: {
            length_preset: options.lengthPreset,
            vibe_preset: options.vibePreset,
            visual_preset: options.visualPreset,
            visual_source: options.visualSource, // 'pexels' or 'dalle'
            voice_speed: options.voiceSpeed,
            // Video effects
            effect_filter: options.effectFilter,
            effect_kenburns: options.effectKenburns,
            effect_transitions: options.effectTransitions,
            effect_vignette: options.effectVignette,
            // Audio
            audio_music: options.audioMusic,
            audio_sfx: options.audioSfx,
            // Captions
            caption_style: options.captionStyle,
            highlight_scary: options.highlightScary,
        },
    });

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}

/**
 * Preview job - generate story and scenes without rendering
 */
async function previewJob(jobId) {
    const client = getSupabaseClient();
    
    const { data, error } = await client.functions.invoke('run-job', {
        body: { 
            job_id: jobId,
            preview_only: true,
        },
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
            // Pass all effect options for rendering
            visual_source: options.visualSource,
            effect_filter: options.effectFilter,
            effect_kenburns: options.effectKenburns,
            effect_transitions: options.effectTransitions,
            effect_vignette: options.effectVignette,
            audio_music: options.audioMusic,
            audio_sfx: options.audioSfx,
            caption_style: options.captionStyle,
            highlight_scary: options.highlightScary,
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
