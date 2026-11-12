import { describe, expect, it } from 'vitest';
import { formatCountdown, formatLocalTime } from './clock-store';

describe('WP-15: clock-store formatting', () => {
  it('formats countdown HH:MM:SS accurately', () => {
    const baseNow = 1700000000000;
    // 2 hours, 15 minutes, 30 seconds ahead
    const targetMs = baseNow + (2 * 3600 + 15 * 60 + 30) * 1000;
    const targetIso = new Date(targetMs).toISOString();

    const formatted = formatCountdown(targetIso, baseNow);
    expect(formatted).toBe('02:15:30');
  });

  it('clamps countdown to 00:00:00 if target is in the past', () => {
    const baseNow = 1700000000000;
    const pastIso = new Date(baseNow - 5000).toISOString();

    const formatted = formatCountdown(pastIso, baseNow);
    expect(formatted).toBe('00:00:00');
  });

  it('formats local time string', () => {
    const iso = '2026-10-22T00:00:00.000Z';
    const local = formatLocalTime(iso);
    expect(local).toBeTruthy();
    expect(typeof local).toBe('string');
  });
});
