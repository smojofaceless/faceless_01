-- =====================================================
-- Storage Policies for Video Overlay Files
-- Allow anon uploads/reads/deletes for brands/*/overlays/* path
-- Mirrors the gameplay storage policy pattern
-- =====================================================

-- Policy: Allow anyone to read overlay videos
CREATE POLICY "Public can read overlay videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/overlays/%');

-- Policy: Allow anyone to upload overlay videos
CREATE POLICY "Public can upload overlay videos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'story-videos' AND name LIKE 'brands/%/overlays/%');

-- Policy: Allow anyone to update (overwrite) overlay videos
CREATE POLICY "Public can update overlay videos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/overlays/%');

-- Policy: Allow anyone to delete overlay videos
CREATE POLICY "Public can delete overlay videos"
ON storage.objects FOR DELETE
USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/overlays/%');
