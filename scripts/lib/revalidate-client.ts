/**
 * Script client for protected cache revalidation.
 *
 * Requirements (Plan 26 WP-07):
 * - No-op with an info log when REVALIDATE_URL or REVALIDATE_SECRET is unset.
 * - Signs payload with HMAC-SHA256 and POSTs with 5s timeout.
 * - 2 retries with exponential backoff and jitter.
 * - NEVER throws: catches errors and logs warnings, since TTLs bound staleness.
 */
import { computeHmacSha256 } from '../../src/lib/hmac';

export async function revalidatePublicTags(tags: string[], reason: string): Promise<void> {
  const url = process.env.REVALIDATE_URL?.trim();
  const secret = process.env.REVALIDATE_SECRET?.trim();

  if (!url || !secret) {
    console.log(
      `[revalidate-client] REVALIDATE_URL or REVALIDATE_SECRET unset; skipping revalidation for ${tags.length} tags (${reason}).`,
    );
    return;
  }

  if (tags.length === 0) {
    return;
  }

  const payload = JSON.stringify({ tags, reason });
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const timestamp = String(Date.now());
      const signature = computeHmacSha256(`${timestamp}.${payload}`, secret);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-recsy-timestamp': timestamp,
          'x-recsy-signature': signature,
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        console.log(
          `[revalidate-client] Successfully revalidated ${tags.length} tags: ${tags.join(', ')} (${reason})`,
        );
        return;
      }

      const text = await response.text().catch(() => '');
      console.warn(
        `[revalidate-client] Revalidate attempt ${attempt}/${maxAttempts} returned HTTP ${response.status}: ${text}`,
      );
    } catch (err: unknown) {
      console.warn(
        `[revalidate-client] Revalidate attempt ${attempt}/${maxAttempts} failed:`,
        err instanceof Error ? err.message : err,
      );
    }

    if (attempt < maxAttempts) {
      // Exponential backoff with jitter: 200ms, 400ms + jitter
      const backoffMs = 200 * Math.pow(2, attempt - 1) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  console.warn(
    `[revalidate-client] Cache revalidation failed after ${maxAttempts} attempts; TTLs will refresh entries naturally.`,
  );
}
