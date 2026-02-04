// =====================================================
// LOADING STATE COMPONENT
// Spinner, skeleton, and progress indicators
// =====================================================

class Loader {
    /**
     * Create a spinner element
     * @param {Object} options - Spinner options
     * @returns {HTMLElement} Spinner element
     */
    static spinner({ size = 'medium', color = 'primary' } = {}) {
        const spinner = document.createElement('div');
        spinner.className = `spinner spinner--${size} spinner--${color}`;
        spinner.setAttribute('role', 'status');
        spinner.setAttribute('aria-label', 'Loading');
        spinner.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" opacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
            </svg>
        `;
        return spinner;
    }

    /**
     * Create a skeleton placeholder
     * @param {Object} options - Skeleton options
     * @returns {HTMLElement} Skeleton element
     */
    static skeleton({ type = 'text', lines = 3, width = '100%', height = 'auto' } = {}) {
        const container = document.createElement('div');
        container.className = 'skeleton-container';
        
        if (type === 'text') {
            for (let i = 0; i < lines; i++) {
                const line = document.createElement('div');
                line.className = 'skeleton skeleton--text';
                line.style.width = i === lines - 1 ? '70%' : '100%';
                container.appendChild(line);
            }
        } else if (type === 'card') {
            container.innerHTML = `
                <div class="skeleton skeleton--image"></div>
                <div class="skeleton skeleton--title"></div>
                <div class="skeleton skeleton--text"></div>
                <div class="skeleton skeleton--text" style="width: 60%"></div>
            `;
        } else if (type === 'avatar') {
            const avatar = document.createElement('div');
            avatar.className = 'skeleton skeleton--avatar';
            container.appendChild(avatar);
        } else if (type === 'custom') {
            const custom = document.createElement('div');
            custom.className = 'skeleton';
            custom.style.width = width;
            custom.style.height = height;
            container.appendChild(custom);
        }

        return container;
    }

    /**
     * Create a progress bar
     * @param {Object} options - Progress options
     * @returns {Object} Progress element with update method
     */
    static progress({ value = 0, max = 100, showLabel = true, color = 'primary' } = {}) {
        const container = document.createElement('div');
        container.className = 'progress-container';
        
        const bar = document.createElement('div');
        bar.className = `progress progress--${color}`;
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', max);
        bar.setAttribute('aria-valuenow', value);

        const fill = document.createElement('div');
        fill.className = 'progress__fill';
        fill.style.width = `${(value / max) * 100}%`;

        bar.appendChild(fill);
        container.appendChild(bar);

        let label = null;
        if (showLabel) {
            label = document.createElement('span');
            label.className = 'progress__label';
            label.textContent = `${Math.round((value / max) * 100)}%`;
            container.appendChild(label);
        }

        // Return with update method
        return {
            element: container,
            update(newValue) {
                fill.style.width = `${(newValue / max) * 100}%`;
                bar.setAttribute('aria-valuenow', newValue);
                if (label) {
                    label.textContent = `${Math.round((newValue / max) * 100)}%`;
                }
            },
            complete() {
                fill.style.width = '100%';
                bar.setAttribute('aria-valuenow', max);
                if (label) {
                    label.textContent = '100%';
                }
                bar.classList.add('progress--complete');
            }
        };
    }

    /**
     * Show loading overlay on an element
     * @param {HTMLElement} element - Element to cover
     * @param {string} message - Optional loading message
     * @returns {Function} Function to remove overlay
     */
    static overlay(element, message = 'Loading...') {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-overlay__content">
                ${Loader.spinner({ size: 'large' }).outerHTML}
                ${message ? `<p class="loading-overlay__message">${message}</p>` : ''}
            </div>
        `;

        element.style.position = element.style.position || 'relative';
        element.appendChild(overlay);
        element.classList.add('is-loading');

        return () => {
            overlay.remove();
            element.classList.remove('is-loading');
        };
    }

    /**
     * Show full-page loading screen
     * @param {string} message - Loading message
     * @returns {Function} Function to remove loading screen
     */
    static fullPage(message = 'Loading...') {
        const loader = document.createElement('div');
        loader.className = 'fullpage-loader';
        loader.innerHTML = `
            <div class="fullpage-loader__content">
                ${Loader.spinner({ size: 'large' }).outerHTML}
                <p class="fullpage-loader__message">${message}</p>
            </div>
        `;

        document.body.appendChild(loader);
        document.body.classList.add('is-loading');

        return () => {
            loader.remove();
            document.body.classList.remove('is-loading');
        };
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Loader };
}
