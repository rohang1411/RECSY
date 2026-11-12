import { describe, expect, it } from 'vitest';
import { analyzeComplexity, ModelRouter } from './router';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { MultiProviderQuotaGovernor } from './quota-governor';
import { KeyPoolRegistry } from '../keys/key-pool';
import { resolveTaskClass } from './task-profiles';
import type { ChatMessage } from '../types';

describe('resolveTaskClass', () => {
  it('infers EXTRACTION for catalog, spec, and intake contexts', () => {
    expect(
      resolveTaskClass(undefined, {
        area: 'Catalog enrichment',
        feature: 'GSMArena spec extraction',
      }),
    ).toBe('EXTRACTION');
    expect(
      resolveTaskClass(undefined, { area: 'Recommendation', feature: 'Requirement extraction' }),
    ).toBe('EXTRACTION');
    expect(resolveTaskClass(undefined, { area: 'Ingestion', feature: 'Scraper pipeline' })).toBe(
      'EXTRACTION',
    );
    expect(resolveTaskClass(undefined, { source: 'wikipedia-extraction' })).toBe('EXTRACTION');
  });

  it('infers DISAMBIGUATION for disambiguation and rerank features', () => {
    expect(
      resolveTaskClass(undefined, { area: 'Ingestion', feature: 'Source disambiguation' }),
    ).toBe('DISAMBIGUATION');
    expect(resolveTaskClass(undefined, { area: 'Retrieval', feature: 'LLM rerank' })).toBe(
      'DISAMBIGUATION',
    );
    expect(resolveTaskClass(undefined, { source: 'rerank-service' })).toBe('DISAMBIGUATION');
  });

  it('infers GROUNDED_SYNTHESIS for /api/ask, aspect scorecard, and synthesis', () => {
    expect(resolveTaskClass(undefined, { area: 'Phone Q&A', feature: 'Grounded answer' })).toBe(
      'GROUNDED_SYNTHESIS',
    );
    expect(resolveTaskClass(undefined, { area: 'Scorecard', feature: 'Aspect extraction' })).toBe(
      'GROUNDED_SYNTHESIS',
    );
    expect(resolveTaskClass(undefined, { feature: 'Recommendation synthesis' })).toBe(
      'GROUNDED_SYNTHESIS',
    );
  });

  it('infers DEEP_REASONING for evaluation, benchmark, tie-break, and comparison', () => {
    expect(resolveTaskClass(undefined, { area: 'Evaluation', feature: 'Ablation runner' })).toBe(
      'DEEP_REASONING',
    );
    expect(resolveTaskClass(undefined, { area: 'Benchmark suite' })).toBe('DEEP_REASONING');
    expect(resolveTaskClass(undefined, { feature: 'Phone comparison trade-offs' })).toBe(
      'DEEP_REASONING',
    );
    expect(resolveTaskClass(undefined, { feature: 'Candidate tie-break' })).toBe('DEEP_REASONING');
  });

  it('respects explicit TaskClass override regardless of context', () => {
    expect(resolveTaskClass('EXTRACTION', { area: 'Evaluation', feature: 'Ablation runner' })).toBe(
      'EXTRACTION',
    );
    expect(resolveTaskClass('DEEP_REASONING', { area: 'Catalog enrichment' })).toBe(
      'DEEP_REASONING',
    );
  });

  it('falls back safely to GROUNDED_SYNTHESIS when context is empty or undefined', () => {
    expect(resolveTaskClass(undefined, undefined)).toBe('GROUNDED_SYNTHESIS');
    expect(resolveTaskClass(undefined, {})).toBe('GROUNDED_SYNTHESIS');
  });
});

