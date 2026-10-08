import { createServer } from 'node:http';
import { z } from 'zod';
import { DeterministicLlmProvider } from '../src/services/eval/stub/deterministic-llm';
import type { ChatInput, StructuredInput } from '../src/services/llm/types';

const token = process.env.EVAL_CONTROLLED_PROVIDER_TOKEN;
if (!token || token.length < 16) throw new Error('EVAL_CONTROLLED_PROVIDER_TOKEN required');
const provider = new DeterministicLlmProvider();
let mode = 'normal';
let calls = 0;
const server = createServer(async (req, res) => {
  const send = (status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (req.headers['x-eval-token'] !== token) {
    send(401, { error: 'Unauthorized' });
    return;
  }
  try {
    const pieces: Buffer[] = [];
    for await (const piece of req) pieces.push(Buffer.from(piece));
    const input = JSON.parse(Buffer.concat(pieces).toString() || '{}');
    if (req.url === '/control') {
      if (
        ![
          'normal',
          'chat-fail',
          'embed-fail',
          'structured-fail',
          'invalid-citations',
          'timeout',
        ].includes(input.mode)
      )
        throw new Error('Unknown fault');
      mode = input.mode;
      send(200, { mode, calls });
      return;
    }
    if (req.url === '/status') {
      send(200, { mode, calls });
      return;
    }
    calls++;
    if (mode === 'timeout') {
      await new Promise((r) => setTimeout(r, 1800));
    }
    if (
      (mode === 'chat-fail' && req.url === '/chat') ||
      (mode === 'embed-fail' && req.url === '/embed') ||
      (mode === 'structured-fail' && req.url === '/structured')
    ) {
      send(429, { error: 'Injected provider throttling' });
      return;
    }
    if (req.url === '/chat') {
      const result = await provider.chat(input as ChatInput);
      send(200, {
        ...result,
        text:
          mode === 'invalid-citations'
            ? 'An unsupported test statement [c:00000000-0000-0000-0000-000000000000].'
            : result.text,
        usage: { tokensIn: 0, tokensOut: 0 },
        model: 'controlled-test-no-quality',
      });
    } else if (req.url === '/structured') {
      const result = await provider.structured({
        ...input,
        schema: z.unknown(),
      } as StructuredInput<unknown>);
      send(200, {
        ...result,
        usage: { tokensIn: 0, tokensOut: 0 },
        model: 'controlled-test-no-quality',
      });
    } else if (req.url === '/embed') {
      const result = await provider.embed(input.texts);
      send(200, { ...result, usage: { tokensIn: 0 }, model: 'controlled-test-no-quality' });
    } else send(404, { error: 'Unknown operation' });
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : String(error) });
  }
});
server.listen(3210, '127.0.0.1', () =>
  console.log('Controlled provider on 127.0.0.1:3210; all outputs are test fixtures'),
);
process.on('SIGTERM', () => server.close());
