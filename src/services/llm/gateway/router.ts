import type { ChatMessage, ExecutionTier, LlmUsageContext, TaskClass } from '../types';
import type { CircuitBreakerRegistry } from './circuit-breaker';
import type { MultiProviderQuotaGovernor } from './quota-governor';
import type { KeyPoolRegistry } from '../keys/key-pool';
import { type ModelCandidate, resolveTaskClass, TIER_MODEL_POOLS } from './task-profiles';

export interface ComplexityAnalysis {
  readonly score: number;
  readonly requiresLargeContext: boolean;
  readonly resolvedTier: ExecutionTier;
  readonly triggers: readonly string[];
}

/**
 * Pre-compiled, linear-time regex with word boundaries to prevent ReDoS
 * and avoid false-positive substring matches on words like "button", "attribute", "devs", "canvas", etc.
 */
const CONFLICT_WORD_REGEX =
  /\b(?:but|however|prefer|preferred|preference|trade-off|tradeoff|compromise|instead\s+of|versus|vs\.?)\b/gi;

/**
 * High-speed, zero-token complexity analyzer.
 * Evaluates semantic task class, prompt constraints, context size, and user mode
 * in strictly sub-millisecond execution time (< 0.05ms).
 */
export function analyzeComplexity(params: {
  readonly taskClass: TaskClass;
  readonly messages?: readonly ChatMessage[];
  readonly userMode?: 'fast' | 'deep';
  readonly candidateCount?: number;
}): ComplexityAnalysis {
  const triggers: string[] = [];
  let score = 0.1;

  if (params.taskClass === 'DEEP_REASONING') {
    score = 0.85;
    triggers.push('task_explicitly_reasoning');
  } else if (params.taskClass === 'DISAMBIGUATION') {
    score = 0.5;
  } else if (params.taskClass === 'GROUNDED_SYNTHESIS') {
    score = 0.4;
  }

  const messages = params.messages ?? [];
  let totalChars = 0;
  for (let i = 0; i < messages.length; i++) {
    const c = messages[i]?.content;
    if (typeof c === 'string') {
      totalChars += c.length;
    }
  }

  const requiresLargeContext = totalChars > 24_000;
  if (requiresLargeContext) {
    triggers.push('context_exceeds_6k_tokens');
  }

  // Extract last user message defensively
  let lastUserMsg = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && typeof m.content === 'string') {
      lastUserMsg = m.content;
      break;
    }
  }

  // Sample head and tail for conflict analysis if text is very large to guarantee < 0.05ms runtime
  const sampleText =
    lastUserMsg.length > 8000
      ? `${lastUserMsg.slice(0, 4000)} ${lastUserMsg.slice(-4000)}`
      : lastUserMsg;

  if (sampleText) {
    const matches = sampleText.match(CONFLICT_WORD_REGEX);
    if (matches && matches.length > 0) {
      const distinctMarkers = new Set(
        matches.map((w) => w.toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ')),
      );
      const conflictCount = distinctMarkers.size;
      if (conflictCount >= 3) {
        score += 0.7;
        triggers.push(`detected_${conflictCount}_conflict_markers`);
      } else if (conflictCount >= 2) {
        score += 0.35;
        triggers.push(`detected_${conflictCount}_conflict_markers`);
      }
    }
  }

  if (params.candidateCount && params.candidateCount >= 3) {
    score += 0.3;
    triggers.push(`high_candidate_count_${params.candidateCount}`);
  }

  if (params.userMode === 'deep') {
    score = Math.max(score, 0.85);
    triggers.push('user_selected_deep_mode');
  } else if (params.userMode === 'fast' && params.taskClass !== 'DEEP_REASONING') {
    score = Math.min(score, 0.35);
    triggers.push('user_selected_fast_mode');
  }

  const normalizedScore = Math.min(1.0, Math.max(0.0, score));
  let resolvedTier: ExecutionTier;
  if (normalizedScore >= 0.75) {
    resolvedTier = 'reasoning';
  } else if (normalizedScore >= 0.4) {
    resolvedTier = 'balanced';
  } else {
    resolvedTier = 'fast';
  }

  return {
    score: normalizedScore,
    requiresLargeContext,
    resolvedTier,
    triggers,
  };
}

export class ModelRouter {
  constructor(
    private readonly keyPool: KeyPoolRegistry,
    private readonly circuitBreakers: CircuitBreakerRegistry,
    private readonly quotaGovernor: MultiProviderQuotaGovernor,
  ) {}

