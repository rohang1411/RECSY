import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';

let adminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdminClient(): ReturnType<typeof createClient> {
  if (!adminClient) {
    adminClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

export function setSupabaseAdminClientForTest(
  client: ReturnType<typeof createClient> | null,
): void {
  adminClient = client;
}
