/**
 * Article adapter.
 *
 * Discovery is a no-op (we don't have a general web-search backend on the
 * free tier). The CLI's `--url` flag is the entry point for ingesting
 * editorial reviews.
 *
 * Fetch:
 *   - GET the URL with a polite User-Agent.
 *   - Parse HTML with `linkedom` (lightweight DOM impl).
 *   - Run `@mozilla/readability` (the same algorithm Firefox Reader View uses).
 *   - Persist the extracted plaintext as the canonical body.
 *
 * Chunking is delegated to the shared sentence-aligned chunker.
 *
 * Limitations:
 *   - Sites that hard-block bots will return a low-content page → we throw
 *     `NotFoundError` so the orchestrator records the failure and moves on.
 *   - JS-rendered single-page apps yield empty bodies; we don't headless-
 *     render. Acceptable for tech-blog / mainstream review sites.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

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

const MIN_BODY_CHARS = 400;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  'RECSYBot/0.1 (+https://github.com/rohan/recsy; contact: github issues) — extracts public article text for non-commercial review aggregation';

export class ArticleAdapter implements SourceAdapter {
  readonly type = 'article' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.article' });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async discover(_phone: PhoneRef, _opts: DiscoverOpts): Promise<SourceCandidate[]> {
    // Articles are discovered via the CLI's --url flag for now. A future
    // version may layer a search engine on top (e.g. Google CSE, Brave).
    return [];
  }

  async fetch(candidate: SourceCandidate): Promise<RawSource> {
    const html = await this.fetchHtml(candidate.url);
    const extracted = extractArticle(html, candidate.url);

    if (!extracted.text || extracted.text.length < MIN_BODY_CHARS) {
      throw new NotFoundError(
        'Article body too short or unparseable — likely paywalled, JS-rendered, or blocked.',
        { url: candidate.url, length: extracted.text?.length ?? 0 },
      );
    }

    const body = normalizeWhitespace(extracted.text);
    const contentHash = hashContent(body);

    return {
      candidate: {
        ...candidate,
        // Promote the extracted title if the candidate didn't have one.
        title: candidate.title || extracted.title || candidate.url,
        author: candidate.author ?? extracted.byline ?? null,
      },
      body,
      contentHash,
      raw: {
        siteName: extracted.siteName ?? null,
        excerpt: extracted.excerpt ?? null,
        length: body.length,
      },
    };
  }

  chunk(raw: RawSource): RawChunk[] {
    const text = raw.body;
    const chunks = chunkText(text);
    return chunks.map((c) => ({
      chunkIndex: c.index,
      text: c.text,
      tokens: c.tokens,
      anchor: undefined,
      metadata: {},
    }));
  }

  private async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en;q=0.9',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new IntegrationError(`HTTP ${res.status} fetching article`, {
          url,
          status: res.status,
        });
      }
      const text = await res.text();
      this.log.debug({ url, bytes: text.length }, 'article html fetched');
      return text;
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError('article fetch failed', { url }, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  text: string;
  siteName: string | null;
  excerpt: string | null;
}

function extractArticle(html: string, url: string): ExtractedArticle {
  // linkedom is fast and dependency-free, and Readability only needs a DOM.
  // We pass the URL so Readability can resolve relative links internally.
  const { document } = parseHTML(html);
  // Readability expects `document.documentURI`; linkedom doesn't set it.
  try {
    Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
  } catch {
    // Read-only; we tried. Readability will still mostly work without it.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = new Readability(document as any);
  const parsed = reader.parse();

  if (!parsed) {
    return { title: null, byline: null, text: '', siteName: null, excerpt: null };
  }
  return {
    title: parsed.title ?? null,
    byline: parsed.byline ?? null,
    text: parsed.textContent ?? '',
    siteName: parsed.siteName ?? null,
    excerpt: parsed.excerpt ?? null,
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
