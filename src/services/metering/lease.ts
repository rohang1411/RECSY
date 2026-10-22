import { sql } from 'drizzle-orm';
import { logger } from '@/services/logger';
import type { AppQueryDb } from '@/services/db/client';
import type { ChargeSource, LeaseStatus, QuotaSnapshotLite } from './types';
import { estimateQueryCostMicros } from './pricing';

const log = logger.child({ component: 'metering-lease' });

export interface LeaseMetadata {
  readonly model?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly latencyMs?: number;
  readonly cacheHit?: boolean;
}

export class QueryLease {
  readonly id: string;
  readonly chargeSource: ChargeSource;
  readonly quota: QuotaSnapshotLite;
  readonly requestId: string;
  readonly route: string;
  readonly deviceId: string;
  readonly userId: string | null;
  readonly traceId: string;
  readonly isNoop: boolean;
  private readonly db?: AppQueryDb;
  private _settled: boolean = false;
  private _settleOutcome: LeaseStatus | null = null;

  constructor(options: {
    id: string;
    chargeSource: ChargeSource;
    quota: QuotaSnapshotLite;
    requestId: string;
    route: string;
    deviceId: string;
    userId: string | null;
    traceId: string;
    isNoop?: boolean;
    db?: AppQueryDb;
  }) {
    this.id = options.id;
    this.chargeSource = options.chargeSource;
    this.quota = options.quota;
    this.requestId = options.requestId;
    this.route = options.route;
    this.deviceId = options.deviceId;
    this.userId = options.userId;
    this.traceId = options.traceId;
    this.isNoop = Boolean(options.isNoop || options.id === 'off');
    this.db = options.db;
  }

  get settled(): boolean {
    return this._settled;
  }

  get settleOutcome(): LeaseStatus | null {
    return this._settleOutcome;
  }

  async commit(meta?: LeaseMetadata, tx?: AppQueryDb): Promise<LeaseStatus> {
    if (this._settled && this._settleOutcome) {
      return this._settleOutcome;
    }

    if (this.isNoop) {
      this._settled = true;
      this._settleOutcome = 'committed';
      return 'committed';
    }

    const client = tx ?? this.db;
    if (!client) {
      this._settled = true;
      return 'committed';
    }

    const costMicros = estimateQueryCostMicros(meta?.model, meta?.tokensIn, meta?.tokensOut);

    try {
      const result = await client.execute<{ recsy_settle_lease: LeaseStatus }>(sql`
        SELECT recsy_settle_lease(
          ${this.id}::uuid,
          'commit',
          'success',
          ${this.traceId},
          ${meta?.model ?? null},
          ${meta?.tokensIn ?? null},
          ${meta?.tokensOut ?? null},
          ${meta?.latencyMs ?? null},
          ${meta?.cacheHit ?? null},
          ${costMicros}
        );
      `);

      const status = result[0]?.recsy_settle_lease ?? 'committed';
      this._settled = true;
      this._settleOutcome = status;

      if (status === 'expired') {
        log.warn(
          { leaseId: this.id, traceId: this.traceId },
          'lease_late_commit: lease committed after expiration',
        );
      } else {
        log.info(
          {
            leaseId: this.id,
            traceId: this.traceId,
            status,
            costMicros,
          },
          'lease_settled',
        );
      }

      return status;
    } catch (err) {
      log.error({ err, leaseId: this.id }, 'lease_settle_failed');
      throw err;
    }
  }

  async noCharge(
    reason: 'clarify' | 'no_results' | 'no_context' | 'client_abort',
    tx?: AppQueryDb,
  ): Promise<LeaseStatus> {
    if (this._settled && this._settleOutcome) {
      return this._settleOutcome;
    }

    if (this.isNoop) {
      this._settled = true;
      this._settleOutcome = 'no_charge';
      return 'no_charge';
    }

    const client = tx ?? this.db;
    if (!client) {
      this._settled = true;
      return 'no_charge';
    }

    try {
      const result = await client.execute<{ recsy_settle_lease: LeaseStatus }>(sql`
        SELECT recsy_settle_lease(
          ${this.id}::uuid,
          'no_charge',
          ${reason},
          ${this.traceId},
          NULL, NULL, NULL, NULL, NULL, NULL
        );
      `);

      const status = result[0]?.recsy_settle_lease ?? 'no_charge';
      this._settled = true;
      this._settleOutcome = status;
      log.info({ leaseId: this.id, traceId: this.traceId, reason, status }, 'lease_settled');
      return status;
    } catch (err) {
      log.error({ err, leaseId: this.id, reason }, 'lease_settle_failed');
      throw err;
    }
  }

  async refund(reason: string, tx?: AppQueryDb): Promise<LeaseStatus> {
    if (this._settled && this._settleOutcome) {
      return this._settleOutcome;
    }

    if (this.isNoop) {
      this._settled = true;
      this._settleOutcome = 'refunded';
      return 'refunded';
    }

    const client = tx ?? this.db;
    if (!client) {
      this._settled = true;
      return 'refunded';
    }

    try {
      const result = await client.execute<{ recsy_settle_lease: LeaseStatus }>(sql`
        SELECT recsy_settle_lease(
          ${this.id}::uuid,
          'refund',
          ${reason},
          ${this.traceId},
          NULL, NULL, NULL, NULL, NULL, NULL
        );
      `);

      const status = result[0]?.recsy_settle_lease ?? 'refunded';
      this._settled = true;
      this._settleOutcome = status;
      log.info({ leaseId: this.id, traceId: this.traceId, reason, status }, 'lease_settled');
      return status;
    } catch (err) {
      log.error({ err, leaseId: this.id, reason }, 'lease_settle_failed');
      throw err;
    }
  }

  /**
   * Pure projection of the user's quota state following the query outcome.
   * Safe to return in client response payloads.
   */
  projectedQuota(outcome: 'commit' | 'refund' | 'no_charge'): QuotaSnapshotLite {
    if (outcome === 'commit') {
      return {
        ...this.quota,
        chargeSource: this.chargeSource,
        outcome: 'committed',
      };
    }

    // When refunded or no_charge, restore the consumed unit
    let freeRemaining = this.quota.freeRemaining;
    let creditBalance = this.quota.creditBalance;
    let subRemaining = this.quota.subRemaining;
    let remaining = this.quota.remaining;

    if (this.chargeSource === 'daily_free' || this.chargeSource === 'anon_free') {
      freeRemaining += 1;
      remaining += 1;
    } else if (this.chargeSource === 'subscription') {
      subRemaining += 1;
      remaining += 1;
    } else if (this.chargeSource === 'credit') {
      creditBalance += 1;
      remaining += 1;
    }

    return {
      remaining,
      freeRemaining,
      creditBalance,
      subRemaining,
      resetAt: this.quota.resetAt,
      chargeSource: this.chargeSource,
      outcome: outcome === 'refund' ? 'refund' : 'no_charge',
    };
  }
}
