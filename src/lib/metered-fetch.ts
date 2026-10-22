/**
 * Client metered fetch utilities and error mapping.
 * Normative reference: Plan 25 Section 12.6, 12.10, 15.2.
 */

import { COPY } from '@/content/copy';
import { getClientByokHeaders } from '@/lib/byok-client';
import type { QuotaSnapshotLite } from '@/services/metering/types';

export interface MeteredErrorResponse {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly context?: Record<string, unknown>;
  };
  readonly quota?: QuotaSnapshotLite;
}

export type MeteredUiAction =
  | { readonly kind: 'auth'; readonly reason: 'anon_exhausted' | 'signin_required' }
  | { readonly kind: 'quota'; readonly reason: 'free_exhausted' | 'sub_exhausted' | 'device_cap' }
  | { readonly kind: 'inline'; readonly message: string; readonly retryAfterSec?: number }
  | { readonly kind: 'callout'; readonly variant: 'warning' | 'error'; readonly message: string }
  | { readonly kind: 'toast'; readonly message: string }
  | { readonly kind: 'restricted'; readonly message: string };

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Maps raw metered API response errors to consistent UI actions.
 */
export function handleMeteredError(
  status: number,
  payload?: MeteredErrorResponse | null,
  retryAfterHeader?: string | null,
): MeteredUiAction {
  const code = payload?.error?.code ?? '';
  const message = payload?.error?.message;
  const context = payload?.error?.context;

  // 1. Auth required / anonymous limits
  if (
    code === 'ANON_QUOTA_EXHAUSTED' ||
    code === 'ANON_IP_CAP' ||
    (status === 402 && code === 'SIGNIN_REQUIRED')
  ) {
    return { kind: 'auth', reason: 'anon_exhausted' };
  }

  if (code === 'SIGNIN_REQUIRED' || status === 401) {
    return { kind: 'auth', reason: 'signin_required' };
  }

  // 2. Signed-in Quota Exhaustion
  if (code === 'SUBSCRIPTION_EXHAUSTED') {
    return { kind: 'quota', reason: 'sub_exhausted' };
  }

  if (code === 'DEVICE_ACCOUNT_CAP') {
    return { kind: 'quota', reason: 'device_cap' };
  }

  if (code === 'QUOTA_EXHAUSTED' || (status === 402 && !code)) {
    return { kind: 'quota', reason: 'free_exhausted' };
  }

  // 3. BYOK Specific Limits
  if (code === 'BYOK_DAILY_CAP') {
    return {
      kind: 'inline',
      message: COPY.deny.byokCap(100, '00:00 UTC'),
    };
  }

  if (code === 'BYOK_REJECTED' || code === 'BYOK_UNSUPPORTED' || code === 'BYOK_RATE_LIMITED') {
    return {
      kind: 'inline',
      message: message ?? 'Your custom API key was rejected by the provider. Check Settings.',
    };
  }

  // 4. Concurrency & Rate limits
  if (code === 'TOO_MANY_INFLIGHT' || code === 'DUPLICATE_REQUEST') {
    return {
      kind: 'inline',
      message: COPY.deny.inflight,
    };
  }

  if (status === 429 || code === 'RATE_LIMITED') {
    const retrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 10;
    return {
      kind: 'inline',
      retryAfterSec: isNaN(retrySec) ? 10 : retrySec,
      message: `Rate limited. Please wait ${isNaN(retrySec) ? 10 : retrySec}s.`,
    };
  }

  // 5. Capacity & Maintenance
  if (code === 'CAPACITY_BUSY') {
    return {
      kind: 'callout',
      variant: 'warning',
      message: COPY.deny.capacity(30),
    };
  }

  if (code === 'PLATFORM_PAUSED') {
    const opMsg = typeof context?.message === 'string' ? context.message : undefined;
    return {
      kind: 'callout',
      variant: 'warning',
      message: COPY.deny.paused(opMsg),
    };
  }

  // 6. Infrastructure errors
  if (code === 'METERING_UNAVAILABLE' || code === 'AUTH_UNAVAILABLE') {
    return {
      kind: 'toast',
      message: COPY.deny.metering,
    };
  }

  // 7. Account restrictions
  if (code === 'ACCOUNT_RESTRICTED' || status === 403) {
    return {
      kind: 'restricted',
      message: message ?? COPY.auth.restricted,
    };
  }

  // Default fallback
  return {
    kind: 'toast',
    message: message ?? 'Something went wrong on our side. You were not charged.',
  };
}

/**
 * Standard fetch options with request-id and BYOK headers attached.
 */
export function createMeteredRequestInit(
  init?: RequestInit,
  customRequestId?: string,
): RequestInit {
  const requestId = customRequestId ?? generateRequestId();
  const byokHeaders = getClientByokHeaders();

  const headers = new Headers(init?.headers);
  headers.set('x-request-id', requestId);
  for (const [k, v] of Object.entries(byokHeaders)) {
    headers.set(k, v);
  }

  return {
    ...init,
    headers,
    credentials: init?.credentials ?? 'include',
  };
}
