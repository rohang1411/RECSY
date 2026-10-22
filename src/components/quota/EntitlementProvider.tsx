'use client';

import { useEffect, type ReactNode } from 'react';
import { quotaStore, loadInitialSnapshotFromStorage } from './quota-store';
import { QuotaAnnouncer } from './QuotaAnnouncer';
import type { EntitlementSnapshot } from '@/services/metering/types';

let lastFetchTime = 0;
let lastEtag: string | null = null;
const VISIBILITY_DEBOUNCE_MS = 15000; // 15s debounce per spec

async function fetchEntitlements(): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (lastEtag) {
      headers['If-None-Match'] = lastEtag;
    }

    const res = await fetch('/api/me/entitlements', {
      headers,
      credentials: 'include',
    });

    if (res.status === 304) {
      // 304 Not Modified: cache is fresh, mark not stale
      const curr = quotaStore.getSnapshot().snapshot;
      if (curr) {
        quotaStore.setSnapshot(curr, false);
      }
      return;
    }

    if (res.ok) {
      const etag = res.headers.get('ETag');
      if (etag) lastEtag = etag;

      const data = (await res.json()) as EntitlementSnapshot;
      quotaStore.setSnapshot(data, false);
    }
  } catch {
    // Network offline or error - keep cached snapshot flagged stale
  }
}

export function EntitlementProvider({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    // 1. Load cached snapshot from sessionStorage immediately (paint fast)
    const cached = loadInitialSnapshotFromStorage();
    if (cached) {
      quotaStore.setSnapshot(cached, true);
    }

    // 2. Fetch fresh entitlements in an idle callback
    const scheduleFetch = () => {
      lastFetchTime = Date.now();
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(() => void fetchEntitlements());
      } else {
        setTimeout(() => void fetchEntitlements(), 100);
      }
    };

    scheduleFetch();

    // 3. Debounced visibility refetch
    const onVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastFetchTime > VISIBILITY_DEBOUNCE_MS) {
        scheduleFetch();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <>
      <QuotaAnnouncer />
      {children}
    </>
  );
}
