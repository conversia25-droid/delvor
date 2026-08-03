// src/lib/supabaseDataClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseDataUrl = import.meta.env.VITE_SUPABASE_DATA_URL as string;
const supabaseDataAnonKey = import.meta.env.VITE_SUPABASE_DATA_ANON_KEY as string;

export const supabaseData = createClient(supabaseDataUrl, supabaseDataAnonKey);
