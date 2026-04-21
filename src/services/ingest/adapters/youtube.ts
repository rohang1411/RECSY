/**
 * YouTube adapter — transcript-first ingestion.
 *
 * Discovery uses YouTube's public search via `youtubei.js` (an unofficial,
 * community-maintained reverse of Innertube). We do NOT need a Google API
 * key for this — Innertube is what the YouTube web client uses.
 *
 * Fetch:
 *   - getInfo(videoId) → metadata (title, channel, published_at, view_count)
 *   - getTranscript() → time-stamped segments (auto- or human-captioned)
 *
 * Chunking is timestamp-aware: each chunk preserves the `start_ts` of its
 * first segment, enabling deep-link citations via `?t=<seconds>`.
 *
 * Failures are normal — videos may have transcripts disabled, may be
 * geo-blocked, or may be live. We surface those as `NotFoundError` so the
 * orchestrator skips them.
 */
import { Innertube } from 'youtubei.js';

import { IntegrationError, NotFoundError } from '@/lib/errors';
import { logger } from '@/services/logger';

import { countTokens } from '../chunking';
import { hashContent } from '../hashing';
import type {
  DiscoverOpts,
  PhoneRef,
  RawChunk,
  RawSource,
  SourceAdapter,
  SourceCandidate,
} from '../types';

const TARGET_TOKENS_PER_CHUNK = 400;
const OVERLAP_TOKENS = 60;
const DEFAULT_DISCOVERY_QUERIES = (phone: PhoneRef): string[] => [
  `${phone.brand} ${phone.model} review`,
  `${phone.brand} ${phone.model} camera test`,
  `${phone.brand} ${phone.model} long term review`,
];

interface CachedYt {
  client: Innertube | null;
  promise: Promise<Innertube> | null;
}

const ytCache: CachedYt = { client: null, promise: null };

async function getYt(): Promise<Innertube> {
  if (ytCache.client) return ytCache.client;
  if (!ytCache.promise) {
    ytCache.promise = Innertube.create({ retrieve_player: false }).then((c) => {
      ytCache.client = c;
      return c;
    });
  }
  return ytCache.promise;
}

export class YouTubeAdapter implements SourceAdapter {
  readonly type = 'youtube' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.youtube' });

