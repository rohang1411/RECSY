/**
 * Wikipedia API adapter for phone spec enrichment.
 *
 * Strategy:
 *   1. Search Wikipedia via `action=opensearch` for the brand + model.
 *   2. Fetch the article wikitext via `action=parse&prop=wikitext`.
 *   3. Extract the `{{Infobox mobile phone}}` block from the wikitext.
 *   4. Use the LLM to convert the raw infobox into a `PhoneSpec` object.
 *
 * Wikipedia explicitly allows programmatic API access with a proper User-Agent,
 * so we use native `fetch` instead of the PoliteHttp wrapper. We do add a
 * 1-second sleep between calls to be respectful.
 */
import { env } from '@/env';
import { llm } from '@/services/llm';
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

const USER_AGENT =
  'RECSYBot/0.1 (https://github.com/rohan; catalog spec enrichment) contact: github issues';

/** Pause execution for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shared fetch wrapper that always sets the required User-Agent header. */
async function wikiApiFetch(params: Record<string, string>): Promise<Response> {
  const url = new URL(WIKIPEDIA_API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
}

/**
 * Search Wikipedia for a phone article and return the best-matching title,
 * or null if none is found.
 */
async function searchPhoneTitle(brand: string, model: string): Promise<string | null> {
  const query = `${brand} ${model}`.trim();
  const res = await wikiApiFetch({
    action: 'opensearch',
    search: query,
    limit: '5',
    format: 'json',
  });

  if (!res.ok) return null;

  // OpenSearch response: [query, [titles], [descriptions], [urls]]
  const data = (await res.json()) as [string, string[], string[], string[]];
  const titles: string[] = data[1] ?? [];

  const brandLower = brand.toLowerCase();
  const modelLower = model.toLowerCase();

  // Pick the first result whose title contains either the brand or the model.
  const match = titles.find((t) => {
    const tl = t.toLowerCase();
    return tl.includes(brandLower) || tl.includes(modelLower);
  });

  return match ?? null;
}

/**
 * Fetch the raw wikitext of a Wikipedia article by page title.
 */
async function fetchWikitext(pageTitle: string): Promise<string | null> {
  const res = await wikiApiFetch({
    action: 'parse',
    page: pageTitle,
    prop: 'wikitext',
    format: 'json',
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { parse?: { wikitext?: { '*'?: string } } };
  return data?.parse?.wikitext?.['*'] ?? null;
}

/**
 * Extract the `{{Infobox mobile phone}}` (or similar) block from wikitext.
 * Returns null if no infobox is found.
 */
function extractInfobox(wikitext: string): string | null {
  // Match case-insensitively: infobox mobile phone, infobox smartphone, etc.
  const startPattern = /\{\{[Ii]nfobox\s+(?:mobile\s+phone|smartphone|phone)/i;
  const startMatch = wikitext.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return null;

  // Walk forward tracking brace depth to find the matching closing `}}`.
  let depth = 0;
  let i = startMatch.index;
  const end = wikitext.length;

  while (i < end) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++;
      i += 2;
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      i += 2;
      if (depth === 0) break;
    } else {
      i++;
    }
  }

  return wikitext.slice(startMatch.index, i);
}

/**
 * Use the LLM to parse raw infobox wikitext into a structured `PhoneSpec`.
 */
async function parseInfoboxWithLlm(infoboxWikitext: string): Promise<PhoneSpec | null> {
  const prompt = `You are extracting phone specifications from a raw Wikipedia infobox in wikitext format.
Convert the infobox data into the required JSON schema for a PhoneSpec object.

Rules:
- Only include fields that are clearly present in the infobox. Do NOT invent or guess values.
- Camera entries should be extracted from fields like "camera", "rear camera", "main camera", "back camera".
- Battery capacity (mah) should come from the "battery" field.
- RAM (ram_gb) and storage (storage_options_gb) from "memory", "ram", "storage", or "internal storage" fields.
- Display info (size_in, resolution, refresh_rate_hz, panel_type) from "screen", "display" fields.
- Omit optional fields entirely if the infobox does not contain them.
- For storage_options_gb, parse all listed storage variants (e.g. "128 GB, 256 GB, 512 GB") into an array of numbers.
- For ram_gb, use the highest listed RAM variant as a single integer.
- For wired charging watts (wired_w), parse from "charging" or "fast charging" fields if wattage is stated.

Raw Wikipedia infobox wikitext:
${infoboxWikitext}`;

  try {
    const { value } = await llm.structured({
      model: env.LLM_CHAT_MODEL,
      schema: PhoneSpecSchema,
      schemaName: 'PhoneSpec',
      schemaDescription: 'Phone specification data extracted from a Wikipedia infobox.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxOutputTokens: 2000,
    });
    return value;
  } catch (err) {
    console.error('[wikipedia-catalog] LLM structured extraction failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch phone specifications from Wikipedia for the given brand + model.
 *
 * @returns A `PhoneSpec` object, or `null` if the article / infobox is not
 *          found or any step fails.
 */
export async function fetchWikipediaSpecs(brand: string, model: string): Promise<PhoneSpec | null> {
  try {
    // Step 1 — find the article title.
    const pageTitle = await searchPhoneTitle(brand, model);
    if (!pageTitle) {
      return null;
    }

    await sleep(1000);

    // Step 2 — fetch the raw wikitext.
    const wikitext = await fetchWikitext(pageTitle);
    if (!wikitext) {
      return null;
    }

    // Step 3 — extract the infobox block (saves LLM call if absent).
    const infobox = extractInfobox(wikitext);
    if (!infobox) {
      return null;
    }

    await sleep(1000);

    // Step 4 — convert infobox to PhoneSpec via LLM.
    const spec = await parseInfoboxWithLlm(infobox);
    if (!spec) {
      console.warn(`[wikipedia-catalog] LLM failed to produce a valid spec for "${pageTitle}"`);
      return null;
    }

    return spec;
  } catch (err) {
    console.error(`[wikipedia-catalog] Failed to fetch specs for ${brand} ${model}:`, err);
    return null;
  }
}

/**
 * Ping the Wikipedia API to verify it is reachable.
 *
 * @returns `true` if the API responds with HTTP 200, `false` otherwise.
 */
export async function checkWikipediaAvailability(): Promise<boolean> {
  try {
    const res = await wikiApiFetch({
      action: 'query',
      meta: 'siteinfo',
      format: 'json',
    });
    return res.ok;
  } catch {
    return false;
  }
}
