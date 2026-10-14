import { env } from '@/env';
import { getConfiguredGeminiKeys } from '../gemini-keys';

export interface ProviderKeyEntry {
  readonly id: string;
  readonly providerId: 'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'github' | 'openrouter';
  readonly apiKey: string;
  readonly keyIndex: number;
  readonly rpmLimit: number;
  readonly rpdLimit: number;
}

export class KeyPoolRegistry {
  private readonly keysByProvider = new Map<string, ProviderKeyEntry[]>();

  constructor() {
    this.initFromEnv();
  }

  private initFromEnv(): void {
    // 1. Google Gemini keys
    const geminiKeys = getConfiguredGeminiKeys(env);
    const geminiEntries: ProviderKeyEntry[] = geminiKeys.map((k, i) => ({
      id: `gemini-${i + 1}`,
      providerId: 'gemini',
      apiKey: k.apiKey,
      keyIndex: i,
      rpmLimit: env.GEMINI_FREE_RPM ?? 15,
      rpdLimit: env.GEMINI_FREE_RPD ?? 1500,
    }));
    this.keysByProvider.set('gemini', geminiEntries);

    // 2. Groq keys
    const groqEntries: ProviderKeyEntry[] = [];
    if (env.GROQ_API_KEY?.trim()) {
      groqEntries.push({
        id: 'groq-1',
        providerId: 'groq',
        apiKey: env.GROQ_API_KEY.trim(),
        keyIndex: 0,
        rpmLimit: 30,
        rpdLimit: 14400,
      });
    }
    if (env.GROQ_API_KEY_2?.trim()) {
      groqEntries.push({
        id: 'groq-2',
        providerId: 'groq',
        apiKey: env.GROQ_API_KEY_2.trim(),
        keyIndex: 1,
        rpmLimit: 30,
        rpdLimit: 14400,
      });
    }
    this.keysByProvider.set('groq', groqEntries);

    // 3. NVIDIA NIM keys
    const nvidiaEntries: ProviderKeyEntry[] = [];
    if (env.NVIDIA_NIM_API_KEY?.trim()) {
      nvidiaEntries.push({
        id: 'nvidia-1',
        providerId: 'nvidia',
        apiKey: env.NVIDIA_NIM_API_KEY.trim(),
        keyIndex: 0,
        rpmLimit: 30,
        rpdLimit: 1000,
      });
    }
    if (env.NVIDIA_NIM_API_KEY_2?.trim()) {
      nvidiaEntries.push({
        id: 'nvidia-2',
        providerId: 'nvidia',
        apiKey: env.NVIDIA_NIM_API_KEY_2.trim(),
        keyIndex: 1,
        rpmLimit: 30,
        rpdLimit: 1000,
      });
    }
    this.keysByProvider.set('nvidia', nvidiaEntries);

    // 4. Cerebras keys
    const cerebrasEntries: ProviderKeyEntry[] = [];
    if (env.CEREBRAS_API_KEY?.trim()) {
      cerebrasEntries.push({
        id: 'cerebras-1',
        providerId: 'cerebras',
        apiKey: env.CEREBRAS_API_KEY.trim(),
        keyIndex: 0,
        rpmLimit: 30,
        rpdLimit: 5000,
      });
    }
    this.keysByProvider.set('cerebras', cerebrasEntries);

    // 5. GitHub Models
    const githubEntries: ProviderKeyEntry[] = [];
    if (env.GITHUB_MODELS_TOKEN?.trim()) {
      githubEntries.push({
        id: 'github-1',
        providerId: 'github',
        apiKey: env.GITHUB_MODELS_TOKEN.trim(),
        keyIndex: 0,
        rpmLimit: 15,
        rpdLimit: 150,
      });
    }
    this.keysByProvider.set('github', githubEntries);

    // 6. OpenRouter
    const openrouterEntries: ProviderKeyEntry[] = [];
    if (env.OPENROUTER_API_KEY?.trim()) {
      openrouterEntries.push({
        id: 'openrouter-1',
        providerId: 'openrouter',
        apiKey: env.OPENROUTER_API_KEY.trim(),
        keyIndex: 0,
        rpmLimit: 20,
        rpdLimit: 200,
      });
    }
    this.keysByProvider.set('openrouter', openrouterEntries);
  }

  getKeysForProvider(providerId: string): readonly ProviderKeyEntry[] {
    return this.keysByProvider.get(providerId) ?? [];
  }

  hasKeys(providerId: string): boolean {
    const list = this.keysByProvider.get(providerId);
    return Boolean(list && list.length > 0);
  }

  getAllConfiguredProviders(): readonly string[] {
    const active: string[] = [];
    for (const [provider, keys] of this.keysByProvider.entries()) {
      if (keys.length > 0) active.push(provider);
    }
    return active;
  }
}

let _keyPool: KeyPoolRegistry | null = null;
export function getKeyPool(): KeyPoolRegistry {
  if (!_keyPool) {
    _keyPool = new KeyPoolRegistry();
  }
  return _keyPool;
}
