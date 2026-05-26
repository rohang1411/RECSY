/**
 * YouTube channel adapter.
 *
 * Discovers videos from an allowlist of trusted tech-review channels via
 * YouTube's public RSS feed:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=<UC...>
 *
 * This is the preferred discovery path for tiered ingestion because:
 *   - No API key or Innertube hit — RSS is cheap and always works.
 *   - Returns ~15 most recent videos with title + publishedAt, which is
 *     enough signal for alias-match → disambiguator → fetch.
 *   - The existing `YouTubeAdapter.fetch/chunk` is reused for transcripts.
 *
 * Discovery strategy:
 *   1. For each active `creator_profile`, fetch its RSS feed.
 *   2. For each entry, match against `phone_aliases`. Entries with exactly
 *      one match and (the caller-provided) phone = match → queue. Entries
 *      with >= 2 matches are left for the Disambiguator (invoked by the
 *      orchestrator). Zero matches → skip.
 *
 * The adapter itself only emits candidates that mention the target phone.
 * It is therefore called **per phone**, with the full creator feed cached
 * per run (so processing phone B after phone A doesn't re-fetch MKBHD).
 */
import { logger } from '@/services/logger';

import type { AliasMatch, AliasRow } from '../agents/alias-match';
import { matchAliases } from '../agents/alias-match';
import type { PoliteHttp } from '../http';
import { YouTubeAdapter } from './youtube';
import type {
  DiscoverOpts,
  PhoneRef,
  RawChunk,
  RawSource,
  SourceAdapter,
  SourceCandidate,
} from '../types';

export interface CreatorChannel {
  readonly handle: string;
  readonly channelId: string;
  readonly trustWeight?: number;
}

export interface YouTubeChannelAdapterOptions {
  readonly http: PoliteHttp;
  /** Allowlisted channels. Usually loaded from `creator_profiles`. */
  readonly creators: readonly CreatorChannel[];
  /** Alias rows for heuristic matching. Usually loaded from `phone_aliases`. */
  readonly aliases: readonly AliasRow[];
  /**
   * Inner adapter used for fetching transcripts. Injected so tests can
   * supply a stub; defaults to a fresh `YouTubeAdapter`.
   */
  readonly inner?: YouTubeAdapter;
  /** Per-run cache so parallel phone runs don't re-fetch the same RSS. */
  readonly feedCache?: Map<string, readonly RssEntry[]>;
  /** Max candidates per phone. Defaults to the discover opts limit. */
  readonly maxPerPhone?: number;
}

export interface RssEntry {
  readonly videoId: string;
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly channelTitle?: string;
  readonly channelId?: string;
  readonly publishedAt?: string;
}

export class YouTubeChannelAdapter implements SourceAdapter {
  readonly type = 'youtube' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.youtube-channel' });
  private readonly http: PoliteHttp;
  private readonly creators: readonly CreatorChannel[];
  private readonly aliases: readonly AliasRow[];
  private readonly inner: YouTubeAdapter;
  private readonly feedCache: Map<string, readonly RssEntry[]>;
  private readonly maxPerPhone?: number;

  constructor(opts: YouTubeChannelAdapterOptions) {
    this.http = opts.http;
    this.creators = opts.creators;
    this.aliases = opts.aliases;
    this.inner = opts.inner ?? new YouTubeAdapter();
    this.feedCache = opts.feedCache ?? new Map();
    this.maxPerPhone = opts.maxPerPhone;
  }

