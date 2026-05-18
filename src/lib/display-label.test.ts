import { describe, expect, it } from 'vitest';

import { humanizeKeyLabel } from './display-label';

describe('humanizeKeyLabel', () => {
  it('maps known schema-like labels to user-facing labels', () => {
    expect(humanizeKeyLabel('battery_mah')).toBe('Battery');
    expect(humanizeKeyLabel('rear_cameras')).toBe('Rear cameras');
    expect(humanizeKeyLabel('refresh_rate_hz')).toBe('Refresh rate');
  });

  it('preserves important unit casing', () => {
    expect(humanizeKeyLabel('min_price_usd')).toBe('Minimum price USD');
    expect(humanizeKeyLabel('ram_gb')).toBe('RAM GB');
    expect(humanizeKeyLabel('main_camera_mp')).toBe('Main camera MP');
  });

  it('humanizes generic underscores and hyphens', () => {
    expect(humanizeKeyLabel('source_diversity')).toBe('Source diversity');
    expect(humanizeKeyLabel('retrieval-state')).toBe('Retrieval state');
  });
});
