import { describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import { findCommittedLease, findReplayTurn, findReplayQuery } from './replay';

describe('Replay Service (WP-18)', () => {
  it('findCommittedLease returns lease when committed row exists', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'lease-123',
                status: 'committed',
                chargeSource: 'daily_free',
                usageDate: '2026-10-21',
                userId: 'user-abc',
              },
            ]),
          }),
        }),
      }),
    };

    const lease = await findCommittedLease(mockDb as unknown as AppQueryDb, {
      requestId: 'req-1',
      deviceId: 'dev-1',
    });

    expect(lease).toBeDefined();
    expect(lease?.id).toBe('lease-123');
    expect(lease?.status).toBe('committed');
  });

  it('findCommittedLease returns null when no committed row found', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };

    const lease = await findCommittedLease(mockDb as unknown as AppQueryDb, {
      requestId: 'req-2',
      deviceId: 'dev-2',
    });

    expect(lease).toBeNull();
  });

  it('findReplayTurn returns stored recommendation turn and projected charged quota', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  turnId: 'turn-999',
                  sessionId: 'session-777',
                  userMessage: 'best battery phone under 500',
                  intent: 'recommend',
                  extractedRequirements: { battery: 5000 },
                  candidatePhoneIds: ['phone-1', 'phone-2'],
                  picks: [{ id: 'phone-1', model: 'Galaxy A55' }],
                  clarifyingQuestion: null,
                  latencyMs: 320,
                  leaseChargeSource: 'daily_free',
                  leaseUserId: 'user-123',
                },
              ]),
            }),
          }),
        }),
      }),
    };

    const result = await findReplayTurn(mockDb as unknown as AppQueryDb, 'lease-123');

    expect(result).not.toBeNull();
    expect(result?.turnId).toBe('turn-999');
    expect(result?.sessionId).toBe('session-777');
    expect(result?.picks).toEqual([{ id: 'phone-1', model: 'Galaxy A55' }]);
    expect(result?.quota.outcome).toBe('committed');
    expect(result?.quota.chargeSource).toBe('daily_free');
  });

  it('findReplayTurn returns null if no turn attached to lease', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };

    const result = await findReplayTurn(mockDb as unknown as AppQueryDb, 'lease-missing');
    expect(result).toBeNull();
  });

  it('findReplayQuery returns stored chat answer and projected charged quota', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  queryId: 'query-111',
                  phoneId: 'phone-pixel-8',
                  query: 'does this have wireless charging?',
                  answer: 'Yes, it supports Qi wireless charging up to 18W.',
                  citations: [{ source: 'spec', field: 'battery.wireless' }],
                  retrievedChunkIds: ['chunk-1'],
                  latencyMs: 180,
                  leaseChargeSource: 'credit_pack',
                  leaseUserId: null,
                },
              ]),
            }),
          }),
        }),
      }),
    };

    const result = await findReplayQuery(mockDb as unknown as AppQueryDb, 'lease-456');

    expect(result).not.toBeNull();
    expect(result?.queryId).toBe('query-111');
    expect(result?.phoneId).toBe('phone-pixel-8');
    expect(result?.answer).toContain('supports Qi wireless');
    expect(result?.quota.outcome).toBe('committed');
    expect(result?.quota.chargeSource).toBe('credit_pack');
  });

  it('findReplayQuery returns null if no chat query attached to lease', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };

    const result = await findReplayQuery(mockDb as unknown as AppQueryDb, 'lease-missing');
    expect(result).toBeNull();
  });
});
