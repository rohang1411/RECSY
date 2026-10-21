/**
 * Account deletion service.
 * Normative reference: Plan 25 Section 10.5 (R10), Section 8.8.
 *
 * Implements 30-day cooling period, cancellation, and execution.
 */
import { sql } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';
import { getUserProfile } from '@/services/auth/profile';
import { getEmailDriver } from '@/services/email/driver';
import {
  renderDeletionRequestedEmail,
  renderDeletionCancelledEmail,
} from '@/services/email/templates';

export const DELETION_COOLING_PERIOD_DAYS = 30;

export async function requestDeletion(
  db: AppQueryDb,
  userId: string,
  email: string,
  cancelUrl: string,
): Promise<{ status: 'pending_deletion'; executeAfter: string }> {
  const profile = await getUserProfile(db, userId);

  if (profile?.billing_hold) {
    throw new AppError(
      'BILLING_HOLD',
      'Account cannot be deleted while a billing hold or dispute is active',
      { status: 409 },
    );
  }

  const executeAfter = new Date(Date.now() + DELETION_COOLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  // 1. Mark profile pending deletion
  await db.execute(sql`
    UPDATE user_profiles
       SET status = 'pending_deletion',
           deletion_requested_at = now(),
           updated_at = now()
     WHERE id = ${userId}::uuid;
  `);

  // 2. Insert or update pending delete request
  await db.execute(sql`
    INSERT INTO account_requests (user_id, kind, status, requested_at, execute_after)
    VALUES (${userId}::uuid, 'delete', 'pending', now(), ${executeAfter})
    ON CONFLICT DO NOTHING;
  `);

  // 3. Send confirmation email
  const emailTemplate = renderDeletionRequestedEmail({
    email,
    cancelUrl,
    executeAfterIso: executeAfter.toISOString(),
  });

  await getEmailDriver().send({
    to: email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text,
  });

  return {
    status: 'pending_deletion',
    executeAfter: executeAfter.toISOString(),
  };
}

export async function cancelDeletion(
  db: AppQueryDb,
  userId: string,
  email: string,
): Promise<{ status: 'active' }> {
  // 1. Restore profile to active
  await db.execute(sql`
    UPDATE user_profiles
       SET status = 'active',
           deletion_requested_at = NULL,
           updated_at = now()
     WHERE id = ${userId}::uuid;
  `);

  // 2. Cancel pending account requests
  await db.execute(sql`
    UPDATE account_requests
       SET status = 'canceled'
     WHERE user_id = ${userId}::uuid
       AND kind = 'delete'
       AND status = 'pending';
  `);

  // 3. Send confirmation email
  const emailTemplate = renderDeletionCancelledEmail({ email });
  await getEmailDriver().send({
    to: email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text,
  });

  return { status: 'active' };
}

export async function executeDeletion(
  db: AppQueryDb,
  userId: string,
): Promise<{ completed: boolean; reason?: string }> {
  const profile = await getUserProfile(db, userId);

  if (profile?.billing_hold) {
    return { completed: false, reason: 'billing_hold active' };
  }

  // FK cascades clean up recommendation sessions, turns, and feedback
  await db.execute(sql`
    DELETE FROM recommendation_clients WHERE user_id = ${userId}::uuid;
  `);

  await db.execute(sql`
    DELETE FROM chat_queries WHERE user_id = ${userId}::uuid;
  `);

  await db.execute(sql`
    DELETE FROM billing_customers WHERE user_id = ${userId}::uuid;
  `);

  await db.execute(sql`
    DELETE FROM user_profiles WHERE id = ${userId}::uuid;
  `);

  await db.execute(sql`
    UPDATE account_requests
       SET status = 'completed',
           completed_at = now()
     WHERE user_id = ${userId}::uuid
       AND kind = 'delete'
       AND status = 'pending';
  `);

  return { completed: true };
}
