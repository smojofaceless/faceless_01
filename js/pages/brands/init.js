// Page bootstrap and initialization
// Extracted from brands.html inline script

document.addEventListener('DOMContentLoaded', () => {
    console.log('Brands page: DOMContentLoaded');
    const sidebar = new Sidebar();

    window.addEventListener('contentengine:ready', () => {
        console.log('Brands page: contentengine:ready event received');
        init();
    });
    
    // Check if already initialized
    if (typeof contentEngine !== 'undefined' && contentEngine.initialized) {
        console.log('Brands page: contentEngine already initialized');
        init();
    } else {
        console.log('Brands page: contentEngine not yet initialized, waiting for event');
        // Fallback: try init after a short delay
        setTimeout(() => {
            if (typeof brandManager !== 'undefined') {
                console.log('Brands page: Fallback init');
                init();
            }
        }, 100);
    }
});

function init() {
    console.log('Brands page: init() called');
    loadBrands();
    setupModal();
    setupColorInputs();
    setupPresets();
    console.log('Brands page: init() complete');
}

// Niche emojis for card avatars
