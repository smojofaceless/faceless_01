-- =====================================================
-- Fix RPC function permissions for import
-- Grant execute permissions to anon and authenticated users
-- =====================================================

-- Grant execute on import functions
GRANT EXECUTE ON FUNCTION import_job_to_posts(UUID, UUID, TEXT[]) TO anon;
GRANT EXECUTE ON FUNCTION import_job_to_posts(UUID, UUID, TEXT[]) TO authenticated;

GRANT EXECUTE ON FUNCTION bulk_import_jobs_to_posts(UUID, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION bulk_import_jobs_to_posts(UUID, INTEGER) TO authenticated;

-- Grant select on the view
GRANT SELECT ON jobs_available_for_import TO anon;
GRANT SELECT ON jobs_available_for_import TO authenticated;
