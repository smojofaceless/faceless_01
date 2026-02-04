// =====================================================
// PLATFORM CONFIGURATION
// Character limits, rules, and settings for each platform
// =====================================================

const PLATFORM_CONFIG = {
    youtube: {
        id: 'youtube',
        name: 'YouTube',
        shortName: 'YT',
        icon: '📺',
        color: '#FF0000',
        
        // Content fields
        fields: {
            title: {
                label: 'Title',
                type: 'text',
                maxLength: 100,
                required: true,
                placeholder: 'Enter video title...',
                aiPrompt: 'Create an engaging, click-worthy YouTube title'
            },
            description: {
                label: 'Description',
                type: 'textarea',
                maxLength: 5000,
                required: false,
                placeholder: 'Enter video description...',
                aiPrompt: 'Write a detailed YouTube description with timestamps if applicable'
            },
            tags: {
                label: 'Tags',
                type: 'tags',
                maxTotalChars: 500,
                maxCount: 30,
                required: false,
                placeholder: 'Add tags...',
                aiPrompt: 'Generate relevant SEO tags for YouTube discovery'
            },
            category_id: {
                label: 'Category',
                type: 'select',
                required: false,
                default: '22', // People & Blogs
                options: [
                    { value: '1', label: 'Film & Animation' },
                    { value: '2', label: 'Autos & Vehicles' },
                    { value: '10', label: 'Music' },
                    { value: '15', label: 'Pets & Animals' },
                    { value: '17', label: 'Sports' },
                    { value: '18', label: 'Short Movies' },
                    { value: '19', label: 'Travel & Events' },
                    { value: '20', label: 'Gaming' },
                    { value: '21', label: 'Videoblogging' },
                    { value: '22', label: 'People & Blogs' },
                    { value: '23', label: 'Comedy' },
                    { value: '24', label: 'Entertainment' },
                    { value: '25', label: 'News & Politics' },
                    { value: '26', label: 'Howto & Style' },
                    { value: '27', label: 'Education' },
                    { value: '28', label: 'Science & Technology' },
                    { value: '29', label: 'Nonprofits & Activism' }
                ]
            },
            privacy_status: {
                label: 'Privacy',
                type: 'radio',
                required: true,
                default: 'public',
                options: [
                    { value: 'public', label: 'Public', icon: '🌍' },
                    { value: 'unlisted', label: 'Unlisted', icon: '🔗' },
                    { value: 'private', label: 'Private', icon: '🔒' }
                ]
            },
            is_short: {
                label: 'YouTube Short',
                type: 'checkbox',
                default: true,
                hint: 'Videos under 60 seconds are eligible for Shorts'
            },
            notify_subscribers: {
                label: 'Notify Subscribers',
                type: 'checkbox',
                default: true,
                hint: 'Send notification and show in subscriber feeds'
            },
            made_for_kids: {
                label: 'Made for Kids',
                type: 'radio',
                required: true,
                default: 'false',
                options: [
                    { value: 'false', label: 'No, not made for kids', icon: '🔞' },
                    { value: 'true', label: 'Yes, made for kids', icon: '👶' }
                ],
                hint: 'COPPA compliance - affects comments, notifications, and ad types'
            },
            allow_comments: {
                label: 'Comments',
                type: 'select',
                default: 'all',
                options: [
                    { value: 'all', label: 'Allow all comments' },
                    { value: 'approval', label: 'Hold for review' },
                    { value: 'none', label: 'Disable comments' }
                ]
            },
            allow_embedding: {
                label: 'Allow Embedding',
                type: 'checkbox',
                default: true,
                hint: 'Let others embed this video on external websites'
            },
            license: {
                label: 'License',
                type: 'select',
                default: 'youtube',
                options: [
                    { value: 'youtube', label: 'Standard YouTube License' },
                    { value: 'creativeCommon', label: 'Creative Commons - Attribution' }
                ]
            }
        },
        
        // Video constraints
        maxDuration: 60, // For Shorts
        maxFileSizeMB: 256,
        supportedFormats: ['mp4', 'mov', 'avi', 'wmv'],
        aspectRatios: ['9:16', '16:9', '1:1']
    },
    
    tiktok: {
        id: 'tiktok',
        name: 'TikTok',
        shortName: 'TT',
        icon: '🎵',
        color: '#000000',
        
        fields: {
            caption: {
                label: 'Caption',
                type: 'textarea',
                maxLength: 2200,
                required: true,
                placeholder: 'Write your caption with hashtags...',
                aiPrompt: 'Write a viral TikTok caption with trending hashtags embedded',
                hint: 'Include hashtags directly in your caption'
            },
            allow_comments: {
                label: 'Allow Comments',
                type: 'checkbox',
                default: true
            },
            allow_duet: {
                label: 'Allow Duet',
                type: 'checkbox',
                default: true
            },
            allow_stitch: {
                label: 'Allow Stitch',
                type: 'checkbox',
                default: true
            }
        },
        
        maxDuration: 180,
        maxFileSizeMB: 287,
        supportedFormats: ['mp4', 'mov'],
        aspectRatios: ['9:16']
    },
    
    instagram: {
        id: 'instagram',
        name: 'Instagram Reels',
        shortName: 'IG',
        icon: '📷',
        color: '#E4405F',
        
        fields: {
            caption: {
                label: 'Caption',
                type: 'textarea',
                maxLength: 2200,
                required: false,
                placeholder: 'Write your caption...',
                aiPrompt: 'Write an engaging Instagram Reels caption'
            },
            hashtags: {
                label: 'Hashtags',
                type: 'tags',
                maxCount: 30,
                required: false,
                placeholder: 'Add hashtags...',
                aiPrompt: 'Generate trending Instagram hashtags for maximum reach',
                hint: 'Up to 30 hashtags, added after caption'
            },
            share_to_feed: {
                label: 'Share to Feed',
                type: 'checkbox',
                default: true,
                hint: 'Also show this Reel on your profile grid'
            }
        },
        
        maxDuration: 90,
        maxFileSizeMB: 650,
        supportedFormats: ['mp4', 'mov'],
        aspectRatios: ['9:16', '1:1']
    },
    
    facebook: {
        id: 'facebook',
        name: 'Facebook Reels',
        shortName: 'FB',
        icon: '📘',
        color: '#1877F2',
        
        fields: {
            description: {
                label: 'Description',
                type: 'textarea',
                maxLength: 2200,
                required: false,
                placeholder: 'Write a description...',
                aiPrompt: 'Write an engaging Facebook Reels description'
            },
            is_reel: {
                label: 'Post as Reel',
                type: 'checkbox',
                default: true,
                hint: 'Post as a Facebook Reel (recommended for short videos)'
            }
        },
        
        maxDuration: 90,
        maxFileSizeMB: 4096,
        supportedFormats: ['mp4', 'mov'],
        aspectRatios: ['9:16', '1:1', '16:9']
    }
};

