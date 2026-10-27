'use client';

/**
 * Mutation hook for executing recommendation conversation turns (Plan 27 WP-07).
 *
 * Implements:
 * - Optimistic turn appending to target session detail cache
 * - Error rollback on network/server errors
 * - Targeted cache merging (updates strictly `data.sessionId`, never active view)
 * - List cache summary updates
 * - sessionStorage LRU cache syncing
 * - Cross-tab event broadcasting
 * - Draft clearing on successful turn
 */
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  sendTurn,
  type ListSessionsResult,
  type RecommendTurnRequest,
  type RecommendTurnResponse,
  type SessionDetail,
  type SessionDetailTurn,
  type SessionSummary,
} from './api';
import { sessionKeys } from './keys';
import { clearDraft } from './drafts';
import { writeCachedSession } from './local-cache';
import { broadcastSessionChange } from './broadcast';

export interface SendTurnVariables {
  message: string;
  sessionId?: string;
  customRequestId?: string;
  ownerKey?: string;
}

export function useSendTurn() {
  const queryClient = useQueryClient();

  return useMutation<
    RecommendTurnResponse,
    Error,
    SendTurnVariables,
    { previousDetail?: SessionDetail; targetSessionId?: string }
  >({
    mutationFn: async ({ message, sessionId, customRequestId }) => {
      const payload: RecommendTurnRequest = { message };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      return sendTurn(payload, customRequestId);
    },

    onMutate: async ({ message, sessionId }) => {
      if (!sessionId) {
        return {};
      }

      const targetKey = sessionKeys.detail(sessionId);
      await queryClient.cancelQueries({ queryKey: targetKey });
      const previousDetail = queryClient.getQueryData<SessionDetail>(targetKey);

      if (previousDetail) {
        const optimisticTurn: SessionDetailTurn = {
          id: `optimistic-${Date.now()}`,
          turnIndex: (previousDetail.turns?.length ?? 0) + 1,
          userMessage: message,
          intent: 'optimistic',
          clarifyingQuestion: null,
          picks: null,
          resultMeta: null,
          createdAt: new Date().toISOString(),
        };

        queryClient.setQueryData<SessionDetail>(targetKey, {
          ...previousDetail,
          turnCount: previousDetail.turnCount + 1,
          lastTurnAt: new Date().toISOString(),
          turns: [...previousDetail.turns, optimisticTurn],
        });
      }

      return { previousDetail, targetSessionId: sessionId };
    },

    onError: (_err, _vars, context) => {
      if (context?.targetSessionId && context?.previousDetail) {
        queryClient.setQueryData(
          sessionKeys.detail(context.targetSessionId),
          context.previousDetail,
        );
      }
    },

    onSuccess: (data, { message, ownerKey }) => {
      const responseSessionId = data.sessionId;
      if (!responseSessionId) return;

      const realTurn: SessionDetailTurn = {
        id: `turn-${data.turnIndex ?? Date.now()}`,
        turnIndex: data.turnIndex ?? 1,
        userMessage: message,
        intent: data.kind,
        clarifyingQuestion: data.clarifyingQuestion ?? null,
        picks: data.picks ?? null,
        resultMeta: {
          v: 1,
          relaxed: data.relaxed,
          refined: data.refined,
          scoresTied: data.scoresTied,
          scorecardMissing: data.scorecardMissing,
          topAspects: data.topAspects,
        },
        createdAt: new Date().toISOString(),
      };

      // 1. Update session detail cache targeted strictly by responseSessionId
      const targetDetailKey = sessionKeys.detail(responseSessionId);
      queryClient.setQueryData<SessionDetail>(targetDetailKey, (prev) => {
        if (!prev) {
          const newDetail: SessionDetail = {
            id: responseSessionId,
            title: data.session?.title ?? message.slice(0, 30),
            titleSource: data.session?.titleSource ?? 'default',
            firstMessage: message,
            isPinned: false,
            status: 'active',
            turnCount: data.session?.turnCount ?? 1,
            topPick: data.picks?.[0]
              ? {
                  brand: (data.picks[0] as { brand: string }).brand,
                  model: (data.picks[0] as { model: string }).model,
                  slug: (data.picks[0] as { slug: string }).slug,
                }
              : null,
            createdAt: new Date().toISOString(),
            lastTurnAt: new Date().toISOString(),
            turns: [realTurn],
          };
          writeCachedSession(newDetail);
          return newDetail;
        }

        const filteredTurns = prev.turns.filter((t) => !t.id.startsWith('optimistic-'));
        const updatedDetail: SessionDetail = {
          ...prev,
          title: data.session?.title ?? prev.title,
          titleSource: data.session?.titleSource ?? prev.titleSource,
          turnCount: data.session?.turnCount ?? prev.turnCount + 1,
          lastTurnAt: new Date().toISOString(),
          topPick: data.picks?.[0]
            ? {
                brand: (data.picks[0] as { brand: string }).brand,
                model: (data.picks[0] as { model: string }).model,
                slug: (data.picks[0] as { slug: string }).slug,
              }
            : prev.topPick,
          turns: [...filteredTurns, realTurn],
        };

        writeCachedSession(updatedDetail);
        return updatedDetail;
      });

      // 2. Update list caches
      queryClient.setQueriesData<InfiniteData<ListSessionsResult>>(
        { queryKey: sessionKeys.lists() },
        (old) => {
          if (!old) return old;
          const updateItem = (item: SessionSummary): SessionSummary => {
            if (item.id === responseSessionId) {
              return {
                ...item,
                title: data.session?.title ?? item.title,
                titleSource: data.session?.titleSource ?? item.titleSource,
                turnCount: data.session?.turnCount ?? item.turnCount + 1,
                lastTurnAt: new Date().toISOString(),
                topPick: data.picks?.[0]
                  ? {
                      brand: (data.picks[0] as { brand: string }).brand,
                      model: (data.picks[0] as { model: string }).model,
                      slug: (data.picks[0] as { slug: string }).slug,
                    }
                  : item.topPick,
              };
            }
            return item;
          };

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              pinned: page.pinned?.map(updateItem),
              sessions: page.sessions.map(updateItem),
            })),
          };
        },
      );

      // Invalidate list queries in the background to ensure consistency
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });

      // 3. Clear draft for the session and for 'new'
      clearDraft(responseSessionId);
      clearDraft('new');

      // 4. Broadcast change
      broadcastSessionChange({
        type: 'changed',
        id: responseSessionId,
        ownerKey,
      });
    },
  });
}
