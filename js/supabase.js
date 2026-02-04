// =====================================================
// SUPABASE CLIENT
// =====================================================
let supabaseClient = null;

function initSupabase() {
    if (!window.supabase) {
        console.warn('⚠️ Supabase SDK not loaded - using localStorage only');
        return null;
    }
    
    if (!CONFIG || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
        console.warn('⚠️ Supabase config not found - using localStorage only');
        return null;
    }
    
    supabaseClient = window.supabase.createClient(
        CONFIG.SUPABASE_URL, 
        CONFIG.SUPABASE_ANON_KEY
    );
    
    console.log('✅ Supabase client initialized');
    return supabaseClient;
}

function getSupabaseClient() {
    if (!supabaseClient) {
        return initSupabase();
    }
    return supabaseClient;
}

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    // Wait for DOM to ensure CONFIG is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initSupabase();
        });
    } else {
        // DOM already loaded, init now
        initSupabase();
    }
}