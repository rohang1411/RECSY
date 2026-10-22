import { CLIENT_SETTING_KEYS } from './client-settings';

/**
 * Reads user BYOK key and reasoning mode from localStorage to attach as headers to API requests.
 */
export function getClientByokHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const key = window.localStorage.getItem(`recsy:setting:${CLIENT_SETTING_KEYS.byokKey}`);
    const provider = window.localStorage.getItem(
      `recsy:setting:${CLIENT_SETTING_KEYS.byokProvider}`,
    );
    const mode = window.localStorage.getItem(`recsy:setting:${CLIENT_SETTING_KEYS.reasoningMode}`);

    const parsedKey = key ? (JSON.parse(key) as string) : '';
    const parsedProvider = provider ? (JSON.parse(provider) as string) : 'gemini';
    const parsedMode = mode ? (JSON.parse(mode) as string) : 'fast';

    const headers: Record<string, string> = {};
    if (parsedKey && typeof parsedKey === 'string' && parsedKey.trim()) {
      headers['x-recsy-user-key'] = parsedKey.trim();
      headers['x-recsy-user-provider'] = parsedProvider;
    }
    if (parsedMode && typeof parsedMode === 'string') {
      headers['x-recsy-user-mode'] = parsedMode;
    }
    return headers;
  } catch {
    return {};
  }
}

export function hasClientByokKey(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const key = window.localStorage.getItem(`recsy:setting:${CLIENT_SETTING_KEYS.byokKey}`);
    const parsedKey = key ? (JSON.parse(key) as string) : '';
    return Boolean(parsedKey && typeof parsedKey === 'string' && parsedKey.trim());
  } catch {
    return false;
  }
}
