import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { runSystemIntegrityAudit } from './integrity-audit';

describe('System Integrity Radar (WP-07)', () => {
  it('parses single-pass CTE rows into clean report metrics', async () => {
    const mockSql = vi.fn().mockResolvedValue([
      {
        missing_aspects_count: 0,
        empty_corpuses_count: 0,
        corrupted_pricing_count: 0,
        orphan_chunks_count: 0,
        malformed_yt_channels_count: 0,
        malformed_yt_sources_count: 0,
        zombie_ingest_runs_count: 0,
      },
    ]);

    const report = await runSystemIntegrityAudit(mockSql as unknown as postgres.Sql);

    expect(report.status).toBe('pass');
    expect(report.corruptedPricingCount).toBe(0);
    expect(report.orphanChunksCount).toBe(0);
    expect(report.executionMs).toBeGreaterThanOrEqual(0);
  });

  it('marks status as fail if corrupted pricing or orphan chunks are detected', async () => {
    const mockSql = vi.fn().mockResolvedValue([
      {
        missing_aspects_count: 0,
        empty_corpuses_count: 0,
        corrupted_pricing_count: 2,
        orphan_chunks_count: 0,
        malformed_yt_channels_count: 0,
        malformed_yt_sources_count: 0,
        zombie_ingest_runs_count: 0,
      },
    ]);

    const report = await runSystemIntegrityAudit(mockSql as unknown as postgres.Sql);

    expect(report.status).toBe('fail');
    expect(report.corruptedPricingCount).toBe(2);
  });

  it('marks status as warn if missing aspects or zombie ingest runs exist', async () => {
    const mockSql = vi.fn().mockResolvedValue([
      {
        missing_aspects_count: 3,
        empty_corpuses_count: 0,
        corrupted_pricing_count: 0,
        orphan_chunks_count: 0,
        malformed_yt_channels_count: 0,
        malformed_yt_sources_count: 0,
        zombie_ingest_runs_count: 1,
      },
    ]);

    const report = await runSystemIntegrityAudit(mockSql as unknown as postgres.Sql);

    expect(report.status).toBe('warn');
    expect(report.missingAspectsCount).toBe(3);
    expect(report.zombieIngestRunsCount).toBe(1);
  });
});
