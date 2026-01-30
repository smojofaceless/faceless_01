-- =====================================================
-- Storage Policies for Audio Library
-- Allow public uploads/reads/deletes for the music folder
-- =====================================================

-- Policy: Allow anyone to read music files
CREATE POLICY "Public can read music files"
ON storage.objects FOR SELECT
USING (bucket_id = 'story-videos' AND (storage.foldername(name))[1] = 'music');

-- Policy: Allow anyone to upload music files  
CREATE POLICY "Public can upload music files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'story-videos' AND (storage.foldername(name))[1] = 'music');

-- Policy: Allow anyone to update (overwrite) music files
CREATE POLICY "Public can update music files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'story-videos' AND (storage.foldername(name))[1] = 'music');

-- Policy: Allow anyone to delete music files
CREATE POLICY "Public can delete music files"
ON storage.objects FOR DELETE
USING (bucket_id = 'story-videos' AND (storage.foldername(name))[1] = 'music');
