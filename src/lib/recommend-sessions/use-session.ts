'use client';

/**
 * Query hook for single session detail with LRU sessionStorage hydration (Plan 27 WP-07).
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSessionDetail, type SessionDetail } from './api';
import { sessionKeys } from './keys';
import { readCachedSession, writeCachedSession } from './local-cache';

export interface UseSessionOptions {
  initialData?: SessionDetail;
  enabled?: boolean;
}

export function useSession(id: string | null | undefined, options: UseSessionOptions = {}) {
  const isEnabled = options.enabled !== false && Boolean(id);

  const query = useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: async () => {
      if (!id) throw new Error('Session ID required');
      return fetchSessionDetail(id);
    },
    enabled: isEnabled,
    staleTime: 5 * 60_000, // 5 minutes
    initialData: () => {
      if (options.initialData) return options.initialData;
      if (id) {
        return readCachedSession(id) ?? undefined;
      }
      return undefined;
    },
  });

  // Keep local LRU cache in sync on fresh network fetch
  useEffect(() => {
    if (query.data && id) {
      writeCachedSession(query.data);
    }
  }, [id, query.data]);

  return query;
}
