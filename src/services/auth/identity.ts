import type { NextRequest } from 'next/server';
import { getDeviceCookieName, hashDeviceId } from './device';
import { isSubjectBlocked } from './abuse-cache';
import { createSupabaseServerClient, getVerifiedUserWithTimeout } from './supabase-server';
import { AppError } from '@/lib/errors';
import { getIpPrefix, getRequestClientIp, hashIpPrefix } from '@/lib/request-ip';
import { env } from '@/env';
import { hashClientIp } from '@/services/rate-limit/ip-hash';
import type { AppQueryDb } from '@/services/db/client';

export interface RequestIdentity {
  readonly userId: string | null;
  readonly emailVerified: boolean;
  readonly deviceId: string;
  readonly deviceCookieIsNew: boolean;
  readonly ipKey: string | null;
  readonly ipHashForRateLimit: string;
  readonly isSuspended: boolean;
}

/**
 * Resolves verified identity, device identity, IP prefix key, and suspension status.
 * Contract reference: Plan 25 Section 7.2.
 */
export async function resolveRequestIdentity(
  request: NextRequest,
  options?: { db?: AppQueryDb },
): Promise<RequestIdentity> {
  // 1. IP and IP prefix key
  const clientIp = getRequestClientIp(request);
  const ipPrefix = getIpPrefix(clientIp);
  const ipKey = ipPrefix ? hashIpPrefix(ipPrefix) : null;
  const ipHashForRateLimit = hashClientIp(clientIp);

  // 2. Device cookie
  const deviceCookieName = getDeviceCookieName();
  const rawDeviceCookie = request.cookies.get(deviceCookieName)?.value?.trim();

  let deviceId: string;
  let deviceCookieIsNew = false;

  if (rawDeviceCookie) {
    deviceId = hashDeviceId(rawDeviceCookie);
  } else {
    deviceId = `nocookie:${ipKey ?? 'unknown'}`;
    deviceCookieIsNew = true;
  }

  // 3. User verification
  let userId: string | null = null;
  let emailVerified = false;

  if (env.AUTH_DRIVER === 'fake') {
    const fakeUid = request.cookies.get('recsy_fake_uid')?.value?.trim();
    if (fakeUid) {
      userId = fakeUid;
      emailVerified = true;
    }
  } else {
    // Check if any sb-* auth cookies exist
    const hasSbCookie = request.cookies
      .getAll()
      .some((c) => c.name.startsWith('sb-') && c.value.trim().length > 0);

    if (hasSbCookie) {
      try {
        const client = await createSupabaseServerClient();
        const user = await getVerifiedUserWithTimeout(client);
        if (user) {
          userId = user.id;
          emailVerified = Boolean(user.email_confirmed_at);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'AUTH_TIMEOUT') {
          throw new AppError(
            'AUTH_UNAVAILABLE',
            'Authentication verification timed out. Please try again.',
            { status: 503 },
          );
        }
        // Malformed / invalid tokens fall through to anonymous
        userId = null;
      }
    }
  }

  // 4. Abuse checks (in-memory cached)
  const isDeviceBlocked = await isSubjectBlocked('device', deviceId, options?.db);
  const isIpBlocked = ipKey ? await isSubjectBlocked('ip_key', ipKey, options?.db) : false;
  const isUserBlocked = userId ? await isSubjectBlocked('user', userId, options?.db) : false;

  const isSuspended = isDeviceBlocked || isIpBlocked || isUserBlocked;

  return {
    userId,
    emailVerified,
    deviceId,
    deviceCookieIsNew,
    ipKey,
    ipHashForRateLimit,
    isSuspended,
  };
}
