/**
 * GSMArena adapter.
 *
 * Discovery combines three signals, deduped by canonical URL:
 *   1. Device-lookup via `/res.php3?sSearch=…` → the maker/device page →
 *      any in-site "Review" link (`*-review-*.php`).
 *   2. Direct override from `phones.raw_json.gsmarenaUrl` (manually curated
 *      for phones where search is unreliable, e.g. sub-brand renames).
 *   3. (Optional) news-sitemap poll — not implemented in v1; GSMArena's
 *      long-form reviews are the primary value here.
 *
 * Fetch reuses the Readability extraction path from `ArticleAdapter`. All
 * network I/O goes through the shared polite HTTP wrapper, which enforces
 * the 1 req / 4 s per-host budget and robots.txt.
 *
 * Scope discipline: we only follow in-domain review pages. We never call
 * `res.php3` more than once per phone per run, and we never recurse into
 * unrelated device pages.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { NotFoundError } from '@/lib/errors';
import { logger } from '@/services/logger';

import { chunkText } from '../chunking';
import { hashContent } from '../hashing';
import type { PoliteHttp } from '../http';
import type {
  DiscoverOpts,
  PhoneRef,
  RawChunk,
  RawSource,
  SourceAdapter,
  SourceCandidate,
} from '../types';

const MIN_BODY_CHARS = 400;
const GSMARENA_HOST = 'www.gsmarena.com';

/** Shape of `phones.raw_json` for GSMArena overrides. */
interface PhoneRawJsonGsmArena {
  readonly gsmarenaUrl?: string;
}

export interface GsmArenaAdapterOptions {
  readonly http: PoliteHttp;
  /**
   * Optional resolver for `phones.raw_json.gsmarenaUrl`. Kept pluggable so
   * tests can inject static data.
   */
  readonly getPhoneRawJson?: (phone: PhoneRef) => Promise<PhoneRawJsonGsmArena | null>;
  /**
   * Max candidates per phone per discovery call. Defaults to 3 — enough
   * to catch the main review + any follow-ups (long-term, camera, etc.).
   */
  readonly maxCandidates?: number;
}

export class GsmArenaAdapter implements SourceAdapter {
  readonly type = 'gsmarena' as const;
  private readonly log = logger.child({ component: 'ingest.adapter.gsmarena' });
  private readonly http: PoliteHttp;
  private readonly getPhoneRawJson?: (phone: PhoneRef) => Promise<PhoneRawJsonGsmArena | null>;
  private readonly maxCandidates: number;

  constructor(opts: GsmArenaAdapterOptions) {
    this.http = opts.http;
    this.getPhoneRawJson = opts.getPhoneRawJson;
    this.maxCandidates = opts.maxCandidates ?? 3;
  }

