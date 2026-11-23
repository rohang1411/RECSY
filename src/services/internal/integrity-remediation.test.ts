import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { runIntegrityRemediation } from './integrity-remediation';

describe('Command Center Integrity Remediation Runbooks (Plan 32 WP-10)', () => {
  it('prunes zombie ingest runs', async () => {
    const mockSql = vi.fn().mockResolvedValue([{ id: 'run-1' }, { id: 'run-2' }]);
    const result = await runIntegrityRemediation(
      'prune_zombie_runs',
      mockSql as unknown as postgres.Sql,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('prune_zombie_runs');
    expect(result.remediated.zombieRunsPruned).toBe(2);
    expect(result.remediated.orphanChunksDeleted).toBe(0);
    expect(result.timestamp).toBeDefined();
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('cleans orphan chunks', async () => {
    const mockSql = vi.fn().mockResolvedValue([{ id: 'chunk-1' }]);
    const result = await runIntegrityRemediation(
      'clean_orphan_chunks',
      mockSql as unknown as postgres.Sql,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('clean_orphan_chunks');
    expect(result.remediated.orphanChunksDeleted).toBe(1);
    expect(result.remediated.zombieRunsPruned).toBe(0);
  });

  it('identifies invalid pricing models and returns model metadata', async () => {
    const mockSql = vi.fn().mockResolvedValue([{ id: 'p-1', slug: 'phone-1', model: 'Test' }]);
    const result = await runIntegrityRemediation(
      'normalize_pricing',
      mockSql as unknown as postgres.Sql,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('normalize_pricing');
    expect(result.remediated.invalidPricingIdentified).toBe(1);
    expect(result.remediated.invalidPricingPhones).toEqual([
      { id: 'p-1', slug: 'phone-1', model: 'Test' },
    ]);
  });

  it('tags remediation queries with traceId and route provenance comments', async () => {
    const mockUnsafe = vi
      .fn()
      .mockReturnValue('/* traceId: trace-rem-1, route: internal:remediate */\n');
    const mockSql = Object.assign(vi.fn().mockResolvedValue([{ id: 'run-1' }]), {
      unsafe: mockUnsafe,
    });

    const result = await runIntegrityRemediation(
      'prune_zombie_runs',
      mockSql as unknown as postgres.Sql,
      { traceId: 'trace-rem-1', route: 'internal:remediate' },
    );

    expect(result.success).toBe(true);
    expect(mockUnsafe).toHaveBeenCalledWith(
      '/* traceId: trace-rem-1, route: internal:remediate */\n',
    );
  });

  it('executes all remediation runbooks in single call when action=all', async () => {
    const mockSql = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'run-1' }]) // zombie runs
      .mockResolvedValueOnce([{ id: 'chunk-1' }, { id: 'chunk-2' }]) // orphan chunks
      .mockResolvedValueOnce([{ id: 'phone-1' }]); // invalid pricing

    const result = await runIntegrityRemediation('all', mockSql as unknown as postgres.Sql);

    expect(result.success).toBe(true);
    expect(result.action).toBe('all');
    expect(result.remediated.zombieRunsPruned).toBe(1);
    expect(result.remediated.orphanChunksDeleted).toBe(2);
    expect(result.remediated.invalidPricingIdentified).toBe(1);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });
});
