'use client';

/**
 * React Query client and provider for Recommendation Sessions (Plan 27 WP-07).
 */
import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sessionKeys } from './keys';
import { subscribeSessionBroadcast } from './broadcast';
import { cleanupLegacySessionCache } from './local-cache';
import { purgeClientSessionState } from './purge';

/**
 * Creates a configured QueryClient according to Plan 27 specifications:
 * - Stale time: 30s for session lists
 * - Stale time: 5m for session details
 * - Multi-device freshness: refetchOnWindowFocus enabled
 */
export function createRecommendQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 30_000, // 30s default
      },
    },
  });
}

export interface RecommendQueryProviderProps {
  readonly children: React.ReactNode;
  readonly client?: QueryClient;
}

export function RecommendQueryProvider({
  children,
  client,
}: RecommendQueryProviderProps): React.JSX.Element {
  const [queryClient] = useState(() => client ?? createRecommendQueryClient());

  useEffect(() => {
    // 1. One-time cleanup of legacy sessionStorage snapshot
    cleanupLegacySessionCache();

    // 2. Cross-tab synchronization subscriber
    const unsubscribe = subscribeSessionBroadcast((message) => {
      switch (message.type) {
        case 'changed':
          void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
          if (message.id) {
            void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(message.id) });
          }
          break;

        case 'deleted':
          void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
          if (message.id) {
            queryClient.removeQueries({ queryKey: sessionKeys.detail(message.id) });
          }
          break;

        case 'signed-out':
          purgeClientSessionState({ queryClient, broadcast: false });
          break;
      }
    });

    return unsubscribe;
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
