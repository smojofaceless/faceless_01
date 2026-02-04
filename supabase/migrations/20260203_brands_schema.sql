-- =====================================================
-- BRANDS SCHEMA
-- Tables for storing brand information and credentials
-- =====================================================

-- Enable pgcrypto for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- BRANDS TABLE
-- Core brand information
-- =====================================================
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Basic Info
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    niche TEXT NOT NULL,
    description TEXT,
    
    -- Theme (colors, fonts, etc.)
    theme JSONB DEFAULT '{
        "primaryColor": "#8B5CF6",
        "secondaryColor": "#1E1E2E", 
        "accentColor": "#EC4899",
        "fontFamily": "Inter"
    }'::jsonb,
    
    -- Settings
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- Status
    is_active BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(user_id, slug)
);

-- =====================================================
-- BRAND CREDENTIALS TABLE
-- Secure storage for API keys and tokens per platform
-- =====================================================
CREATE TABLE IF NOT EXISTS brand_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Platform identification
    platform TEXT NOT NULL, -- 'youtube', 'tiktok', 'instagram', 'twitter', etc.
    
    -- Encrypted credentials stored as JSONB
    -- Structure varies by platform, e.g.:
    -- YouTube: { "api_key": "...", "client_id": "...", "client_secret": "...", "refresh_token": "..." }
    -- TikTok: { "access_token": "...", "refresh_token": "...", "open_id": "..." }
    credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Connection status
    is_connected BOOLEAN DEFAULT false,
    last_verified_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One credential set per platform per brand
    UNIQUE(brand_id, platform)
);

-- =====================================================
-- BRAND TEMPLATES TABLE
-- Custom templates per brand (optional)
-- =====================================================
CREATE TABLE IF NOT EXISTS brand_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Template info
    name TEXT NOT NULL,
    template_type TEXT NOT NULL, -- 'horror', 'food-facts', 'generic', etc.
    
    -- Custom overrides for this brand
    config_overrides JSONB DEFAULT '{}'::jsonb,
    
    -- Is this the default template for the brand?
    is_default BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_brands_user_id ON brands(user_id);
CREATE INDEX IF NOT EXISTS idx_brands_slug ON brands(slug);
CREATE INDEX IF NOT EXISTS idx_brands_is_active ON brands(is_active);
CREATE INDEX IF NOT EXISTS idx_brand_credentials_brand_id ON brand_credentials(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_credentials_platform ON brand_credentials(platform);
CREATE INDEX IF NOT EXISTS idx_brand_templates_brand_id ON brand_templates(brand_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_templates ENABLE ROW LEVEL SECURITY;

-- Brands policies
CREATE POLICY "Users can view their own brands"
    ON brands FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own brands"
    ON brands FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own brands"
    ON brands FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own brands"
    ON brands FOR DELETE
    USING (auth.uid() = user_id);

-- Brand credentials policies (extra secure - only owner can access)
CREATE POLICY "Users can view credentials for their brands"
    ON brand_credentials FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_credentials.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create credentials for their brands"
    ON brand_credentials FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_credentials.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update credentials for their brands"
    ON brand_credentials FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_credentials.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete credentials for their brands"
    ON brand_credentials FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_credentials.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

-- Brand templates policies
CREATE POLICY "Users can view templates for their brands"
    ON brand_templates FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_templates.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create templates for their brands"
    ON brand_templates FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_templates.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update templates for their brands"
    ON brand_templates FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_templates.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete templates for their brands"
    ON brand_templates FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM brands 
            WHERE brands.id = brand_templates.brand_id 
            AND brands.user_id = auth.uid()
        )
    );

-- =====================================================
-- SERVICE ROLE ACCESS
-- Allow edge functions to access brand data
-- =====================================================
CREATE POLICY "Service role can access all brands"
    ON brands FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service role can access all credentials"
    ON brand_credentials FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service role can access all templates"
    ON brand_templates FOR ALL
    USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating timestamps
CREATE TRIGGER update_brands_updated_at
    BEFORE UPDATE ON brands
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brand_credentials_updated_at
    BEFORE UPDATE ON brand_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_brand_templates_updated_at
    BEFORE UPDATE ON brand_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure only one active brand per user
CREATE OR REPLACE FUNCTION ensure_single_active_brand()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active = true THEN
        UPDATE brands 
        SET is_active = false 
        WHERE user_id = NEW.user_id 
        AND id != NEW.id 
        AND is_active = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_active_brand_trigger
    BEFORE INSERT OR UPDATE ON brands
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_active_brand();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE brands IS 'Stores brand/channel information for each user';
COMMENT ON TABLE brand_credentials IS 'Securely stores API credentials for social platforms per brand';
COMMENT ON TABLE brand_templates IS 'Custom template configurations per brand';
COMMENT ON COLUMN brand_credentials.credentials IS 'Encrypted JSON containing platform-specific API keys and tokens';
