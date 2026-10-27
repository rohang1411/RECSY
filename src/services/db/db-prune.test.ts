import { describe, expect, it, vi } from 'vitest';
import { pruneRetention } from '../../../scripts/db-prune';
import type { getPostgres } from '@/services/db/client';

type SqlMock = ReturnType<typeof getPostgres>;

describe('db-prune retention logic (Plan 27 WP-01)', () => {
  it('counts candidates without deleting when dryRun=true', async () => {
    const executedQueries: string[] = [];

    // Tagged template mock
    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      // Return count of 5 for count queries
      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 5 }]);
      }
      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: true, batchSize: 100 });

    expect(results.inactiveRecommendationSessions).toBe(5);
    expect(results.expiredLlmCache).toBe(5);
    expect(results.expiredRateLimits).toBe(5);

    // Assert that NO DELETE queries were issued in dry-run mode
    const deleteQueries = executedQueries.filter((q) => q.toUpperCase().startsWith('DELETE'));
    expect(deleteQueries).toHaveLength(0);
  });

  it('prunes inactive anonymous sessions in batches until done in live mode', async () => {
    const executedQueries: string[] = [];
    let deleteBatchCall = 0;

    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 250 }]);
      }

      if (query.startsWith('DELETE FROM recommendation_sessions')) {
        deleteBatchCall += 1;
        // Batch 1 returns 100 rows, batch 2 returns 100 rows, batch 3 returns 50 rows (< 100, terminates loop)
        if (deleteBatchCall === 1) return Promise.resolve(new Array(100).fill({ id: 's1' }));
        if (deleteBatchCall === 2) return Promise.resolve(new Array(100).fill({ id: 's2' }));
        return Promise.resolve(new Array(50).fill({ id: 's3' }));
      }

      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: false, batchSize: 100 });

    expect(results.inactiveRecommendationSessions).toBe(250);
    expect(deleteBatchCall).toBe(3);

    // Verify SQL query structure for step 7
    const sessionQueries = executedQueries.filter((q) => q.includes('recommendation_sessions'));
    expect(sessionQueries.length).toBeGreaterThanOrEqual(2);

    for (const q of sessionQueries) {
      // Must join recommendation_clients to verify ownership
      expect(q).toContain('recommendation_clients c ON s.client_id = c.id');
      // Must explicitly enforce that user_id is NULL (signed-in user history protected!)
      expect(q).toContain('c.user_id IS NULL');
      // Must use activity via COALESCE(max(t.created_at), s.updated_at, s.created_at)
      expect(q).toContain('COALESCE');
      expect(q).toContain('max(t.created_at)');
      expect(q).toContain("interval '90 days'");
    }
  });

  it('does not issue DELETE for sessions if candidate count is 0', async () => {
    const executedQueries: string[] = [];

    const mockSql = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?').trim();
      executedQueries.push(query);

      if (query.includes('count(*)')) {
        return Promise.resolve([{ n: 0 }]);
      }
      return Promise.resolve([]);
    }) as unknown as SqlMock;

    const results = await pruneRetention(mockSql, { dryRun: false, batchSize: 100 });

    expect(results.inactiveRecommendationSessions).toBe(0);
    const sessionDeleteQueries = executedQueries.filter((q) =>
      q.startsWith('DELETE FROM recommendation_sessions'),
    );
    expect(sessionDeleteQueries).toHaveLength(0);
  });
});
