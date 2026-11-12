import { sql } from 'drizzle-orm';
import { env } from '@/env';
import { logger } from '@/services/logger';
import { isValidUuid } from '@/lib/uuid';
import type { AppQueryDb } from '@/services/db/client';
import { getUserProfile, type UserProfileRow } from '@/services/auth/profile';
import type { EntitlementSnapshot, MeteringConfig, PlatformState } from './types';
import { getMeteringConfig } from './config';
import { getPlatformState, getDefaultPlatformState } from './platform';

const log = logger.child({ component: 'metering-entitlement' });

type EntitlementQueryRow = Record<string, unknown> & {
  user_free_used: string | number | null;
  user_byok_used: string | number | null;
  device_total_used: string | number | null;
  device_anon_used: string | number | null;
  device_byok_used: string | number | null;
  credits: string | number | null;
  subscription: {
    planCode: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled';
    included: number;
    used: number;
    periodEnd: string | Date;
    cancelAtPeriodEnd: boolean;
    entitledUntil: string | Date;
    graceUntil?: string | Date | null;
  } | null;
};

function getNextMidnightUtcIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

export function getStaticDefaultEntitlement(
  config: MeteringConfig = getMeteringConfig(),
): EntitlementSnapshot {
  return {
    signedIn: false,
    mode: config.mode,
    free: {
      used: 0,
      allowance: config.anonDailyQueries,
      remaining: config.anonDailyQueries,
    },
    resetAt: getNextMidnightUtcIso(),
    credits: 0,
    subscription: null,
    byok: {
      active: false,
      usedToday: 0,
      dailyCap: config.byokDailyCap,
    },
    capacity: 'ok',
    nextSource: config.anonDailyQueries > 0 ? 'free' : 'none',
    features: {
      signIn: env.SIGNUPS_ENABLED,
      billing: env.BILLING_ENABLED,
    },
  };
}

function isBillingAllowedForViewer(viewerEmail?: string | null): boolean {
  if (!env.BILLING_ENABLED) return false;
  const allowlist = env.BILLING_ALLOWLIST_EMAILS?.trim();
  if (!allowlist) return true; // Open to all when allowlist is not specified

  if (!viewerEmail) return false;
  const allowedEmails = allowlist
    .toLowerCase()
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  return allowedEmails.includes(viewerEmail.toLowerCase().trim());
}

/**
 * Returns the EntitlementSnapshot for the viewer.
 * Fast path: if neither auth cookie nor device cookie is present, returns static defaults.
 * Hot path: exactly one SQL round-trip for all counters, wallet, and subscription data.
 */
