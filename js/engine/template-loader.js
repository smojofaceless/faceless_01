/**
 * Template Loader
 * Manages loading and switching between brand templates
 */

class TemplateLoader {
    constructor() {
        this.templates = new Map();
        this.activeTemplate = null;
        this.listeners = new Map();
    }

    /**
     * Event system
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => cb(data));
        }
    }

    /**
     * Register a template
     */
    register(template) {
        if (!template.id || !template.niche) {
            console.error('Template must have id and niche properties');
            return;
        }
        this.templates.set(template.id, template);
        console.log(`Template registered: ${template.id}`);
    }

    /**
     * Get a template by ID
     */
    get(templateId) {
        return this.templates.get(templateId);
    }

    /**
     * Get template by niche
     */
    getByNiche(niche) {
        for (const template of this.templates.values()) {
            if (template.niche === niche) {
                return template;
            }
        }
        return null;
    }

    /**
     * Get all registered templates
     */
    getAll() {
        return Array.from(this.templates.values());
    }

    /**
     * Load and activate a template
     */
    async load(templateId) {
        const template = this.templates.get(templateId);
        if (!template) {
            throw new Error(`Template not found: ${templateId}`);
        }

        this.activeTemplate = template;
        
        // Apply template theme
        this.applyTheme(template.theme);
        
        this.emit('templateLoaded', template);
        return template;
    }

    /**
     * Load template by brand
     */
    async loadByBrand(brand) {
        // First try to find a template that matches the brand's niche
        let template = this.getByNiche(brand.niche);
        
        // Fall back to a generic template
        if (!template) {
            template = this.templates.get('generic');
        }

        if (!template) {
            throw new Error(`No template found for niche: ${brand.niche}`);
        }

        // Merge brand settings into template
        const brandTemplate = this.mergeBrandWithTemplate(brand, template);
        
        this.activeTemplate = brandTemplate;
        this.applyTheme(brandTemplate.theme);
        
        this.emit('templateLoaded', brandTemplate);
        return brandTemplate;
    }

    /**
     * Merge brand-specific settings with template
     * Applies niche configurations for adaptive templates
     */
    mergeBrandWithTemplate(brand, template) {
        // Get niche-specific config if available
        const nicheConfig = window.getNicheConfig ? window.getNicheConfig(brand.niche) : null;
        
        // Build merged template
        const merged = {
            ...template,
            _brand: brand,
            _nicheConfig: nicheConfig,
            theme: {
                ...template.theme,
                primary: brand.theme?.primaryColor || nicheConfig?.theme?.primary || template.theme.primary,
                secondary: brand.theme?.secondaryColor || nicheConfig?.theme?.secondary || template.theme.secondary,
                accent: brand.theme?.accentColor || nicheConfig?.theme?.accent || template.theme.accent,
                vibe: nicheConfig?.theme?.vibe || template.theme.vibe
            },
            name: brand.name,
            icon: brand.icon || nicheConfig?.icon || template.icon
        };

        // If using generic template with niche config, apply niche-specific settings
        if (template.id === 'generic' && nicheConfig) {
            merged.settings = {
                ...template.settings,
                contentTypes: nicheConfig.contentTypes || template.settings.contentTypes,
                visualStyles: nicheConfig.visualStyles.map(style => ({
                    value: style.value,
                    label: style.label,
                    description: style.prompt,
                    prompt: style.prompt
                })) || template.settings.visualStyles
            };
            merged.promptPrefix = nicheConfig.promptPrefix;
            merged.imagePromptSuffix = nicheConfig.imagePromptSuffix;
        }

        return merged;
    }

    /**
     * Apply theme CSS variables
     */
    applyTheme(theme) {
        const root = document.documentElement;
        
        if (theme.primary) {
            root.style.setProperty('--template-primary', theme.primary);
            root.style.setProperty('--template-primary-rgb', this.hexToRgb(theme.primary));
        }
        if (theme.secondary) {
            root.style.setProperty('--template-secondary', theme.secondary);
        }
        if (theme.accent) {
            root.style.setProperty('--template-accent', theme.accent);
        }
        if (theme.background) {
            root.style.setProperty('--template-bg', theme.background);
        }
        
        // Apply vibe class to body
        document.body.classList.remove('vibe-dark', 'vibe-light', 'vibe-vibrant');
        if (theme.vibe) {
            document.body.classList.add(`vibe-${theme.vibe}`);
        }
    }

    /**
     * Convert hex to RGB
     */
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result 
            ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
            : '139, 92, 246';
    }

    /**
     * Get active template
     */
    getActive() {
        return this.activeTemplate;
    }
}

// Export as singleton
window.templateLoader = new TemplateLoader();
