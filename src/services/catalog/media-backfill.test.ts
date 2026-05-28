/**
 * Tests for conservative phone media backfill selection.
 */
import { describe, expect, it } from 'vitest';

import {
  mediaCandidateMatchReason,
  needsPhoneMediaBackfill,
  selectPhoneMediaCandidate,
} from './media-backfill';

const PHONE = {
  brand: 'Samsung',
  model: 'Galaxy S25 Ultra',
  imageUrl: null,
  mediaStatus: 'missing' as const,
};

describe('catalog media backfill helpers', () => {
  it('selects an exact brand and model image candidate', () => {
    const selected = selectPhoneMediaCandidate(PHONE, [
      {
        sourceKey: 'wikidata',
        externalId: 'Q1',
        brand: 'Samsung',
        model: 'Samsung Galaxy S25 Ultra',
        title: 'Samsung Galaxy S25 Ultra',
        imageUrl: 'https://upload.wikimedia.org/example/s25-ultra.jpg',
      },
    ]);

    expect(selected).toMatchObject({
      imageUrl: 'https://upload.wikimedia.org/example/s25-ultra.jpg',
      sourceKey: 'wikidata',
      matchReason: 'brand_and_exact_model',
    });
  });

  it('rejects loose model matches that could confuse sibling phones', () => {
    expect(
      mediaCandidateMatchReason(PHONE, {
        sourceKey: 'wikidata',
        brand: 'Samsung',
        model: 'Samsung Galaxy S25',
        title: 'Samsung Galaxy S25',
        imageUrl: 'https://upload.wikimedia.org/example/s25.jpg',
      }),
    ).toBeNull();
  });

  it('detects phones that should be checked by the scheduled media backfill', () => {
    expect(needsPhoneMediaBackfill(PHONE)).toBe(true);
    expect(
      needsPhoneMediaBackfill({
        brand: 'Google',
        model: 'Pixel 9 Pro',
        imageUrl: 'https://upload.wikimedia.org/example/pixel.jpg',
        mediaStatus: 'remote_only',
      }),
    ).toBe(false);
  });
});
