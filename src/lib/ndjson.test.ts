import { describe, expect, it, vi } from 'vitest';
import { readNdjson } from './ndjson';

function createStreamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe('readNdjson', () => {
  const enc = new TextEncoder();

  it('reads multiple complete JSON lines', async () => {
    const stream = createStreamFromChunks([
      enc.encode('{"type":"status","stage":"retrieving"}\n{"type":"delta","text":"Hello"}\n'),
    ]);

    const results: unknown[] = [];
    for await (const obj of readNdjson(stream)) {
      results.push(obj);
    }

    expect(results).toEqual([
      { type: 'status', stage: 'retrieving' },
      { type: 'delta', text: 'Hello' },
    ]);
  });

  it('handles chunks split in the middle of a JSON line', async () => {
    const stream = createStreamFromChunks([
      enc.encode('{"type":"de'),
      enc.encode('lta","text":"world"}\n'),
    ]);

    const results: unknown[] = [];
    for await (const obj of readNdjson(stream)) {
      results.push(obj);
    }

    expect(results).toEqual([{ type: 'delta', text: 'world' }]);
  });

  it('handles chunks split inside a multi-byte UTF-8 character', async () => {
    // Rupee symbol ₹ is 3 bytes: 0xE2, 0x82, 0xB9
    const jsonStr = '{"symbol":"₹"}\n';
    const bytes = enc.encode(jsonStr);
    // Split right in the middle of the 3-byte sequence
    const splitIdx = jsonStr.indexOf('₹') + 1; // 1 byte into ₹
    const chunk1 = bytes.slice(0, splitIdx);
    const chunk2 = bytes.slice(splitIdx);

    const stream = createStreamFromChunks([chunk1, chunk2]);

    const results: unknown[] = [];
    for await (const obj of readNdjson(stream)) {
      results.push(obj);
    }

    expect(results).toEqual([{ symbol: '₹' }]);
  });

  it('flushes trailing line even without trailing newline', async () => {
    const stream = createStreamFromChunks([enc.encode('{"a":1}\n{"b":2}')]);

    const results: unknown[] = [];
    for await (const obj of readNdjson(stream)) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips malformed lines and reports via onMalformed without aborting stream', async () => {
    const onMalformed = vi.fn();
    const stream = createStreamFromChunks([
      enc.encode('{"valid":1}\n{not-json-line}\n{"valid":2}\n'),
    ]);

    const results: unknown[] = [];
    for await (const obj of readNdjson(stream, onMalformed)) {
      results.push(obj);
    }

    expect(results).toEqual([{ valid: 1 }, { valid: 2 }]);
    expect(onMalformed).toHaveBeenCalledWith('{not-json-line}');
  });
});