// Helper to get platform config
function getPlatformConfig(platformId) {
    return PLATFORM_CONFIG[platformId] || null;
}

// Get all enabled platforms
function getEnabledPlatforms() {
    return Object.values(PLATFORM_CONFIG);
}

// Validate content for a specific platform
function validatePlatformContent(platformId, content) {
    const config = PLATFORM_CONFIG[platformId];
    if (!config) {
        return { valid: false, errors: ['Unknown platform'] };
    }
    
    const errors = [];
    
    for (const [fieldId, fieldConfig] of Object.entries(config.fields)) {
        const value = content[fieldId];
        
        // Check required
        if (fieldConfig.required && (!value || (typeof value === 'string' && value.trim() === ''))) {
            errors.push(`${fieldConfig.label} is required`);
            continue;
        }
        
        // Check maxLength
        if (fieldConfig.maxLength && value && value.length > fieldConfig.maxLength) {
            errors.push(`${fieldConfig.label} exceeds ${fieldConfig.maxLength} characters`);
        }
        
        // Check tags count
        if (fieldConfig.type === 'tags' && fieldConfig.maxCount && Array.isArray(value)) {
            if (value.length > fieldConfig.maxCount) {
                errors.push(`${fieldConfig.label} exceeds ${fieldConfig.maxCount} items`);
            }
        }
        
        // Check tags total chars (YouTube specific)
        if (fieldConfig.maxTotalChars && Array.isArray(value)) {
            const totalChars = value.join(',').length;
            if (totalChars > fieldConfig.maxTotalChars) {
                errors.push(`${fieldConfig.label} total characters exceed ${fieldConfig.maxTotalChars}`);
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

// Get default content for a platform
function getDefaultPlatformContent(platformId) {
    const config = PLATFORM_CONFIG[platformId];
    if (!config) return {};
    
    const defaults = {
        ai_generated: false,
        manually_edited: false
    };
    
    for (const [fieldId, fieldConfig] of Object.entries(config.fields)) {
        if (fieldConfig.default !== undefined) {
            defaults[fieldId] = fieldConfig.default;
        } else if (fieldConfig.type === 'tags') {
            defaults[fieldId] = [];
        } else if (fieldConfig.type === 'checkbox') {
            defaults[fieldId] = false;
        } else {
            defaults[fieldId] = '';
        }
    }
    
    return defaults;
}

// Format character counter display
function formatCharCount(current, max) {
    const remaining = max - current;
    const isOver = remaining < 0;
    const percentage = (current / max) * 100;
    
    let status = 'ok';
    if (percentage > 90) status = 'warning';
    if (percentage >= 100) status = 'error';
    
    return {
        current,
        max,
        remaining: Math.abs(remaining),
        isOver,
        percentage: Math.min(percentage, 100),
        status,
        display: `${current}/${max}`
    };
}

// Export for browser
window.PLATFORM_CONFIG = PLATFORM_CONFIG;
window.getPlatformConfig = getPlatformConfig;
window.getEnabledPlatforms = getEnabledPlatforms;
window.validatePlatformContent = validatePlatformContent;
window.getDefaultPlatformContent = getDefaultPlatformContent;
window.formatCharCount = formatCharCount;

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PLATFORM_CONFIG,
        getPlatformConfig,
        getEnabledPlatforms,
        validatePlatformContent,
        getDefaultPlatformContent,
        formatCharCount
    };
}
