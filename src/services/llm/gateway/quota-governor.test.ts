import { describe, expect, it } from 'vitest';
import {
  MultiProviderQuotaGovernor,
  resolvePriorityTierFromContext,
  BATCH_THROTTLE_REMAINING_QUOTA_RATIO,
} from './quota-governor';

describe('MultiProviderQuotaGovernor', () => {
  it('allows requests within RPM and RPD limits', async () => {
    const gov = new MultiProviderQuotaGovernor();
    gov.registerKey('groq', 0, { rpm: 10, tpm: 10000, rpd: 50 });

    const ok1 = await gov.acquire('groq', 0, 100);
    expect(ok1).toBe(true);

    const ok2 = await gov.acquire('groq', 0, 100);
    expect(ok2).toBe(true);
  });

  it('rejects acquisition when daily RPD limit is exceeded', async () => {
    const gov = new MultiProviderQuotaGovernor();
    gov.registerKey('groq', 0, { rpm: 10, tpm: 10000, rpd: 2 });

    const ok1 = await gov.acquire('groq', 0, 100);
    expect(ok1).toBe(true);
    const ok2 = await gov.acquire('groq', 0, 100);
    expect(ok2).toBe(true);

    const ok3 = await gov.acquire('groq', 0, 100);
    expect(ok3).toBe(false);
  });

  it('marks key as depleted when markKeyDepleted is called', async () => {
    const gov = new MultiProviderQuotaGovernor();
    gov.registerKey('gemini', 0, { rpm: 10, tpm: 10000, rpd: 100 });

    expect(gov.isKeyDepleted('gemini', 0)).toBe(false);
    gov.markKeyDepleted('gemini', 0);
    expect(gov.isKeyDepleted('gemini', 0)).toBe(true);

    const ok = await gov.acquire('gemini', 0, 100);
    expect(ok).toBe(false);
  });

  it('allows unthrottled access to unregistered keys', async () => {
    const gov = new MultiProviderQuotaGovernor();
    const ok = await gov.acquire('unregistered-provider', 0, 1000);
    expect(ok).toBe(true);
  });

  describe('Priority Tiers & Dynamic Batch Throttling (WP-11)', () => {
    it('throttles Tier 3 (Batch) when remaining quota drops below 15% while preserving Tier 1 (Interactive)', async () => {
      expect(BATCH_THROTTLE_REMAINING_QUOTA_RATIO).toBe(0.15);
      const gov = new MultiProviderQuotaGovernor();
      // Total RPD: 10 requests. 15% threshold is 1.5 requests remaining (i.e. <= 1 request remaining)
      gov.registerKey('gemini', 0, { rpm: 60, tpm: 100000, rpd: 10 });

      // Consume 8 requests (20% remaining >= 15%)
      for (let i = 0; i < 8; i++) {
        const ok = await gov.acquire('gemini', 0, 100, 1);
        expect(ok).toBe(true);
      }

      expect(gov.getRemainingDailyQuotaRatio('gemini', 0)).toBeCloseTo(0.2, 2);
      expect(gov.isBatchThrottled('gemini', 0)).toBe(false);

      // Now consume the 9th request -> only 1 request remaining (10% < 15%)
      const req9 = await gov.acquire('gemini', 0, 100, 1);
      expect(req9).toBe(true);

      expect(gov.getRemainingDailyQuotaRatio('gemini', 0)).toBeCloseTo(0.1, 2);
      expect(gov.isBatchThrottled('gemini', 0)).toBe(true);

      // Tier 3 (Batch crawler / bulk aspect score) must now be throttled
      const batchAcquire = await gov.acquire('gemini', 0, 100, 'batch');
      expect(batchAcquire).toBe(false);

      // Tier 1 (Interactive user recommendation) must still succeed using the reserved buffer
      const interactiveAcquire = await gov.acquire('gemini', 0, 100, 'interactive');
      expect(interactiveAcquire).toBe(true);

      // Now 100% of RPD (10/10) is exhausted; even Tier 1 is depleted
      const finalAcquire = await gov.acquire('gemini', 0, 100, 1);
      expect(finalAcquire).toBe(false);
    });

    it('reports accurate tier status and stats snapshot', async () => {
      const gov = new MultiProviderQuotaGovernor();
      gov.registerKey('groq', 0, { rpm: 30, tpm: 10000, rpd: 20 });

      const status = gov.getTierStatus('groq', 0);
      expect(status.tier1Available).toBe(true);
      expect(status.tier2Available).toBe(true);
      expect(status.tier3Available).toBe(true);
      expect(status.remainingRatio).toBe(1.0);

      const snapshot = gov.getSnapshot();
      expect(snapshot['groq:0']).toBeDefined();
    });

    it('resolves priority tier correctly from LlmUsageContext', () => {
      // Direct explicit priorityTier
      expect(resolvePriorityTierFromContext({ area: 'any', priorityTier: 3 })).toBe(3);
      expect(resolvePriorityTierFromContext({ area: 'any', priorityTier: 'batch' })).toBe(3);

      // Interactive user contexts (Tier 1)
      expect(
        resolvePriorityTierFromContext({ area: 'Recommendation', source: '/api/recommend' }),
      ).toBe(1);
      expect(resolvePriorityTierFromContext({ area: 'Phone Q&A', source: '/api/ask' })).toBe(1);
      expect(resolvePriorityTierFromContext({ area: 'chat' })).toBe(1);

      // Admin & extraction contexts (Tier 2)
      expect(resolvePriorityTierFromContext({ area: 'Catalog', feature: 'Spec extraction' })).toBe(
        2,
      );
      expect(resolvePriorityTierFromContext({ area: 'admin', source: 'admin-refresh' })).toBe(2);

      // Batch ingestion contexts (Tier 3)
      expect(resolvePriorityTierFromContext({ area: 'ingest', source: 'cron-sync' })).toBe(3);
      expect(resolvePriorityTierFromContext({ area: 'crawler', source: 'batch' })).toBe(3);
    });
  });
});
