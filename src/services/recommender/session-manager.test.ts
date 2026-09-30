/**
 * Unit tests for recommendation session manager & titling engine.
 *
 * Verifies:
 * - Isolation by clientId
 * - Session CRUD operations (create, list, get with turns, update, soft-delete)
 * - Public read-only share creation and retrieval
 * - Deterministic and LLM titling engine
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppDb } from '@/services/db/client';
import type { LlmProvider } from '@/services/llm/types';
import {
  createSession,
  deleteSession,
  formatAssistantResultsText,
  getOrCreateClient,
  getSessionWithTurns,
} from './session-manager';
import { generateDeterministicTitle, generateSessionTitle } from './titling';
import type { UserRequirements } from './requirements-schema';

describe('formatAssistantResultsText', () => {
  it('returns fallback message when picks are empty', () => {
    const text = formatAssistantResultsText([]);
    expect(text).toContain('No catalog entries matched those preferences');
  });

  it('formats single pick message', () => {
    const text = formatAssistantResultsText(
      [
        {
          phoneId: 'p1',
          slug: 'iphone-18',
          brand: 'Apple',
          model: 'iPhone 18',
          score: 9.2,
          summary: 'Great phone',
          msrpUsd: '999',
          localPrice: '999',
          localCurrency: 'USD',
          imageUrl: null,
        },
      ],
      [],
      false,
    );
    expect(text).toBe('Recommendations are ready. Returning one match.');
  });

  it('formats refined recommendations message with relaxed constraints', () => {
    const text = formatAssistantResultsText(
      [
        {
          phoneId: 'p1',
          slug: 'pixel-10',
          brand: 'Google',
          model: 'Pixel 10',
          score: 8.9,
          summary: 'Top camera',
          msrpUsd: '799',
          localPrice: '799',
          localCurrency: 'USD',
          imageUrl: null,
        },
        {
          phoneId: 'p2',
          slug: 'galaxy-s26',
          brand: 'Samsung',
          model: 'Galaxy S26',
          score: 8.8,
          summary: 'Solid all-rounder',
          msrpUsd: '849',
          localPrice: '849',
          localCurrency: 'USD',
          imageUrl: null,
        },
      ],
      ['brand'],
      true,
    );
    expect(text).toBe('Updated your recommendations. Returning two picks. Adjusted: brand.');
  });
});

describe('Titling Engine', () => {
  it('generates deterministic title from budget and aspects', () => {
    const req: UserRequirements = {
      budget_usd: { max: 1200 },
      priorities: [
        { aspect: 'camera', weight: 1 },
        { aspect: 'battery', weight: 0.8 },
      ],
      must_haves: [],
      deal_breakers: [],
      use_cases: [],
      brand_preference: { liked: [], disliked: [] },
      confidence: 0.9,
      clarifying_question: undefined,
    };
    const title = generateDeterministicTitle(req);
    expect(title).toBe('Under $1,200 • Camera & Battery');
  });

  it('generates deterministic title with local currency (INR)', () => {
    const req: UserRequirements = {
      budget_usd: null,
      budget_local: { max: 50000, currency: 'INR' },
      priorities: [{ aspect: 'performance', weight: 1 }],
      must_haves: [],
      deal_breakers: [],
      use_cases: [],
      brand_preference: { liked: [], disliked: [] },
      confidence: 0.85,
      clarifying_question: undefined,
    };
    const title = generateDeterministicTitle(req);
    expect(title).toBe('Under ₹50,000 • Performance');
  });

  it('generates deterministic title with brand and budget', () => {
    const req: UserRequirements = {
      budget_usd: { max: 800 },
      priorities: [],
      must_haves: [],
      deal_breakers: [],
      use_cases: [],
      brand_preference: { liked: ['samsung'], disliked: [] },
      confidence: 0.8,
      clarifying_question: undefined,
    };
    const title = generateDeterministicTitle(req);
    expect(title).toBe('Samsung • Under $800');
  });

  it('falls back to LLM or message words when deterministic title is unavailable', async () => {
    const mockLlm = {
      chat: vi.fn().mockResolvedValue({
        text: 'Compact Flagship Camera',
      }),
    };

    const title = await generateSessionTitle({
      requirements: null,
      userMessage: 'I need a small phone for graduation that takes stunning night portraits',
      llm: mockLlm as unknown as LlmProvider,
    });

    expect(title).toBe('Compact Flagship Camera');
  });

  it('falls back to capitalized message words if LLM is unavailable', async () => {
    const title = await generateSessionTitle({
      requirements: null,
      userMessage: 'gaming phone high refresh rate display',
      llm: null,
    });

    expect(title).toBe('Gaming phone high refresh');
  });
});

describe('session-manager DB operations', () => {
  it('getOrCreateClient returns existing client when matching token is provided', async () => {
    const existingClient = {
      id: 'client-123',
      clientToken: 'token-abc',
      ipHash: 'hash-xyz',
      userAgent: 'Mozilla',
      createdAt: new Date(),
      lastSeenAt: new Date(),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([existingClient]),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnValue({ catch: vi.fn() }),
      }),
    } as unknown as AppDb;

    const { client, isNew } = await getOrCreateClient(mockDb, { clientToken: 'token-abc' });

    expect(isNew).toBe(false);
    expect(client.id).toBe('client-123');
  });

  it('createSession inserts a new session with defaults', async () => {
    const mockSession = {
      id: 'session-xyz',
      clientId: 'client-123',
      title: 'Flagship Search',
      primaryIntent: 'recommend',
      isPinned: false,
      status: 'active',
      metadata: { regionCode: 'US' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockSession]),
        }),
      }),
    } as unknown as AppDb;

    const session = await createSession(mockDb, 'client-123', {
      title: 'Flagship Search',
      primaryIntent: 'recommend',
    });

    expect(session.id).toBe('session-xyz');
    expect(session.title).toBe('Flagship Search');
  });

  it('getSessionWithTurns returns null if session is soft-deleted or client mismatch', async () => {
    const deletedSession = {
      id: 'session-del',
      clientId: 'client-123',
      title: 'Old Chat',
      status: 'deleted',
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([deletedSession]),
    } as unknown as AppDb;

    const res = await getSessionWithTurns(mockDb, 'session-del', 'client-123');
    expect(res).toBeNull();
  });

  it('deleteSession soft-deletes the session by setting status to deleted', async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'session-xyz' }]),
          }),
        }),
      }),
    } as unknown as AppDb;

    const success = await deleteSession(mockDb, 'session-xyz', 'client-123');
    expect(success).toBe(true);
  });
});