describe('analyzeComplexity - Edge Cases and False Positive Immunity', () => {
  it('assigns fast tier to simple spec extraction', () => {
    const analysis = analyzeComplexity({
      taskClass: 'EXTRACTION',
      messages: [{ role: 'user', content: 'Extract battery and screen size' }],
    });
    expect(analysis.resolvedTier).toBe('fast');
  });

  it('does NOT falsely match substring collisions like button, attribute, devs, canvas, distribution', () => {
    const analysis = analyzeComplexity({
      taskClass: 'EXTRACTION',
      messages: [
        {
          role: 'user',
          content:
            'This phone has a dedicated camera button, vivid display attributes, high distribution quality on canvas, and devs love it.',
        },
      ],
    });
    // None of "button" (contains but), "attribute" (contains but), "distribution" (contains but), "canvas" or "devs" should trigger conflict markers
    expect(analysis.triggers.filter((t) => t.startsWith('detected_'))).toHaveLength(0);
    expect(analysis.resolvedTier).toBe('fast');
  });

  it('correctly matches genuine word-boundary conflict markers with punctuation', () => {
    const analysis = analyzeComplexity({
      taskClass: 'GROUNDED_SYNTHESIS',
      messages: [
        {
          role: 'user',
          content:
            'iPhone 16 Pro vs. Pixel 9 Pro: prefer smaller size but need great zoom instead of average lens.',
        },
      ],
    });
    // Distinct markers: "vs", "prefer", "but", "instead of" -> 4 distinct markers
    expect(analysis.triggers).toContain('detected_4_conflict_markers');
    expect(analysis.resolvedTier).toBe('reasoning');
  });

  it('does not inflate count on repeated identical words (e.g. but... but... but...)', () => {
    const analysis = analyzeComplexity({
      taskClass: 'GROUNDED_SYNTHESIS',
      messages: [
        {
          role: 'user',
          content: 'I want a phone, but it is expensive, but maybe it works, but I am not sure.',
        },
      ],
    });
    // "but" is repeated 4 times, but it is only 1 distinct marker -> should not escalate
    expect(analysis.triggers.filter((t) => t.startsWith('detected_'))).toHaveLength(0);
    expect(analysis.resolvedTier).toBe('balanced');
  });

  it('handles userMode: "deep" and "fast" toggles correctly', () => {
    const deepAnalysis = analyzeComplexity({
      taskClass: 'GROUNDED_SYNTHESIS',
      messages: [{ role: 'user', content: 'How is the battery?' }],
      userMode: 'deep',
    });
    expect(deepAnalysis.resolvedTier).toBe('reasoning');
    expect(deepAnalysis.triggers).toContain('user_selected_deep_mode');

    const fastAnalysis = analyzeComplexity({
      taskClass: 'GROUNDED_SYNTHESIS',
      messages: [{ role: 'user', content: 'How is the battery?' }],
      userMode: 'fast',
    });
    expect(fastAnalysis.resolvedTier).toBe('fast');
    expect(fastAnalysis.triggers).toContain('user_selected_fast_mode');

    // Fast mode must not downgrade explicit system evaluations
    const evalAnalysis = analyzeComplexity({
      taskClass: 'DEEP_REASONING',
      messages: [{ role: 'user', content: 'Evaluate NDCG@10 metrics' }],
      userMode: 'fast',
    });
    expect(evalAnalysis.resolvedTier).toBe('reasoning');
  });

  it('handles empty messages array, undefined messages, and null content without throwing', () => {
    expect(() => analyzeComplexity({ taskClass: 'EXTRACTION', messages: [] })).not.toThrow();
    expect(() => analyzeComplexity({ taskClass: 'EXTRACTION', messages: undefined })).not.toThrow();

    const dirtyMessages: ChatMessage[] = [
      null as unknown as ChatMessage,
      { role: 'system', content: null as unknown as string },
      { role: 'user', content: undefined as unknown as string },
      { role: 'user', content: 'Valid query' },
    ];
    const analysis = analyzeComplexity({ taskClass: 'EXTRACTION', messages: dirtyMessages });
    expect(analysis.resolvedTier).toBe('fast');
  });

  it('handles multilingual inputs (Korean, Arabic, Hindi, Emojis, Code) seamlessly', () => {
    const multilingual: ChatMessage[] = [
      { role: 'user', content: '배터리 오래가고 카메라 좋은 폰 추천해줘 📱🔋' },
      { role: 'user', content: 'أريد هاتفاً ببطارية قوية وكاميرا ممتازة' },
      { role: 'user', content: 'मुझे 20000 के अंदर अच्छा कैमरा वाला फोन चाहिए' },
      { role: 'user', content: 'SELECT * FROM phones WHERE price < 30000' },
    ];

    for (const msg of multilingual) {
      const res = analyzeComplexity({
        taskClass: 'GROUNDED_SYNTHESIS',
        messages: [msg],
      });
      expect(['fast', 'balanced', 'reasoning']).toContain(res.resolvedTier);
    }
  });

  it('handles massive context (>50k characters) and marks requiresLargeContext', () => {
    const hugePrompt = 'x'.repeat(60_000);
    const analysis = analyzeComplexity({
      taskClass: 'GROUNDED_SYNTHESIS',
      messages: [{ role: 'user', content: hugePrompt }],
    });
    expect(analysis.requiresLargeContext).toBe(true);
    expect(analysis.triggers).toContain('context_exceeds_6k_tokens');
  });
});

