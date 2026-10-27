import { describe, expect, it, vi } from 'vitest';
import { pruneRetention } from '../../../scripts/db-prune';
import type { getPostgres } from '@/services/db/client';

type SqlMock = ReturnType<typeof getPostgres>;

describe('db-prune retention logic (Plan 27 WP-01 & WP-11)', () => {
  it('counts candidates without deleting when dryRun=true', async () => {
    const executedQueries: string[] = [];

    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 5 }]);
      }
      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: true, batchSize: 100 });

    expect(results.deletedRecommendationSessions).toBe(5);
    expect(results.inactiveGuestSessions).toBe(5);
    expect(results.orphanedRecommendationClients).toBe(5);
    expect(results.expiredLlmCache).toBe(5);
    expect(results.expiredRateLimits).toBe(5);

    // Assert that NO DELETE queries were issued in dry-run mode
    const deleteQueries = executedQueries.filter((q) => q.toUpperCase().startsWith('DELETE'));
    expect(deleteQueries).toHaveLength(0);
  });

  it('prunes soft-deleted sessions older than 30 days in batches', async () => {
    const executedQueries: string[] = [];
    let deleteBatchCall = 0;

    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      if (query.includes("status = 'deleted'") && query.includes('count(*)')) {
        return Promise.resolve([{ n: 150 }]);
      }
      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 0 }]);
      }

      if (query.includes("status = 'deleted'") && query.startsWith('DELETE')) {
        deleteBatchCall += 1;
        if (deleteBatchCall === 1) return Promise.resolve(new Array(100).fill({ id: 's1' }));
        return Promise.resolve(new Array(50).fill({ id: 's2' }));
      }

      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: false, batchSize: 100 });

    expect(results.deletedRecommendationSessions).toBe(150);
    expect(deleteBatchCall).toBe(2);

    const softDeleteQueries = executedQueries.filter((q) => q.includes("status = 'deleted'"));
    for (const q of softDeleteQueries) {
      expect(q).toContain("deleted_at < now() - interval '30 days'");
    }
  });

  it('prunes inactive guest sessions older than 30 days while protecting signed-in sessions', async () => {
    const executedQueries: string[] = [];
    let deleteBatchCall = 0;

    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      if (query.includes('s.user_id IS NULL') && query.includes('count(*)')) {
        return Promise.resolve([{ n: 250 }]);
      }
      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 0 }]);
      }

      if (
        query.includes('s.user_id IS NULL') &&
        query.startsWith('DELETE FROM recommendation_sessions')
      ) {
        deleteBatchCall += 1;
        if (deleteBatchCall === 1) return Promise.resolve(new Array(100).fill({ id: 's1' }));
        if (deleteBatchCall === 2) return Promise.resolve(new Array(100).fill({ id: 's2' }));
        return Promise.resolve(new Array(50).fill({ id: 's3' }));
      }

      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: false, batchSize: 100 });

    expect(results.inactiveGuestSessions).toBe(250);
    expect(deleteBatchCall).toBe(3);

    const guestQueries = executedQueries.filter((q) => q.includes('s.user_id IS NULL'));
    expect(guestQueries.length).toBeGreaterThanOrEqual(2);

    for (const q of guestQueries) {
      expect(q).toContain('s.user_id IS NULL');
      expect(q).toContain('c.user_id IS NULL');
      expect(q).toContain("interval '30 days'");
    }
  });

  it('prunes orphaned recommendation clients with no sessions', async () => {
    const executedQueries: string[] = [];

    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      if (query.includes('NOT EXISTS') && query.includes('count(*)')) {
        return Promise.resolve([{ n: 10 }]);
      }
      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 0 }]);
      }

      if (query.includes('DELETE FROM recommendation_clients')) {
        return Promise.resolve(new Array(10).fill({ id: 'c1' }));
      }

      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: false, batchSize: 100 });

    expect(results.orphanedRecommendationClients).toBe(10);
    const clientQueries = executedQueries.filter((q) =>
      q.includes('FROM recommendation_clients c'),
    );
    for (const q of clientQueries) {
      expect(q).toContain('NOT EXISTS');
      expect(q).toContain('recommendation_sessions s WHERE s.client_id = c.id');
    }
  });
});
