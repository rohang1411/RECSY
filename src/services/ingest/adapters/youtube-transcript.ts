/**
 * YouTube transcript fallback utilities.
 *
 * `youtubei.js`'s `info.getTranscript()` occasionally returns HTTP 400 —
 * YouTube sporadically rotates the Innertube endpoint. When that happens we
 * fall back to the same `timedtext` URLs the YouTube player itself uses.
 *
 * Fallback chain (applied in order until one yields segments):
 *   1. Caption tracks already present on the `youtubei.js` `Info` object
 *      (requires `retrieve_player: true` when the client was created).
 *   2. Caption tracks scraped from the public watch-page HTML
 *      (`"captionTracks":[...]` inside `ytInitialPlayerResponse`).
 *
 * Selected track → fetched with `fmt=json3` and parsed into segments with
 * millisecond start/end.
 *
 * All helpers here are network-bound utility functions — they intentionally
 * do NOT throw on "no transcript found" conditions; they return empty arrays
 * so the adapter can decide how to surface the miss (`NotFoundError` in our
 * case). Hard failures (network, JSON parse) are logged by the caller.
 */

export interface TranscriptSegment {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface CaptionTrack {
  /** Signed URL served by `timedtext`. Fetchable with `fmt=json3`. */
  readonly baseUrl: string;
  /** ISO-639 / BCP-47 language tag from YouTube (e.g. `en`, `en-US`). */
  readonly languageCode: string;
  /** YouTube sets this to `'asr'` for auto-generated captions. */
  readonly kind: string | null;
  readonly name: string | null;
}

/**
 * `timedtext?fmt=json3` response shape (the fields we care about).
 * The full schema is larger but YouTube has kept these stable for years.
 */
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}
interface Json3Response {
  events?: Json3Event[];
}

// HTTP header values must be ASCII (ByteString); a Unicode em-dash here makes
// Node's `fetch` throw `TypeError: Cannot convert argument to a ByteString`,
// which our surrounding try/catch would swallow as "no captions". Keep ASCII.
const USER_AGENT =
  'Mozilla/5.0 (compatible; RECSYBot/0.1; +https://github.com/rohan/recsy) - reads public captions';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Rank caption tracks and return the best English option, or `null` if none.
 * Preference order: manual English → manual English-variant → ASR English →
 * any English-family → the first track (last-resort non-English).
 *
 * Prefer {@link rankCaptionTracks} when you can loop through candidates —
 * YouTube sometimes lists a manual English track that fetches as empty, in
 * which case the caller needs to advance to the next-best option.
 */
export function pickBestEnglishTrack(tracks: readonly CaptionTrack[]): CaptionTrack | null {
  return rankCaptionTracks(tracks)[0] ?? null;
}

/**
 * Full ranking of caption tracks, best → worst. Same ordering as
 * {@link pickBestEnglishTrack} but returns the full list so callers can
 * iterate when a higher-ranked track fetches as empty (a known YouTube
 * quirk — it occasionally lists a manual English track that has no events,
 * with the real content only on the `asr` track).
 */
export function rankCaptionTracks(tracks: readonly CaptionTrack[]): CaptionTrack[] {
  if (tracks.length === 0) return [];
  const isEnglish = (t: CaptionTrack): boolean =>
    (t.languageCode ?? '').toLowerCase().startsWith('en');

  const buckets: CaptionTrack[][] = [
    tracks.filter((t) => isEnglish(t) && t.kind !== 'asr'),
    tracks.filter((t) => isEnglish(t) && t.kind === 'asr'),
    tracks.filter((t) => isEnglish(t)),
    [...tracks],
  ];
  const seen = new Set<string>();
  const out: CaptionTrack[] = [];
  for (const bucket of buckets) {
    for (const t of bucket) {
      if (seen.has(t.baseUrl)) continue;
      seen.add(t.baseUrl);
      out.push(t);
    }
  }
  return out;
}

/**
 * Parse a `json3` payload into `TranscriptSegment`s. Exported for unit tests;
 * the runtime call path goes through `fetchTimedTextSegments`.
 */
export function parseJson3Transcript(json: unknown): TranscriptSegment[] {
  const payload = json as Json3Response | null | undefined;
  const events = payload?.events ?? [];
  const out: TranscriptSegment[] = [];
  for (const ev of events) {
    if (!Array.isArray(ev?.segs)) continue;
    const text = ev.segs
      .map((s) => s?.utf8 ?? '')
      .join('')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const startMs = Number(ev?.tStartMs ?? 0);
    const durMs = Number(ev?.dDurationMs ?? 0);
    if (!text || !Number.isFinite(startMs)) continue;
    out.push({
      text,
      startMs,
      endMs: Number.isFinite(durMs) ? startMs + durMs : startMs,
    });
  }
  return out;
}

/**
 * Fetch and parse a caption track as `json3` → segments.
 * Returns `[]` on any non-2xx or parse failure; the caller decides whether
 * to fall through to the next strategy.
 */
export async function fetchTimedTextSegments(baseUrl: string): Promise<TranscriptSegment[]> {
  let target: URL;
  try {
    target = new URL(baseUrl);
  } catch {
    return [];
  }
  target.searchParams.set('fmt', 'json3');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    return parseJson3Transcript(json);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scrape caption track metadata from the watch-page HTML. YouTube inlines
 * a `ytInitialPlayerResponse` JSON blob that contains the player's caption
 * tracklist; we match the `captionTracks` array with a balanced-bracket scan.
 *
 * Why not a plain regex? YouTube's JSON is dense and sometimes contains `]`
 * inside strings; a greedy/lazy `\[...\]` slice miscounts. The balanced scan
 * is ~20 lines, robust enough for our needs, and has no DOM dependency.
 */
export async function fetchCaptionTracksFromWatchPage(videoId: string): Promise<CaptionTrack[]> {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  const jsonArray = extractCaptionTracksArray(html);
  if (!jsonArray) return [];
  try {
    const parsed = JSON.parse(jsonArray) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normaliseRawTrack)
      .filter((t): t is CaptionTrack => t !== null && t.baseUrl.length > 0);
  } catch {
    return [];
  }
}

/**
 * Normalise a caption-track object from either the watch-page JSON or the
 * shape `youtubei.js` exposes on `info.captions.caption_tracks`.
 */
export function normaliseRawTrack(raw: unknown): CaptionTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl : (r.base_url as string | undefined);
  if (!baseUrl) return null;

  const languageCode =
    (typeof r.languageCode === 'string' ? r.languageCode : undefined) ??
    (typeof r.language_code === 'string' ? r.language_code : undefined) ??
    'en';

  const kind = (typeof r.kind === 'string' ? r.kind : null) ?? null;

  const nameObj =
    (r.name as { simpleText?: string; runs?: Array<{ text?: string }> } | undefined) ?? undefined;
  const name =
    nameObj && typeof nameObj === 'object'
      ? (nameObj.simpleText ?? nameObj.runs?.[0]?.text ?? null)
      : null;

  return { baseUrl, languageCode, kind, name };
}

/**
 * Locate `"captionTracks":[ ... ]` inside a watch-page HTML string using a
 * bracket-balanced scan. Returns the substring from the opening `[` to its
 * matching `]` (inclusive), or `null` if not found.
 *
 * Exported for unit tests.
 */
export function extractCaptionTracksArray(html: string): string | null {
  const marker = '"captionTracks":';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = html.indexOf('[', markerIdx);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}
