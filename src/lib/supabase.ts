import { createClient } from '@supabase/supabase-js';

// The publishable key is designed to ship in browser code; data is protected by
// Row Level Security (see supabase/schema.sql), not by keeping this key secret.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yjwqntogxovdrygxgutu.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_gJLc1OAacdAyEUBGC8g31w_Vhy_jkvG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
