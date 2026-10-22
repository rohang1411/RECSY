// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { savePendingIntent, readPendingIntent, clearPendingIntent } from './pending-intent';

describe('WP-15: pending-intent preservation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('saves and reads pending intent within TTL', () => {
    savePendingIntent({ text: 'Pixel 9 under 700', route: '/recommend' });
    const read = readPendingIntent();
    expect(read).not.toBeNull();
    expect(read?.text).toBe('Pixel 9 under 700');
    expect(read?.route).toBe('/recommend');
  });

  it('clears pending intent', () => {
    savePendingIntent({ text: 'test query', route: '/recommend' });
    clearPendingIntent();
    expect(readPendingIntent()).toBeNull();
  });

  it('discards expired pending intent', () => {
    savePendingIntent({ text: 'old query', route: '/recommend' });
    // Mutate savedAt to 35 minutes ago
    const raw = sessionStorage.getItem('recsy:pending-intent');
    const parsed = JSON.parse(raw!);
    parsed.savedAt = Date.now() - 35 * 60 * 1000;
    sessionStorage.setItem('recsy:pending-intent', JSON.stringify(parsed));

    expect(readPendingIntent()).toBeNull();
  });
});
