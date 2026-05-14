import { describe, expect, it } from 'vitest';

import { parseCaptionText } from './youtube-external-transcripts';

describe('parseCaptionText', () => {
  it('parses WebVTT cues into timed segments', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.500 align:start',
      '<c>Hello</c> &amp; welcome',
      '',
      '2',
      '00:00:04.000 --> 00:00:05.000',
      'Pixel 9 Pro XL review',
    ].join('\n');

    expect(parseCaptionText(vtt, '.vtt')).toEqual([
      { text: 'Hello & welcome', startMs: 1_000, endMs: 3_500 },
      { text: 'Pixel 9 Pro XL review', startMs: 4_000, endMs: 5_000 },
    ]);
  });

  it('parses SRT cues with comma timestamps', () => {
    const srt = [
      '1',
      '00:00:02,500 --> 00:00:04,000',
      'Battery life is strong.',
      '',
      '2',
      '00:00:05,000 --> 00:00:06,250',
      'Camera processing improved.',
    ].join('\n');

    expect(parseCaptionText(srt, '.srt')).toEqual([
      { text: 'Battery life is strong.', startMs: 2_500, endMs: 4_000 },
      { text: 'Camera processing improved.', startMs: 5_000, endMs: 6_250 },
    ]);
  });

  it('parses srv3 XML captions', () => {
    const srv3 = [
      '<transcript>',
      '<text start="1.2" dur="2.3">Hello &amp; welcome</text>',
      '<text start="4" dur="1">Pixel &lt;b&gt;camera&lt;/b&gt;</text>',
      '</transcript>',
    ].join('');

    expect(parseCaptionText(srv3, '.srv3')).toEqual([
      { text: 'Hello & welcome', startMs: 1_200, endMs: 3_500 },
      { text: 'Pixel camera', startMs: 4_000, endMs: 5_000 },
    ]);
  });
});
