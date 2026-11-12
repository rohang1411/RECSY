/**
 * Metering and entitlement type definitions.
 * Normative reference: Section 5.7, 7.1, 7.3, 7.5, 13.2 of plan 25; Plan 26 WP-00, WP-01.
 */
import type { PerfFlags } from '@/services/perf/flags';

export type ChargeSource = 'daily_free' | 'anon_free' | 'subscription' | 'credit' | 'byok';

export type LeaseStatus = 'reserved' | 'committed' | 'refunded' | 'expired' | 'no_charge';

export type ReserveDenial =
  | 'QUOTA_EXHAUSTED'
  | 'SUBSCRIPTION_EXHAUSTED'
  | 'ANON_QUOTA_EXHAUSTED'
  | 'ANON_IP_CAP'
  | 'SIGNIN_REQUIRED'
  | 'DEVICE_ACCOUNT_CAP'
  | 'BYOK_DAILY_CAP'
  | 'TOO_MANY_INFLIGHT'
  | 'DUPLICATE_REQUEST'
  | 'CAPACITY_BUSY'
  | 'PLATFORM_PAUSED'
  | 'METERING_UNAVAILABLE';

export interface QuotaSnapshotLite {
  readonly remaining: number;
  readonly freeRemaining: number;
  readonly creditBalance: number;
  readonly subRemaining: number;
  readonly resetAt: string; // ISO string (next 00:00:00 UTC)
  readonly chargeSource?: ChargeSource;
  readonly outcome?: 'committed' | 'no_charge' | 'refund' | 'denied';
}

export interface EntitlementSnapshot {
  readonly signedIn: boolean;
  readonly mode: 'off' | 'shadow' | 'enforce';
  readonly free: {
    readonly used: number;
    readonly allowance: number;
    readonly remaining: number;
  };
  readonly resetAt: string; // ISO, next 00:00:00 UTC
  readonly credits: number; // 0 when anonymous
  readonly subscription: null | {
    readonly planCode: string;
    readonly status: 'active' | 'trialing' | 'past_due' | 'canceled';
    readonly includedQueries: number;
    readonly usedThisPeriod: number;
    readonly periodEnd: string;
    readonly cancelAtPeriodEnd: boolean;
    readonly graceUntil: string | null;
  };
  readonly byok: {
    readonly active: boolean;
    readonly usedToday: number;
    readonly dailyCap: number;
  };
  readonly capacity: 'ok' | 'busy' | 'paused';
  readonly nextSource: 'free' | 'subscription' | 'credit' | 'byok' | 'none';
  readonly features: {
    readonly signIn: boolean;
    readonly billing: boolean;
  };
  readonly user?: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly avatarUrl: string | null;
    readonly dateOfBirth: string | null;
    readonly createdAt: string;
  } | null;
}

export interface MeteringConfig {
  readonly mode: 'off' | 'shadow' | 'enforce';
  readonly freeDailyQueries: number;
  readonly anonDailyQueries: number;
  readonly anonIpDailyCap: number;
  readonly deviceAccountCap: number;
  readonly byokDailyCap: number;
  readonly clarifyFreeCap: number;
  readonly maxInflightFree: number;
  readonly maxInflightPro: number;
  readonly leaseTtlSeconds: number;
  readonly dbTimeoutMs: number;
  readonly globalDailyPlatformCap: number;
}

export interface PlatformState {
  readonly killSwitch: {
    readonly enabled: boolean;
    readonly message?: string;
  };
  readonly globalDailyCap: number;
  readonly usedToday: number;
  readonly capacity: 'ok' | 'busy' | 'paused';
  shedFreeFor(identity: { userId: string | null }): boolean;
  readonly perf: PerfFlags;
}

export type MeteredRequestOutcome =
  | 'committed'
  | 'no_charge'
  | 'refunded'
  | 'denied'
  | 'expired'
  | 'error';

export interface MeteredRequestCacheSummary {
  readonly catalog?: 'hit' | 'miss';
  readonly queryEmbedding?: 'hit' | 'miss';
  readonly platform?: 'hit' | 'miss';
  readonly abuse?: 'hit' | 'miss';
  readonly llm?: 'hit' | 'miss';
}

export interface MeteredRequestSummary {
  readonly event: 'metered_request';
  readonly traceId: string;
  readonly route: string;
  readonly quotaMode: 'off' | 'shadow' | 'enforce';
  readonly subjectKind: 'user' | 'device' | 'ip' | 'byok';
  readonly userRef: string | null;
  readonly deviceRef: string;
  readonly chargeSource: ChargeSource | 'none';
  readonly outcome: MeteredRequestOutcome;
  readonly denial: string | null;
  readonly reserveMs: number;
  readonly settleMs: number;
  readonly totalMs: number;
  readonly model: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
  readonly cacheHit: boolean;
  readonly httpStatus: number;
  readonly stages?: Readonly<Record<string, number>>;
  readonly ttfbMs?: number;
  readonly ttfvtMs?: number;
  readonly cache?: MeteredRequestCacheSummary;
}
