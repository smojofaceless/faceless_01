// =====================================================
// SIDEBAR COMPONENT
// Responsive sidebar navigation with collapse support
// =====================================================

class Sidebar {
    constructor(options = {}) {
        this.element = document.querySelector(options.selector || '.sidebar');
        this.toggleBtn = document.querySelector(options.toggleSelector || '.sidebar-toggle');
        this.mobileBreakpoint = options.mobileBreakpoint || 768;
        this.storageKey = 'sidebar-collapsed';
        this.isCollapsed = false;
        this.isMobile = false;

        if (this.element) {
            this.init();
        }
    }

    init() {
        // Check stored preference
        const stored = localStorage.getItem(this.storageKey);
        if (stored === 'true' && !this.checkMobile()) {
            this.collapse(false);
        }

        // Set up event listeners
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => this.toggle());
        }

        // Handle resize
        window.addEventListener('resize', debounce(() => this.handleResize(), 150));
        
        // Initial check
        this.handleResize();

        // Handle nav link clicks on mobile
        this.element.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                if (this.isMobile && !this.isCollapsed) {
                    this.collapse();
                }
            });
        });

        // Close on overlay click (mobile)
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.collapse());
        }
    }

    checkMobile() {
        return window.innerWidth < this.mobileBreakpoint;
    }

    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = this.checkMobile();

        if (this.isMobile && !wasMobile) {
            // Switched to mobile - collapse by default
            this.collapse(false);
        } else if (!this.isMobile && wasMobile) {
            // Switched to desktop - restore preference
            const stored = localStorage.getItem(this.storageKey);
            if (stored === 'true') {
                this.collapse(false);
            } else {
                this.expand(false);
            }
        }

        document.body.classList.toggle('is-mobile', this.isMobile);
    }

    toggle() {
        if (this.isCollapsed) {
            this.expand();
        } else {
            this.collapse();
        }
    }

    collapse(animate = true) {
        this.isCollapsed = true;
        this.element.classList.add('sidebar--collapsed');
        document.body.classList.remove('sidebar-open');
        
        if (!this.isMobile) {
            localStorage.setItem(this.storageKey, 'true');
        }

        this.element.dispatchEvent(new CustomEvent('sidebar:collapse'));
    }

    expand(animate = true) {
        this.isCollapsed = false;
        this.element.classList.remove('sidebar--collapsed');
        document.body.classList.add('sidebar-open');
        
        if (!this.isMobile) {
            localStorage.setItem(this.storageKey, 'false');
        }

        this.element.dispatchEvent(new CustomEvent('sidebar:expand'));
    }

    /**
     * Set active nav item by path
     * @param {string} path - Path to match
     */
    setActiveByPath(path) {
        const links = this.element.querySelectorAll('.nav-link');
        links.forEach(link => {
            const href = link.getAttribute('href');
            const isActive = href === path || 
                            (path !== '/' && href !== '/' && path.startsWith(href));
            link.classList.toggle('active', isActive);
        });
    }

    /**
     * Update active state based on current URL
     */
    updateActive() {
        const currentPath = window.location.pathname;
        this.setActiveByPath(currentPath);
    }
}

// Debounce helper (if not available from utils)
if (typeof debounce === 'undefined') {
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Sidebar };
}
