// =====================================================
// UI UTILITIES
// =====================================================

// DOM Element references (cached for performance)
const DOM = {
    get generatorForm() { return document.getElementById('generator-form'); },
    get progressSection() { return document.getElementById('progress-section'); },
    get resultSection() { return document.getElementById('result-section'); },
    get errorSection() { return document.getElementById('error-section'); },
    get statusText() { return document.getElementById('status-text'); },
    get progressPercent() { return document.getElementById('progress-percent'); },
    get progressBar() { return document.getElementById('progress-bar'); },
    get videoTitle() { return document.getElementById('video-title'); },
    get videoDuration() { return document.getElementById('video-duration'); },
    get videoPlayer() { return document.getElementById('video-player'); },
    get downloadBtn() { return document.getElementById('download-btn'); },
    get errorMessage() { return document.getElementById('error-message'); },
    get lengthPreset() { return document.getElementById('length-preset'); },
    get vibePreset() { return document.getElementById('vibe-preset'); },
    get visualPreset() { return document.getElementById('visual-preset'); },
};

// Step IDs for progress tracking
const STEPS = ['step-story', 'step-captions', 'step-audio', 'step-visuals', 'step-render'];

// Progress thresholds for each step
const STEP_THRESHOLDS = {
    'step-story': 25,
    'step-captions': 40,
    'step-audio': 55,
    'step-visuals': 70,
    'step-render': 95,
};

/**
 * Update the progress bar and status text
 */
function updateStatus(text, progress) {
    DOM.statusText.textContent = text;
    DOM.progressPercent.textContent = `${progress}%`;
    DOM.progressBar.style.width = `${progress}%`;

    // Update step indicators based on progress
    for (const [stepId, threshold] of Object.entries(STEP_THRESHOLDS)) {
        if (progress >= threshold) {
            markStepComplete(stepId);
        }
    }
}

/**
 * Mark a step as complete with checkmark
 */
function markStepComplete(stepId) {
    const step = document.getElementById(stepId);
    if (step) {
        step.classList.remove('text-gray-500');
        step.classList.add('text-green-400');
        const icon = step.querySelector('.step-icon');
        if (icon) icon.textContent = '✓';
    }
}

/**
 * Reset a step to incomplete state
 */
function resetStep(stepId) {
    const step = document.getElementById(stepId);
    if (step) {
        step.classList.remove('text-green-400');
        step.classList.add('text-gray-500');
        const icon = step.querySelector('.step-icon');
        if (icon) icon.textContent = '○';
    }
}

/**
 * Show the progress section and disable the form
 */
function showProgress() {
    DOM.generatorForm.classList.add('opacity-50', 'pointer-events-none');
    DOM.progressSection.classList.remove('hidden');
    DOM.resultSection.classList.add('hidden');
    DOM.errorSection.classList.add('hidden');
}

/**
 * Show the result section with video
 */
function showResult(data) {
    DOM.progressSection.classList.add('hidden');
    DOM.resultSection.classList.remove('hidden');
    DOM.generatorForm.classList.remove('opacity-50', 'pointer-events-none');

    DOM.videoTitle.textContent = data.title || 'Untitled Story';
    DOM.videoDuration.textContent = `Duration: ${data.duration_sec} seconds`;
    DOM.videoPlayer.src = data.video_url;
    DOM.downloadBtn.href = data.video_url;
}

/**
 * Show the error section with message
 */
function showError(message) {
    DOM.progressSection.classList.add('hidden');
    DOM.errorSection.classList.remove('hidden');
    DOM.generatorForm.classList.remove('opacity-50', 'pointer-events-none');
    DOM.errorMessage.textContent = message;
}

/**
 * Reset the UI to initial state
 */
function resetUI() {
    DOM.generatorForm.classList.remove('opacity-50', 'pointer-events-none');
    DOM.progressSection.classList.add('hidden');
    DOM.resultSection.classList.add('hidden');
    DOM.errorSection.classList.add('hidden');
    
    // Reset progress
    updateStatus('Initializing...', 0);
    
    // Reset all step indicators
    STEPS.forEach(resetStep);
}

/**
 * Get the current form values
 */
function getFormValues() {
    return {
        lengthPreset: DOM.lengthPreset.value,
        vibePreset: DOM.vibePreset.value,
        visualPreset: DOM.visualPreset.value,
    };
}
