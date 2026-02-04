-- =====================================================
-- Platform-Specific Content for Posts
-- Each platform (YouTube, TikTok, Instagram) has different
-- requirements for titles, descriptions, tags, etc.
-- =====================================================

-- Add platform_content JSONB column to store platform-specific details
ALTER TABLE posts ADD COLUMN IF NOT EXISTS platform_content JSONB DEFAULT '{}'::jsonb;

-- Structure example:
-- {
--   "youtube": {
--     "title": "The Terrifying Truth About...",
--     "description": "What happens when...",
--     "tags": ["horror", "scary", "abandoned"],
--     "playlist_id": null,
--     "category_id": "22",
--     "privacy_status": "public",
--     "is_short": true,
--     "ai_generated": true,
--     "manually_edited": false
--   },
--   "tiktok": {
--     "caption": "You won't believe what we found... #horror #scary",
--     "allow_comments": true,
--     "allow_duet": true,
--     "allow_stitch": true,
--     "ai_generated": true,
--     "manually_edited": false
--   },
--   "instagram": {
--     "caption": "Swipe to see what happened...",
--     "hashtags": ["horror", "scary", "abandoned"],
--     "location_id": null,
--     "ai_generated": true,
--     "manually_edited": false
--   }
-- }

-- Add content_generated flag to track if AI has processed this post
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_generated BOOLEAN DEFAULT false;

-- Add content_generated_at timestamp
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_generated_at TIMESTAMPTZ;

-- Create index for efficient querying of posts needing content generation
CREATE INDEX IF NOT EXISTS idx_posts_content_generated ON posts(content_generated) WHERE content_generated = false;

-- =====================================================
-- Platform Constraints Reference Table
-- Stores the rules/limits for each platform
-- =====================================================

CREATE TABLE IF NOT EXISTS platform_constraints (
    platform TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    constraints JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert platform constraints
INSERT INTO platform_constraints (platform, display_name, icon, color, constraints) VALUES
('youtube', 'YouTube', '📺', '#FF0000', '{
    "title": {"max_length": 100, "required": true},
    "description": {"max_length": 5000, "required": false},
    "tags": {"max_total_chars": 500, "max_count": 30, "required": false},
    "playlist_id": {"required": false},
    "category_id": {"required": false, "default": "22"},
    "privacy_status": {"options": ["public", "unlisted", "private"], "default": "public"},
    "is_short": {"required": false, "default": true},
    "max_video_duration": 60,
    "max_file_size_mb": 256,
    "supported_formats": ["mp4", "mov", "avi", "wmv"]
}'::jsonb),
('tiktok', 'TikTok', '🎵', '#000000', '{
    "caption": {"max_length": 2200, "required": true, "includes_hashtags": true},
    "hashtags": {"max_count": 30, "embedded_in_caption": true},
    "allow_comments": {"required": false, "default": true},
    "allow_duet": {"required": false, "default": true},
    "allow_stitch": {"required": false, "default": true},
    "max_video_duration": 180,
    "max_file_size_mb": 287,
    "supported_formats": ["mp4", "mov"]
}'::jsonb),
('instagram', 'Instagram Reels', '📷', '#E4405F', '{
    "caption": {"max_length": 2200, "required": false},
    "hashtags": {"max_count": 30, "separate_from_caption": true},
    "location_id": {"required": false},
    "share_to_feed": {"required": false, "default": true},
    "max_video_duration": 90,
    "max_file_size_mb": 650,
    "supported_formats": ["mp4", "mov"]
}'::jsonb)
ON CONFLICT (platform) DO UPDATE SET
    constraints = EXCLUDED.constraints,
    updated_at = NOW();

-- RLS for platform_constraints (read-only for everyone)
ALTER TABLE platform_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_constraints_select_all" ON platform_constraints FOR SELECT
    USING (true);

GRANT SELECT ON platform_constraints TO anon, authenticated;

-- =====================================================
-- Function to validate platform content against constraints
-- =====================================================

CREATE OR REPLACE FUNCTION validate_platform_content(
    p_platform TEXT,
    p_content JSONB
) RETURNS JSONB AS $$
DECLARE
    v_constraints JSONB;
    v_errors TEXT[] := '{}';
    v_title_len INTEGER;
    v_desc_len INTEGER;
    v_caption_len INTEGER;
BEGIN
    -- Get platform constraints
    SELECT constraints INTO v_constraints
    FROM platform_constraints
    WHERE platform = p_platform;
    
    IF v_constraints IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'errors', ARRAY['Unknown platform']);
    END IF;
    
    -- YouTube validation
    IF p_platform = 'youtube' THEN
        v_title_len := length(p_content->>'title');
        IF v_title_len IS NULL OR v_title_len = 0 THEN
            v_errors := array_append(v_errors, 'Title is required');
        ELSIF v_title_len > (v_constraints->'title'->>'max_length')::int THEN
            v_errors := array_append(v_errors, format('Title exceeds %s characters', v_constraints->'title'->>'max_length'));
        END IF;
        
        v_desc_len := length(p_content->>'description');
        IF v_desc_len > (v_constraints->'description'->>'max_length')::int THEN
            v_errors := array_append(v_errors, format('Description exceeds %s characters', v_constraints->'description'->>'max_length'));
        END IF;
    END IF;
    
    -- TikTok validation
    IF p_platform = 'tiktok' THEN
        v_caption_len := length(p_content->>'caption');
        IF v_caption_len IS NULL OR v_caption_len = 0 THEN
            v_errors := array_append(v_errors, 'Caption is required');
        ELSIF v_caption_len > (v_constraints->'caption'->>'max_length')::int THEN
            v_errors := array_append(v_errors, format('Caption exceeds %s characters', v_constraints->'caption'->>'max_length'));
        END IF;
    END IF;
    
    -- Instagram validation
    IF p_platform = 'instagram' THEN
        v_caption_len := length(p_content->>'caption');
        IF v_caption_len > (v_constraints->'caption'->>'max_length')::int THEN
            v_errors := array_append(v_errors, format('Caption exceeds %s characters', v_constraints->'caption'->>'max_length'));
        END IF;
    END IF;
    
    RETURN jsonb_build_object(
        'valid', array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to anon
GRANT EXECUTE ON FUNCTION validate_platform_content(TEXT, JSONB) TO anon, authenticated;
