import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';

let _adminClient: ReturnType<typeof createClient> | null = null;

/**
 * Returns a Supabase client configured with the service role key.
 * Strictly restricted by ESLint to account lifecycle and admin operations.
 */
export function getAuthAdminClient(): ReturnType<typeof createClient> {
  if (!_adminClient) {
    _adminClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _adminClient;
}
