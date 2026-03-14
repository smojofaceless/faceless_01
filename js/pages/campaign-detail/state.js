// =====================================================
// CAMPAIGN DETAIL — STATE & UTILITIES
// =====================================================

window.campaignDetailPage = {
    // --- State ---
    campaignId: null,
    campaign: null,
    jobs: [],
    stats: {},
    statusFilter: '',
    refreshInterval: null,
    confirmCallback: null,
    selectedJobId: null,
    currentLogs: [],
    selectedStepName: null,
    jobsSubscription: null,
    logsSubscription: null,
    campaignSubscription: null,
    failureInfoMap: {},

    // Internal data for copy helpers
    _currentStepData: null,
    _storyAnchorText: null,
    _imagesStoryAnchorText: null,
    _imageAssets: null,
    _imagePromptSnapshots: null,
    _imageScenes: null,
    _imageStoryAnchor: null,
    _imageSequence: null,
    _visualCues: null,
    _characterReference: null,
    _assemblePayloadText: null,
    _img2vidSummary: null,
    _img2vidClipAssets: null,
    _img2vidSrcImageMap: null,

    // DOM elements (populated by init)
    el: {},

    // Constants
    pipelineSteps: ['story', 'uniqueness', 'scenes', 'voice', 'music', 'images', 'img2vid', 'subtitles', 'assemble', 'upload', 'schedule'],

    platformSvgs: {
        youtube_shorts: { icon: '<svg viewBox="0 0 24 24" fill="#FF0000" width="16" height="16"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>', label: 'YouTube Shorts' },
        youtube: { icon: '<svg viewBox="0 0 24 24" fill="#FF0000" width="16" height="16"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><polygon fill="#FFF" points="9.545 15.568 15.818 12 9.545 8.432"/></svg>', label: 'YouTube' },
        tiktok: { icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>', label: 'TikTok' },
        instagram_reels: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="16" height="16"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>', label: 'Instagram Reels' },
        instagram: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#E4405F" stroke-width="2" width="16" height="16"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>', label: 'Instagram' },
        facebook_reels: { icon: '<svg viewBox="0 0 24 24" fill="#1877F2" width="16" height="16"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>', label: 'Facebook Reels' },
        facebook: { icon: '<svg viewBox="0 0 24 24" fill="#1877F2" width="16" height="16"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>', label: 'Facebook' },
        threads: { icon: '<svg viewBox="0 0 192 192" fill="currentColor" width="16" height="16"><path d="M141.537 88.988a66.6 66.6 0 00-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.335c-14.986 0-27.449 6.396-35.12 18.028l13.661 9.427c5.587-8.586 14.217-13.014 21.459-13.014h.118c8.803.052 15.462 2.952 19.809 8.588 3.275 4.253 5.489 9.848 6.605 17.649-6.728-1.189-13.959-1.658-21.616-1.407-21.15.636-34.74 12.417-33.798 28.355.481 8.054 4.522 15.108 11.324 19.886 5.84 3.879 13.319 5.848 21.101 5.481 10.414-.495 18.784-4.649 24.867-12.383 4.589-5.842 7.671-13.295 9.342-22.632 4.894 2.899 8.626 6.684 10.922 11.32 3.8 7.657 4.033 19.97-3.631 28.591-6.744 7.612-15.336 11.117-29.605 11.229-15.777-.123-27.576-5.002-35.246-14.521-7.239-8.993-10.98-21.803-11.299-38.053.319-16.251 4.06-29.061 11.127-38.067 7.67-9.518 19.469-14.397 35.246-14.52 15.916.124 27.905 5.004 35.816 14.603 3.862 4.682 6.828 10.445 8.826 17.154l13.437-3.767a63.7 63.7 0 00-11.079-21.305c-10.06-12.243-24.561-18.556-46.902-18.715h-.064c-22.242.159-36.639 6.479-46.53 18.575-8.916 11.096-13.612 26.369-13.959 46.063v.102c.347 19.694 5.043 34.967 13.959 46.063 9.891 12.096 24.288 18.416 46.53 18.576h.064c17.347-.133 28.81-4.863 37.445-14.547 10.952-12.239 10.592-28.26 5.44-38.797-3.549-7.272-9.48-13.296-17.39-17.608zm-47.893 34.655c-9.115.444-17.852-4.883-18.401-11.445-.408-4.801 2.61-13.516 21.502-14.168 2.287-.077 4.528-.114 6.73-.114 5.765 0 11.227.515 16.278 1.5-1.935 18.074-13.519 23.589-26.109 24.227z"/></svg>', label: 'Threads' },
        twitter: { icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', label: 'X' },
        x: { icon: '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>', label: 'X' }
    },

    // --- Utility Methods ---
    escapeHtml(str) {
        if (!str) return '';
        if (typeof str !== 'string') str = String(str);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    getStepIcon(step) {
        const icons = { story: '📖', uniqueness: '🔍', scenes: '🎬', voice: '🎙️', music: '🎵', images: '🖼️', img2vid: '🎥', subtitles: '📝', assemble: '🔧', upload: '☁️', schedule: '📅' };
        return icons[step] || '⚙️';
    },

    capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); },

    async copyToClipboard(text, buttonEl) {
        try {
            const str = typeof text === 'string' ? text : typeof text === 'object' ? JSON.stringify(text, null, 2) : String(text ?? '');
            await navigator.clipboard.writeText(str);
            if (buttonEl) {
                const orig = buttonEl.innerHTML;
                buttonEl.innerHTML = '✓ Copied';
                buttonEl.classList.add('step-detail__copy-btn--copied');
                setTimeout(() => { buttonEl.innerHTML = orig; buttonEl.classList.remove('step-detail__copy-btn--copied'); }, 1500);
            }
        } catch (err) {
            console.error('Copy failed:', err);
            this.showToast?.('Failed to copy', 'error');
        }
    },

    formatDuration(ms) {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
    },

    formatMetaDuration(duration, lengthPreset, audioDurationMs) {
        if (audioDurationMs && typeof audioDurationMs === 'number' && audioDurationMs > 0) return `${(audioDurationMs / 1000).toFixed(1)}s (audio)`;
        if (duration == null) return lengthPreset ? `${lengthPreset}s` : '-';
        if (typeof duration === 'number' || typeof duration === 'string') return `${duration}s`;
        if (typeof duration === 'object') {
            const min = duration.minSeconds || duration.min || null;
            const max = duration.maxSeconds || duration.max || null;
            if (min && max) return `${min}-${max}s`;
            if (min) return `${min}s+`;
            if (max) return `≤${max}s`;
            if (duration.target) return `~${duration.target}s`;
        }
        return lengthPreset ? `${lengthPreset}s` : '-';
    },

    formatCharacterDescription(desc) {
        if (!desc) return 'None (atmospheric)';
        if (typeof desc === 'string') return desc;
        if (typeof desc === 'object') {
            if (Array.isArray(desc)) {
                return desc.map(c => {
                    if (typeof c === 'string') return c;
                    if (c.description) return c.description;
                    const parts = [c.name, c.age ? `age ${c.age}` : null, c.hair, c.clothing, c.distinguishingFeatures || c.features].filter(Boolean);
                    return parts.length > 0 ? parts.join(', ') : JSON.stringify(c);
                }).join('; ');
            }
            if (desc.description) return desc.description;
            if (desc.appearance) return desc.appearance;
            if (desc.name && desc.details) return `${desc.name}: ${desc.details}`;
            if (desc.name) return desc.name;
            const structured = [desc.name, desc.age ? `age ${desc.age}` : null, desc.hair, desc.clothing, desc.distinguishingFeatures || desc.features].filter(Boolean);
            if (structured.length >= 2) return structured.join(', ');
            const entries = Object.entries(desc).filter(([_, v]) => v);
            if (entries.length > 0) return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
        }
        return String(desc);
    },

    showToast(message, type = 'info') {
        if (typeof toast !== 'undefined') {
            toast[type]?.(message) || toast.show?.(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
            alert(message);
        }
    }
};
