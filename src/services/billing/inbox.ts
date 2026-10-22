import { sql } from 'drizzle-orm';
import { getDb, type AppQueryDb } from '@/services/db/client';
import type { NormalizedBillingEvent } from './types';

export type ClaimEventResult =
  | { outcome: 'claimed'; eventRowId: string; attempts: number }
  | { outcome: 'duplicate'; status: 'processed' | 'ignored' }
  | { outcome: 'busy' };

/**
 * Idempotently inserts or claims a billing event row.
 * Normative reference: Section 9.5 of plan 25.
 */
export async function claimBillingEvent(
  event: NormalizedBillingEvent,
  dbClient?: AppQueryDb,
): Promise<ClaimEventResult> {
  const db = dbClient ?? getDb();

  // 1. Insert row or preserve existing attempts
  const insertRows = await db.execute<{
    id: string;
    status: 'received' | 'processing' | 'processed' | 'failed' | 'ignored';
    attempts: number;
  }>(sql`
    INSERT INTO billing_events (
      provider,
      event_id,
      event_type,
      livemode,
      refs,
      provider_created_at
    )
    VALUES (
      ${event.provider},
      ${event.eventId},
      ${event.type},
      ${event.livemode},
      ${JSON.stringify(event.refs)}::jsonb,
      ${event.createdAt.toISOString()}::timestamptz
    )
    ON CONFLICT (provider, event_id)
    DO UPDATE SET attempts = billing_events.attempts
    RETURNING id, status, attempts;
  `);

  const row = insertRows[0];
  if (!row) {
    return { outcome: 'busy' };
  }

  // 2. If already processed or ignored, return duplicate
  if (row.status === 'processed' || row.status === 'ignored') {
    return { outcome: 'duplicate', status: row.status };
  }

  // 3. Atomically attempt to claim the event for processing
  const claimRows = await db.execute<{ id: string; attempts: number }>(sql`
    UPDATE billing_events
    SET
      status = 'processing',
      locked_until = now() + interval '60 seconds',
      attempts = attempts + 1
    WHERE id = ${row.id}::uuid
      AND (
        status IN ('received', 'failed')
        OR (status = 'processing' AND (locked_until IS NULL OR locked_until < now()))
      )
    RETURNING id, attempts;
  `);

  const claimed = claimRows[0];
  if (!claimed) {
    return { outcome: 'busy' };
  }

  return {
    outcome: 'claimed',
    eventRowId: claimed.id,
    attempts: claimed.attempts,
  };
}

export async function markEventProcessed(eventRowId: string, dbClient?: AppQueryDb): Promise<void> {
  const db = dbClient ?? getDb();
  await db.execute(sql`
    UPDATE billing_events
    SET
      status = 'processed',
      processed_at = now(),
      locked_until = NULL,
      error = NULL
    WHERE id = ${eventRowId}::uuid;
  `);
}

export async function markEventIgnored(eventRowId: string, dbClient?: AppQueryDb): Promise<void> {
  const db = dbClient ?? getDb();
  await db.execute(sql`
    UPDATE billing_events
    SET
      status = 'ignored',
      processed_at = now(),
      locked_until = NULL,
      error = NULL
    WHERE id = ${eventRowId}::uuid;
  `);
}

export async function markEventFailed(
  eventRowId: string,
  error: unknown,
  dbClient?: AppQueryDb,
): Promise<void> {
  const db = dbClient ?? getDb();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const truncatedError = errorMessage.slice(0, 300);

  await db.execute(sql`
    UPDATE billing_events
    SET
      status = 'failed',
      locked_until = NULL,
      error = ${truncatedError}
    WHERE id = ${eventRowId}::uuid;
  `);
}
