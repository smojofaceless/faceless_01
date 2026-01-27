// =====================================================
// MAIN APPLICATION
// =====================================================

// State
let currentJobId = null;
let pollInterval = null;

/**
 * Start the video generation process
 */
async function startGeneration() {
    const formValues = getFormValues();

    // Show progress UI
    showProgress();

    try {
        // Step 1: Create job
        updateStatus('Creating job...', 5);
        const createData = await createJob(formValues);
        
        currentJobId = createData.job_id;
        console.log('Job created:', currentJobId);

        // Step 2: Start job
        updateStatus('Starting generation...', 10);
        const runData = await runJob(currentJobId);

        // Check if we need to poll for render completion
        if (runData.status === 'rendering' || !runData.video_url) {
            updateStatus('Rendering video...', 85);
            startPolling(currentJobId);
        } else {
            // Success! Show result immediately
            showResult(runData);
        }

    } catch (error) {
        console.error('Generation failed:', error);
        showError(error.message);
    }
}

/**
 * Start polling for job completion
 */
function startPolling(jobId) {
    console.log('Starting to poll for job completion...');
    
    pollInterval = setInterval(async () => {
        try {
            const data = await checkJob(jobId);
            console.log('Poll result:', data);

            if (data.status === 'complete' && data.video_url) {
                stopPolling();
                showResult(data);
            } else if (data.status === 'failed') {
                stopPolling();
                showError(data.error || 'Video generation failed');
            } else {
                // Update progress based on render progress
                const progress = data.render_progress 
                    ? 80 + (data.render_progress * 0.2) 
                    : 85;
                updateStatus('Rendering video...', Math.round(progress));
            }
        } catch (err) {
            console.error('Poll exception:', err);
        }
    }, CONFIG.POLL_INTERVAL);
}

/**
 * Stop the polling interval
 */
function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

/**
 * Reset the generator to initial state
 */
function resetGenerator() {
    currentJobId = null;
    stopPolling();
    resetUI();
}

// =====================================================
// INITIALIZATION
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Supabase client
    initSupabase();
    console.log('Scary Story Generator initialized');
});