describe('ModelRouter - Context Window, Circuit Breaker, Quota & Fallback', () => {
  it('filters out candidates whose context window is too small for the input prompt', () => {
    const keyPool = new KeyPoolRegistry();
    const breakers = new CircuitBreakerRegistry();
    const governor = new MultiProviderQuotaGovernor();
    const router = new ModelRouter(keyPool, breakers, governor);

    // 40,000 characters =~ 11,400 tokens
    // Cerebras in fast tier has 8,192 token limit, so it must be filtered out!
    const largePrompt = 'specs '.repeat(8_000); // 48,000 chars

    const resolution = router.resolveExecutionChain({
      explicitTaskClass: 'EXTRACTION',
      messages: [{ role: 'user', content: largePrompt }],
    });

    // Verify Cerebras was NOT selected because context exceeds 8,192
    const cerebrasCandidate = resolution.candidates.find((c) => c.providerId === 'cerebras');
    expect(cerebrasCandidate).toBeUndefined();

    // Verify viable candidates that can handle large context remain
    for (const candidate of resolution.candidates) {
      expect(candidate.contextWindow).toBeGreaterThan(11_000);
    }
  });

  it('filters out candidates when their circuit breaker is OPEN and falls back gracefully', () => {
    const keyPool = new KeyPoolRegistry();
    const breakers = new CircuitBreakerRegistry();
    const governor = new MultiProviderQuotaGovernor();
    const router = new ModelRouter(keyPool, breakers, governor);

    // Trip the circuit breaker for groq and cerebras
    const groqBreaker = breakers.getBreaker('groq');
    groqBreaker.recordFailure();
    groqBreaker.recordFailure();
    groqBreaker.recordFailure();
    expect(groqBreaker.canAttempt()).toBe(false);

    const cerebrasBreaker = breakers.getBreaker('cerebras');
    cerebrasBreaker.recordFailure();
    cerebrasBreaker.recordFailure();
    cerebrasBreaker.recordFailure();
    expect(cerebrasBreaker.canAttempt()).toBe(false);

    const resolution = router.resolveExecutionChain({
      explicitTaskClass: 'EXTRACTION',
      messages: [{ role: 'user', content: 'Extract specs' }],
    });

    // In fast tier, Groq and Cerebras are tripped, so it should fall back to Gemini
    expect(resolution.candidates.some((c) => c.providerId === 'groq')).toBe(false);
    expect(resolution.candidates.some((c) => c.providerId === 'cerebras')).toBe(false);
    expect(resolution.candidates.some((c) => c.providerId === 'gemini')).toBe(true);
  });

  it('filters out providers whose keys are completely depleted in QuotaGovernor', () => {
    const keyPool = new KeyPoolRegistry();
    const breakers = new CircuitBreakerRegistry();
    const governor = new MultiProviderQuotaGovernor();
    const router = new ModelRouter(keyPool, breakers, governor);

    // Mark groq keys depleted
    governor.markKeyDepleted('groq', 0);
    governor.markKeyDepleted('groq', 1);

    const resolution = router.resolveExecutionChain({
      explicitTier: 'fast',
      messages: [{ role: 'user', content: 'Quick task' }],
    });

    // Groq should be excluded from candidates due to depleted quota
    expect(resolution.candidates.some((c) => c.providerId === 'groq')).toBe(false);
  });

  it('returns baseline Gemini candidate when keyPool has zero configured keys', () => {
    // Mock empty key pool with no keys
    const emptyKeyPool = {
      hasKeys: () => false,
      getKeysForProvider: () => [],
      getAllConfiguredProviders: () => [],
    } as unknown as KeyPoolRegistry;

    const breakers = new CircuitBreakerRegistry();
    const governor = new MultiProviderQuotaGovernor();
    const router = new ModelRouter(emptyKeyPool, breakers, governor);

    const resolution = router.resolveExecutionChain({
      explicitTaskClass: 'EXTRACTION',
      messages: [{ role: 'user', content: 'Parse specs' }],
    });

    expect(resolution.candidates.length).toBeGreaterThan(0);
    expect(resolution.candidates[0]!.providerId).toBe('gemini');
  });

  it('ensures no duplicate candidates are returned in execution chain', () => {
    const keyPool = new KeyPoolRegistry();
    const breakers = new CircuitBreakerRegistry();
    const governor = new MultiProviderQuotaGovernor();
    const router = new ModelRouter(keyPool, breakers, governor);

    const resolution = router.resolveExecutionChain({
      explicitTaskClass: 'GROUNDED_SYNTHESIS',
      messages: [{ role: 'user', content: 'Compare phones' }],
    });

    const uniqueKeys = new Set(resolution.candidates.map((c) => `${c.providerId}:${c.model}`));
    expect(resolution.candidates.length).toBe(uniqueKeys.size);
  });

  describe('WP-13: Server-side Deep Reasoning Router Entitlement Gate', () => {
    it('downgrades non-entitled callers requesting deep mode and never routes to reasoning tier', () => {
      const keyPool = new KeyPoolRegistry();
      const breakers = new CircuitBreakerRegistry();
      const governor = new MultiProviderQuotaGovernor();
      const router = new ModelRouter(keyPool, breakers, governor);

      // Caller sends userMode: deep without BYOK key or subscriber status
      const resolution = router.resolveExecutionChain({
        explicitTaskClass: 'GROUNDED_SYNTHESIS',
        messages: [{ role: 'user', content: 'Explain phone battery' }],
        usageContext: {
          area: 'chat',
          userMode: 'deep',
          isSubscriber: false,
          userByokKey: undefined,
        },
      });

      // Must be downgraded
      expect(resolution.targetTier).not.toBe('reasoning');
      expect(resolution.targetTier).toBe('fast');
      // Must not contain deep-tier models
      const models = resolution.candidates.map((c) => c.model);
      expect(models).not.toContain('gemini-2.5-pro');
      expect(models).not.toContain('deepseek-ai/deepseek-r1');
    });

    it('allows Pro subscribers to reach reasoning tier when requesting deep mode', () => {
      const keyPool = new KeyPoolRegistry();
      const breakers = new CircuitBreakerRegistry();
      const governor = new MultiProviderQuotaGovernor();
      const router = new ModelRouter(keyPool, breakers, governor);

      const resolution = router.resolveExecutionChain({
        explicitTaskClass: 'GROUNDED_SYNTHESIS',
        messages: [{ role: 'user', content: 'Explain phone battery' }],
        usageContext: {
          area: 'chat',
          userMode: 'deep',
          isSubscriber: true,
        },
      });

      expect(resolution.targetTier).toBe('reasoning');
      const models = resolution.candidates.map((c) => c.model);
      expect(models).toContain('gemini-2.5-pro');
    });

    it('allows BYOK users to reach reasoning tier on their provider when requesting deep mode', () => {
      const keyPool = new KeyPoolRegistry();
      const breakers = new CircuitBreakerRegistry();
      const governor = new MultiProviderQuotaGovernor();
      const router = new ModelRouter(keyPool, breakers, governor);

      const resolution = router.resolveExecutionChain({
        explicitTaskClass: 'GROUNDED_SYNTHESIS',
        messages: [{ role: 'user', content: 'Explain phone battery' }],
        usageContext: {
          area: 'chat',
          userMode: 'deep',
          userByokKey: 'test-user-gemini-key',
          userByokProvider: 'gemini',
        },
      });

      expect(resolution.targetTier).toBe('reasoning');
      expect(resolution.candidates.length).toBeGreaterThan(0);
      expect(resolution.candidates[0]!.providerId).toBe('gemini');
      expect(resolution.candidates[0]!.model).toBe('gemini-2.5-pro');
    });
  });
});