  async discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]> {
    const max = Math.min(opts.limit ?? this.maxCandidates, this.maxCandidates);
    const candidates = new Map<string, SourceCandidate>();

    // 1. rawJson override — highest signal, consumed first.
    if (this.getPhoneRawJson) {
      try {
        const raw = await this.getPhoneRawJson(phone);
        const override = raw?.gsmarenaUrl;
        if (override && isGsmarenaUrl(override)) {
          candidates.set(canonicalUrl(override), {
            url: canonicalUrl(override),
            title: `${phone.brand} ${phone.model} (GSMArena — manual override)`,
            author: null,
            channel: 'GSMArena',
            language: 'en',
            publishedAt: null,
            raw: { source: 'gsmarena', discoveredVia: 'rawJson-override' },
          });
        }
      } catch (err) {
        this.log.warn({ err: errMsg(err) }, 'getPhoneRawJson failed; continuing');
      }
    }

    if (candidates.size >= max) {
      return [...candidates.values()].slice(0, max);
    }

    // 2. res.php3 search — finds the device page; then scrape for review links.
    try {
      const searchUrl = buildSearchUrl(phone);
      const search = await this.http.get(searchUrl);
      const devicePath = firstDevicePathFromSearch(search.body);
      if (!devicePath) {
        this.log.info({ phone: phone.slug }, 'gsmarena res.php3 returned no device page');
      } else {
        const deviceUrl = `https://${GSMARENA_HOST}${devicePath}`;
        const devicePage = await this.http.get(deviceUrl);
        const reviewLinks = reviewLinksFromDevicePage(devicePage.body);
        for (const link of reviewLinks) {
          const full = link.startsWith('http') ? link : `https://${GSMARENA_HOST}/${link}`;
          const canonical = canonicalUrl(full);
          if (candidates.has(canonical)) continue;
          candidates.set(canonical, {
            url: canonical,
            title: `${phone.brand} ${phone.model} review (GSMArena)`,
            author: null,
            channel: 'GSMArena',
            language: 'en',
            publishedAt: null,
            raw: { source: 'gsmarena', discoveredVia: 'res.php3', deviceUrl },
          });
          if (candidates.size >= max) break;
        }
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.log.info(
          { phone: phone.slug, err: errMsg(err) },
          'gsmarena discovery skipped (robots or 404)',
        );
      } else {
        this.log.warn({ phone: phone.slug, err: errMsg(err) }, 'gsmarena discovery failed');
      }
    }

    return [...candidates.values()].slice(0, max);
  }

  async fetch(candidate: SourceCandidate): Promise<RawSource> {
    if (!isGsmarenaUrl(candidate.url)) {
      throw new NotFoundError('not a gsmarena url', { url: candidate.url });
    }
    const res = await this.http.get(candidate.url);
    const extracted = extractArticle(res.body, candidate.url);

    if (!extracted.text || extracted.text.length < MIN_BODY_CHARS) {
      throw new NotFoundError('GSMArena body too short — likely a challenge page or stub.', {
        url: candidate.url,
        length: extracted.text?.length ?? 0,
      });
    }

    const body = normalizeWhitespace(extracted.text);
    const contentHash = hashContent(body);

    return {
      candidate: {
        ...candidate,
        title: extracted.title || candidate.title,
        author: candidate.author ?? extracted.byline ?? null,
      },
      body,
      contentHash,
      raw: {
        source: 'gsmarena',
        siteName: extracted.siteName ?? 'GSMArena',
        excerpt: extracted.excerpt ?? null,
        length: body.length,
        discoveredVia: (candidate.raw as { discoveredVia?: string } | undefined)?.discoveredVia,
      },
    };
  }

  chunk(raw: RawSource): RawChunk[] {
    return chunkText(raw.body).map((c) => ({
      chunkIndex: c.index,
      text: c.text,
      tokens: c.tokens,
      anchor: undefined,
      metadata: { source: 'gsmarena' },
    }));
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests.
// ---------------------------------------------------------------------------

export function isGsmarenaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.host === 'www.gsmarena.com' || u.host === 'gsmarena.com' || u.host.endsWith('.gsmarena.com')
    );
  } catch {
    return false;
  }
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // GSMArena doesn't meaningfully use query params for review pages; strip
    // tracking/session params conservatively.
    const allowedParams = new Set<string>([]);
    const keep: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (allowedParams.has(k)) keep.push([k, v]);
    });
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    // Normalise host.
    if (u.host === 'gsmarena.com') u.host = 'www.gsmarena.com';
    return u.toString();
  } catch {
    return url;
  }
}

export function buildSearchUrl(phone: PhoneRef): string {
  const query = `${phone.brand} ${phone.model}`.trim().replace(/\s+/g, '+');
  return `https://${GSMARENA_HOST}/res.php3?sSearch=${encodeURIComponent(query)}`;
}

/**
 * Extract the first device page path from a res.php3 result.
 * Device pages look like `/samsung_galaxy_s25_ultra-13559.php`.
 */
export function firstDevicePathFromSearch(html: string): string | null {
  // Simpler + safer than fully parsing: regex for the specific pattern. We
  // stop at the first match because GSMArena's search orders by relevance.
  const rx = /href="(\/[a-z0-9_]+-\d+\.php)"/i;
  const m = html.match(rx);
  return m ? m[1]! : null;
}

/**
 * Extract review links from a GSMArena device page. Reviews live at
 * `/{model}-review-{id}.php` — distinct from the spec page's shorter path.
 */
export function reviewLinksFromDevicePage(html: string): string[] {
  const rx = /href="([a-z0-9_-]+-review-\d+\.php)"/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) != null) {
    const path = m[1]!;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  text: string;
  siteName: string | null;
  excerpt: string | null;
}

function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);
  try {
    Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
  } catch {
    // ignore — Readability handles a missing documentURI.
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

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
