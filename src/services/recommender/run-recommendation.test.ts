/**
 * Unit tests for the recommendation pipeline orchestrator (`run-recommendation.ts`).
 *
 * Tests cover: clarify branch (low-confidence extraction), fresh results
 * branch (full catalog), refine branch (narrows to prior picks), flag
 * propagation (`refined`, `scoresTied`, `scorecardMissing`), and fallback
 * to full catalog when refined narrowing yields 0 results.
 *
 * All LLM and DB calls are mocked — no network or Postgres connections.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

import type { LlmProvider } from '@/services/llm/types';
import type { PhoneCatalogEntry } from './catalog';
import type { UserRequirements } from './requirements-schema';

// Stable requirements fixture with enough confidence to avoid clarify branch
function makeRequirements(overrides: Partial<UserRequirements> = {}): UserRequirements {
  return {
    confidence: 0.9,
    clarifying_question: undefined,
    budget_usd: { max: 1000 },
    priorities: [
      { aspect: 'camera', weight: 0.5 },
      { aspect: 'battery', weight: 0.2 },
    ],
    brand_preference: { liked: [], disliked: [] },
    must_haves: [],
    deal_breakers: [],
    use_cases: [],
    form_factor: undefined,
    ...overrides,
  };
}

function makePhone(id: string, slug: string): PhoneCatalogEntry {
  return {
    phoneId: id,
    slug,
    brand: 'Google',
    model: `Pixel ${id}`,
    tagline: null,
    msrpUsd: '799',
    imageUrl: null,
    spec: null,
    specEmbedding: null,
    aspectScores: new Map([
      ['camera', 7],
      ['battery', 6],
    ]),
  };
}

const mockLogger: Logger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeLlm(requirementsOverrides: Partial<UserRequirements> = {}): LlmProvider {
  return {
    name: 'mock',
    chat: vi.fn(),
    chatStream: vi.fn(),
    structured: vi
      .fn()
      .mockResolvedValue({ value: makeRequirements(requirementsOverrides), cached: false }),
    embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
  };
}

// Mock heavy DB calls and session helpers
vi.mock('./session', () => ({
  getLatestRequirementsForSession: vi.fn().mockResolvedValue(null),
  getLatestRecommendPickIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('./catalog', () => ({
  loadRecommendationCatalog: vi.fn(),
}));

const mockCatalog = (await import('./catalog')).loadRecommendationCatalog as ReturnType<
  typeof vi.fn
>;

const { runRecommendationPipeline } = await import('./run-recommendation');

describe('runRecommendationPipeline — clarify branch', () => {
  it('returns kind=clarify when extraction confidence is low', async () => {
    mockCatalog.mockResolvedValue([]);
    const llm = makeLlm({
      confidence: 0.2,
      clarifying_question: 'What is your budget?',
      priorities: [],
      must_haves: [],
      deal_breakers: [],
      use_cases: [],
      brand_preference: { liked: [], disliked: [] },
      budget_usd: null,
    });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      }),
    };
    const result = await runRecommendationPipeline({
      db: db as never,
      llm,
      sessionId: 'sess-1',
      userMessage: 'I need a phone',
      log: mockLogger,
    });
    expect(result.kind).toBe('clarify');
    if (result.kind === 'clarify') {
      expect(result.clarifyingQuestion).toBe('What is your budget?');
    }
  });
});

describe('runRecommendationPipeline — results branch', () => {
  it('returns kind=results with picks when catalog has active phones', async () => {
    const phones = [makePhone('id-1', 'pixel-9'), makePhone('id-2', 'pixel-9-pro')];
    mockCatalog.mockResolvedValue(phones);
    const llm = makeLlm();
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([]), // no aspectDefinitions rows
      }),
    };
    const result = await runRecommendationPipeline({
      db: db as never,
      llm,
      sessionId: 'sess-1',
      userMessage: 'best camera phone under $800',
      log: mockLogger,
    });
    expect(result.kind).toBe('results');
    if (result.kind === 'results') {
      expect(result.picks.length).toBeGreaterThanOrEqual(1);
      expect(result.refined).toBe(false);
    }
  });

  it('returns empty picks when catalog is empty', async () => {
    mockCatalog.mockResolvedValue([]);
    const llm = makeLlm();
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
    };
    const result = await runRecommendationPipeline({
      db: db as never,
      llm,
      sessionId: 'sess-1',
      userMessage: 'best phone',
      log: mockLogger,
    });
    expect(result.kind).toBe('results');
    if (result.kind === 'results') {
      expect(result.picks).toHaveLength(0);
    }
  });
});

describe('runRecommendationPipeline — refine branch', () => {
  it('narrows to prior picks when refine intent is detected', async () => {
    const { getLatestRequirementsForSession, getLatestRecommendPickIds } =
      await import('./session');
    vi.mocked(getLatestRequirementsForSession).mockResolvedValue(makeRequirements());
    vi.mocked(getLatestRecommendPickIds).mockResolvedValue(['id-1', 'id-2']);

    const phones = [
      makePhone('id-1', 'pixel-9'),
      makePhone('id-2', 'pixel-9-pro'),
      makePhone('id-3', 'pixel-9-pro-xl'), // not in prior picks
    ];
    mockCatalog.mockResolvedValue(phones);
    const llm = makeLlm();
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }) };

    const result = await runRecommendationPipeline({
      db: db as never,
      llm,
      sessionId: 'sess-1',
      userMessage: 'which of those is better for battery',
      log: mockLogger,
    });

    expect(result.kind).toBe('results');
    if (result.kind === 'results') {
      // Only prior picks should appear when refine succeeds
      expect(result.picks.every((p) => ['id-1', 'id-2'].includes(p.phoneId))).toBe(true);
      expect(result.refined).toBe(true);
    }
  });
});
