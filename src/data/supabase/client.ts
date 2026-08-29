import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function getSupabase() {
  if (client) return client;
  // Vite only exposes variables prefixed with `VITE_`. The NEXT_PUBLIC names
  // are accepted as a backwards-compatible bridge for existing local setups.
  const env = import.meta.env as ImportMetaEnv & {
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  };
  const url = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("A conexão segura com o Supabase não está configurada.");
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
