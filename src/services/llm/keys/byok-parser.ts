import { ByokError } from '@/lib/errors';

export type ByokProviderId = 'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'openai' | 'openrouter';

export const VALID_BYOK_PROVIDERS: readonly ByokProviderId[] = [
  'gemini',
  'groq',
  'nvidia',
  'cerebras',
  'openai',
  'openrouter',
] as const;

export interface UserByokConfig {
  readonly apiKey: string;
  readonly provider: ByokProviderId;
  readonly userMode?: 'fast' | 'deep';
}

/**
 * Extracts and sanitizes client-supplied BYOK (Bring Your Own Key) headers.
 * Never stores or writes the user key to disk or database.
 * Rejects unknown providers with 400 BYOK_UNSUPPORTED.
 */
export function extractByokFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
): UserByokConfig | null {
  const getHeader = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name) ?? undefined;
    }
    const val = (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  const rawKey = getHeader('x-recsy-user-key')?.trim();
  if (!rawKey || rawKey.length < 8) return null;

  const rawProvider = getHeader('x-recsy-user-provider')?.trim().toLowerCase();
  let provider: ByokProviderId = 'gemini';
  if (rawProvider) {
    if (!VALID_BYOK_PROVIDERS.includes(rawProvider as ByokProviderId)) {
      throw new ByokError('BYOK_UNSUPPORTED', `BYOK provider '${rawProvider}' is not supported`, {
        status: 400,
      });
    }
    provider = rawProvider as ByokProviderId;
  }

  const rawMode = getHeader('x-recsy-user-mode')?.trim().toLowerCase();
  const userMode = rawMode === 'deep' ? 'deep' : 'fast';

  return {
    apiKey: rawKey,
    provider,
    userMode,
  };
}
