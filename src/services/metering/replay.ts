/**
 * Request replay helpers for idempotent execution across connection drops.
 *
 * Normative reference: Plan 25 Section 11.6.1, 15.2, WP-18.
 * When a metered request is retried with the same (deviceId, requestId) and its
 * lease was already committed, we return the stored result with quota.outcome = 'charged'
 * and ZERO additional charge or model calls.
 */
import { and, eq } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { chatQueries, queryLeases, recommendationTurns } from '@/services/db/schema';
import type { ChargeSource, QuotaSnapshotLite } from '@/services/metering/types';

export interface ReplayTurnResult {
  turnId: string;
  sessionId: string;
  turnIndex: number;
  userMessage: string;
  intent: string;
  extractedRequirements: Record<string, unknown> | null;
  candidatePhoneIds: string[] | null;
  picks: unknown[] | null;
  clarifyingQuestion: string | null;
  latencyMs: number | null;
  quota: QuotaSnapshotLite | null;
}

export interface ReplayQueryResult {
  queryId: string;
  phoneId: string;
  query: string;
  answer: string;
  citations: unknown[];
  retrievedChunkIds: string[];
  latencyMs: number | null;
  quota: QuotaSnapshotLite;
}

/**
 * Checks if a duplicate lease was already committed.
 */
export async function findCommittedLease(
  db: AppQueryDb,
  input: {
    requestId: string;
    deviceId: string;
  },
) {
  const rows = await db
    .select({
      id: queryLeases.id,
      status: queryLeases.status,
      chargeSource: queryLeases.chargeSource,
      usageDate: queryLeases.usageDate,
      userId: queryLeases.userId,
    })
    .from(queryLeases)
    .where(
      and(
        eq(queryLeases.requestId, input.requestId),
        eq(queryLeases.deviceId, input.deviceId),
        eq(queryLeases.status, 'committed'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Finds the stored recommendation turn attached to a committed lease id.
 */
export async function findReplayTurn(
  db: AppQueryDb,
  leaseId: string,
): Promise<ReplayTurnResult | null> {
  const turns = await db
    .select({
      turnId: recommendationTurns.id,
      sessionId: recommendationTurns.sessionId,
      turnIndex: recommendationTurns.turnIndex,
      userMessage: recommendationTurns.userMessage,
      intent: recommendationTurns.intent,
      extractedRequirements: recommendationTurns.extractedRequirements,
      candidatePhoneIds: recommendationTurns.candidatePhoneIds,
      picks: recommendationTurns.picks,
      clarifyingQuestion: recommendationTurns.clarifyingQuestion,
      latencyMs: recommendationTurns.latencyMs,
      leaseChargeSource: queryLeases.chargeSource,
      leaseUserId: queryLeases.userId,
    })
    .from(recommendationTurns)
    .innerJoin(queryLeases, eq(recommendationTurns.leaseId, queryLeases.id))
    .where(eq(recommendationTurns.leaseId, leaseId))
    .limit(1);

  const turn = turns[0];
  if (!turn) return null;

  // Plan 27 WP-01: Settled leases in Postgres do not store remaining quota balances.
  // Rather than fabricating artificial zero quotas that clear the client's quota display,
  // we return quota: null so the client preserves its last known authoritative quota.
  return {
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    turnIndex: turn.turnIndex,
    userMessage: turn.userMessage,
    intent: turn.intent,
    extractedRequirements: turn.extractedRequirements as Record<string, unknown> | null,
    candidatePhoneIds: turn.candidatePhoneIds,
    picks: turn.picks as unknown[] | null,
    clarifyingQuestion: turn.clarifyingQuestion,
    latencyMs: turn.latencyMs,
    quota: null,
  };
}

/**
 * Finds the stored chat answer attached to a committed lease id.
 */
export async function findReplayQuery(
  db: AppQueryDb,
  leaseId: string,
): Promise<ReplayQueryResult | null> {
  const queries = await db
    .select({
      queryId: chatQueries.id,
      phoneId: chatQueries.phoneId,
      query: chatQueries.query,
      answer: chatQueries.answer,
      citations: chatQueries.citations,
      retrievedChunkIds: chatQueries.retrievedChunkIds,
      latencyMs: chatQueries.latencyMs,
      leaseChargeSource: queryLeases.chargeSource,
      leaseUserId: queryLeases.userId,
    })
    .from(chatQueries)
    .innerJoin(queryLeases, eq(chatQueries.leaseId, queryLeases.id))
    .where(eq(chatQueries.leaseId, leaseId))
    .limit(1);

  const q = queries[0];
  if (!q) return null;

  const quota: QuotaSnapshotLite = {
    outcome: 'committed',
    chargeSource: (q.leaseChargeSource as ChargeSource) ?? 'daily_free',
    remaining: 0,
    freeRemaining: 0,
    creditBalance: 0,
    subRemaining: 0,
    resetAt: new Date(Date.now() + 86400000).toISOString(),
  };

  return {
    queryId: q.queryId,
    phoneId: q.phoneId,
    query: q.query,
    answer: q.answer,
    citations: q.citations as unknown[],
    retrievedChunkIds: q.retrievedChunkIds,
    latencyMs: q.latencyMs,
    quota,
  };
}
