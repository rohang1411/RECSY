import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { cache } from 'react';
import { env } from '@/env';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'supabase-server' });

export type SupabaseServerClient = ReturnType<typeof createServerClient>;

/**
 * Creates a server-side Supabase client reading and writing cookies
 * through Next.js headers/cookies context (Route Handlers & Server Components).
 */
export async function createSupabaseServerClient(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Setting cookies in Server Components is not permitted; ignored safely
        }
      },
    },
  });
}

/**
 * Creates a proxy-level Supabase client for Next.js proxy / middleware.
 * Directly reads from NextRequest and writes to NextResponse cookies.
 */
export function createSupabaseProxyClient(
  request: NextRequest,
  response: NextResponse,
): SupabaseServerClient {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}

/**
 * Verifies JWT / user session with timeout.
 * Returns the authenticated user or null. Throws on timeout to signal AUTH_UNAVAILABLE.
 */
export async function getVerifiedUserWithTimeout(
  client: SupabaseServerClient,
  timeoutMs = env.AUTH_VERIFY_TIMEOUT_MS,
) {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('AUTH_TIMEOUT'));
    }, timeoutMs);
  });

  try {
    const userPromise = (async () => {
      const { data } = await client.auth.getUser();
      return data?.user ?? null;
    })();
    const user = await Promise.race([userPromise, timeoutPromise]);
    return user;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'AUTH_TIMEOUT') {
      log.warn({ timeoutMs }, 'Supabase auth verification timed out');
      throw err;
    }
    // Expired or malformed token
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Cached getter for Server Components to avoid duplicate verification within one render pass.
 */
export const getCurrentUser = cache(async () => {
  try {
    const client = await createSupabaseServerClient();
    return await getVerifiedUserWithTimeout(client);
  } catch {
    return null;
  }
});
