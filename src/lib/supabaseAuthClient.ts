// src/lib/supabaseAuthClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseAuthUrl = import.meta.env.VITE_SUPABASE_AUTH_URL as string;
const supabaseAuthAnonKey = import.meta.env.VITE_SUPABASE_AUTH_ANON_KEY as string;

export const supabaseAuth = createClient(supabaseAuthUrl, supabaseAuthAnonKey);
