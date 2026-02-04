-- =====================================================
-- POSTS QUEUE SCHEMA
-- Tables for post scheduling, queue management, and analytics
-- =====================================================

-- =====================================================
-- POSTS TABLE
-- Queue of videos to be posted to platforms
-- =====================================================
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Video reference
    video_url TEXT NOT NULL,                    -- Supabase storage URL
    video_storage_path TEXT,                    -- Storage path for deletion later
    thumbnail_url TEXT,
    duration_seconds INTEGER,
    
    -- Content metadata
    title TEXT NOT NULL,
    description TEXT,
    tags TEXT[] DEFAULT '{}',                   -- Array of hashtags/tags
    
    -- Generation info
    theme TEXT,                                 -- Which theme was used (urban_legend, true_crime, etc.)
    niche TEXT,                                 -- Content niche
    generation_batch_id UUID,                   -- If part of bulk generation
    
    -- Platform targeting
    platforms TEXT[] DEFAULT '{youtube}',       -- ['youtube', 'tiktok', 'instagram']
    
    -- Status workflow: draft -> approved -> scheduled -> posting -> posted | failed
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft',        -- Just created, needs review
        'approved',     -- Approved, ready to schedule
        'scheduled',    -- Has scheduled_at time
        'posting',      -- Currently being uploaded
        'posted',       -- Successfully posted
        'failed',       -- Upload failed
        'cancelled'     -- User cancelled
    )),
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ,                   -- When to post (null = manual)
    posted_at TIMESTAMPTZ,                      -- When actually posted
    
    -- Platform results after posting
    -- { "youtube": { "id": "xyz", "url": "...", "status": "public" }, "tiktok": {...} }
    platform_results JSONB DEFAULT '{}'::jsonb,
    
    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,
    
    -- AI-generated metadata suggestions
    ai_metadata JSONB DEFAULT '{}'::jsonb,
    -- Structure: {
    --   "suggested_titles": ["Title 1", "Title 2"],
    --   "suggested_description": "...",
    --   "suggested_tags": ["tag1", "tag2"],
    --   "optimal_post_time": "2024-02-04T17:00:00Z",
    --   "time_slot_confidence": 0.85
    -- }
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_posts_brand_id ON posts(brand_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_brand_status ON posts(brand_id, status);

-- =====================================================
-- POST ANALYTICS TABLE
-- Performance data for each post after publishing
-- =====================================================
CREATE TABLE IF NOT EXISTS post_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,                     -- 'youtube', 'tiktok', etc.
    
    -- Engagement metrics
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,                    -- Bookmarks/saves
    
    -- Watch metrics (YouTube specific)
    watch_time_seconds INTEGER,                 -- Total watch time
    avg_view_duration_seconds NUMERIC(10,2),    -- Average view duration
    avg_view_percentage NUMERIC(5,2),           -- Retention rate
    
    -- Subscriber/follower impact
    subscribers_gained INTEGER DEFAULT 0,
    subscribers_lost INTEGER DEFAULT 0,
    
    -- Timing data for smart scheduling
    posted_hour INTEGER,                        -- 0-23 (hour of day posted)
    posted_day_of_week INTEGER,                 -- 0-6 (Sunday = 0)
    posted_date DATE,
    
    -- When this data was fetched
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Track multiple snapshots over time
    snapshot_type TEXT DEFAULT 'current' CHECK (snapshot_type IN (
        '24h',      -- 24 hours after posting
        '48h',      -- 48 hours after posting
        '7d',       -- 7 days after posting
        '30d',      -- 30 days after posting
        'current'   -- Latest data
    )),
    
    UNIQUE(post_id, platform, snapshot_type)
);

CREATE INDEX IF NOT EXISTS idx_post_analytics_post_id ON post_analytics(post_id);
CREATE INDEX IF NOT EXISTS idx_post_analytics_platform ON post_analytics(platform);
CREATE INDEX IF NOT EXISTS idx_post_analytics_timing ON post_analytics(platform, posted_hour, posted_day_of_week);

