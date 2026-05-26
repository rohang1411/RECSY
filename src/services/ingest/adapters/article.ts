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

import { eq } from 'drizzle-orm';
import { getDb } from '@/services/db/client';
import { domainProfiles } from '@/services/db/schema';
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
// HTTP header values must be ASCII (ByteString); no em-dash / unicode here or
// Node's `fetch` throws `TypeError: Cannot convert argument to a ByteString`.
const USER_AGENT =
  'RECSYBot/0.1 (+https://github.com/rohan/recsy; contact: github issues) - extracts public article text for non-commercial review aggregation';

export class ArticleAdapter implements SourceAdapter {
  readonly type = 'article' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.article' });

  async discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]> {
    const limit = opts.limit ?? 5;

    const db = getDb();
    const activeDomains = await db
      .select({ host: domainProfiles.host })
      .from(domainProfiles)
      .where(eq(domainProfiles.status, 'active'));

    const trustedHosts = new Set(
      activeDomains
        .map((d) => d.host.toLowerCase())
        // exclude platform-specific sub-adapters to avoid duplicate ingestion paths
        .filter((h) => h !== 'youtube.com' && h !== 'reddit.com' && h !== 'gsmarena.com'),
    );

    if (trustedHosts.size === 0) return [];

    try {
      const queries = articleDiscoveryQueries(phone);
      const candidates: SourceCandidate[] = [];
      const seen = new Set<string>();
      for (const query of queries) {
        if (candidates.length >= limit) break;
        const discovered = await discoverDuckDuckGoLite(query, trustedHosts);
        for (const candidate of discovered) {
          if (candidates.length >= limit) break;
          if (seen.has(candidate.url)) continue;
          seen.add(candidate.url);
          candidates.push(candidate);
        }
        if (discovered.length > 0) break;
      }

      this.log.info(
        { phone: phone.slug, count: candidates.length, queriesTried: queries.length },
        'article auto-discovery via DDG',
      );
      return candidates;
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), phone: phone.slug },
        'DDG Lite discovery threw',
      );
      return [];
    }
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
      const cause = err instanceof Error ? (err.cause ?? err) : err;
      const causeMsg =
        cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause ?? 'unknown');
      throw new IntegrationError(`article fetch failed (${causeMsg})`, { url }, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function articleDiscoveryQueries(phone: PhoneRef): string[] {
  const values = new Set<string>();
  const add = (value: string): void => {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized) values.add(normalized);
  };
  add(`${phone.brand} ${phone.model} review`);
  add(`${phone.model} review`);
  add(`${phone.brand} ${phone.model}`);
  return [...values];
}

async function discoverDuckDuckGoLite(
  query: string,
  trustedHosts: ReadonlySet<string>,
): Promise<SourceCandidate[]> {
  const lite = await discoverDuckDuckGo(
    'https://lite.duckduckgo.com/lite/',
    query,
    trustedHosts,
    'a.result-link',
  );
  if (lite.length > 0) return lite;
  return discoverDuckDuckGo(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    query,
    trustedHosts,
    'a.result__a, a.result-link',
    false,
  );
}

async function discoverDuckDuckGo(
  url: string,
  query: string,
  trustedHosts: ReadonlySet<string>,
  selector: string,
  post = true,
): Promise<SourceCandidate[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: post ? 'POST' : 'GET',
      body: post ? new URLSearchParams({ q: query }) : undefined,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://lite.duckduckgo.com',
        Referer: 'https://lite.duckduckgo.com/',
        ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new IntegrationError(`DDG Lite discovery failed with HTTP ${res.status}`, {
        status: res.status,
        query,
      });
    }

    const html = await res.text();
    const { document } = parseHTML(html);
    const links = document.querySelectorAll(selector);
    const out: SourceCandidate[] = [];
    for (const link of links) {
      const href = unwrapDuckDuckGoLink(link.getAttribute('href'));
      if (!href) continue;
      try {
        const parsedUrl = new URL(href);
        const host = parsedUrl.hostname.replace(/^www\./, '');
        if (host === 'duckduckgo.com' || !trustedHosts.has(host)) continue;
        out.push({
          url: href,
          title: link.textContent?.trim() || href,
          author: null,
          channel: null,
          language: 'en',
          publishedAt: null,
          raw: { discoveredVia: 'ddg-lite', query },
        });
      } catch {
        // skip invalid URLs safely
      }
    }
    return out;
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapDuckDuckGoLink(href: string | null): string | null {
  if (!href) return null;
  try {
    const absolute = href.startsWith('//') ? `https:${href}` : href;
    const parsed = new URL(absolute);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : absolute;
  } catch {
    return href;
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
