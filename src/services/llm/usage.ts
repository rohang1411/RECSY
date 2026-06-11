import { getDb } from '@/services/db/client';
import { llmUsageEvents } from '@/services/db/schema';
import { logger } from '@/services/logger';

import type { LlmUsageContext } from './types';

const log = logger.child({ component: 'llm-usage' });

export async function recordLlmUsageEvent(input: {
  readonly provider: string;
  readonly model: string;
  readonly operation: 'chat' | 'stream' | 'structured' | 'embed';
  readonly usageContext?: LlmUsageContext;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount?: number;
  readonly cached?: boolean;
  readonly apiKeyIndex?: number;
  readonly latencyMs?: number;
  readonly errorCode?: string;
}): Promise<void> {
  try {
    await getDb()
      .insert(llmUsageEvents)
      .values({
        provider: input.provider,
        model: input.model,
        operation: input.operation,
        usageArea: cleanLabel(input.usageContext?.area) ?? 'uncategorized',
        usageFeature: cleanLabel(input.usageContext?.feature),
        source: cleanLabel(input.usageContext?.source),
        inputTokens: safeInt(input.inputTokens),
        outputTokens: safeInt(input.outputTokens),
        requestCount: input.requestCount ?? 1,
        cached: input.cached ?? false,
        apiKeyIndex: input.apiKeyIndex,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
        metadata: (input.usageContext?.metadata ?? {}) as Record<string, unknown>,
      });
  } catch (err) {
    log.warn({ err }, 'failed to persist llm usage event');
  }
}

function cleanLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 140) : undefined;
}

function safeInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}
