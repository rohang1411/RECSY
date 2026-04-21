/**
 * Unit tests for the YouTube transcript fallback helpers.
 *
 * Network-dependent helpers (`fetchTimedTextSegments`,
 * `fetchCaptionTracksFromWatchPage`) are NOT exercised here — they're thin
 * wrappers around `fetch()`. We cover the pure pieces:
 *   - JSON3 parsing into segments.
 *   - Track-picking precedence.
 *   - Bracket-balanced extraction from watch-page HTML.
 *   - Normalisation of heterogeneous track shapes.
 */
import { describe, expect, it } from 'vitest';

import {
  extractCaptionTracksArray,
  normaliseRawTrack,
  parseJson3Transcript,
  pickBestEnglishTrack,
  rankCaptionTracks,
  type CaptionTrack,
} from './youtube-transcript';

describe('parseJson3Transcript', () => {
  it('returns [] for empty / malformed input', () => {
    expect(parseJson3Transcript(null)).toEqual([]);
    expect(parseJson3Transcript(undefined)).toEqual([]);
    expect(parseJson3Transcript({})).toEqual([]);
    expect(parseJson3Transcript({ events: [] })).toEqual([]);
  });

  it('parses a typical json3 payload and computes endMs', () => {
    const json = {
      events: [
        { tStartMs: 0, dDurationMs: 1_500, segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
        { tStartMs: 1_500, dDurationMs: 2_000, segs: [{ utf8: 'again' }] },
      ],
    };
    const segs = parseJson3Transcript(json);
    expect(segs).toEqual([
      { text: 'Hello world', startMs: 0, endMs: 1_500 },
      { text: 'again', startMs: 1_500, endMs: 3_500 },
    ]);
  });

  it('skips events with no segs or no text', () => {
    const json = {
      events: [
        { tStartMs: 0, dDurationMs: 500 }, // no segs
        { tStartMs: 500, dDurationMs: 500, segs: [{ utf8: '   ' }] }, // whitespace-only
        { tStartMs: 1_000, dDurationMs: 500, segs: [{ utf8: 'ok' }] },
      ],
    };
    expect(parseJson3Transcript(json).map((s) => s.text)).toEqual(['ok']);
  });

  it('collapses embedded newlines into single spaces', () => {
    const json = {
      events: [{ tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: 'line one\nline two' }] }],
    };
    expect(parseJson3Transcript(json)[0]?.text).toBe('line one line two');
  });
});

describe('pickBestEnglishTrack', () => {
  const track = (overrides: Partial<CaptionTrack>): CaptionTrack => ({
    baseUrl: 'https://example/t',
    languageCode: 'en',
    kind: null,
    name: null,
    ...overrides,
  });

  it('returns null for empty input', () => {
    expect(pickBestEnglishTrack([])).toBeNull();
  });

  it('prefers manual English over ASR', () => {
    const tracks = [track({ languageCode: 'en', kind: 'asr' }), track({ languageCode: 'en' })];
    expect(pickBestEnglishTrack(tracks)).toBe(tracks[1]);
  });

  it('falls back to ASR English when no manual English exists', () => {
    const tracks = [track({ languageCode: 'es' }), track({ languageCode: 'en-GB', kind: 'asr' })];
    expect(pickBestEnglishTrack(tracks)).toBe(tracks[1]);
  });

  it('falls back to any English variant', () => {
    const tracks = [track({ languageCode: 'fr' }), track({ languageCode: 'en-CA' })];
    expect(pickBestEnglishTrack(tracks)).toBe(tracks[1]);
  });

  it('falls back to the first track when no English track exists', () => {
    const tracks = [track({ languageCode: 'fr' }), track({ languageCode: 'de' })];
    expect(pickBestEnglishTrack(tracks)).toBe(tracks[0]);
  });
});

describe('rankCaptionTracks', () => {
  const track = (overrides: Partial<CaptionTrack>): CaptionTrack => ({
    baseUrl: `https://example/${Math.random()}`,
    languageCode: 'en',
    kind: null,
    name: null,
    ...overrides,
  });

  it('returns [] for empty input', () => {
    expect(rankCaptionTracks([])).toEqual([]);
  });

  it('orders manual English before ASR, both before other languages', () => {
    const asr = track({ languageCode: 'en', kind: 'asr' });
    const manual = track({ languageCode: 'en' });
    const es = track({ languageCode: 'es' });
    const ranked = rankCaptionTracks([es, asr, manual]);
    expect(ranked).toEqual([manual, asr, es]);
  });

  it('deduplicates tracks by baseUrl so each appears exactly once', () => {
    const manual = track({ languageCode: 'en', baseUrl: 'https://x/1' });
    const ranked = rankCaptionTracks([manual, manual]);
    expect(ranked).toHaveLength(1);
  });

  it('includes non-English tracks as a last-resort bucket', () => {
    const es = track({ languageCode: 'es' });
    const ranked = rankCaptionTracks([es]);
    expect(ranked).toEqual([es]);
  });
});

describe('extractCaptionTracksArray', () => {
  it('extracts a balanced captionTracks JSON array', () => {
    const html = [
      '<html><script>',
      'var ytInitialPlayerResponse = {',
      '  "captions": {',
      '    "playerCaptionsTracklistRenderer": {',
      '      "captionTracks":[',
      '        {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc","languageCode":"en","kind":"asr"},',
      '        {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=es","languageCode":"es"}',
      '      ]',
      '    }',
      '  }',
      '};',
      '</script></html>',
    ].join('\n');
    const arr = extractCaptionTracksArray(html);
    expect(arr).not.toBeNull();
    const parsed = JSON.parse(arr!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].languageCode).toBe('en');
  });

  it('returns null when no captionTracks marker is present', () => {
    expect(extractCaptionTracksArray('<html>no captions here</html>')).toBeNull();
  });

  it('handles brackets embedded inside string values', () => {
    // The inner "]" inside a string must not terminate the array scan.
    const html = '"captionTracks":[{"name":"a]b","baseUrl":"https://x/t"}]';
    const arr = extractCaptionTracksArray(html);
    expect(arr).not.toBeNull();
    const parsed = JSON.parse(arr!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('a]b');
  });
});

describe('normaliseRawTrack', () => {
  it('normalises the watch-page JSON shape', () => {
    const t = normaliseRawTrack({
      baseUrl: 'https://www.youtube.com/api/timedtext?v=abc',
      languageCode: 'en-US',
      kind: 'asr',
      name: { simpleText: 'English (auto)' },
    });
    expect(t).toEqual({
      baseUrl: 'https://www.youtube.com/api/timedtext?v=abc',
      languageCode: 'en-US',
      kind: 'asr',
      name: 'English (auto)',
    });
  });

  it('normalises the `youtubei.js` snake_case shape', () => {
    const t = normaliseRawTrack({
      base_url: 'https://t/',
      language_code: 'en',
      kind: null,
      name: { runs: [{ text: 'English' }] },
    });
    expect(t?.baseUrl).toBe('https://t/');
    expect(t?.name).toBe('English');
    expect(t?.languageCode).toBe('en');
  });

  it('returns null when baseUrl is missing', () => {
    expect(normaliseRawTrack({ languageCode: 'en' })).toBeNull();
    expect(normaliseRawTrack(null)).toBeNull();
    expect(normaliseRawTrack(undefined)).toBeNull();
  });
});
