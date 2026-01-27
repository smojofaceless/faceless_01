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
        },
    });

    if (error) throw new Error(error.message);
    if (!data.success) throw new Error(data.error);

    return data;
}

/**
 * Start running a video generation job
 */
async function runJob(jobId) {
    const client = getSupabaseClient();
    
    const { data, error } = await client.functions.invoke('run-job', {
        body: { job_id: jobId },
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
