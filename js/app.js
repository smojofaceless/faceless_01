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

        // Step 2: Start generation - this runs async on the server
        updateStatus('Starting generation...', 5);
        
        // Start polling IMMEDIATELY to get real-time progress
        startPolling(currentJobId);
        
        // Also start the job (don't await - let it run in background)
        runJob(currentJobId, formValues).catch(err => {
            console.error('Run job error:', err);
            // Polling will catch the error status
        });

    } catch (error) {
        console.error('Generation failed:', error);
        showError(error.message);
    }
}

/**
 * Start polling for job completion with real progress updates
 */
function startPolling(jobId) {
    console.log('Starting to poll for job completion...');
    let lastProgress = 5;
    
    pollInterval = setInterval(async () => {
        try {
            const data = await checkJob(jobId);
            console.log('Poll result:', data);

            if (data.status === 'complete' && data.video_url) {
                stopPolling();
                showResult(data);
            } else if (data.status === 'failed' || data.status === 'error') {
                stopPolling();
                showError(data.error || 'Video generation failed');
            } else {
                // Use actual progress from backend
                let progress = data.progress || lastProgress;
                
                // Add render_progress if available (70-100 range)
                if (data.render_progress && data.status === 'rendering') {
                    progress = 70 + Math.round(data.render_progress * 0.3);
                }
                
                // Ensure progress always moves forward
                if (progress > lastProgress) {
                    lastProgress = progress;
                }
                
                // Update status text based on progress
                let statusText = 'Initializing...';
                if (progress >= 5 && progress < 25) statusText = 'Generating story...';
                else if (progress >= 25 && progress < 40) statusText = 'Creating captions...';
                else if (progress >= 40 && progress < 55) statusText = 'Generating voiceover...';
                else if (progress >= 55 && progress < 70) statusText = 'Selecting visuals...';
                else if (progress >= 70) statusText = 'Rendering video...';
                
                updateStatus(statusText, lastProgress);
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
