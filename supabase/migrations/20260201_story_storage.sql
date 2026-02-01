-- =====================================================
-- Story Storage & Uniqueness System
-- Migration: 20260201_story_storage.sql
-- Purpose: Store generated stories with metadata for uniqueness checking
-- =====================================================

-- =====================================================
-- STORIES TABLE
-- Stores all generated stories with metadata for uniqueness checking
-- =====================================================
CREATE TABLE stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Story content
    title TEXT NOT NULL,
    story_text TEXT NOT NULL,
    hook TEXT,
    
    -- Content fingerprinting for duplicate detection
    content_hash TEXT NOT NULL, -- SHA-256 hash of normalized story text
    title_hash TEXT NOT NULL,   -- SHA-256 hash of normalized title
    
    -- Text statistics for similarity comparison
    word_count INTEGER NOT NULL,
    sentence_count INTEGER NOT NULL,
    avg_sentence_length FLOAT,
    
    -- N-gram fingerprints for fuzzy matching (stored as JSONB arrays)
    -- These allow for near-duplicate detection
    bigram_fingerprint JSONB DEFAULT '[]'::jsonb,  -- Top 50 most common bigrams
    trigram_fingerprint JSONB DEFAULT '[]'::jsonb, -- Top 50 most common trigrams
    keyword_fingerprint JSONB DEFAULT '[]'::jsonb, -- Extracted key terms
    
    -- Generation parameters (for analysis and filtering)
    vibe_preset TEXT,
    length_preset TEXT,
    visual_preset TEXT,
    art_style TEXT,
    
    -- Usage tracking
    use_count INTEGER DEFAULT 1,         -- How many times this story was used
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Link to job (optional - for tracking which job created this)
    source_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    
    -- Similarity score when generated (if it was checked against existing)
    -- NULL means it was the first story or uniqueness check was disabled
    max_similarity_score FLOAT,
    most_similar_story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
    
    -- Quality/performance metrics (updated post-generation)
    meta JSONB DEFAULT '{}'::jsonb
);

-- =====================================================
-- STORY SIMILARITY CACHE TABLE
-- Pre-computed similarity scores between stories for faster lookups
-- Only stores pairs with similarity > 0.3 to save space
-- =====================================================
CREATE TABLE story_similarity_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_a_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    story_b_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    similarity_score FLOAT NOT NULL,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure we don't store duplicate pairs
    UNIQUE(story_a_id, story_b_id),
    
    -- Ensure story_a_id < story_b_id to prevent duplicate reversed pairs
    CHECK (story_a_id < story_b_id)
);

-- =====================================================
-- STORY UNIQUENESS CONFIG TABLE
-- Stores configurable parameters for the uniqueness system
-- =====================================================
CREATE TABLE story_uniqueness_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Uniqueness checking parameters
    config_name TEXT NOT NULL UNIQUE DEFAULT 'default',
    
    -- Similarity thresholds (0.0 = allow everything, 1.0 = require completely unique)
    exact_match_threshold FLOAT DEFAULT 0.95,      -- Above this = definite duplicate
    high_similarity_threshold FLOAT DEFAULT 0.75,  -- Above this = too similar, reject
    moderate_similarity_threshold FLOAT DEFAULT 0.5, -- Above this = somewhat similar, apply weight
    
    -- Time decay parameters for weighted reuse
    -- Weight = base_weight * exp(-decay_rate * days_since_creation)
    decay_rate FLOAT DEFAULT 0.01,                -- How fast old stories become "reusable"
    decay_half_life_days INTEGER DEFAULT 30,      -- Alternative: days until weight is halved
    
    -- Lookback settings
    lookback_days INTEGER DEFAULT 90,             -- Only check stories from last N days
    max_stories_to_check INTEGER DEFAULT 1000,    -- Limit for performance
    
    -- Retry settings
    max_generation_attempts INTEGER DEFAULT 5,    -- Max tries to generate unique story
    
    -- Feature flags
    uniqueness_enabled BOOLEAN DEFAULT true,
    store_all_stories BOOLEAN DEFAULT true,
    compute_similarity_cache BOOLEAN DEFAULT false, -- Expensive, enable for large datasets
    
    -- Notes
    description TEXT
);