export async function getEntitlementSnapshot(input: {
  db: AppQueryDb;
  identity?: {
    userId: string | null;
    deviceId?: string | null;
    email?: string | null;
  } | null;
  profile?: UserProfileRow | null;
  config?: MeteringConfig;
  platform?: PlatformState;
}): Promise<EntitlementSnapshot> {
  const config = input.config ?? getMeteringConfig();
  const identity = input.identity;

  // 1. Static fast path: crawlers and first paint with no identity cookies
  if (
    !identity ||
    (!identity.userId && (!identity.deviceId || identity.deviceId.startsWith('nocookie:')))
  ) {
    return getStaticDefaultEntitlement(config);
  }

  const platform =
    input.platform ?? (await getPlatformState(input.db).catch(() => getDefaultPlatformState()));

  const rawUserId = identity.userId?.trim() || null;
  const userId = rawUserId;
  const isUuid = rawUserId ? isValidUuid(rawUserId) : false;
  const deviceId = identity.deviceId ?? '';

  try {
    const rows = await input.db.execute<EntitlementQueryRow>(sql`
      SELECT
        (SELECT free_used  FROM usage_counters WHERE subject_kind = 'user'   AND subject_id = ${userId ? sql`${userId}::text` : sql`NULL`} AND usage_date = (now() AT TIME ZONE 'UTC')::date) AS user_free_used,
        (SELECT byok_used  FROM usage_counters WHERE subject_kind = 'user'   AND subject_id = ${userId ? sql`${userId}::text` : sql`NULL`} AND usage_date = (now() AT TIME ZONE 'UTC')::date) AS user_byok_used,
        (SELECT total_used FROM usage_counters WHERE subject_kind = 'device' AND subject_id = ${deviceId}       AND usage_date = (now() AT TIME ZONE 'UTC')::date) AS device_total_used,
        (SELECT anon_used  FROM usage_counters WHERE subject_kind = 'device' AND subject_id = ${deviceId}       AND usage_date = (now() AT TIME ZONE 'UTC')::date) AS device_anon_used,
        (SELECT byok_used  FROM usage_counters WHERE subject_kind = 'device' AND subject_id = ${deviceId}       AND usage_date = (now() AT TIME ZONE 'UTC')::date) AS device_byok_used,
        (SELECT balance FROM credit_wallets WHERE user_id = ${isUuid ? sql`${userId}::uuid` : sql`NULL`}) AS credits,
        (SELECT jsonb_build_object(
                  'planCode', s.plan_code,
                  'status', s.status,
                  'included', s.included_queries,
                  'used', COALESCE(su.used, 0),
                  'periodEnd', s.current_period_end,
                  'cancelAtPeriodEnd', s.cancel_at_period_end,
                  'entitledUntil', s.entitled_until
                )
           FROM subscriptions s
           LEFT JOIN subscription_usage su ON su.subscription_id = s.id AND su.period_start = s.current_period_start
          WHERE s.user_id = ${isUuid ? sql`${userId}::uuid` : sql`NULL`} AND s.entitled_until > now()
          ORDER BY s.entitled_until DESC LIMIT 1) AS subscription;
    `);

    const row = rows[0] ?? {
      user_free_used: 0,
      user_byok_used: 0,
      device_total_used: 0,
      device_anon_used: 0,
      device_byok_used: 0,
      credits: 0,
      subscription: null,
    };

    const signedIn = Boolean(userId);
    const allowance = signedIn ? config.freeDailyQueries : config.anonDailyQueries;
    const freeUsed = Number(signedIn ? (row.user_free_used ?? 0) : (row.device_total_used ?? 0));
    const freeRemaining = Math.max(allowance - freeUsed, 0);

    const credits = signedIn ? Math.max(Number(row.credits ?? 0), 0) : 0;
    const byokUsedToday = Number(
      signedIn ? (row.user_byok_used ?? 0) : (row.device_byok_used ?? 0),
    );

    let subRemaining = 0;
    let subscription: EntitlementSnapshot['subscription'] = null;

    if (row.subscription && signedIn) {
      const sub = row.subscription;
      const periodEndIso =
        sub.periodEnd instanceof Date
          ? sub.periodEnd.toISOString()
          : new Date(sub.periodEnd).toISOString();

      const graceUntilIso = sub.graceUntil
        ? sub.graceUntil instanceof Date
          ? sub.graceUntil.toISOString()
          : new Date(sub.graceUntil).toISOString()
        : null;

      subscription = {
        planCode: sub.planCode,
        status: sub.status,
        includedQueries: sub.included,
        usedThisPeriod: sub.used,
        periodEnd: periodEndIso,
        cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
        graceUntil: graceUntilIso,
      };

      subRemaining = Math.max(sub.included - sub.used, 0);
    }

    let nextSource: EntitlementSnapshot['nextSource'] = 'none';
    if (freeRemaining > 0) {
      nextSource = 'free';
    } else if (subRemaining > 0) {
      nextSource = 'subscription';
    } else if (credits > 0) {
      nextSource = 'credit';
    }

    let user: EntitlementSnapshot['user'] = null;
    let effectiveProfile = input.profile;
    if (signedIn && !effectiveProfile && userId) {
      effectiveProfile = await getUserProfile(input.db, userId).catch(() => null);
    }
    if (signedIn && effectiveProfile) {
      const p = effectiveProfile;
      const names = (p.display_name ?? '').trim().split(/\s+/);
      const firstName = names[0] || (p.email ? p.email.split('@')[0] : 'Member');
      const lastName = names.slice(1).join(' ') || null;
      user = {
        id: p.id,
        email: p.email,
        displayName: p.display_name ?? null,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        avatarUrl: p.avatar_url ?? null,
        dateOfBirth: p.date_of_birth ? String(p.date_of_birth).slice(0, 10) : null,
        createdAt: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
      };
    }

    return {
      signedIn,
      mode: config.mode,
      free: {
        used: freeUsed,
        allowance,
        remaining: freeRemaining,
      },
      resetAt: getNextMidnightUtcIso(),
      credits,
      subscription,
      byok: {
        active: false,
        usedToday: byokUsedToday,
        dailyCap: config.byokDailyCap,
      },
      capacity: platform.capacity,
      nextSource,
      features: {
        signIn: env.SIGNUPS_ENABLED,
        billing: isBillingAllowedForViewer(identity.email),
      },
      user,
    };
  } catch (err) {
    log.error({ err, userId }, 'failed to fetch entitlement snapshot; returning fallback');
    return getStaticDefaultEntitlement(config);
  }
}
