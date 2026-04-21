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

const ALLOWED_SUBREDDITS = [
  'Android',
  'PickAnAndroidForMe',
  'GalaxyS25',
  'GooglePixel',
  'iphone',
  'apple',
  'Smartphones',
  'nothingtech',
  'OnePlus',
] as const;

const MIN_THREAD_SCORE = 20;
const MIN_COMMENT_SCORE = 5;
const MAX_COMMENTS_PER_THREAD = 40;
const FETCH_TIMEOUT_MS = 15_000;

export class RedditAdapter implements SourceAdapter {
  readonly type = 'reddit' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.reddit' });

  async discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]> {
    const query = opts.hint ?? `${phone.brand} ${phone.model}`;
    const out: SourceCandidate[] = [];
    const seen = new Set<string>();

    for (const sub of ALLOWED_SUBREDDITS) {
      if (out.length >= opts.limit) break;
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(
        query,
      )}&restrict_sr=1&sort=relevance&t=year&limit=10`;

      try {
        const listing = await this.fetchJson<RedditListing>(url);
        for (const child of listing?.data?.children ?? []) {
          if (out.length >= opts.limit) break;
          const post = child.data;
          if (!post || post.stickied || post.over_18) continue;
          if ((post.score ?? 0) < MIN_THREAD_SCORE) continue;
          if (post.selftext === undefined) continue; // link-only posts: skip
          const threadUrl = `https://www.reddit.com${post.permalink}`;
          if (seen.has(threadUrl)) continue;
          seen.add(threadUrl);
          out.push({
            url: threadUrl,
            title: post.title ?? 'Reddit thread',
            author: post.author ?? null,
            channel: `r/${sub}`,
            language: 'en',
            publishedAt: post.created_utc ? new Date(post.created_utc * 1_000).toISOString() : null,
            raw: {
              postId: post.id,
              subreddit: sub,
              score: post.score,
              numComments: post.num_comments,
            },
          });
        }
      } catch (err) {
        this.log.warn(
          { sub, err: err instanceof Error ? err.message : err },
          'reddit subreddit search failed; continuing',
        );
      }
    }

    return out;
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
      const res = await fetch(url, {
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
