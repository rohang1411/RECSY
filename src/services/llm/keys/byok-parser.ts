export interface UserByokConfig {
  readonly apiKey: string;
  readonly provider: 'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'openai';
  readonly userMode?: 'fast' | 'deep';
}

/**
 * Extracts and sanitizes client-supplied BYOK (Bring Your Own Key) headers.
 * Never stores or writes the user key to disk or database.
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
  const validProviders: readonly string[] = ['gemini', 'groq', 'nvidia', 'cerebras', 'openai'];
  const provider = (
    rawProvider && validProviders.includes(rawProvider) ? rawProvider : 'gemini'
  ) as UserByokConfig['provider'];

  const rawMode = getHeader('x-recsy-user-mode')?.trim().toLowerCase();
  const userMode = rawMode === 'deep' ? 'deep' : 'fast';

  return {
    apiKey: rawKey,
    provider,
    userMode,
  };
}
