-- =====================================================
-- Storage Policies for Gameplay Clips
-- Allow anon uploads/reads/deletes for brands/*/gameplay/* path
-- Mirrors the music storage policy pattern from 20260129_audio_storage_policy.sql
-- =====================================================

-- Policy: Allow anyone to read gameplay clips
CREATE POLICY "Public can read gameplay clips"
ON storage.objects FOR SELECT
USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/gameplay/%');

-- Policy: Allow anyone to upload gameplay clips
CREATE POLICY "Public can upload gameplay clips"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'story-videos' AND name LIKE 'brands/%/gameplay/%');

-- Policy: Allow anyone to update (overwrite) gameplay clips
CREATE POLICY "Public can update gameplay clips"
ON storage.objects FOR UPDATE
USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/gameplay/%');

-- Policy: Allow anyone to delete gameplay clips
CREATE POLICY "Public can delete gameplay clips"
ON storage.objects FOR DELETE
USING (bucket_id = 'story-videos' AND name LIKE 'brands/%/gameplay/%');
