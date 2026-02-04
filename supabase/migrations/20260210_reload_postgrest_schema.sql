-- =====================================================
-- Force PostgREST schema reload
-- =====================================================

-- This triggers PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';

-- Re-grant permissions just in case
GRANT EXECUTE ON FUNCTION import_job_to_posts(UUID, UUID, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_import_jobs_to_posts(UUID, INTEGER) TO anon, authenticated;

-- Also make sure the view is accessible
GRANT SELECT ON jobs_available_for_import TO anon, authenticated;
