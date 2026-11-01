// Клієнт Supabase для браузера (адмінка). Публічний ключ: усі права обмежує RLS у базі.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export type StaffRole = 'owner' | 'manager';

/** Роль поточного користувача в команді магазину; null — не в команді або не увійшов. */
export async function currentRole(): Promise<{ email: string; role: StaffRole } | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('staff').select('role').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data ? { email: session.user.email ?? '', role: data.role as StaffRole } : null;
}
