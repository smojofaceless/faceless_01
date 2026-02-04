// =====================================================
// TOAST NOTIFICATION COMPONENT
// Handles toast notifications with auto-dismiss
// =====================================================

class ToastManager {
    constructor() {
        this.container = null;
        this.toasts = new Map();
        this.defaultDuration = 5000;
        this.init();
    }

    init() {
        // Create toast container if it doesn't exist
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    /**
     * Show a toast notification
     * @param {Object} options - Toast options
     * @param {string} options.message - Toast message
     * @param {string} options.type - Toast type: 'success', 'error', 'warning', 'info'
     * @param {number} options.duration - Duration in ms (0 for permanent)
     * @param {string} options.title - Optional title
     * @param {boolean} options.dismissible - Allow manual dismiss
     * @returns {string} Toast ID
     */
    show({ message, type = 'info', duration = this.defaultDuration, title = '', dismissible = true }) {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.id = id;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');

        const icon = this.getIcon(type);
        
        toast.innerHTML = `
            <div class="toast__icon">${icon}</div>
            <div class="toast__content">
                ${title ? `<div class="toast__title">${title}</div>` : ''}
                <div class="toast__message">${message}</div>
            </div>
            ${dismissible ? `<button class="toast__close" aria-label="Dismiss">&times;</button>` : ''}
        `;

        // Add dismiss handler
        if (dismissible) {
            const closeBtn = toast.querySelector('.toast__close');
            closeBtn.addEventListener('click', () => this.dismiss(id));
        }

        // Add to container
        this.container.appendChild(toast);
        this.toasts.set(id, toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('toast--visible');
        });

        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => this.dismiss(id), duration);
        }

        return id;
    }

    /**
     * Dismiss a toast
     * @param {string} id - Toast ID to dismiss
     */
    dismiss(id) {
        const toast = this.toasts.get(id);
        if (!toast) return;

        toast.classList.remove('toast--visible');
        toast.classList.add('toast--hiding');

        setTimeout(() => {
            toast.remove();
            this.toasts.delete(id);
        }, 300); // Match CSS animation duration
    }

    /**
     * Dismiss all toasts
     */
    dismissAll() {
        this.toasts.forEach((_, id) => this.dismiss(id));
    }

    /**
     * Get icon SVG for toast type
     * @param {string} type - Toast type
     * @returns {string} SVG icon
     */
    getIcon(type) {
        const icons = {
            success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
            </svg>`,
            error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M15 9l-6 6M9 9l6 6"/>
            </svg>`,
            warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <path d="M12 9v4M12 17h.01"/>
            </svg>`,
            info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4M12 8h.01"/>
            </svg>`
        };
        return icons[type] || icons.info;
    }

    // Convenience methods
    success(message, options = {}) {
        return this.show({ ...options, message, type: 'success' });
    }

    error(message, options = {}) {
        return this.show({ ...options, message, type: 'error', duration: 0 }); // Errors stay until dismissed
    }

    warning(message, options = {}) {
        return this.show({ ...options, message, type: 'warning' });
    }

    info(message, options = {}) {
        return this.show({ ...options, message, type: 'info' });
    }
}

// Create singleton instance
const toast = new ToastManager();

// Export for browser
window.toast = toast;
window.Toast = toast; // Alias for backward compatibility

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ToastManager, toast };
}
