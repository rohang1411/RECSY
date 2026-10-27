'use client';

/**
 * Infinite query hook for recommendation session history with optimistic updates (Plan 27 WP-07).
 */
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  deleteSession as deleteSessionApi,
  fetchSessionList,
  restoreSession as restoreSessionApi,
  updateSession as updateSessionApi,
  type ListSessionsResult,
  type SessionStatus,
  type SessionSummary,
} from './api';
import { sessionKeys } from './keys';
import { broadcastSessionChange } from './broadcast';

export interface UseSessionListOptions {
  ownerKey?: string;
  status?: SessionStatus | 'all';
  q?: string;
  includePinned?: boolean;
  limit?: number;
}

export function useSessionList(options: UseSessionListOptions = {}) {
  const queryClient = useQueryClient();
  const ownerKey = options.ownerKey || 'guest';
  const status = (options.status || 'active') as 'active' | 'archived' | 'all';
  const q = options.q || '';
  const includePinned = options.includePinned ?? true;
  const limit = options.limit ?? 30;

  const queryKey = sessionKeys.list(ownerKey, status, q);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      return fetchSessionList({
        cursor: pageParam,
        limit,
        q,
        status,
        includePinned,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ListSessionsResult) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  // Flatten sessions across pages (deduplicating by id)
  const sessions: SessionSummary[] = [];
  const seenIds = new Set<string>();

  if (query.data?.pages) {
    for (const page of query.data.pages) {
      for (const s of page.sessions) {
        if (!seenIds.has(s.id)) {
          seenIds.add(s.id);
          sessions.push(s);
        }
      }
    }
  }

  // Pinned sessions from first page
  const pinnedSessions: SessionSummary[] = query.data?.pages[0]?.pinned ?? [];
  const guestImportAvailable = query.data?.pages[0]?.guestImportAvailable ?? 0;

  // Optimistic update helper for list cache
  const updateListCache = (updater: (items: SessionSummary[]) => SessionSummary[]) => {
    queryClient.setQueryData<InfiniteData<ListSessionsResult>>(queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page, index) => {
          if (index === 0) {
            return {
              ...page,
              pinned: page.pinned ? updater(page.pinned) : page.pinned,
              sessions: updater(page.sessions),
            };
          }
          return {
            ...page,
            sessions: updater(page.sessions),
          };
        }),
      };
    });
  };

  // Mutation: Rename session
  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      return updateSessionApi(id, { title });
    },
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<InfiniteData<ListSessionsResult>>(queryKey);

      updateListCache((items) =>
        items.map((item) => (item.id === id ? { ...item, title, titleSource: 'user' } : item)),
      );

      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSettled: (data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(id) });
      broadcastSessionChange({ type: 'changed', id, ownerKey });
    },
  });

  // Mutation: Pin / Unpin session
  const pinMutation = useMutation({
    mutationFn: async ({ id, isPinned }: { id: string; isPinned: boolean }) => {
      return updateSessionApi(id, { isPinned });
    },
    onMutate: async ({ id, isPinned }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<InfiniteData<ListSessionsResult>>(queryKey);

      updateListCache((items) =>
        items.map((item) => (item.id === id ? { ...item, isPinned } : item)),
      );

      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey });
      broadcastSessionChange({ type: 'changed', id, ownerKey });
    },
  });

  // Mutation: Archive / Unarchive session
  const archiveMutation = useMutation({
    mutationFn: async ({
      id,
      status: newStatus,
    }: {
      id: string;
      status: 'active' | 'archived';
    }) => {
      return updateSessionApi(id, { status: newStatus });
    },
    onMutate: async ({ id, status: newStatus }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<InfiniteData<ListSessionsResult>>(queryKey);

      if (status !== 'all' && status !== newStatus) {
        // If filtering by status, remove from view optimistically
        updateListCache((items) => items.filter((item) => item.id !== id));
      } else {
        updateListCache((items) =>
          items.map((item) => (item.id === id ? { ...item, status: newStatus } : item)),
        );
      }

      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey });
      broadcastSessionChange({ type: 'changed', id, ownerKey });
    },
  });

  // Mutation: Delete session (with immediate UI removal and broadcast)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return deleteSessionApi(id);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<InfiniteData<ListSessionsResult>>(queryKey);

      updateListCache((items) => items.filter((item) => item.id !== id));

      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSettled: (_data, _err, id) => {
      void queryClient.invalidateQueries({ queryKey });
      queryClient.removeQueries({ queryKey: sessionKeys.detail(id) });
      broadcastSessionChange({ type: 'deleted', id, ownerKey });
    },
  });

  // Mutation: Restore deleted session
  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      return restoreSessionApi(id);
    },
    onSettled: (_data, _err, id) => {
      void queryClient.invalidateQueries({ queryKey });
      broadcastSessionChange({ type: 'changed', id, ownerKey });
    },
  });

  return {
    ...query,
    sessions,
    pinnedSessions,
    guestImportAvailable,
    renameSession: renameMutation.mutateAsync,
    pinSession: pinMutation.mutateAsync,
    archiveSession: archiveMutation.mutateAsync,
    deleteSession: deleteMutation.mutateAsync,
    restoreSession: restoreMutation.mutateAsync,
    isMutating:
      renameMutation.isPending ||
      pinMutation.isPending ||
      archiveMutation.isPending ||
      deleteMutation.isPending,
  };
}
