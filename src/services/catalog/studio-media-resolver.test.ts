import { describe, expect, it } from 'vitest';
import {
  generateCandidateGsmFilenames,
  KNOWN_STUDIO_IMAGES,
  resolveStudioImageCandidate,
} from './studio-media-resolver';

describe('studio-media-resolver', () => {
  it('has curated studio images for key catalog flagships', () => {
    expect(KNOWN_STUDIO_IMAGES['apple-iphone-16-pro-max']).toBeDefined();
    expect(KNOWN_STUDIO_IMAGES['apple-iphone-16-pro']).toBeDefined();
    expect(KNOWN_STUDIO_IMAGES['samsung-galaxy-s25-ultra']).toBeDefined();
    expect(KNOWN_STUDIO_IMAGES['google-pixel-9-pro-xl']).toBeDefined();
    expect(KNOWN_STUDIO_IMAGES['oneplus-13']).toBeDefined();
  });

  it('generates normalized candidate filenames for GSMArena matching', () => {
    const candidates = generateCandidateGsmFilenames(
      'Samsung',
      'Galaxy S25 Ultra',
      'samsung-galaxy-s25-ultra',
    );
    expect(candidates).toContain('samsung-galaxy-s25-ultra');
    expect(candidates).toContain('galaxy-s25-ultra');
  });

  it('resolves curated candidates synchronously without network overhead', async () => {
    const candidate = await resolveStudioImageCandidate({
      brand: 'Apple',
      model: 'iPhone 16 Pro',
      slug: 'apple-iphone-16-pro',
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.sourceKey).toBe('gsmarena_studio_curated');
    expect(candidate?.imageUrl).toContain('apple-iphone-16-pro.jpg');
  });

  it('generates special brand variants for Google Pixels', () => {
    const candidates = generateCandidateGsmFilenames('Google', 'Pixel 9', 'google-pixel-9');
    expect(candidates).toContain('google-pixel-9-');
  });
});
