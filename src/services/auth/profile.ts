import { sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { normalizeEmail } from './email';
import { resolveRequestIdentity, type RequestIdentity } from './identity';
import { AccountRestrictedError, UnauthorizedError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'auth-profile' });

export interface UserClaims {
  readonly id?: string;
  readonly sub?: string;
  readonly email?: string | null;
  readonly user_metadata?: Record<string, unknown> | null;
}

export interface UserProfileRow {
  readonly id: string;
  readonly email: string;
  readonly email_normalized: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly date_of_birth?: Date | string | null;
  readonly country: string | null;
  readonly locale: string | null;
  readonly terms_version: string | null;
  readonly terms_accepted_at: Date | string | null;
  readonly marketing_opt_in: boolean;
  readonly status: 'active' | 'suspended' | 'pending_deletion';
  readonly billing_hold: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly last_seen_at: Date | string;
  readonly deletion_requested_at: Date | string | null;
}

/**
 * Upserts a user profile into `user_profiles`.
 * Runs idempotently on first auth and updates `last_seen_at` at most once every 10 minutes.
 */
export async function ensureUserProfile(
  db: AppQueryDb,
  claims: UserClaims,
): Promise<{ id: string; email: string; email_normalized: string }> {
  const userId = claims.sub || claims.id;
  if (!userId) {
    throw new Error('ensureUserProfile: user ID (sub/id) missing from claims');
  }

  const rawEmail = claims.email?.trim() || '';
  const emailNorm = normalizeEmail(rawEmail);

  const metadata = claims.user_metadata || {};
  const displayName =
    (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
    (typeof metadata.name === 'string' && metadata.name.trim()) ||
    null;
  const avatarUrl =
    (typeof metadata.avatar_url === 'string' && metadata.avatar_url.trim()) ||
    (typeof metadata.picture === 'string' && metadata.picture.trim()) ||
    null;
  const rawDob =
    (typeof metadata.date_of_birth === 'string' && metadata.date_of_birth.trim()) ||
    (typeof metadata.birthday === 'string' && metadata.birthday.trim()) ||
    (typeof metadata.birthdate === 'string' && metadata.birthdate.trim()) ||
    null;
  const dateOfBirth = rawDob && /^\d{4}-\d{2}-\d{2}$/.test(rawDob) ? rawDob : null;
  const termsVersion =
    (typeof metadata.terms_version === 'string' && metadata.terms_version.trim()) || '2026-10';
  const termsAcceptedAt = metadata.terms_accepted_at
    ? new Date(String(metadata.terms_accepted_at)).toISOString()
    : new Date().toISOString();
  const marketingOptIn = Boolean(metadata.marketing_opt_in);

  try {
    await db.execute(sql`
      INSERT INTO user_profiles (
        id, email, email_normalized, display_name, avatar_url, date_of_birth,
        terms_version, terms_accepted_at, marketing_opt_in,
        status, billing_hold, created_at, updated_at, last_seen_at
      ) VALUES (
        ${userId}::uuid, ${rawEmail}, ${emailNorm}, ${displayName}, ${avatarUrl}, ${dateOfBirth}::date,
        ${termsVersion}, ${termsAcceptedAt}::timestamptz, ${marketingOptIn},
        'active', false, now(), now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, user_profiles.date_of_birth),
        email = CASE
          WHEN user_profiles.email = '' OR user_profiles.email IS NULL THEN EXCLUDED.email
          ELSE user_profiles.email
        END,
        email_normalized = CASE
          WHEN user_profiles.email_normalized = '' OR user_profiles.email_normalized IS NULL THEN EXCLUDED.email_normalized
          ELSE user_profiles.email_normalized
        END,
        last_seen_at = CASE
          WHEN user_profiles.last_seen_at < now() - interval '10 minutes' THEN now()
          ELSE user_profiles.last_seen_at
        END,
        updated_at = now();
    `);

    return { id: userId, email: rawEmail, email_normalized: emailNorm };
  } catch (err) {
    log.error({ err, userId }, 'failed to ensure user profile');
    throw err;
  }
}

/**
 * Updates a user profile's editable fields (display_name, date_of_birth, avatar_url).
 */
export async function updateUserProfile(
  db: AppQueryDb,
  userId: string,
  data: {
    displayName?: string | null;
    dateOfBirth?: string | null;
    avatarUrl?: string | null;
  },
): Promise<UserProfileRow | null> {
  await db.execute(sql`
    UPDATE user_profiles
       SET display_name = COALESCE(${data.displayName !== undefined ? data.displayName : null}, display_name),
           date_of_birth = CASE
             WHEN ${data.dateOfBirth !== undefined} THEN ${data.dateOfBirth ? data.dateOfBirth : null}::date
             ELSE date_of_birth
           END,
           avatar_url = COALESCE(${data.avatarUrl !== undefined ? data.avatarUrl : null}, avatar_url),
           updated_at = now()
     WHERE id = ${userId}::uuid;
  `);

  return getUserProfile(db, userId);
}

/**
 * Loads a user's profile from `user_profiles`.
 */
export async function getUserProfile(
  db: AppQueryDb,
  userId: string,
): Promise<UserProfileRow | null> {
  const rows = await db.execute<Record<string, unknown> & UserProfileRow>(sql`
    SELECT *
      FROM user_profiles
     WHERE id = ${userId}::uuid
     LIMIT 1;
  `);
  return rows[0] ?? null;
}

/**
 * Requires an authenticated, active user.
 * Throws UnauthorizedError if unauthenticated.
 * Throws AccountRestrictedError if account is suspended or blocked.
 */
export async function requireUser(
  request: NextRequest,
  options?: { db?: AppQueryDb },
): Promise<RequestIdentity> {
  const identity = await resolveRequestIdentity(request, options);

  if (!identity.userId) {
    throw new UnauthorizedError('Authentication required');
  }

  if (identity.isSuspended) {
    throw new AccountRestrictedError('Your account has been restricted');
  }

  return identity;
}
