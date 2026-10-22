import { describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { AppQueryDb } from '@/services/db/client';
import {
  recommendationClients,
  recommendationSessions,
  recommendationTurns,
  recommendationFeedback,
} from '@/services/db/schema';
import { deleteUserHistory } from './history';

describe('FK Chain & User History Cascade (WP-18 & Plan 25 Section 10.5)', () => {
  it('verifies Drizzle schema enforces onDelete: cascade down the recommendation graph', () => {
    // 1. recommendationSessions references recommendationClients with cascade
    const sessionConfig = getTableConfig(recommendationSessions);
    const sessionClientFk = sessionConfig.foreignKeys.find(
      (fk) => fk.reference().foreignTable === recommendationClients,
    );
    expect(sessionClientFk).toBeDefined();
    expect(sessionClientFk?.onDelete).toBe('cascade');

    // 2. recommendationTurns references recommendationSessions with cascade
    const turnConfig = getTableConfig(recommendationTurns);
    const turnSessionFk = turnConfig.foreignKeys.find(
      (fk) => fk.reference().foreignTable === recommendationSessions,
    );
    expect(turnSessionFk).toBeDefined();
    expect(turnSessionFk?.onDelete).toBe('cascade');

    // 3. recommendationFeedback references recommendationTurns with cascade
    const feedbackConfig = getTableConfig(recommendationFeedback);
    const feedbackTurnFk = feedbackConfig.foreignKeys.find(
      (fk) => fk.reference().foreignTable === recommendationTurns,
    );
    expect(feedbackTurnFk).toBeDefined();
    expect(feedbackTurnFk?.onDelete).toBe('cascade');
  });

  it('deleteUserHistory executes cascades for recommendation clients and chat queries', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ count: 2 }]) // 2 clients deleted
        .mockResolvedValueOnce([{ count: 5 }]), // 5 chat queries deleted
    };

    const result = await deleteUserHistory(
      mockDb as unknown as AppQueryDb,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.deleted).toBe(7);
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });
});
