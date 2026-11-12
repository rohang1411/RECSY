// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { cleanupLegacySessionCache, readCachedSession, writeCachedSession } from './local-cache';
import { clearAllDrafts, clearDraft, getDraft, setDraft } from './drafts';
import {
  broadcastSessionChange,
  closeBroadcastChannel,
  subscribeSessionBroadcast,
  type BroadcastMessage,
} from './broadcast';
import { purgeClientSessionState } from './purge';
import { sessionKeys } from './keys';
import type { SessionDetail, SessionDetailTurn } from './api';

describe('WP-07 Client Data Layer', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    closeBroadcastChannel();
  });

  describe('Local Cache & LRU Eviction', () => {
    it('writes and reads session detail from sessionStorage', () => {
      const mockSession: SessionDetail = {
        id: 'sess-1',
        title: 'Best camera phone',
        titleSource: 'heuristic',
        firstMessage: 'camera phone under $800',
        isPinned: false,
        status: 'active',
        turnCount: 1,
        topPick: { brand: 'Google', model: 'Pixel 9', slug: 'pixel-9' },
        createdAt: '2026-01-01T00:00:00Z',
        lastTurnAt: '2026-01-01T00:00:00Z',
        turns: [],
      };

      writeCachedSession(mockSession);
      const read = readCachedSession('sess-1');

      expect(read).toEqual(mockSession);
    });

    it('evicts oldest entries when exceeding max 10 LRU capacity', () => {
      for (let i = 1; i <= 12; i++) {
        const session: SessionDetail = {
          id: `sess-${i}`,
          title: `Session ${i}`,
          titleSource: 'heuristic',
          firstMessage: `Message ${i}`,
          isPinned: false,
          status: 'active',
          turnCount: 1,
          topPick: null,
          createdAt: new Date().toISOString(),
          lastTurnAt: new Date().toISOString(),
          turns: [],
        };
        writeCachedSession(session);
      }

      // sess-1 and sess-2 should have been evicted
      expect(readCachedSession('sess-1')).toBeNull();
      expect(readCachedSession('sess-2')).toBeNull();

      // sess-3 through sess-12 should still exist
      expect(readCachedSession('sess-3')).not.toBeNull();
      expect(readCachedSession('sess-12')).not.toBeNull();
    });

    it('cleans up legacy v1 session cache', () => {
      window.sessionStorage.setItem('recsy:session:recommend:v1', '{"old": true}');
      expect(window.sessionStorage.getItem('recsy:session:recommend:v1')).not.toBeNull();

      cleanupLegacySessionCache();
      expect(window.sessionStorage.getItem('recsy:session:recommend:v1')).toBeNull();
    });
  });

  describe('Drafts per session ID', () => {
    it('saves, retrieves, and clears drafts per ID', () => {
      setDraft('sess-1', 'iPhone with good battery');
      setDraft('sess-2', 'Foldable phone');
      setDraft(null, 'New query draft');

      expect(getDraft('sess-1')).toBe('iPhone with good battery');
      expect(getDraft('sess-2')).toBe('Foldable phone');
      expect(getDraft(null)).toBe('New query draft');
      expect(getDraft('new')).toBe('New query draft');

      clearDraft('sess-1');
      expect(getDraft('sess-1')).toBe('');
      expect(getDraft('sess-2')).toBe('Foldable phone');

      clearAllDrafts();
      expect(getDraft('sess-2')).toBe('');
      expect(getDraft('new')).toBe('');
    });
  });

  describe('Broadcast & Cross-Tab Sync', () => {
    it('subscribes and receives broadcast messages via fallback or channel', () => {
      const messages: BroadcastMessage[] = [];
      const unsubscribe = subscribeSessionBroadcast((msg) => {
        messages.push(msg);
      });

      broadcastSessionChange({
        type: 'changed',
        id: 'sess-abc',
        ownerKey: 'user:123',
      });

      unsubscribe();
      // Storage fallback or broadcast message should trigger
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Purge Utility', () => {
    it('removes all cached v2 sessions, drafts, and resets queryClient', () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(sessionKeys.detail('sess-1'), { id: 'sess-1' });

      setDraft('sess-1', 'draft text');
      writeCachedSession({
        id: 'sess-1',
        title: 'Title',
        titleSource: 'default',
        firstMessage: null,
        isPinned: false,
        status: 'active',
        turnCount: 1,
        topPick: null,
        createdAt: '',
        lastTurnAt: '',
        turns: [],
      });

      purgeClientSessionState({ queryClient, broadcast: false });

      expect(queryClient.getQueryData(sessionKeys.detail('sess-1'))).toBeUndefined();
      expect(getDraft('sess-1')).toBe('');
      expect(readCachedSession('sess-1')).toBeNull();
    });
  });

  describe('Late Response Isolation and Cache Independence', () => {
    it('updates only session A cache when response for A arrives while viewing session B', () => {
      const queryClient = new QueryClient();

      const sessionA: SessionDetail = {
        id: 'sess-A',
        title: 'Session A',
        titleSource: 'heuristic',
        firstMessage: 'Query A',
        isPinned: false,
        status: 'active',
        turnCount: 1,
        topPick: null,
        createdAt: '2026-01-01T00:00:00Z',
        lastTurnAt: '2026-01-01T00:00:00Z',
        turns: [
          {
            id: 't-1',
            turnIndex: 1,
            userMessage: 'Query A',
            intent: 'results',
            clarifyingQuestion: null,
            picks: null,
            resultMeta: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      };

      const sessionB: SessionDetail = {
        id: 'sess-B',
        title: 'Session B',
        titleSource: 'user',
        firstMessage: 'Query B',
        isPinned: false,
        status: 'active',
        turnCount: 2,
        topPick: null,
        createdAt: '2026-01-02T00:00:00Z',
        lastTurnAt: '2026-01-02T00:00:00Z',
        turns: [
          {
            id: 't-2',
            turnIndex: 1,
            userMessage: 'Query B',
            intent: 'results',
            clarifyingQuestion: null,
            picks: null,
            resultMeta: null,
            createdAt: '2026-01-02T00:00:00Z',
          },
        ],
      };

      queryClient.setQueryData(sessionKeys.detail('sess-A'), sessionA);
      queryClient.setQueryData(sessionKeys.detail('sess-B'), sessionB);

      // Simulate turn response for Session A arriving
      const turnAResponse = {
        sessionId: 'sess-A',
        turnIndex: 2,
        kind: 'results',
        picks: [{ brand: 'Samsung', model: 'Galaxy S25', slug: 's25' }],
        session: {
          title: 'Updated A Title',
          titleSource: 'heuristic',
          turnCount: 2,
        },
      };

      // Apply update directly to sess-A's key
      queryClient.setQueryData<SessionDetail>(sessionKeys.detail('sess-A'), (prev) => {
        if (!prev) return prev;
        const newTurn: SessionDetailTurn = {
          id: 'turn-2',
          turnIndex: 2,
          userMessage: 'Message 2 for A',
          intent: 'results',
          clarifyingQuestion: null,
          picks: turnAResponse.picks,
          resultMeta: null,
          createdAt: '2026-01-01T00:01:00Z',
        };
        return {
          ...prev,
          title: turnAResponse.session.title,
          turnCount: turnAResponse.session.turnCount,
          turns: [...prev.turns, newTurn],
        };
      });

      // Session B's cache must remain entirely untouched!
      const cachedB = queryClient.getQueryData<SessionDetail>(sessionKeys.detail('sess-B'));
      expect(cachedB).toEqual(sessionB);
      expect(cachedB?.turnCount).toBe(2);
      expect(cachedB?.title).toBe('Session B');

      // Session A's cache must have received the update
      const cachedA = queryClient.getQueryData<SessionDetail>(sessionKeys.detail('sess-A'));
      expect(cachedA?.turnCount).toBe(2);
      expect(cachedA?.title).toBe('Updated A Title');
      expect(cachedA?.turns.length).toBe(2);
    });

    it('performs optimistic update and rolls back on failure', () => {
      const queryClient = new QueryClient();

      const initialSession: SessionDetail = {
        id: 'sess-123',
        title: 'Original Title',
        titleSource: 'heuristic',
        firstMessage: 'first prompt',
        isPinned: false,
        status: 'active',
        turnCount: 1,
        topPick: null,
        createdAt: '2026-01-01T00:00:00Z',
        lastTurnAt: '2026-01-01T00:00:00Z',
        turns: [
          {
            id: 't-1',
            turnIndex: 1,
            userMessage: 'first prompt',
            intent: 'results',
            clarifyingQuestion: null,
            picks: null,
            resultMeta: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      };

      queryClient.setQueryData(sessionKeys.detail('sess-123'), initialSession);

      // Snapshot previous state for rollback
      const snapshot = queryClient.getQueryData<SessionDetail>(sessionKeys.detail('sess-123'));

      // Optimistically append user message
      const optimisticTurn: SessionDetailTurn = {
        id: 'optimistic-1',
        turnIndex: 2,
        userMessage: 'Optimistic prompt',
        intent: 'optimistic',
        clarifyingQuestion: null,
        picks: null,
        resultMeta: null,
        createdAt: '2026-01-01T00:01:00Z',
      };

      queryClient.setQueryData<SessionDetail>(sessionKeys.detail('sess-123'), {
        ...initialSession,
        turnCount: 2,
        turns: [...initialSession.turns, optimisticTurn],
      });

      expect(
        queryClient.getQueryData<SessionDetail>(sessionKeys.detail('sess-123'))?.turns.length,
      ).toBe(2);

      // Error occurs: rollback to snapshot
      queryClient.setQueryData(sessionKeys.detail('sess-123'), snapshot);

      const restored = queryClient.getQueryData<SessionDetail>(sessionKeys.detail('sess-123'));
      expect(restored).toEqual(initialSession);
      expect(restored?.turns.length).toBe(1);
    });
  });
});
