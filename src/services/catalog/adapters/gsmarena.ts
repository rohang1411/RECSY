import { parseHTML } from 'linkedom';
import { env } from '@/env';
import { llm } from '@/services/llm';
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';
import { makePoliteHttp } from '@/services/ingest/http';
import { NotFoundError } from '@/lib/errors';

const GSMARENA_HOST = 'www.gsmarena.com';
// GSMArena limits requests, 15 per min is a safe budget.
const http = makePoliteHttp({
  rateLimitOptions: {
    defaultMs: 4000,
    perHostMs: new Map([['www.gsmarena.com', 4000]]),
    jitter: 0,
  },
});

export async function isGsmarenaCatalogAvailable(): Promise<boolean> {
  try {
    return await http.isAllowed(`https://${GSMARENA_HOST}/res.php3?sSearch=test`);
  } catch {
    return false;
  }
}

/**
 * Check if the response body is a Cloudflare Turnstile / bot-challenge page.
 * If GSMArena detects scraping it serves this instead of real content.
 */
function isBotChallengePage(body: string): boolean {
  return (
    body.includes('cf-turnstile') ||
    body.includes('challenges.cloudflare.com') ||
    body.includes('Turnstile check') ||
    body.includes('turnstile-verify')
  );
}

export async function fetchGsmarenaSpecs(brand: string, model: string): Promise<PhoneSpec | null> {
  const query = `${brand} ${model}`.trim().replace(/\s+/g, '+');
  const searchUrl = `https://${GSMARENA_HOST}/res.php3?sSearch=${encodeURIComponent(query)}`;

  try {
    const searchRes = await http.get(searchUrl);

    // GSMArena is protected by Cloudflare Turnstile — detect and bail early.
    if (isBotChallengePage(searchRes.body)) {
      return null;
    }

    const rx = /href="(\/[a-z0-9_]+-\d+\.php)"/i;
    const m = searchRes.body.match(rx);
    if (!m) return null;

    const deviceUrl = `https://${GSMARENA_HOST}${m[1]}`;
    const deviceRes = await http.get(deviceUrl);

    // Also detect Turnstile on the device page.
    if (isBotChallengePage(deviceRes.body)) {
      return null;
    }

    const { document } = parseHTML(deviceRes.body);
    const specs = Array.from(document.querySelectorAll('[data-spec]'))
      .map((e) => ({
        key: e.getAttribute('data-spec'),
        value: e.textContent?.trim(),
      }))
      .filter((s) => s.value);

    // If fewer than 5 specs, something went wrong — don't waste an LLM call.
    if (specs.length < 5) return null;

    const prompt = `Extract phone specifications from the following GSMArena data into the required JSON schema. 
If a field is missing, omit it or use a default where appropriate.
If wattage is missing but fast charging is supported, leave watts blank or 0.
GSMArena Data:
${JSON.stringify(specs, null, 2)}`;

    const { value } = await llm.structured({
      model: env.LLM_CHAT_MODEL,
      schema: PhoneSpecSchema,
      schemaName: 'PhoneSpec',
      schemaDescription: 'Phone specification data extracted from GSMArena.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxOutputTokens: 2000,
      usageContext: {
        area: 'Catalog enrichment',
        feature: 'GSMArena spec extraction',
        source: 'catalog.gsmarena',
      },
    });

    return value;
  } catch (err) {
    if (err instanceof NotFoundError && String(err.message).includes('robots.txt disallowed')) {
      return null;
    }
    console.error(`[gsmarena-catalog] Failed to fetch specs for ${brand} ${model}:`, err);
    return null;
  }
}
