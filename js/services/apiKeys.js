/**
 * API Keys Service
 * Manages API keys storage and retrieval for various services
 */

class ApiKeysService {
    constructor() {
        this.storageKey = 'contentengine_api_keys';
        this.keys = {};
        this.load();
    }

    /**
     * Load API keys from localStorage
     */
    load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            this.keys = stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.error('Failed to load API keys:', e);
            this.keys = {};
        }
        return this.keys;
    }

    /**
     * Save API keys to localStorage
     */
    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.keys));
            return true;
        } catch (e) {
            console.error('Failed to save API keys:', e);
            return false;
        }
    }

    /**
     * Set an API key
     */
    set(service, key) {
        this.keys[service] = key;
        this.save();
    }

    /**
     * Get an API key
     */
    get(service) {
        return this.keys[service] || null;
    }

    /**
     * Get all API keys
     */
    getAll() {
        return { ...this.keys };
    }

    /**
     * Set multiple API keys at once
     */
    setAll(keys) {
        this.keys = { ...this.keys, ...keys };
        this.save();
    }

    /**
     * Check if a specific key is configured
     */
    has(service) {
        return !!this.keys[service];
    }

    /**
     * Check if all required keys are configured
     */
    hasRequired(services = ['openai']) {
        return services.every(s => this.has(s));
    }

    /**
     * Get configuration status for all services
     */
    getStatus() {
        return {
            openai: this.has('openai'),
            pexels: this.has('pexels'),
            elevenlabs: this.has('elevenlabs'),
            replicate: this.has('replicate')
        };
    }

    /**
     * Clear all API keys
     */
    clear() {
        this.keys = {};
        this.save();
    }

    /**
     * Remove a specific API key
     */
    remove(service) {
        delete this.keys[service];
        this.save();
    }
}

// Export as singleton
window.apiKeys = new ApiKeysService();
