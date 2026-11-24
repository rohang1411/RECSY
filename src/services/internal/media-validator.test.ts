import { describe, expect, it, vi } from 'vitest';
import {
  extractYouTubeVideoId,
  isValidYouTubeChannelId,
  isValidYouTubeVideoId,
  verifyYouTubeVideoOembed,
} from './media-validator';

describe('Media & YouTube Validator (WP-08)', () => {
  it('validates canonical YouTube 24-char UC channel IDs', () => {
    expect(isValidYouTubeChannelId('UCBJycsmduvYEL83R_U4JriQ')).toBe(true); // MKBHD
    expect(isValidYouTubeChannelId('UCXGgrKt94gR6lmN1gtJJ3Cw')).toBe(true);
    expect(isValidYouTubeChannelId('UC_too_short')).toBe(false);
    expect(isValidYouTubeChannelId('not-a-channel')).toBe(false);
    expect(isValidYouTubeChannelId('')).toBe(false);
  });

  it('validates 11-char YouTube video IDs', () => {
    expect(isValidYouTubeVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidYouTubeVideoId('12345678901')).toBe(true);
    expect(isValidYouTubeVideoId('tooShort')).toBe(false);
    expect(isValidYouTubeVideoId('wayTooLongVideoId12345')).toBe(false);
  });

  it('extracts video IDs from various URL formats', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://example.com/not-youtube')).toBeNull();
  });

  it('performs low-overhead HEAD check on oEmbed URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    const res = await verifyYouTubeVideoOembed('dQw4w9WgXcQ', mockFetch as unknown as typeof fetch);

    expect(res.status).toBe('verified');
    expect(res.httpStatus).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://www.youtube.com/oembed?url='),
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('handles 404 not found without throwing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 404 });
    const res = await verifyYouTubeVideoOembed('deletedV111', mockFetch as unknown as typeof fetch);

    expect(res.status).toBe('not_found');
    expect(res.httpStatus).toBe(404);
  });
});
