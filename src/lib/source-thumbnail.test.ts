import { describe, expect, it } from 'vitest';

import { getSourceThumbnail, getYouTubeVideoId } from './source-thumbnail';

describe('getYouTubeVideoId', () => {
  it('extracts standard, short, and embed YouTube IDs', () => {
    expect(getYouTubeVideoId('https://www.youtube.com/watch?v=abc123')).toBe('abc123');
    expect(getYouTubeVideoId('https://youtu.be/xyz789')).toBe('xyz789');
    expect(getYouTubeVideoId('https://www.youtube.com/embed/embed123')).toBe('embed123');
  });
});

describe('getSourceThumbnail', () => {
  it('returns a YouTube thumbnail when an ID is available', () => {
    expect(
      getSourceThumbnail({
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=abc123',
        title: 'Review',
      }),
    ).toEqual({
      kind: 'image',
      src: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      label: 'Review',
      detail: 'youtube.com',
    });
  });

  it('falls back to a structured tile for non-image sources', () => {
    expect(
      getSourceThumbnail({
        type: 'reddit',
        url: 'https://www.reddit.com/r/GooglePixel/comments/test',
        title: 'Thread',
        author: 'pixel_user',
      }),
    ).toEqual({ kind: 'tile', label: 'reddit', detail: 'pixel_user' });
  });

  it('returns a favicon thumbnail for article sources', () => {
    expect(
      getSourceThumbnail({
        type: 'article',
        url: 'https://www.cnet.com/tech/mobile/example-review/',
        title: 'Review',
      }),
    ).toEqual({
      kind: 'image',
      src: 'https://www.google.com/s2/favicons?domain=cnet.com&sz=128',
      label: 'Review',
      detail: 'cnet.com',
    });
  });
});