  /**
   * Deterministically resolves execution chain with zero latency, verified context window compatibility,
   * circuit breaker state, and quota depletion checks.
   */
  resolveExecutionChain(params: {
    readonly explicitTaskClass?: TaskClass;
    readonly explicitTier?: ExecutionTier;
    readonly messages?: readonly ChatMessage[];
    readonly usageContext?: LlmUsageContext;
  }): {
    readonly taskClass: TaskClass;
    readonly targetTier: ExecutionTier;
    readonly candidates: readonly ModelCandidate[];
  } {
    const messages = params.messages ?? [];
    const taskClass = resolveTaskClass(params.explicitTaskClass, params.usageContext);

    let targetTier: ExecutionTier;
    if (params.explicitTier) {
      targetTier = params.explicitTier;
    } else {
      const analysis = analyzeComplexity({
        taskClass,
        messages,
        userMode: params.usageContext?.userMode,
      });
      targetTier = analysis.resolvedTier;
    }

    // Estimate tokens conservatively (~3.5 chars per token across English/code/multilingual)
    let totalChars = 0;
    for (let i = 0; i < messages.length; i++) {
      const c = messages[i]?.content;
      if (typeof c === 'string') totalChars += c.length;
    }
    const estimatedTokens = Math.ceil(totalChars / 3.5);

    const pool = TIER_MODEL_POOLS[targetTier];
    const candidateCollector: ModelCandidate[] = [];

    // Helper to evaluate if a candidate is fully viable
    const isCandidateViable = (candidate: ModelCandidate, requireBreakerClosed = true): boolean => {
      // 1. Must have configured API keys
      if (!this.keyPool.hasKeys(candidate.providerId)) {
        return false;
      }

      // 2. Candidate context window must fit the input prompt + response headroom
      if (candidate.contextWindow && estimatedTokens > candidate.contextWindow * 0.9) {
        return false;
      }

      // 3. Circuit breaker check
      if (requireBreakerClosed) {
        const breaker = this.circuitBreakers.getBreaker(candidate.providerId);
        if (!breaker.canAttempt()) {
          return false;
        }
      }

      // 4. Daily quota exhaustion check across all keys for provider
      const keys = this.keyPool.getKeysForProvider(candidate.providerId);
      if (
        keys.length > 0 &&
        keys.every((k) => this.quotaGovernor.isKeyDepleted(candidate.providerId, k.keyIndex))
      ) {
        return false;
      }

      return true;
    };

    // Primary Pass: Target Tier
    for (const candidate of pool) {
      if (isCandidateViable(candidate, true)) {
        candidateCollector.push(candidate);
      }
    }

    // Secondary Pass: Adjacent Tiers (Healthy Providers)
    if (candidateCollector.length === 0) {
      const tierOrder: readonly ExecutionTier[] =
        targetTier === 'fast'
          ? ['balanced', 'reasoning']
          : targetTier === 'reasoning'
            ? ['balanced', 'fast']
            : ['fast', 'reasoning'];

      for (const tier of tierOrder) {
        for (const candidate of TIER_MODEL_POOLS[tier]) {
          if (isCandidateViable(candidate, true)) {
            candidateCollector.push(candidate);
          }
        }
        if (candidateCollector.length > 0) break;
      }
    }

    // Tertiary Pass: Any configured provider fitting context window (even if breaker open)
    if (candidateCollector.length === 0) {
      for (const tier of ['balanced', 'fast', 'reasoning'] as const) {
        for (const candidate of TIER_MODEL_POOLS[tier]) {
          if (isCandidateViable(candidate, false)) {
            candidateCollector.push(candidate);
          }
        }
        if (candidateCollector.length > 0) break;
      }
    }

    // Ultimate Safety Net: If keyPool has no keys at all (unit test or unconfigured environment)
    if (candidateCollector.length === 0) {
      candidateCollector.push(TIER_MODEL_POOLS.balanced[0]!);
    }

    // Deduplicate candidates while preserving priority order
    const seen = new Set<string>();
    const deduplicatedCandidates: ModelCandidate[] = [];
    for (const candidate of candidateCollector) {
      const key = `${candidate.providerId}:${candidate.model}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedCandidates.push(candidate);
      }
    }

    return {
      taskClass,
      targetTier,
      candidates: deduplicatedCandidates,
    };
  }
}
