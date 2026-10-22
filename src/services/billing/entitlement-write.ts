import { sql } from 'drizzle-orm';
import { getDb, type AppQueryDb } from '@/services/db/client';

export interface ApplyCreditDeltaResult {
  readonly newBalance: number;
  readonly applied: boolean;
  readonly ledgerEntryId: string | null;
}

/**
 * Invokes the atomic SQL function `recsy_apply_credit_delta`.
 * Guarantees idempotency via unique index on idempotency_key.
 *
 * Normative reference: Section 6.4, Section 9.4.3 of plan 25.
 */
export async function applyCreditDelta(
  userId: string,
  delta: number,
  reason: 'purchase' | 'payment_reversal' | 'admin_adjustment' | 'dispute' | 'dispute_reversal',
  refType: 'order' | 'charge' | 'dispute' | 'admin' | null,
  refId: string | null,
  idempotencyKey: string,
  metadata: Record<string, unknown> = {},
  dbClient?: AppQueryDb,
): Promise<ApplyCreditDeltaResult> {
  const db = dbClient ?? getDb();

  const rows = await db.execute<{
    new_balance: number;
    applied: boolean;
    ledger_entry_id: string | null;
  }>(sql`
    SELECT new_balance, applied, ledger_entry_id
    FROM recsy_apply_credit_delta(
      ${userId}::uuid,
      ${delta}::int,
      ${reason}::text,
      ${refType ? sql`${refType}::text` : sql`NULL`},
      ${refId ? sql`${refId}::text` : sql`NULL`},
      ${idempotencyKey}::text,
      ${JSON.stringify(metadata)}::jsonb
    );
  `);

  const row = rows[0] ?? {
    new_balance: 0,
    applied: false,
    ledger_entry_id: null,
  };

  return {
    newBalance: Number(row.new_balance),
    applied: Boolean(row.applied),
    ledgerEntryId: row.ledger_entry_id,
  };
}
