// =====================================================
// GENERATE POST CONTENT - Supabase Edge Function
// Generates platform-specific titles, descriptions, tags
// using OpenAI based on video story and theme
// =====================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Platform constraints for generation
const PLATFORM_LIMITS = {
    youtube: {
        title: { max: 100, target: 60 },
        description: { max: 5000, target: 300 },
        tags: { maxCount: 15, maxTotalChars: 400 }
    },
    tiktok: {
        caption: { max: 2200, target: 150 }
    },
    instagram: {
        caption: { max: 2200, target: 200 },
        hashtags: { maxCount: 20 }
    }
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { post_id, platforms, regenerate_field, force } = await req.json();

        console.log('📥 Request received:', { post_id, platforms, regenerate_field, force });

        if (!post_id) {
            return new Response(
                JSON.stringify({ error: 'post_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Initialize Supabase client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // Fetch the post with related job data
        const { data: post, error: postError } = await supabase
            .from('posts')
            .select(`
                *,
                jobs:source_job_id (
                    title,
                    story_text,
                    vibe_preset,
                    visual_preset,
                    length_preset
                )
            `)
            .eq('id', post_id)
            .single();

        if (postError || !post) {
            return new Response(
                JSON.stringify({ error: 'Post not found', details: postError }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Get brand info for context
        const { data: brand } = await supabase
            .from('brands')
            .select('name, niche, description')
            .eq('id', post.brand_id)
            .single();

        // Determine which platforms to generate for
        const targetPlatforms = platforms || post.platforms || ['youtube'];
        
        // Build context from post/job data
        const context = {
            originalTitle: post.jobs?.title || post.title || 'Untitled Video',
            storyText: post.jobs?.story_text || post.description || '',
            theme: post.theme || post.jobs?.vibe_preset || 'horror',
            visualStyle: post.jobs?.visual_preset || 'cinematic',
            brandName: brand?.name || '',
            brandNiche: brand?.niche || 'entertainment',
            brandDescription: brand?.description || '',
            duration: post.duration_seconds || 60
        };

        // Generate content for each platform
        const platformContent = post.platform_content || {};
        
        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) {
            return new Response(
                JSON.stringify({ error: 'OpenAI API key not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log('🔄 Generating content for platforms:', targetPlatforms, 'force:', force);

        for (const platform of targetPlatforms) {
            const existingContent = platformContent[platform] || {};
            
            // Skip if already manually edited (unless force=true or regenerating specific field)
            if (existingContent.manually_edited && !regenerate_field && !force) {
                console.log(`⏭️ Skipping ${platform} - manually edited`);
                continue;
            }

            console.log(`🤖 Calling OpenAI for ${platform}...`);
            
            const generated = await generatePlatformContent(
                platform,
                context,
                openaiApiKey,
                regenerate_field
            );

            console.log(`✅ Generated for ${platform}:`, generated?.title || generated?.caption);

            // If regenerating a specific field, only update that field
            if (regenerate_field && generated[regenerate_field] !== undefined) {
                platformContent[platform] = {
                    ...existingContent,
                    [regenerate_field]: generated[regenerate_field],
                    ai_generated: true,
                    // Keep manually_edited true since user is selectively regenerating
                    manually_edited: true,
                    generated_at: new Date().toISOString()
                };
            } else {
                // Full regeneration - replace all content
                platformContent[platform] = {
                    ...existingContent,
                    ...generated,
                    ai_generated: true,
                    manually_edited: false,
                    generated_at: new Date().toISOString()
                };
            }
        }

        // Update the post
        const { error: updateError } = await supabase
            .from('posts')
            .update({
                platform_content: platformContent,
                content_generated: true,
                content_generated_at: new Date().toISOString(),
                // Also update the base title/description if not set
                title: post.title || platformContent.youtube?.title || context.originalTitle,
                description: post.description || platformContent.youtube?.description || context.storyText?.substring(0, 500)
            })
            .eq('id', post_id);

        if (updateError) {
            throw updateError;
        }

        return new Response(
            JSON.stringify({
                success: true,
                post_id,
                platform_content: platformContent,
                platforms_generated: targetPlatforms
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error generating post content:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});

async function generatePlatformContent(platform, context, apiKey, regenerateField = null) {
    const limits = PLATFORM_LIMITS[platform];
    
    // Build platform-specific prompt
    let prompt = '';
    
    if (platform === 'youtube') {
        prompt = buildYouTubePrompt(context, limits, regenerateField);
    } else if (platform === 'tiktok') {
        prompt = buildTikTokPrompt(context, limits, regenerateField);
    } else if (platform === 'instagram') {
        prompt = buildInstagramPrompt(context, limits, regenerateField);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a social media content expert specializing in ${context.brandNiche}. 
                    Generate engaging, platform-optimized content that maximizes engagement.
                    Always respond with valid JSON only, no markdown.`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.95,  // Higher for more creative variety
            max_tokens: 1000,
            response_format: { type: "json_object" }  // Force JSON output
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    console.log('📄 Raw OpenAI response:', content.substring(0, 200) + '...');
    
    // Parse JSON response with robust cleaning
    try {
        // Clean up potential markdown code blocks and other formatting
        let cleanContent = content
            .replace(/```json\s*/gi, '')  // Remove ```json
            .replace(/```\s*/g, '')        // Remove closing ```
            .replace(/^\s*[\r\n]+/, '')    // Remove leading newlines
            .replace(/[\r\n]+\s*$/, '')    // Remove trailing newlines
            .trim();
        
        // Try to extract JSON object if there's text before/after it
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanContent = jsonMatch[0];
        }
        
        console.log('🧹 Cleaned content:', cleanContent.substring(0, 200) + '...');
        
        return JSON.parse(cleanContent);
    } catch (e) {
        console.error('❌ Failed to parse AI response:', content);
        console.error('❌ Parse error:', e.message);
        throw new Error('Failed to parse AI-generated content');
    }
}

function buildYouTubePrompt(context, limits, regenerateField) {
    // If regenerating a specific field, only ask for that field
    if (regenerateField === 'title') {
        return `Generate a NEW YouTube video title for this content:

CONTEXT:
- Current Story: "${context.storyText.substring(0, 300)}..."
- Theme: ${context.theme}
- Brand: ${context.brandName} (${context.brandNiche})

Generate a JSON object with ONLY:
{
    "title": "Catchy, click-worthy title (max ${limits.title.max} chars). Use curiosity gaps, numbers, or emotional hooks. Make it DIFFERENT from before."
}`;
    }
    
    if (regenerateField === 'description') {
        return `Generate a NEW YouTube video description for this content:

CONTEXT:
- Title: "${context.originalTitle}"
- Story: "${context.storyText.substring(0, 400)}..."
- Theme: ${context.theme}

Generate a JSON object with ONLY:
{
    "description": "Engaging description (max ${limits.description.max} chars). Include hook, summary, and CTA. Make it DIFFERENT from before."
}`;
    }
    
    if (regenerateField === 'tags') {
        return `Generate NEW YouTube tags for this video:

CONTEXT:
- Title: "${context.originalTitle}"
- Theme: ${context.theme}
- Niche: ${context.brandNiche}

Generate a JSON object with ONLY:
{
    "tags": ["array", "of", "NEW", "seo", "tags"] (max ${limits.tags.maxCount} tags)
}`;
    }
    
    // Full generation
    return `Generate YouTube Shorts content for this video:

CONTEXT:
- Original Title: "${context.originalTitle}"
- Story/Content: "${context.storyText.substring(0, 500)}..."
- Theme/Vibe: ${context.theme}
- Visual Style: ${context.visualStyle}
- Brand: ${context.brandName} (${context.brandNiche})
- Duration: ${context.duration} seconds

Generate a JSON object with these fields:
{
    "title": "Catchy, click-worthy title (max ${limits.title.max} chars, aim for ${limits.title.target}). Use curiosity gaps, numbers, or emotional hooks.",
    "description": "Engaging description (max ${limits.description.max} chars, aim for ${limits.description.target}). Include a hook, brief summary, and call to action. Add relevant links placeholders.",
    "tags": ["array", "of", "relevant", "seo", "tags"] (max ${limits.tags.maxCount} tags, total chars under ${limits.tags.maxTotalChars})
}

Make content engaging for ${context.theme} niche viewers. Use proven engagement patterns.`;
}

function buildTikTokPrompt(context, limits, regenerateField) {
    return `Generate TikTok content for this video:

CONTEXT:
- Original Title: "${context.originalTitle}"
- Story/Content: "${context.storyText.substring(0, 500)}..."
- Theme/Vibe: ${context.theme}
- Brand: ${context.brandName} (${context.brandNiche})
- Duration: ${context.duration} seconds

Generate a JSON object with:
{
    "caption": "Viral TikTok caption with hashtags EMBEDDED at the end (max ${limits.caption.max} chars, aim for ${limits.caption.target}). Start with a hook that stops scrolling. Include 5-10 relevant hashtags like #fyp #viral #${context.theme}.",
    "allow_comments": true,
    "allow_duet": true,
    "allow_stitch": true
}

Make it snappy, Gen-Z friendly, and scroll-stopping. Use trending hooks.`;
}

function buildInstagramPrompt(context, limits, regenerateField) {
    return `Generate Instagram Reels content for this video:

CONTEXT:
- Original Title: "${context.originalTitle}"
- Story/Content: "${context.storyText.substring(0, 500)}..."
- Theme/Vibe: ${context.theme}
- Brand: ${context.brandName} (${context.brandNiche})
- Duration: ${context.duration} seconds

Generate a JSON object with:
{
    "caption": "Engaging Instagram caption (max ${limits.caption.max} chars, aim for ${limits.caption.target}). Start with a hook, tell a micro-story, end with a question or CTA. DO NOT include hashtags here.",
    "hashtags": ["array", "of", "hashtags", "without", "hash", "symbol"] (max ${limits.hashtags.maxCount} hashtags, mix of popular and niche)
}

Make it aesthetic, story-driven, and engagement-focused. Use emojis appropriately.`;
}
