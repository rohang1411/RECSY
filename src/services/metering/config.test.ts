import { describe, expect, it } from 'vitest';
import { getMeteringConfig } from './config';

describe('getMeteringConfig', () => {
  it('returns a frozen MeteringConfig object', () => {
    const config = getMeteringConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.freeDailyQueries).toBeGreaterThanOrEqual(0);
    expect(config.anonDailyQueries).toBeGreaterThanOrEqual(0);
  });

  it('honors injected overrides and returns a frozen object', () => {
    const custom = getMeteringConfig({
      mode: 'enforce',
      freeDailyQueries: 5,
      anonDailyQueries: 0,
    });
    expect(custom.mode).toBe('enforce');
    expect(custom.freeDailyQueries).toBe(5);
    expect(custom.anonDailyQueries).toBe(0);
    expect(Object.isFrozen(custom)).toBe(true);
  });

  it('links LEASE_TTL_SECONDS to maxDuration (must exceed 60s by at least 10s)', () => {
    const config = getMeteringConfig();
    const routeMaxDuration = 60;
    expect(config.leaseTtlSeconds).toBeGreaterThanOrEqual(routeMaxDuration + 10);
  });
});
