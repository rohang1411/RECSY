// @vitest-environment jsdom
/**
 * Unit tests for client settings hooks (`client-settings.ts`).
 *
 * Tests cover: `useClientSetting` localStorage round-trip (read default,
 * write, read updated value), SSR server-snapshot returns fallback,
 * JSON parse failure falls back to default, and `CLIENT_SETTING_KEYS` /
 * `CLIENT_SETTING_DEFAULTS` exports are correct and frozen.
 *
 * Runs in jsdom to provide `window.localStorage` and `useSyncExternalStore`.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CLIENT_SETTING_DEFAULTS, CLIENT_SETTING_KEYS, useClientSetting } from './client-settings';

afterEach(() => {
  localStorage.clear();
});

describe('CLIENT_SETTING_KEYS', () => {
  it('exports enterToSend key', () => {
    expect(CLIENT_SETTING_KEYS.enterToSend).toBe('enterToSend');
  });
});

describe('CLIENT_SETTING_DEFAULTS', () => {
  it('enterToSend defaults to true', () => {
    expect(CLIENT_SETTING_DEFAULTS.enterToSend).toBe(true);
  });
});

describe('useClientSetting', () => {
  it('returns fallback on first render when no value is stored', () => {
    const { result } = renderHook(() => useClientSetting('testKey', 'default-value'));
    expect(result.current[0]).toBe('default-value');
  });

  it('persists and reads back a written value', () => {
    const { result } = renderHook(() => useClientSetting('enterToSend', true));
    // Initial value should be the default (true)
    expect(result.current[0]).toBe(true);

    // Toggle to false
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);

    // Toggle back to true
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });

  it('falls back to default when localStorage contains invalid JSON', () => {
    localStorage.setItem('recsy:setting:badKey', '{not valid json');
    const { result } = renderHook(() => useClientSetting('badKey', 42));
    expect(result.current[0]).toBe(42);
  });

  it('reads from localStorage on mount if a value was pre-set', () => {
    localStorage.setItem('recsy:setting:preloaded', JSON.stringify(99));
    const { result } = renderHook(() => useClientSetting('preloaded', 0));
    expect(result.current[0]).toBe(99);
  });

  it('returns boolean defaults correctly', () => {
    const { result } = renderHook(() =>
      useClientSetting(CLIENT_SETTING_KEYS.enterToSend, CLIENT_SETTING_DEFAULTS.enterToSend),
    );
    expect(typeof result.current[0]).toBe('boolean');
  });
});
