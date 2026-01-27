// =====================================================
// SUPABASE CLIENT
// =====================================================
let supabaseClient = null;

function initSupabase() {
    if (!window.supabase) {
        console.error('Supabase SDK not loaded');
        return null;
    }
    
    supabaseClient = window.supabase.createClient(
        CONFIG.SUPABASE_URL, 
        CONFIG.SUPABASE_ANON_KEY
    );
    
    return supabaseClient;
}

function getSupabaseClient() {
    if (!supabaseClient) {
        return initSupabase();
    }
    return supabaseClient;
}
