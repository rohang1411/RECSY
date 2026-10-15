import { describe, expect, it } from 'vitest';
import { MultiProviderQuotaGovernor } from './quota-governor';

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
});