  async discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]> {
    const yt = await getYt();
    const queries = opts.hint ? [opts.hint] : DEFAULT_DISCOVERY_QUERIES(phone);
    const seen = new Set<string>();
    const out: SourceCandidate[] = [];

    for (const q of queries) {
      if (out.length >= opts.limit) break;
      try {
        const search = await yt.search(q, { type: 'video' });
        const results = (search.results ?? []) as unknown[];
        for (const item of results) {
          if (out.length >= opts.limit) break;
          const c = toCandidate(item);
          if (!c) continue;
          if (seen.has(c.url)) continue;
          seen.add(c.url);
          out.push(c);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log.warn({ query: q, err: message }, 'youtube search failed; continuing');
      }
    }

    return out;
  }

  async fetch(candidate: SourceCandidate): Promise<RawSource> {
    const videoId = parseVideoId(candidate.url);
    if (!videoId) {
      throw new IntegrationError('not a YouTube video URL', { url: candidate.url });
    }
    const yt = await getYt();

    let info;
    try {
      info = await yt.getInfo(videoId);
    } catch (err) {
      throw new IntegrationError('youtube getInfo failed', { videoId }, err);
    }

    const segments = await this.getTranscriptSegments(info, videoId);
    if (segments.length === 0) {
      throw new NotFoundError('no transcript available', { videoId });
    }

    const body = segments.map((s) => s.text).join(' ');
    const contentHash = hashContent(body);
    // `youtubei.js` types omit a few fields that the actual payload exposes,
    // so we read optional ones through an escape-hatch cast.
    const basicInfo = info.basic_info ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const publishDate = (basicInfo as any).publish_date as string | undefined;

    return {
      candidate: {
        ...candidate,
        title: candidate.title || basicInfo.title || `YouTube video ${videoId}`,
        channel: candidate.channel ?? basicInfo.channel?.name ?? null,
        author: candidate.author ?? basicInfo.author ?? null,
        publishedAt:
          candidate.publishedAt ??
          (typeof publishDate === 'string' ? new Date(publishDate).toISOString() : null),
      },
      body,
      contentHash,
      raw: {
        videoId,
        durationSec: basicInfo.duration ?? null,
        viewCount: basicInfo.view_count ?? null,
        channelId: basicInfo.channel?.id ?? null,
        segmentCount: segments.length,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getTranscriptSegments(info: any, videoId: string): Promise<TranscriptSegment[]> {
    let transcriptInfo;
    try {
      transcriptInfo = await info.getTranscript();
    } catch (err) {
      this.log.debug(
        { videoId, err: err instanceof Error ? err.message : err },
        'getTranscript failed',
      );
      return [];
    }
    const initial =
      transcriptInfo?.transcript?.content?.body?.initial_segments ??
      transcriptInfo?.transcript?.content?.initial_segments ??
      [];
    return (initial as unknown[])
      .map((seg) => normaliseSegment(seg))
      .filter((s): s is TranscriptSegment => s !== null);
  }

  chunk(raw: RawSource): RawChunk[] {
    const segments = (raw.raw['segments'] as TranscriptSegment[] | undefined) ?? [];
    if (segments.length > 0) {
      return chunkTimedSegments(segments);
    }
    // Fallback (segments not persisted in raw): chunk by chars only.
    return [
      {
        chunkIndex: 0,
        text: raw.body,
        tokens: countTokens(raw.body),
        anchor: '?t=0',
        startTs: 0,
      },
    ];
  }
}

interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseSegment(seg: any): TranscriptSegment | null {
  if (!seg) return null;
  const text =
    typeof seg.snippet?.text === 'string'
      ? seg.snippet.text
      : typeof seg.snippet?.toString === 'function'
        ? String(seg.snippet)
        : null;
  const startMs = Number(seg.start_ms ?? seg.startMs ?? seg.start_time_ms);
  const endMs = Number(seg.end_ms ?? seg.endMs ?? seg.end_time_ms);
  if (!text || !Number.isFinite(startMs)) return null;
  return {
    text: text.trim(),
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : startMs,
  };
}

/** Greedy token-bounded packing of timed segments, preserving start_ts. */
function chunkTimedSegments(segments: readonly TranscriptSegment[]): RawChunk[] {
  if (segments.length === 0) return [];

  const chunks: RawChunk[] = [];
  let buffer: TranscriptSegment[] = [];
  let bufferTokens = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const text = buffer.map((s) => s.text).join(' ');
    const startMs = buffer[0]!.startMs;
    const endMs = buffer[buffer.length - 1]!.endMs;
    const startSec = Math.floor(startMs / 1_000);
    chunks.push({
      chunkIndex: chunks.length,
      text,
      tokens: bufferTokens,
      startTs: startSec,
      endTs: Math.floor(endMs / 1_000),
      anchor: `?t=${startSec}`,
      metadata: { segmentCount: buffer.length },
    });
  };

  for (const seg of segments) {
    const segTokens = countTokens(seg.text);
    if (bufferTokens + segTokens > TARGET_TOKENS_PER_CHUNK && buffer.length > 0) {
      flush();
      // Carry segments worth ~OVERLAP_TOKENS for cross-chunk continuity.
      const carry: TranscriptSegment[] = [];
      let carryTokens = 0;
      for (let i = buffer.length - 1; i >= 0 && carryTokens < OVERLAP_TOKENS; i--) {
        const s = buffer[i]!;
        carry.unshift(s);
        carryTokens += countTokens(s.text);
      }
      buffer = carry;
      bufferTokens = carryTokens;
    }
    buffer.push(seg);
    bufferTokens += segTokens;
  }
  flush();

  return chunks.map((c, i) => ({ ...c, chunkIndex: i }));
}

function parseVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1) || null;
    }
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      // /shorts/<id>, /embed/<id>, /v/<id>
      const segs = u.pathname.split('/').filter(Boolean);
      const last = segs[segs.length - 1];
      if (last && (segs.includes('shorts') || segs.includes('embed') || segs.includes('v'))) {
        return last;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCandidate(item: any): SourceCandidate | null {
  const id = item?.id ?? item?.video_id ?? item?.basic_info?.id;
  if (!id || typeof id !== 'string') return null;
  const url = `https://www.youtube.com/watch?v=${id}`;
  const title =
    item?.title?.text ??
    (typeof item?.title === 'string' ? item.title : null) ??
    `YouTube video ${id}`;
  const channel = item?.author?.name ?? item?.channel?.name ?? null;
  return {
    url,
    title,
    author: channel,
    channel,
    language: 'en',
    publishedAt: null,
    raw: { videoId: id },
  };
}
