// =====================================================
// MAIN APPLICATION
// =====================================================

// State
let currentJobId = null;
let currentPreviewData = null;
let pollInterval = null;

/**
 * Start the preview/storyboard generation (no rendering)
 */
async function startPreview() {
    const formValues = getFormValues();

    // Show progress UI
    showProgress();

    try {
        // Step 1: Create job
        updateStatus('Creating job...', 5);
        const createData = await createJob(formValues);
        
        currentJobId = createData.job_id;
        console.log('Job created for preview:', currentJobId);

        // Step 2: Generate story and scenes only (preview mode)
        updateStatus('Generating story...', 15);
        const previewData = await previewJob(currentJobId);
        
        currentPreviewData = previewData;
        console.log('Preview data:', previewData);

        // Show the preview/storyboard
        showPreview(previewData);

    } catch (error) {
        console.error('Preview failed:', error);
        showError(error.message);
    }
}

/**
 * Regenerate story (new story, same settings)
 */
async function regenerateStory() {
    currentJobId = null;
    currentPreviewData = null;
    startPreview();
}

/**
 * Confirm preview and render the full video
 */
async function confirmAndRender() {
    if (!currentJobId) {
        showError('No job to render. Please preview first.');
        return;
    }

    const formValues = getFormValues();

    // Hide preview, show progress
    document.getElementById('preview-section').classList.add('hidden');
    showProgress();

    try {
        updateStatus('Rendering video...', 70);
        const runData = await runJob(currentJobId, formValues);

        // Poll for render completion
        if (runData.status === 'rendering' || !runData.video_url) {
            updateStatus('Rendering video...', 85);
            startPolling(currentJobId);
        } else {
            showResult(runData);
        }

    } catch (error) {
        console.error('Render failed:', error);
        showError(error.message);
    }
}

/**
 * Start the video generation process (direct, no preview)
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

        // Step 2: Start job with all options
        updateStatus('Starting generation...', 10);
        const runData = await runJob(currentJobId, formValues);

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
    currentPreviewData = null;
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
