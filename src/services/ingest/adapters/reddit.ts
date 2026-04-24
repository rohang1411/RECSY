/**
 * Reddit adapter.
 *
 * Reddit's public JSON endpoints (`/search.json`, `/comments/<id>.json`)
 * are read-only and require no auth — only a custom `User-Agent`. This
 * gives us thread metadata + top-level comments without pulling in PRAW or
 * managing OAuth tokens.
 *
 * Discovery:
 *   - Search a curated allowlist of phone-relevant subreddits for
 *     "<brand> <model>" over the last year.
 *   - Filter out low-signal posts (score floor, NSFW, stickied).
 *
 * Fetch:
 *   - Fetch the thread + top-level comments (`?sort=top&limit=100`).
 *   - Build the body as:  title + "\n\n" + selftext + "\n\n" +
 *     each top-level comment above a karma floor, truncated.
 *
 * Chunking is delegated to the shared sentence-aligned chunker — Reddit
 * prose is sentence-aligned just like articles.
 */
import { IntegrationError, NotFoundError } from '@/lib/errors';
import { logger } from '@/services/logger';

import { chunkText } from '../chunking';
import { hashContent } from '../hashing';
import type {
  DiscoverOpts,
  PhoneRef,
  RawChunk,
  RawSource,
  SourceAdapter,
  SourceCandidate,
} from '../types';

const USER_AGENT =
  'RECSYBot/0.1 (Node.js; +https://github.com/rohan/recsy) — read-only public-content aggregator';

/**
 * Legacy hardcoded allowlist — kept as a fallback when the adapter is
 * constructed without `subredditProfiles` (e.g. the existing CLI / tests
 * that don't yet plumb DB-backed profiles).
 */
const DEFAULT_SUBREDDITS: readonly SubredditProfile[] = [
  { name: 'Android', scope: 'general', minScore: 20 },
  { name: 'PickAnAndroidForMe', scope: 'general', minScore: 20 },
  { name: 'GalaxyS25', scope: 'device', minScore: 10 },
  { name: 'GooglePixel', scope: 'device', minScore: 10 },
  { name: 'iphone', scope: 'device', minScore: 20 },
  { name: 'apple', scope: 'general', minScore: 20 },
  { name: 'Smartphones', scope: 'general', minScore: 20 },
  { name: 'nothingtech', scope: 'device', minScore: 10 },
  { name: 'OnePlus', scope: 'device', minScore: 10 },
];

/** Per-subreddit config, usually loaded from `subreddit_profiles`. */
export interface SubredditProfile {
  readonly name: string;
  /** 'general' = cross-brand; 'device' = tied to a specific phone family. */
  readonly scope: 'general' | 'device';
  /** Minimum thread score required to be considered. */
  readonly minScore: number;
}

export interface RedditAdapterOptions {
  /** Allowlist of subreddits to poll. Defaults to the legacy hardcoded list. */
  readonly subredditProfiles?: readonly SubredditProfile[];
  /**
   * Whether to poll `/r/{sub}/new.json` in addition to `/search`. Catches
   * fresh threads before they peak. Default: true for device-scope subs,
   * false for general.
   */
  readonly pollNew?: boolean;
  /** Max posts to scan per /new.json call. Default 25. */
  readonly newPostsLimit?: number;
  /** For testing: override fetch impl. */
  readonly fetchImpl?: typeof fetch;
}

const MIN_COMMENT_SCORE = 5;
const MAX_COMMENTS_PER_THREAD = 40;
const FETCH_TIMEOUT_MS = 15_000;

