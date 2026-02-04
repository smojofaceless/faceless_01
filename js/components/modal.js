// =====================================================
// MODAL COMPONENT
// Reusable modal/dialog with accessibility support
// =====================================================

class Modal {
    constructor(options = {}) {
        this.id = options.id || `modal-${Date.now()}`;
        this.title = options.title || '';
        this.content = options.content || '';
        this.size = options.size || 'medium'; // small, medium, large, full
        this.closable = options.closable !== false;
        this.onOpen = options.onOpen || null;
        this.onClose = options.onClose || null;
        this.element = null;
        this.previouslyFocused = null;
        this.isOpen = false;
    }

    /**
     * Create the modal DOM structure
     */
    create() {
        const modal = document.createElement('div');
        modal.className = `modal modal--${this.size}`;
        modal.id = this.id;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', `${this.id}-title`);
        modal.setAttribute('tabindex', '-1');

        modal.innerHTML = `
            <div class="modal__backdrop"></div>
            <div class="modal__dialog">
                <div class="modal__header">
                    <h2 class="modal__title" id="${this.id}-title">${this.title}</h2>
                    ${this.closable ? `<button class="modal__close" aria-label="Close modal">&times;</button>` : ''}
                </div>
                <div class="modal__body">
                    ${this.content}
                </div>
                <div class="modal__footer"></div>
            </div>
        `;

        // Event listeners
        if (this.closable) {
            const backdrop = modal.querySelector('.modal__backdrop');
            const closeBtn = modal.querySelector('.modal__close');
            
            backdrop.addEventListener('click', () => this.close());
            closeBtn.addEventListener('click', () => this.close());
        }

        // Escape key to close
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.closable) {
                this.close();
            }
        });

        document.body.appendChild(modal);
        this.element = modal;

        return this;
    }

    /**
     * Open the modal
     */
    open() {
        if (!this.element) {
            this.create();
        }

        this.previouslyFocused = document.activeElement;
        document.body.classList.add('modal-open');
        this.element.classList.add('modal--visible');
        this.isOpen = true;

        // Focus trap
        this.element.focus();

        if (this.onOpen) {
            this.onOpen(this);
        }

        return this;
    }

    /**
     * Close the modal
     */
    close() {
        if (!this.element || !this.isOpen) return;

        this.element.classList.remove('modal--visible');
        document.body.classList.remove('modal-open');
        this.isOpen = false;

        // Restore focus
        if (this.previouslyFocused) {
            this.previouslyFocused.focus();
        }

        if (this.onClose) {
            this.onClose(this);
        }

        return this;
    }

    /**
     * Destroy the modal
     */
    destroy() {
        this.close();
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }

    /**
     * Update modal content
     * @param {string} content - New HTML content
     */
    setContent(content) {
        this.content = content;
        if (this.element) {
            const body = this.element.querySelector('.modal__body');
            body.innerHTML = content;
        }
        return this;
    }

    /**
     * Update modal title
     * @param {string} title - New title
     */
    setTitle(title) {
        this.title = title;
        if (this.element) {
            const titleEl = this.element.querySelector('.modal__title');
            titleEl.textContent = title;
        }
        return this;
    }

    /**
     * Add footer buttons
     * @param {Array} buttons - Array of button configs
     */
    setFooter(buttons) {
        if (!this.element) return this;

        const footer = this.element.querySelector('.modal__footer');
        footer.innerHTML = '';

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `btn ${btn.class || 'btn--secondary'}`;
            button.textContent = btn.text;
            if (btn.onClick) {
                button.addEventListener('click', () => btn.onClick(this));
            }
            footer.appendChild(button);
        });

        return this;
    }

    /**
     * Get body element for dynamic content manipulation
     */
    getBody() {
        return this.element?.querySelector('.modal__body');
    }
}

/**
 * Create a confirmation dialog
 * @param {Object} options - Confirmation options
 * @returns {Promise<boolean>} User's choice
 */
function confirm({ title = 'Confirm', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', type = 'primary' }) {
    return new Promise(resolve => {
        const modal = new Modal({
            title,
            content: `<p>${message}</p>`,
            size: 'small',
            closable: true,
            onClose: () => {
                resolve(false);
                modal.destroy();
            }
        });

        modal.create().setFooter([
            {
                text: cancelText,
                class: 'btn--ghost',
                onClick: () => {
                    resolve(false);
                    modal.destroy();
                }
            },
            {
                text: confirmText,
                class: `btn--${type}`,
                onClick: () => {
                    resolve(true);
                    modal.destroy();
                }
            }
        ]).open();
    });
}

/**
 * Create an alert dialog
 * @param {Object} options - Alert options
 * @returns {Promise} Resolves when closed
 */
function alert({ title = 'Alert', message = '', type = 'info' }) {
    return new Promise(resolve => {
        const modal = new Modal({
            title,
            content: `<p>${message}</p>`,
            size: 'small',
            closable: true,
            onClose: () => {
                resolve();
                modal.destroy();
            }
        });

        modal.create().setFooter([
            {
                text: 'OK',
                class: 'btn--primary',
                onClick: () => {
                    resolve();
                    modal.destroy();
                }
            }
        ]).open();
    });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Modal, confirm, alert };
}
