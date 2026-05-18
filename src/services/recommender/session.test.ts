/**
 * Unit tests for recommendation session context loading.
 *
 * The critical regression here is multi-turn clarification state: clarify
 * turns store partial requirements, and the next user message must merge with
 * those requirements instead of starting from an empty prompt.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppDb } from '@/services/db/client';

import { getLatestRequirementsForSession } from './session';

function makeMockDb(rows: readonly { extractedRequirements: unknown }[]): AppDb {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain as unknown as AppDb;
}

describe('getLatestRequirementsForSession', () => {
  it('loads partial requirements from the latest clarify turn', async () => {
    const db = makeMockDb([
      {
        extractedRequirements: {
          budget_usd: { max: 1200 },
          priorities: [{ aspect: 'camera', weight: 1 }],
          must_haves: [],
          deal_breakers: [],
          use_cases: ['camera'],
          brand_preference: { liked: [], disliked: [] },
          confidence: 0.45,
          clarifying_question: 'Do you prefer Android or iPhone?',
        },
      },
    ]);

    const requirements = await getLatestRequirementsForSession(db, 'session-1');

    expect(requirements?.budget_usd?.max).toBe(1200);
    expect(requirements?.priorities[0]?.aspect).toBe('camera');
    expect(requirements?.clarifying_question).toBe('Do you prefer Android or iPhone?');
  });

  it('skips an unparseable latest row and returns the next parseable state', async () => {
    const db = makeMockDb([
      {
        extractedRequirements: {
          budget_usd: { max: 900 },
          priorities: [{ aspect: 'unknown-axis', weight: 1 }],
          must_haves: [],
          deal_breakers: [],
          use_cases: [],
          brand_preference: { liked: [], disliked: [] },
          confidence: 0.8,
        },
      },
      {
        extractedRequirements: {
          budget_usd: { max: 700 },
          priorities: [{ aspect: 'battery', weight: 1 }],
          must_haves: [],
          deal_breakers: [],
          use_cases: ['travel'],
          brand_preference: { liked: [], disliked: [] },
          confidence: 0.7,
        },
      },
    ]);

    const requirements = await getLatestRequirementsForSession(db, 'session-1');

    expect(requirements?.budget_usd?.max).toBe(700);
    expect(requirements?.priorities[0]?.aspect).toBe('battery');
  });
});
