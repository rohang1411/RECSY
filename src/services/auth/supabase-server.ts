import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { cache } from 'react';
import { env } from '@/env';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'supabase-server' });

export type CookieOptions = NonNullable<Parameters<NextResponse['cookies']['set']>[2]>;

export type SupabaseServerClient = ReturnType<typeof createServerClient> & {
  applyCookies: (response: NextResponse) => NextResponse;
  getModifiedCookies: () => Array<{
    name: string;
    value: string;
    options?: CookieOptions;
  }>;
};

/**
 * Creates a server-side Supabase client reading and writing cookies
 * through Next.js headers/cookies context (Route Handlers & Server Components).
 *
 * Provides `applyCookies(response)` to ensure session and PKCE cookies
 * are reliably attached to explicitly returned `NextResponse` instances
 * (such as 302 redirects or JSON responses).
 */
export async function createSupabaseServerClient(options?: {
  response?: NextResponse;
}): Promise<SupabaseServerClient> {
  const cookieStore = await cookies();
  const modifiedCookies: Array<{
    name: string;
    value: string;
    options?: CookieOptions;
  }> = [];

  const rawClient = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
              cookieStore.set(name, value, cookieOptions);
              const typedOpts = cookieOptions as unknown as CookieOptions;
              modifiedCookies.push({ name, value, options: typedOpts });
              if (options?.response) {
                options.response.cookies.set(name, value, typedOpts);
              }
            });
          } catch {
            // Setting cookies in Server Components is not permitted; ignored safely
          }
        },
      },
    },
  );

  return Object.assign(rawClient, {
    applyCookies(response: NextResponse): NextResponse {
      for (const { name, value, options: cookieOptions } of modifiedCookies) {
        response.cookies.set(name, value, cookieOptions);
      }
      return response;
    },
    getModifiedCookies() {
      return [...modifiedCookies];
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
  const modifiedCookies: Array<{
    name: string;
    value: string;
    options?: CookieOptions;
  }> = [];

  const rawClient = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
            request.cookies.set(name, value);
            const typedOpts = cookieOptions as unknown as CookieOptions;
            response.cookies.set(name, value, typedOpts);
            modifiedCookies.push({ name, value, options: typedOpts });
          });
        },
      },
    },
  );

  return Object.assign(rawClient, {
    applyCookies(res: NextResponse): NextResponse {
      for (const { name, value, options: cookieOptions } of modifiedCookies) {
        res.cookies.set(name, value, cookieOptions);
      }
      return res;
    },
    getModifiedCookies() {
      return [...modifiedCookies];
    },
  });
}

export interface VerifiedClaimsUser {
  readonly id: string;
  /**
   * Advisory email verification flag derived from JWT user_metadata.
   * Call getUser() if a trustworthy authoritative value is required.
   */
  readonly emailVerified: boolean;
}

/**
 * Verifies JWT claims locally (via cached JWKS when asymmetric keys are enabled)
 * with timeout. Returns the authenticated user claims or null. Throws on timeout to signal AUTH_UNAVAILABLE.
 */
export async function getVerifiedClaimsWithTimeout(
  client: SupabaseServerClient,
  timeoutMs = env.AUTH_VERIFY_TIMEOUT_MS,
): Promise<VerifiedClaimsUser | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('AUTH_TIMEOUT'));
    }, timeoutMs);
  });

  try {
    const claimsPromise = (async () => {
      const { data, error } = await client.auth.getClaims();
      if (error || !data?.claims) {
        return null;
      }
      const claims = data.claims as {
        sub?: string;
        user_metadata?: { email_verified?: boolean };
        [key: string]: unknown;
      };
      if (!claims.sub) {
        return null;
      }
      return {
        id: claims.sub,
        emailVerified: claims.user_metadata?.email_verified === true,
      };
    })();
    const user = await Promise.race([claimsPromise, timeoutPromise]);
    return user;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'AUTH_TIMEOUT') {
      log.warn({ timeoutMs }, 'Supabase auth claims verification timed out');
      throw err;
    }
    // Expired or malformed token
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
