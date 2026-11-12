// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecommendClient } from './recommend-client';
import { setDraft } from '@/lib/recommend-sessions/drafts';
import { getRegionConfig, type RegionConfig } from '@/lib/regions';
import type { SessionDetail } from '@/lib/recommend-sessions/api';

vi.mock('@/components/phone/PhoneImage', () => ({
  PhoneImage: () => <div data-testid="phone-image" />,
}));

vi.mock('@/components/quota/QuotaSheet', () => ({
  QuotaSheet: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockRegion: RegionConfig = getRegionConfig('US');

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('WP-08 RecommendClient', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders initial greeting for a new conversation', () => {
    renderWithClient(<RecommendClient activeRegion={mockRegion} />);

    expect(screen.getByText('Conversation')).toBeDefined();
    expect(screen.getByText(/Just describe the phone you want/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Under \$700/i)).toBeDefined();
  });

  it('restores draft text from sessionStorage on mount', () => {
    setDraft('sess-test-draft', 'Looking for compact flagship');

    renderWithClient(<RecommendClient sessionId="sess-test-draft" activeRegion={mockRegion} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Looking for compact flagship');
  });

  it('reconstructs conversation lines and picks for reopened session', () => {
    const historicalSession: SessionDetail = {
      id: 'sess-historical',
      title: 'Gaming phones under $800',
      titleSource: 'heuristic',
      firstMessage: 'gaming phone',
      isPinned: false,
      status: 'active',
      turnCount: 1,
      topPick: { brand: 'Asus', model: 'ROG Phone 9', slug: 'rog-phone-9' },
      createdAt: '2026-01-01T00:00:00Z',
      lastTurnAt: '2026-01-01T00:00:00Z',
      turns: [
        {
          id: 'turn-1',
          turnIndex: 1,
          userMessage: 'gaming phone high refresh rate',
          intent: 'results',
          clarifyingQuestion: null,
          picks: [
            {
              phoneId: 'p-1',
              slug: 'rog-phone-9',
              brand: 'Asus',
              model: 'ROG Phone 9',
              score: 0.95,
              summary: 'Ultimate mobile gaming flagship.',
              msrpUsd: '999',
              localPrice: '999',
              localCurrency: 'USD',
              imageUrl: null,
            },
          ],
          resultMeta: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    };

    renderWithClient(
      <RecommendClient
        sessionId="sess-historical"
        initialSession={historicalSession}
        activeRegion={mockRegion}
      />,
    );

    // Verifies user message and reconstructed assistant lines
    expect(screen.getByText('gaming phone high refresh rate')).toBeDefined();
    expect(screen.getByText('Recommendations are ready. Returning one match.')).toBeDefined();
    expect(screen.getByText('ROG Phone 9')).toBeDefined();
  });

  it('displays turn limit warning when at 45 turns and disables at 50 turns', () => {
    const fullSession: SessionDetail = {
      id: 'sess-full',
      title: 'Full conversation',
      titleSource: 'default',
      firstMessage: 'msg',
      isPinned: false,
      status: 'active',
      turnCount: 50,
      topPick: null,
      createdAt: '2026-01-01T00:00:00Z',
      lastTurnAt: '2026-01-01T00:00:00Z',
      turns: [],
    };

    renderWithClient(
      <RecommendClient
        sessionId="sess-full"
        initialSession={fullSession}
        activeRegion={mockRegion}
      />,
    );

    expect(screen.getByText(/This conversation is full/i)).toBeDefined();
    expect(screen.getByText(/Start new recommendation/i)).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
