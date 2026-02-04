-- =====================================================
-- DEVELOPMENT POLICIES
-- Allow unauthenticated access for development
-- REMOVE THESE IN PRODUCTION
-- =====================================================

-- Drop existing restrictive policies for brands
DROP POLICY IF EXISTS "Users can view their own brands" ON brands;
DROP POLICY IF EXISTS "Users can create their own brands" ON brands;
DROP POLICY IF EXISTS "Users can update their own brands" ON brands;
DROP POLICY IF EXISTS "Users can delete their own brands" ON brands;
DROP POLICY IF EXISTS "Service role can access all brands" ON brands;

-- Drop existing restrictive policies for brand_credentials  
DROP POLICY IF EXISTS "Users can view credentials for their brands" ON brand_credentials;
DROP POLICY IF EXISTS "Users can create credentials for their brands" ON brand_credentials;
DROP POLICY IF EXISTS "Users can update credentials for their brands" ON brand_credentials;
DROP POLICY IF EXISTS "Users can delete credentials for their brands" ON brand_credentials;
DROP POLICY IF EXISTS "Service role can access all credentials" ON brand_credentials;

-- Drop existing restrictive policies for brand_templates
DROP POLICY IF EXISTS "Users can view templates for their brands" ON brand_templates;
DROP POLICY IF EXISTS "Users can create templates for their brands" ON brand_templates;
DROP POLICY IF EXISTS "Users can update templates for their brands" ON brand_templates;
DROP POLICY IF EXISTS "Users can delete templates for their brands" ON brand_templates;
DROP POLICY IF EXISTS "Service role can access all templates" ON brand_templates;

-- Make user_id nullable for development
ALTER TABLE brands ALTER COLUMN user_id DROP NOT NULL;

-- =====================================================
-- PERMISSIVE DEVELOPMENT POLICIES
-- These allow all operations without authentication
-- =====================================================

-- Brands: Allow all operations
CREATE POLICY "dev_brands_select" ON brands FOR SELECT USING (true);
CREATE POLICY "dev_brands_insert" ON brands FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_brands_update" ON brands FOR UPDATE USING (true);
CREATE POLICY "dev_brands_delete" ON brands FOR DELETE USING (true);

-- Brand Credentials: Allow all operations
CREATE POLICY "dev_credentials_select" ON brand_credentials FOR SELECT USING (true);
CREATE POLICY "dev_credentials_insert" ON brand_credentials FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_credentials_update" ON brand_credentials FOR UPDATE USING (true);
CREATE POLICY "dev_credentials_delete" ON brand_credentials FOR DELETE USING (true);

-- Brand Templates: Allow all operations
CREATE POLICY "dev_templates_select" ON brand_templates FOR SELECT USING (true);
CREATE POLICY "dev_templates_insert" ON brand_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_templates_update" ON brand_templates FOR UPDATE USING (true);
CREATE POLICY "dev_templates_delete" ON brand_templates FOR DELETE USING (true);

-- =====================================================
-- NOTE: When adding authentication later, replace these
-- policies with user-specific ones that check auth.uid()
-- =====================================================
