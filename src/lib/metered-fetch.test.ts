import { describe, expect, it } from 'vitest';
import { handleMeteredError, generateRequestId, createMeteredRequestInit } from './metered-fetch';

describe('WP-15: metered-fetch and error mapping', () => {
  it('generates unique request IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('attaches request-id header to request init', () => {
    const init = createMeteredRequestInit({ method: 'POST' });
    const headers = new Headers(init.headers);
    expect(headers.get('x-request-id')).toBeTruthy();
  });

  describe('handleMeteredError code mappings (Plan 25 Section 12.6, 15.2)', () => {
    it('maps ANON_QUOTA_EXHAUSTED to auth sheet (anon_exhausted)', () => {
      const action = handleMeteredError(402, {
        error: { code: 'ANON_QUOTA_EXHAUSTED' },
      });
      expect(action).toEqual({ kind: 'auth', reason: 'anon_exhausted' });
    });

    it('maps ANON_IP_CAP to auth sheet (anon_exhausted)', () => {
      const action = handleMeteredError(402, {
        error: { code: 'ANON_IP_CAP' },
      });
      expect(action).toEqual({ kind: 'auth', reason: 'anon_exhausted' });
    });

    it('maps SIGNIN_REQUIRED to auth sheet', () => {
      const action = handleMeteredError(401, {
        error: { code: 'SIGNIN_REQUIRED' },
      });
      expect(action).toEqual({ kind: 'auth', reason: 'signin_required' });
    });

    it('maps QUOTA_EXHAUSTED for signed-in user to quota sheet', () => {
      const action = handleMeteredError(402, {
        error: { code: 'QUOTA_EXHAUSTED' },
      });
      expect(action).toEqual({ kind: 'quota', reason: 'free_exhausted' });
    });

    it('maps SUBSCRIPTION_EXHAUSTED to quota sheet (sub_exhausted)', () => {
      const action = handleMeteredError(402, {
        error: { code: 'SUBSCRIPTION_EXHAUSTED' },
      });
      expect(action).toEqual({ kind: 'quota', reason: 'sub_exhausted' });
    });

    it('maps DEVICE_ACCOUNT_CAP to quota sheet (device_cap)', () => {
      const action = handleMeteredError(402, {
        error: { code: 'DEVICE_ACCOUNT_CAP' },
      });
      expect(action).toEqual({ kind: 'quota', reason: 'device_cap' });
    });

    it('maps BYOK_DAILY_CAP to inline notification', () => {
      const action = handleMeteredError(402, {
        error: { code: 'BYOK_DAILY_CAP' },
      });
      expect(action.kind).toBe('inline');
      expect((action as { message: string }).message).toContain('100');
    });

    it('maps TOO_MANY_INFLIGHT and DUPLICATE_REQUEST to inline notification', () => {
      const action1 = handleMeteredError(429, {
        error: { code: 'TOO_MANY_INFLIGHT' },
      });
      const action2 = handleMeteredError(429, {
        error: { code: 'DUPLICATE_REQUEST' },
      });
      expect(action1.kind).toBe('inline');
      expect(action2.kind).toBe('inline');
    });

    it('maps RATE_LIMITED to inline with retryAfterSec', () => {
      const action = handleMeteredError(429, { error: { code: 'RATE_LIMITED' } }, '15');
      expect(action.kind).toBe('inline');
      expect((action as { retryAfterSec?: number }).retryAfterSec).toBe(15);
    });

    it('maps CAPACITY_BUSY to warning callout', () => {
      const action = handleMeteredError(503, {
        error: { code: 'CAPACITY_BUSY' },
      });
      expect(action).toEqual({
        kind: 'callout',
        variant: 'warning',
        message: expect.stringContaining('High demand'),
      });
    });

    it('maps PLATFORM_PAUSED to warning callout with operator message', () => {
      const action = handleMeteredError(503, {
        error: {
          code: 'PLATFORM_PAUSED',
          context: { message: 'Database maintenance in progress' },
        },
      });
      expect(action).toEqual({
        kind: 'callout',
        variant: 'warning',
        message: 'Database maintenance in progress',
      });
    });

    it('maps METERING_UNAVAILABLE to toast', () => {
      const action = handleMeteredError(503, {
        error: { code: 'METERING_UNAVAILABLE' },
      });
      expect(action.kind).toBe('toast');
    });

    it('maps ACCOUNT_RESTRICTED to restricted action', () => {
      const action = handleMeteredError(403, {
        error: { code: 'ACCOUNT_RESTRICTED', message: 'Account suspended' },
      });
      expect(action).toEqual({
        kind: 'restricted',
        message: 'Account suspended',
      });
    });

    it('maps flat payload shapes { code, message } correctly', () => {
      const authAction = handleMeteredError(402, {
        code: 'ANON_QUOTA_EXHAUSTED',
      });
      expect(authAction).toEqual({ kind: 'auth', reason: 'anon_exhausted' });

      const quotaAction = handleMeteredError(402, {
        code: 'SUBSCRIPTION_EXHAUSTED',
      });
      expect(quotaAction).toEqual({ kind: 'quota', reason: 'sub_exhausted' });

      const rateAction = handleMeteredError(
        429,
        { code: 'RATE_LIMITED', message: 'Too fast' },
        '20',
      );
      expect(rateAction).toEqual({
        kind: 'inline',
        retryAfterSec: 20,
        message: 'Rate limited. Please wait 20s.',
      });
    });

    it('maps string error payload shapes { error: string } correctly', () => {
      const toastAction = handleMeteredError(500, {
        error: 'Custom database failure details',
      });
      expect(toastAction).toEqual({
        kind: 'toast',
        message: 'Custom database failure details',
      });

      const restrictedAction = handleMeteredError(403, {
        error: 'Suspended by moderator',
      });
      expect(restrictedAction).toEqual({
        kind: 'restricted',
        message: 'Suspended by moderator',
      });
    });

    it('safely normalizes non-string message payloads to fallback string', () => {
      // Prevents React crash: Objects are not valid as a React child
      const action = handleMeteredError(500, {
        message: { formErrors: ['something wrong'] } as unknown as string,
      });
      expect(action).toEqual({
        kind: 'toast',
        message: 'Something went wrong on our side. You were not charged.',
      });
      if (action.kind === 'toast') {
        expect(typeof action.message).toBe('string');
      }
    });

    it('maps DB_TIMEOUT and DB_UNAVAILABLE to infrastructure toast', () => {
      const dbTimeoutAction = handleMeteredError(503, {
        code: 'DB_TIMEOUT',
        message: 'Database service is temporarily unavailable',
      });
      expect(dbTimeoutAction).toEqual({
        kind: 'toast',
        message: 'Database service is temporarily unavailable',
      });

      const dbUnavailableAction = handleMeteredError(503, {
        code: 'DB_UNAVAILABLE',
      });
      expect(dbUnavailableAction).toEqual({
        kind: 'toast',
        message: 'Database service is temporarily unavailable. Please retry shortly.',
      });
    });

    it('clamps negative or malformed retry-after headers to safe positive integer', () => {
      const negativeAction = handleMeteredError(429, { code: 'RATE_LIMITED' }, '-5');
      expect(negativeAction).toEqual({
        kind: 'inline',
        retryAfterSec: 10,
        message: 'Rate limited. Please wait 10s.',
      });

      const invalidAction = handleMeteredError(
        429,
        { code: 'RATE_LIMITED' },
        'invalid-non-numeric',
      );
      expect(invalidAction).toEqual({
        kind: 'inline',
        retryAfterSec: 10,
        message: 'Rate limited. Please wait 10s.',
      });
    });
  });
});
