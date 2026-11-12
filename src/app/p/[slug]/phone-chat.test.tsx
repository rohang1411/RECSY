// @vitest-environment jsdom
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PhoneChat } from './phone-chat';

function createMockNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(enc.encode(`${line}\n`));
      }
      controller.close();
    },
  });
}

describe('PhoneChat component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders progressive deltas and citation chips before done event arrives', async () => {
    const chunkId = '00000000-0000-0000-0000-000000000001';
    const lines = [
      JSON.stringify({ type: 'status', stage: 'retrieving' }),
      JSON.stringify({ type: 'meta', phoneId: 'p-1', retrievedChunkIds: [chunkId] }),
      JSON.stringify({ type: 'status', stage: 'generating' }),
      JSON.stringify({
        type: 'citation',
        citation: {
          chunkId,
          sourceUrl: 'https://example.com/review',
          title: 'Camera Review',
          type: 'article',
          anchor: null,
          startTs: null,
        },
      }),
      JSON.stringify({ type: 'delta', text: 'Camera has ' }),
      JSON.stringify({ type: 'delta', text: `great zoom [c:${chunkId}].` }),
      JSON.stringify({
        type: 'done',
        citations: [
          {
            chunkId,
            sourceUrl: 'https://example.com/review',
            title: 'Camera Review',
            type: 'article',
            anchor: null,
            startTs: null,
          },
        ],
        usage: { tokensIn: 10, tokensOut: 20 },
        model: 'test-model',
        retrievalMs: 15,
        streamed: true,
      }),
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: createMockNdjsonStream(lines),
    });

    render(<PhoneChat phoneSlug="pixel-9" />);

    const textarea = screen.getByPlaceholderText(/How is the battery life/i);
    const askButton = screen.getByRole('button', { name: /Ask/i });

    fireEvent.change(textarea, { target: { value: 'How is the camera?' } });

    await act(async () => {
      fireEvent.click(askButton);
    });

    expect(screen.getByText(/Camera has/i)).toBeDefined();
    expect(screen.getByText(/great zoom/i)).toBeDefined();
    expect(screen.getByText('1')).toBeDefined(); // Citation chip label 1
  });

  it('keeps partial answer visible if an error occurs after deltas', async () => {
    const lines = [
      JSON.stringify({ type: 'status', stage: 'retrieving' }),
      JSON.stringify({ type: 'status', stage: 'generating' }),
      JSON.stringify({ type: 'delta', text: 'Partial answer delivered before error ' }),
      JSON.stringify({ type: 'error', code: 'LLM_TIMEOUT', message: 'Model generation timed out' }),
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: createMockNdjsonStream(lines),
    });

    render(<PhoneChat phoneSlug="pixel-9" />);

    const textarea = screen.getByPlaceholderText(/How is the battery life/i);
    const askButton = screen.getByRole('button', { name: /Ask/i });

    fireEvent.change(textarea, { target: { value: 'Battery?' } });

    await act(async () => {
      fireEvent.click(askButton);
    });

    // Partial answer must still be rendered
    expect(screen.getByText(/Partial answer delivered before error/i)).toBeDefined();
    // Error banner rendered below
    expect(screen.getByText(/Error: Model generation timed out/i)).toBeDefined();
  });
});
