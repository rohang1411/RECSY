/**
 * Client-side region reader (Plan 26 WP-08).
 * Reads the `recsy_region` cookie without server-side request APIs.
 */
'use client';

import { useSyncExternalStore } from 'react';
import {
  DEFAULT_REGION_CODE,
  getRegionConfig,
  isSupportedRegion,
  type RegionConfig,
} from './regions';

export function readClientRegionCode(): string {
  if (typeof document === 'undefined') {
    return DEFAULT_REGION_CODE;
  }
  const match = document.cookie.match(/(?:^|;\s*)recsy_region=([^;]+)/);
  if (!match || !match[1]) {
    return DEFAULT_REGION_CODE;
  }
  const code = decodeURIComponent(match[1]).trim().toUpperCase();
  return isSupportedRegion(code) ? code : DEFAULT_REGION_CODE;
}

export function readClientRegion(): RegionConfig {
  return getRegionConfig(readClientRegionCode());
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('focus', callback);
  return () => window.removeEventListener('focus', callback);
}

function getSnapshot(): string {
  return readClientRegionCode();
}

function getServerSnapshot(): string {
  return DEFAULT_REGION_CODE;
}

export function useClientRegion(): {
  region: RegionConfig;
  countryCode: string;
  isMounted: boolean;
} {
  const countryCode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    region: getRegionConfig(countryCode),
    countryCode,
    isMounted: true,
  };
}
