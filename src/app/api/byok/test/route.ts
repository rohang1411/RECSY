import { type NextRequest, NextResponse } from 'next/server';
import { AppError, ByokError, mapByokError, RateLimitError } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { assertSameOrigin } from '@/lib/same-origin';
import { readRequestJson } from '@/lib/request-json';
import {
  extractByokFromHeaders,
  VALID_BYOK_PROVIDERS,
  type ByokProviderId,
} from '@/services/llm/keys/byok-parser';
import { consumeByokTestRateLimit, hashClientIp } from '@/services/rate-limit';
import { GeminiProvider } from '@/services/llm/gemini';
import { OpenAiCompatibleAdapter } from '@/services/llm/adapters/openai-compatible';

export const runtime = 'nodejs';

const BASE_URL_MAP: Record<Exclude<ByokProviderId, 'gemini'>, string> = {
  groq: 'https://api.groq.com/openai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const TEST_MODEL_MAP: Record<ByokProviderId, string> = {
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.1-8b-instant',
  nvidia: 'meta/llama-3.1-8b-instruct',
  cerebras: 'llama3.1-8b',
  openai: 'gpt-4o-mini',
  openrouter: 'meta-llama/llama-3.1-8b-instruct',
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const ip = getRequestClientIp(request);
    const did =
      request.cookies.get('__Host-recsy_did')?.value ||
      request.cookies.get('recsy_did')?.value ||
      hashClientIp(ip);

    await consumeByokTestRateLimit(did);

    let apiKey = '';
    let provider: string = 'gemini';

    // 1. Try JSON body first
    try {
      const body = (await readRequestJson(request, 4096)) as Record<string, unknown>;
      if (typeof body.apiKey === 'string') {
        apiKey = body.apiKey.trim();
      }
      if (typeof body.provider === 'string') {
        provider = body.provider.trim().toLowerCase();
      }
    } catch {
      // If body parsing fails or is empty, fallback to headers
    }

    // 2. Fallback to headers
    if (!apiKey) {
      const headerByok = extractByokFromHeaders(request.headers);
      if (headerByok) {
        apiKey = headerByok.apiKey;
        provider = headerByok.provider;
      }
    }

    if (!apiKey || apiKey.length < 8) {
      return NextResponse.json(
        {
          ok: false,
          code: 'VALIDATION',
          error: 'A valid API key (min 8 characters) is required',
        },
        { status: 400 },
      );
    }

    if (!VALID_BYOK_PROVIDERS.includes(provider as ByokProviderId)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'BYOK_UNSUPPORTED',
          error: `BYOK provider '${provider}' is not supported`,
        },
        { status: 400 },
      );
    }

    const byokProvider = provider as ByokProviderId;

    // 3. Perform a cheap probe request
    if (byokProvider === 'gemini') {
      const gemini = GeminiProvider.withKey(apiKey);
      await gemini.chat({
        model: TEST_MODEL_MAP.gemini,
        messages: [{ role: 'user', content: 'ping' }],
        maxOutputTokens: 2,
      });
    } else {
      const baseUrl = BASE_URL_MAP[byokProvider];
      const model = TEST_MODEL_MAP[byokProvider];
      const adapter = new OpenAiCompatibleAdapter({
        providerId: byokProvider,
        baseUrl,
      });
      await adapter.chat(
        {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          maxOutputTokens: 2,
        },
        model,
        apiKey,
      );
    }

    return NextResponse.json({
      ok: true,
      provider: byokProvider,
      message: 'API key verified successfully',
    });
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'Too many test requests. Please try again in an hour.',
        },
        { status: 429, headers: { 'Retry-After': '3600' } },
      );
    }

    if (err instanceof ByokError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          error: err.message,
        },
        { status: err.status },
      );
    }

    try {
      mapByokError(err);
    } catch (mappedErr: unknown) {
      if (mappedErr instanceof AppError) {
        return NextResponse.json(
          {
            ok: false,
            code: mappedErr.code,
            error: mappedErr.message,
          },
          { status: mappedErr.status },
        );
      }
    }

    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        code: 'BYOK_REJECTED',
        error: msg || 'API key verification failed',
      },
      { status: 400 },
    );
  }
}