-- =====================================================
-- PLATFORM TOKENS TABLE
-- Secure storage for OAuth tokens per brand per platform
-- Separate from brand_credentials for better security/organization
-- =====================================================
CREATE TABLE IF NOT EXISTS platform_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,                     -- 'youtube', 'tiktok', 'instagram'
    
    -- OAuth tokens (encrypted in application layer)
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    
    -- Platform-specific identifiers
    platform_user_id TEXT,                      -- User ID on that platform
    platform_channel_id TEXT,                   -- Channel/page ID
    platform_channel_name TEXT,                 -- Display name
    platform_channel_thumbnail TEXT,            -- Avatar URL
    
    -- Scopes granted
    scopes TEXT[],
    
    -- Status
    is_valid BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    last_error TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One token set per platform per brand
    UNIQUE(brand_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_platform_tokens_brand ON platform_tokens(brand_id);
CREATE INDEX IF NOT EXISTS idx_platform_tokens_platform ON platform_tokens(platform);

-- =====================================================
-- GENERATION BATCHES TABLE
-- Track bulk video generation sessions
-- =====================================================
CREATE TABLE IF NOT EXISTS generation_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Batch configuration
    video_count INTEGER NOT NULL,               -- How many videos to generate
    themes TEXT[] NOT NULL,                     -- Themes to randomly pick from
    
    -- Generation settings
    settings JSONB DEFAULT '{}'::jsonb,
    -- Structure: {
    --   "duration": { "min": 45, "max": 60 },
    --   "artStyle": "cinematic",
    --   "voice": "deep_male",
    --   "music": "suspense",
    --   "effects": ["zoom", "fade"]
    -- }
    
    -- Status: setup -> generating -> reviewing -> scheduling -> completed
    status TEXT DEFAULT 'setup' CHECK (status IN (
        'setup',        -- Configuring settings
        'stories',      -- Generating/reviewing stories
        'generating',   -- Generating videos
        'reviewing',    -- Reviewing/approving videos
        'scheduling',   -- Scheduling posts
        'completed',    -- All done
        'cancelled'     -- User cancelled
    )),
    
    -- Track individual video progress
    videos JSONB DEFAULT '[]'::jsonb,
    -- Structure: [
    --   {
    --     "index": 0,
    --     "theme": "urban_legend",
    --     "status": "completed",
    --     "job_id": "uuid",
    --     "post_id": "uuid",
    --     "story": { "title": "...", "scenes": [...] },
    --     "error": null
    --   }
    -- ]
    
    -- Progress tracking
    videos_completed INTEGER DEFAULT 0,
    videos_approved INTEGER DEFAULT 0,
    videos_scheduled INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_generation_batches_brand ON generation_batches(brand_id);
CREATE INDEX IF NOT EXISTS idx_generation_batches_status ON generation_batches(status);

-- =====================================================
-- TIME SLOT SCORES TABLE
-- Track performance by time slot for smart scheduling
-- =====================================================
CREATE TABLE IF NOT EXISTS time_slot_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    
    -- Time slot
    day_of_week INTEGER NOT NULL,               -- 0-6 (Sunday = 0)
    hour INTEGER NOT NULL,                      -- 0-23
    
    -- Scoring
    post_count INTEGER DEFAULT 0,               -- How many posts in this slot
    total_views INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,         -- likes + comments + shares
    avg_views NUMERIC(12,2) DEFAULT 0,
    avg_engagement NUMERIC(12,2) DEFAULT 0,
    score NUMERIC(8,4) DEFAULT 0,               -- Calculated score (0-100)
    
    -- Timestamps
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(brand_id, platform, day_of_week, hour)
);

CREATE INDEX IF NOT EXISTS idx_time_slot_scores_brand_platform ON time_slot_scores(brand_id, platform);

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Enable RLS on all new tables
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slot_scores ENABLE ROW LEVEL SECURITY;

-- Posts policies
CREATE POLICY "posts_select_own" ON posts FOR SELECT
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "posts_insert_own" ON posts FOR INSERT
    WITH CHECK (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "posts_update_own" ON posts FOR UPDATE
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "posts_delete_own" ON posts FOR DELETE
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));

-- Post analytics policies
CREATE POLICY "post_analytics_select_own" ON post_analytics FOR SELECT
    USING (post_id IN (
        SELECT id FROM posts WHERE brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    ));
    
CREATE POLICY "post_analytics_insert_own" ON post_analytics FOR INSERT
    WITH CHECK (post_id IN (
        SELECT id FROM posts WHERE brand_id IN (
            SELECT id FROM brands WHERE user_id = auth.uid()
        )
    ));

