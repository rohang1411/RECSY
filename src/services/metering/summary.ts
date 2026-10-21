import { logger } from '@/services/logger';
import type { ChargeSource, MeteredRequestOutcome, MeteredRequestSummary } from './types';

const log = logger.child({ component: 'metered-request' });

export interface EmitMeteredRequestSummaryInput {
  readonly traceId: string;
  readonly route: string;
  readonly quotaMode: 'off' | 'shadow' | 'enforce';
  readonly byok: boolean;
  readonly userId?: string | null;
  readonly deviceId?: string | null;
  readonly chargeSource?: ChargeSource | null;
  readonly outcome: MeteredRequestOutcome;
  readonly denial?: string | null;
  readonly reserveMs: number;
  readonly settleMs: number;
  readonly totalMs: number;
  readonly model?: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly costMicros?: number | null;
  readonly cacheHit?: boolean | null;
  readonly httpStatus: number;
}

export function buildMeteredRequestSummary(
  input: EmitMeteredRequestSummaryInput,
): MeteredRequestSummary {
  let subjectKind: 'user' | 'device' | 'ip' | 'byok' = 'device';
  if (input.byok) {
    subjectKind = 'byok';
  } else if (input.userId) {
    subjectKind = 'user';
  } else if (input.deviceId && input.deviceId.startsWith('nocookie:')) {
    subjectKind = 'ip';
  } else {
    subjectKind = 'device';
  }

  const userRef = input.userId ? input.userId.slice(0, 8) : null;
  const deviceRef = input.deviceId ? input.deviceId.slice(0, 8) : 'unknown';

  return {
    event: 'metered_request',
    traceId: input.traceId,
    route: input.route,
    quotaMode: input.quotaMode,
    subjectKind,
    userRef,
    deviceRef,
    chargeSource: input.chargeSource ?? 'none',
    outcome: input.outcome,
    denial: input.denial ?? null,
    reserveMs: Math.round(input.reserveMs),
    settleMs: Math.round(input.settleMs),
    totalMs: Math.round(input.totalMs),
    model: input.model ?? null,
    tokensIn: Math.max(0, input.tokensIn ?? 0),
    tokensOut: Math.max(0, input.tokensOut ?? 0),
    costMicros: Math.max(0, input.costMicros ?? 0),
    cacheHit: Boolean(input.cacheHit),
    httpStatus: input.httpStatus,
  };
}

/**
 * Emits exactly one info log line with event=metered_request.
 * Normative reference: Section 13.2 of plan 25.
 */
export function emitMeteredRequestSummary(
  input: EmitMeteredRequestSummaryInput,
): MeteredRequestSummary {
  const summary = buildMeteredRequestSummary(input);
  log.info(summary, 'metered_request');
  return summary;
}
