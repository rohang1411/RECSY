import { env } from '@/env';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'abuse-turnstile' });

export interface TurnstileVerificationResult {
  readonly success: boolean;
  readonly errorCodes?: readonly string[];
}

/**
 * Verifies a Cloudflare Turnstile token via their siteverify API.
 * Section 8.4: 2-second timeout, fail-closed for flagged traffic.
 * If TURNSTILE_SECRET_KEY is unset (e.g. local dev / test), validation is skipped.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileVerificationResult> {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { success: true };
  }

  if (!token || !token.trim()) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const formData = new URLSearchParams();
  formData.append('secret', env.TURNSTILE_SECRET_KEY);
  formData.append('response', token.trim());
  if (remoteIp && remoteIp !== 'unknown') {
    formData.append('remoteip', remoteIp.trim());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      log.warn({ status: res.status }, 'Turnstile verification HTTP error');
      return { success: false, errorCodes: [`http-${res.status}`] };
    }

    const data = (await res.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };

    return {
      success: Boolean(data.success),
      errorCodes: data['error-codes'] ?? [],
    };
  } catch (err: unknown) {
    const isTimeout =
      (err instanceof Error && err.name === 'AbortError') || controller.signal.aborted;
    log.error({ err, isTimeout }, 'Turnstile verification failed or timed out');
    return {
      success: false,
      errorCodes: [isTimeout ? 'timeout' : 'network-error'],
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluates whether anonymous traffic is risk-flagged (Section 8.4):
 * IP prefix usage today >= 70% of anonymous IP cap.
 */
export function isTrafficRiskFlagged(input: {
  ipKey: string | null;
  ipAnonUsedToday: number;
  anonIpCap: number;
}): boolean {
  if (!input.ipKey || input.anonIpCap <= 0) {
    return false;
  }
  return input.ipAnonUsedToday >= 0.7 * input.anonIpCap;
}