-- Platform tokens policies (most sensitive!)
CREATE POLICY "platform_tokens_select_own" ON platform_tokens FOR SELECT
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "platform_tokens_insert_own" ON platform_tokens FOR INSERT
    WITH CHECK (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "platform_tokens_update_own" ON platform_tokens FOR UPDATE
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "platform_tokens_delete_own" ON platform_tokens FOR DELETE
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));

-- Generation batches policies
CREATE POLICY "generation_batches_select_own" ON generation_batches FOR SELECT
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "generation_batches_insert_own" ON generation_batches FOR INSERT
    WITH CHECK (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "generation_batches_update_own" ON generation_batches FOR UPDATE
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));

-- Time slot scores policies
CREATE POLICY "time_slot_scores_select_own" ON time_slot_scores FOR SELECT
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));
    
CREATE POLICY "time_slot_scores_all_own" ON time_slot_scores FOR ALL
    USING (brand_id IN (SELECT id FROM brands WHERE user_id = auth.uid()));

-- =====================================================
-- SERVICE ROLE POLICIES
-- Edge functions need access to post and update tokens
-- =====================================================

-- Allow service role to access posts for auto-posting
CREATE POLICY "posts_service_role" ON posts FOR ALL
    TO service_role USING (true);

CREATE POLICY "platform_tokens_service_role" ON platform_tokens FOR ALL
    TO service_role USING (true);

CREATE POLICY "post_analytics_service_role" ON post_analytics FOR ALL
    TO service_role USING (true);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get posts due for posting
CREATE OR REPLACE FUNCTION get_posts_due_for_posting()
RETURNS TABLE (
    post_id UUID,
    brand_id UUID,
    video_url TEXT,
    title TEXT,
    description TEXT,
    tags TEXT[],
    platforms TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id as post_id,
        p.brand_id,
        p.video_url,
        p.title,
        p.description,
        p.tags,
        p.platforms
    FROM posts p
    WHERE p.status = 'scheduled'
      AND p.scheduled_at <= NOW()
      AND p.retry_count < 3
    ORDER BY p.scheduled_at ASC
    LIMIT 10;  -- Process max 10 at a time
END;
$$;

-- Function to update time slot scores based on analytics
CREATE OR REPLACE FUNCTION update_time_slot_scores(p_brand_id UUID, p_platform TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO time_slot_scores (brand_id, platform, day_of_week, hour, post_count, total_views, total_engagement, avg_views, avg_engagement, score)
    SELECT 
        p_brand_id,
        p_platform,
        pa.posted_day_of_week,
        pa.posted_hour,
        COUNT(*),
        SUM(pa.views),
        SUM(pa.likes + pa.comments + pa.shares),
        AVG(pa.views),
        AVG(pa.likes + pa.comments + pa.shares),
        -- Score formula: weighted combination of views and engagement
        (AVG(pa.views) * 0.4 + AVG(pa.likes + pa.comments + pa.shares) * 100 * 0.6)
    FROM post_analytics pa
    JOIN posts p ON pa.post_id = p.id
    WHERE p.brand_id = p_brand_id
      AND pa.platform = p_platform
      AND pa.snapshot_type = '7d'
    GROUP BY pa.posted_day_of_week, pa.posted_hour
    ON CONFLICT (brand_id, platform, day_of_week, hour)
    DO UPDATE SET
        post_count = EXCLUDED.post_count,
        total_views = EXCLUDED.total_views,
        total_engagement = EXCLUDED.total_engagement,
        avg_views = EXCLUDED.avg_views,
        avg_engagement = EXCLUDED.avg_engagement,
        score = EXCLUDED.score,
        last_calculated_at = NOW();
END;
$$;

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_tokens_updated_at
    BEFORE UPDATE ON platform_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generation_batches_updated_at
    BEFORE UPDATE ON generation_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_analytics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON generation_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_slot_scores TO authenticated;

GRANT ALL ON posts TO service_role;
GRANT ALL ON post_analytics TO service_role;
GRANT ALL ON platform_tokens TO service_role;
GRANT ALL ON generation_batches TO service_role;
GRANT ALL ON time_slot_scores TO service_role;