export class RedditAdapter implements SourceAdapter {
  readonly type = 'reddit' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.reddit' });
  private readonly subredditProfiles: readonly SubredditProfile[];
  private readonly pollNew: boolean | undefined;
  private readonly newPostsLimit: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RedditAdapterOptions = {}) {
    this.subredditProfiles = opts.subredditProfiles ?? DEFAULT_SUBREDDITS;
    this.pollNew = opts.pollNew;
    this.newPostsLimit = opts.newPostsLimit ?? 25;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]> {
    const query = opts.hint ?? `${phone.brand} ${phone.model}`;
    const out: SourceCandidate[] = [];
    const seen = new Set<string>();

    for (const profile of this.subredditProfiles) {
      if (out.length >= opts.limit) break;
      await this.collectFromSearch(profile, query, opts.limit, out, seen);
      if (out.length >= opts.limit) break;
      // /new.json polling — catches fresh threads about a hot phone that
      // haven't peaked yet. On by default for device-scope subs, where the
      // signal-to-noise is high.
      const shouldPollNew =
        this.pollNew ?? (profile.scope === 'device' || shouldPollForPhone(profile, phone));
      if (shouldPollNew) {
        await this.collectFromNew(profile, phone, out, seen);
      }
    }

    return out;
  }

  private async collectFromSearch(
    profile: SubredditProfile,
    query: string,
    limit: number,
    out: SourceCandidate[],
    seen: Set<string>,
  ): Promise<void> {
    const url = `https://www.reddit.com/r/${profile.name}/search.json?q=${encodeURIComponent(
      query,
    )}&restrict_sr=1&sort=relevance&t=year&limit=10`;
    try {
      const listing = await this.fetchJson<RedditListing>(url);
      for (const child of listing?.data?.children ?? []) {
        if (out.length >= limit) break;
        const post = child.data;
        if (!this.isAcceptablePost(post, profile)) continue;
        if (post!.selftext === undefined) continue;
        const threadUrl = `https://www.reddit.com${post!.permalink}`;
        if (seen.has(threadUrl)) continue;
        seen.add(threadUrl);
        out.push(toCandidate(post!, profile, 'search'));
      }
    } catch (err) {
      this.log.warn(
        { sub: profile.name, err: err instanceof Error ? err.message : err },
        'reddit subreddit search failed; continuing',
      );
    }
  }

  private async collectFromNew(
    profile: SubredditProfile,
    phone: PhoneRef,
    out: SourceCandidate[],
    seen: Set<string>,
  ): Promise<void> {
    const url = `https://www.reddit.com/r/${profile.name}/new.json?limit=${this.newPostsLimit}&raw_json=1`;
    const needle = `${phone.brand} ${phone.model}`.toLowerCase();
    try {
      const listing = await this.fetchJson<RedditListing>(url);
      for (const child of listing?.data?.children ?? []) {
        const post = child.data;
        if (!this.isAcceptablePost(post, profile)) continue;
        // For /new we don't have relevance sort; match on title substring
        // against the phone name. Device-scope subs already pre-filter,
        // but general-scope subs need this guard.
        const titleLc = (post!.title ?? '').toLowerCase();
        const haystack = `${titleLc}\n${(post!.selftext ?? '').toLowerCase()}`;
        if (profile.scope === 'general' && !haystack.includes(needle)) continue;
        if (post!.selftext === undefined) continue;
        const threadUrl = `https://www.reddit.com${post!.permalink}`;
        if (seen.has(threadUrl)) continue;
        seen.add(threadUrl);
        out.push(toCandidate(post!, profile, 'new'));
      }
    } catch (err) {
      this.log.warn(
        { sub: profile.name, err: err instanceof Error ? err.message : err },
        'reddit subreddit /new fetch failed; continuing',
      );
    }
  }

  private isAcceptablePost(
    post: RedditPost | undefined,
    profile: SubredditProfile,
  ): post is RedditPost {
    if (!post) return false;
    if (post.stickied || post.over_18) return false;
    if ((post.score ?? 0) < profile.minScore) return false;
    return true;
  }

  async fetch(candidate: SourceCandidate): Promise<RawSource> {
    const url = this.threadJsonUrl(candidate.url);
    const payload = await this.fetchJson<RedditThreadPayload>(url);
    const [threadListing, commentsListing] = payload ?? [];

    const thread = threadListing?.data?.children?.[0]?.data;
    if (!thread || !thread.id) {
      throw new NotFoundError('reddit thread returned no post', { url: candidate.url });
    }

    const selftext = (thread.selftext ?? '').trim();
    const comments = (commentsListing?.data?.children ?? [])
      .map((c) => c.data)
      .filter((c): c is RedditPost =>
        Boolean(c && c.body && (c.score ?? 0) >= MIN_COMMENT_SCORE && !c.stickied),
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, MAX_COMMENTS_PER_THREAD);

    const bodyParts = [
      `# ${thread.title ?? ''}`.trim(),
      selftext,
      ...comments.map((c) => c.body ?? ''),
    ];
    const body = bodyParts.filter(Boolean).join('\n\n');

    if (body.length < 200) {
      throw new NotFoundError('reddit thread body too short', {
        url: candidate.url,
        length: body.length,
      });
    }

    return {
      candidate: {
        ...candidate,
        title: candidate.title || thread.title || candidate.url,
        author: candidate.author ?? thread.author ?? null,
        publishedAt:
          candidate.publishedAt ??
          (thread.created_utc ? new Date(thread.created_utc * 1_000).toISOString() : null),
      },
      body,
      contentHash: hashContent(body),
      raw: {
        threadId: thread.id,
        subreddit: thread.subreddit,
        score: thread.score,
        commentCount: comments.length,
      },
    };
  }

  chunk(raw: RawSource): RawChunk[] {
    return chunkText(raw.body).map((c) => ({
      chunkIndex: c.index,
      text: c.text,
      tokens: c.tokens,
      metadata: {},
    }));
  }

  private threadJsonUrl(permalink: string): string {
    const clean = permalink.replace(/\/$/, '');
    const withJson = clean.endsWith('.json') ? clean : `${clean}.json`;
    return `${withJson}?raw_json=1&limit=100&sort=top`;
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new IntegrationError(`reddit HTTP ${res.status}`, { url, status: res.status });
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError('reddit fetch failed', { url }, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toCandidate(
  post: RedditPost,
  profile: SubredditProfile,
  discoveredVia: 'search' | 'new',
): SourceCandidate {
  return {
    url: `https://www.reddit.com${post.permalink}`,
    title: post.title ?? 'Reddit thread',
    author: post.author ?? null,
    channel: `r/${profile.name}`,
    language: 'en',
    publishedAt: post.created_utc ? new Date(post.created_utc * 1_000).toISOString() : null,
    raw: {
      postId: post.id,
      subreddit: profile.name,
      subredditScope: profile.scope,
      score: post.score,
      numComments: post.num_comments,
      discoveredVia,
    },
  };
}

/**
 * Decide whether a general-scope subreddit should also be polled via /new
 * for this specific phone. The rule of thumb: only for recently-launched
 * phones where a new thread is likely to name the device. We approximate
 * "recent" as `phone.launchDate` within the last 120 days.
 */
function shouldPollForPhone(profile: SubredditProfile, phone: PhoneRef): boolean {
  if (profile.scope !== 'general') return true;
  if (!phone.launchDate) return false;
  const launched = Date.parse(phone.launchDate);
  if (!Number.isFinite(launched)) return false;
  const ageDays = (Date.now() - launched) / (1000 * 60 * 60 * 24);
  return ageDays <= 120;
}

// --- Minimal Reddit API types (only fields we read) ---------------------------

interface RedditListing {
  data?: {
    children?: Array<{ data?: RedditPost }>;
  };
}

interface RedditPost {
  id?: string;
  title?: string;
  author?: string;
  selftext?: string;
  body?: string;
  permalink?: string;
  subreddit?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  stickied?: boolean;
  over_18?: boolean;
}

type RedditThreadPayload = [RedditListing, RedditListing];