  async discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]> {
    const limit = Math.min(opts.limit ?? 5, this.maxPerPhone ?? opts.limit ?? 5);
    if (limit <= 0 || this.creators.length === 0) return [];

    const out: SourceCandidate[] = [];
    const seen = new Set<string>();

    for (const creator of this.creators) {
      if (out.length >= limit) break;
      let entries: readonly RssEntry[];
      try {
        entries = await this.loadFeed(creator);
      } catch (err) {
        this.feedCache.set(creator.channelId, []);
        this.log.warn(
          { creator: creator.handle, err: errMsg(err) },
          'rss feed fetch failed; skipping creator this run',
        );
        continue;
      }

      for (const entry of entries) {
        if (out.length >= limit) break;
        if (seen.has(entry.videoId)) continue;

        const text = `${entry.title}\n${entry.description ?? ''}`;
        const matches: AliasMatch[] = matchAliases(text, this.aliases);
        if (matches.length === 0) continue;

        // The orchestrator handles disambiguation when multiple phones match.
        // We emit the candidate iff one of the matches is the target phone.
        const targets = matches.some((m) => m.phoneId === phone.id);
        if (!targets) continue;

        seen.add(entry.videoId);
        out.push({
          url: entry.url,
          title: entry.title,
          author: entry.channelTitle ?? creator.handle,
          channel: entry.channelTitle ?? creator.handle,
          language: 'en',
          publishedAt: entry.publishedAt ?? null,
          raw: {
            videoId: entry.videoId,
            description: entry.description ?? '',
            discoveredVia: 'rss',
            creatorHandle: creator.handle,
            channelId: entry.channelId ?? creator.channelId,
            aliasMatches: matches.map((m) => ({ slug: m.slug, alias: m.alias })),
            aliasMatchCount: matches.length,
          },
        });
      }
    }

    this.log.info({ phone: phone.slug, discovered: out.length }, 'youtube-channel discovery done');
    return out;
  }

  async fetch(candidate: SourceCandidate): Promise<RawSource> {
    return this.inner.fetch(candidate);
  }

  chunk(raw: RawSource): RawChunk[] {
    return this.inner.chunk(raw);
  }

  private async loadFeed(creator: CreatorChannel): Promise<readonly RssEntry[]> {
    const cached = this.feedCache.get(creator.channelId);
    if (cached) return cached;
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(creator.channelId)}`;
    const res = await this.http.get(url, {
      accept: 'application/atom+xml,application/xml;q=0.9,text/xml;q=0.8',
      // YouTube's official channel Atom feed is publicly fetchable and used by
      // the push-notification docs, but robots.txt disallows crawler traversal
      // of `/feeds/videos.xml`. We intentionally consume this syndication feed
      // directly for trusted channels, so bypass robots for this exact request.
      bypassRobots: true,
    });
    const entries = parseYouTubeRss(res.body);
    this.feedCache.set(creator.channelId, entries);
    return entries;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests.
// ---------------------------------------------------------------------------

/**
 * Parse a YouTube Atom feed into a list of minimal entries.
 *
 * YouTube's feed shape is fixed and simple enough that a regex-based
 * extractor is both correct and cheaper than spinning up a full XML DOM.
 * Fields we read: <yt:videoId>, <title>, <published>, <author><name>,
 * <yt:channelId>, <media:description>.
 */
export function parseYouTubeRss(xml: string): RssEntry[] {
  const entryRx = /<entry\b[\s\S]*?<\/entry>/g;
  const out: RssEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRx.exec(xml)) != null) {
    const block = m[0];
    const videoId = tagText(block, 'yt:videoId') ?? tagText(block, 'videoId');
    if (!videoId) continue;
    const title = tagText(block, 'title') ?? '';
    const published = tagText(block, 'published') ?? undefined;
    const description =
      tagText(block, 'media:description') ?? tagText(block, 'summary') ?? undefined;
    const channelTitle = tagText(block, 'name') ?? undefined;
    const channelId = tagText(block, 'yt:channelId') ?? undefined;
    out.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: title || '(untitled)',
      description,
      channelTitle,
      channelId,
      publishedAt: published,
    });
  }
  return out;
}

/** Case-sensitive, namespace-aware single-tag text extractor. */
function tagText(block: string, tag: string): string | null {
  // Escape the `:` in namespace-qualified tag names for the regex.
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`);
  const m = block.match(rx);
  if (!m) return null;
  return decodeXmlEntities(m[1]!).trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