-- Insert default configuration
INSERT INTO story_uniqueness_config (
    config_name,
    exact_match_threshold,
    high_similarity_threshold,
    moderate_similarity_threshold,
    decay_rate,
    decay_half_life_days,
    lookback_days,
    max_stories_to_check,
    max_generation_attempts,
    uniqueness_enabled,
    store_all_stories,
    description
) VALUES (
    'default',
    0.95,
    0.75,
    0.5,
    0.023,  -- Approximately 30-day half-life: ln(2)/30 ≈ 0.023
    30,
    90,
    1000,
    5,
    true,
    true,
    'Default uniqueness configuration with 30-day half-life decay'
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Primary lookups
CREATE INDEX idx_stories_created_at ON stories(created_at DESC);
CREATE INDEX idx_stories_content_hash ON stories(content_hash);
CREATE INDEX idx_stories_title_hash ON stories(title_hash);
CREATE INDEX idx_stories_last_used ON stories(last_used_at DESC);

-- Filtering by generation parameters
CREATE INDEX idx_stories_vibe_preset ON stories(vibe_preset);
CREATE INDEX idx_stories_length_preset ON stories(length_preset);
CREATE INDEX idx_stories_visual_preset ON stories(visual_preset);

-- Combined index for common query pattern
CREATE INDEX idx_stories_recent_by_preset ON stories(vibe_preset, visual_preset, created_at DESC);

-- Similarity cache indexes
CREATE INDEX idx_similarity_story_a ON story_similarity_cache(story_a_id);
CREATE INDEX idx_similarity_story_b ON story_similarity_cache(story_b_id);
CREATE INDEX idx_similarity_score ON story_similarity_cache(similarity_score DESC);

-- GIN index for JSONB fingerprint searches (for advanced similarity queries)
CREATE INDEX idx_stories_bigram_gin ON stories USING GIN (bigram_fingerprint jsonb_path_ops);
CREATE INDEX idx_stories_keyword_gin ON stories USING GIN (keyword_fingerprint jsonb_path_ops);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to compute weighted similarity score based on age
-- Returns a value between 0 and 1, where older stories have lower weight
CREATE OR REPLACE FUNCTION compute_age_weight(
    story_created_at TIMESTAMPTZ,
    decay_rate FLOAT DEFAULT 0.023,
    lookback_days INTEGER DEFAULT 90
) RETURNS FLOAT AS $$
DECLARE
    days_old FLOAT;
    weight FLOAT;
BEGIN
    days_old := EXTRACT(EPOCH FROM (NOW() - story_created_at)) / 86400.0;
    
    -- If older than lookback, return 0 (don't consider this story)
    IF days_old > lookback_days THEN
        RETURN 0.0;
    END IF;
    
    -- Exponential decay: weight = e^(-decay_rate * days)
    weight := EXP(-decay_rate * days_old);
    
    RETURN GREATEST(0.0, LEAST(1.0, weight));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get effective similarity (raw similarity * age weight)
CREATE OR REPLACE FUNCTION get_effective_similarity(
    raw_similarity FLOAT,
    story_created_at TIMESTAMPTZ,
    decay_rate FLOAT DEFAULT 0.023,
    lookback_days INTEGER DEFAULT 90
) RETURNS FLOAT AS $$
BEGIN
    RETURN raw_similarity * compute_age_weight(story_created_at, decay_rate, lookback_days);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update timestamp trigger for config table
CREATE TRIGGER update_story_uniqueness_config_updated_at
    BEFORE UPDATE ON story_uniqueness_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_similarity_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_uniqueness_config ENABLE ROW LEVEL SECURITY;

-- Allow all operations (MVP - personal use)
CREATE POLICY "Allow all operations on stories" ON stories
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on story_similarity_cache" ON story_similarity_cache
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on story_uniqueness_config" ON story_uniqueness_config
    FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- ADD STORY REFERENCE TO JOBS TABLE
-- =====================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES stories(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS story_reuse_info JSONB DEFAULT NULL;

CREATE INDEX idx_jobs_story_id ON jobs(story_id);

-- =====================================================
-- VIEWS FOR ANALYTICS
-- =====================================================

-- View: Recent stories with age-weighted uniqueness scores
CREATE OR REPLACE VIEW v_stories_with_weights AS
SELECT 
    s.*,
    compute_age_weight(s.created_at, c.decay_rate, c.lookback_days) as current_weight,
    EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400.0 as days_old
FROM stories s
CROSS JOIN story_uniqueness_config c
WHERE c.config_name = 'default'
ORDER BY s.created_at DESC;

-- View: Story generation statistics
CREATE OR REPLACE VIEW v_story_stats AS
SELECT 
    vibe_preset,
    visual_preset,
    length_preset,
    COUNT(*) as total_stories,
    AVG(word_count) as avg_word_count,
    AVG(max_similarity_score) as avg_similarity_at_generation,
    MIN(created_at) as first_story_date,
    MAX(created_at) as last_story_date
FROM stories
GROUP BY vibe_preset, visual_preset, length_preset;

-- =====================================================
-- RPC FUNCTIONS FOR STORY MANAGEMENT
-- =====================================================

-- Function to increment story use count
CREATE OR REPLACE FUNCTION increment_story_use_count(story_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE stories 
    SET 
        use_count = use_count + 1,
        last_used_at = NOW()
    WHERE id = story_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update uniqueness config
CREATE OR REPLACE FUNCTION update_uniqueness_config(
    p_config_name TEXT DEFAULT 'default',
    p_exact_match_threshold FLOAT DEFAULT NULL,
    p_high_similarity_threshold FLOAT DEFAULT NULL,
    p_moderate_similarity_threshold FLOAT DEFAULT NULL,
    p_decay_rate FLOAT DEFAULT NULL,
    p_decay_half_life_days INTEGER DEFAULT NULL,
    p_lookback_days INTEGER DEFAULT NULL,
    p_max_stories_to_check INTEGER DEFAULT NULL,
    p_max_generation_attempts INTEGER DEFAULT NULL,
    p_uniqueness_enabled BOOLEAN DEFAULT NULL,
    p_store_all_stories BOOLEAN DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    UPDATE story_uniqueness_config
    SET
        exact_match_threshold = COALESCE(p_exact_match_threshold, exact_match_threshold),
        high_similarity_threshold = COALESCE(p_high_similarity_threshold, high_similarity_threshold),
        moderate_similarity_threshold = COALESCE(p_moderate_similarity_threshold, moderate_similarity_threshold),
        decay_rate = COALESCE(p_decay_rate, decay_rate),
        decay_half_life_days = COALESCE(p_decay_half_life_days, decay_half_life_days),
        lookback_days = COALESCE(p_lookback_days, lookback_days),
        max_stories_to_check = COALESCE(p_max_stories_to_check, max_stories_to_check),
        max_generation_attempts = COALESCE(p_max_generation_attempts, max_generation_attempts),
        uniqueness_enabled = COALESCE(p_uniqueness_enabled, uniqueness_enabled),
        store_all_stories = COALESCE(p_store_all_stories, store_all_stories),
        updated_at = NOW()
    WHERE config_name = p_config_name;
END;
$$ LANGUAGE plpgsql;

-- Function to get stories similar to a given text (for manual checking)
CREATE OR REPLACE FUNCTION find_similar_stories(
    p_story_text TEXT,
    p_limit INTEGER DEFAULT 10,
    p_lookback_days INTEGER DEFAULT 90
)
RETURNS TABLE(
    story_id UUID,
    title TEXT,
    created_at TIMESTAMPTZ,
    word_count INTEGER,
    days_old FLOAT,
    age_weight FLOAT
) AS $$
DECLARE
    lookback_date TIMESTAMPTZ;
BEGIN
    lookback_date := NOW() - (p_lookback_days || ' days')::INTERVAL;
    
    RETURN QUERY
    SELECT 
        s.id as story_id,
        s.title,
        s.created_at,
        s.word_count,
        EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400.0 as days_old,
        compute_age_weight(s.created_at, 0.023, p_lookback_days) as age_weight
    FROM stories s
    WHERE s.created_at >= lookback_date
    ORDER BY s.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get story statistics
CREATE OR REPLACE FUNCTION get_story_statistics()
RETURNS TABLE(
    total_stories BIGINT,
    stories_last_7_days BIGINT,
    stories_last_30_days BIGINT,
    avg_word_count NUMERIC,
    avg_similarity_score NUMERIC,
    most_common_vibe TEXT,
    most_common_visual TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_stories,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::BIGINT as stories_last_7_days,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::BIGINT as stories_last_30_days,
        ROUND(AVG(s.word_count)::NUMERIC, 2) as avg_word_count,
        ROUND(AVG(max_similarity_score)::NUMERIC, 4) as avg_similarity_score,
        (SELECT vibe_preset FROM stories GROUP BY vibe_preset ORDER BY COUNT(*) DESC LIMIT 1) as most_common_vibe,
        (SELECT visual_preset FROM stories GROUP BY visual_preset ORDER BY COUNT(*) DESC LIMIT 1) as most_common_visual
    FROM stories s;
END;
$$ LANGUAGE plpgsql;
