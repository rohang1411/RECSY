/**
 * Client-safe NDJSON (newline-delimited JSON) stream reader (Plan 26 WP-06).
 *
 * Reads an NDJSON HTTP response body stream:
 * - Buffers across chunk boundaries.
 * - Handles split multi-byte UTF-8 sequences via TextDecoder({ stream: true }).
 * - Emits parsed JSON objects.
 * - Flushes any trailing line at end of stream.
 * - Skips empty or whitespace lines.
 * - Catches malformed lines, calls optional onMalformed callback, and continues rather than aborting.
 */
export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onMalformed?: (line: string) => void,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as T;
          yield parsed;
        } catch {
          onMalformed?.(line);
        }
      }
    }

    buffer += decoder.decode();
    const finalTrimmed = buffer.trim();
    if (finalTrimmed) {
      try {
        const parsed = JSON.parse(finalTrimmed) as T;
        yield parsed;
      } catch {
        onMalformed?.(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
