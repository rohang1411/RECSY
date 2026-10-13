import { describe, expect, it, vi } from 'vitest';

import type { LlmProvider } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { RetrievalResult, RetrievedChunk } from '@/services/retrieval/types';

import { McpServer } from './server';
import type { JsonRpcRequest } from './types';

function createMockChunk(id: string, text: string): RetrievedChunk {
  return {
    chunkId: id,
    sourceId: 'source-1',
    text,
    score: 0.88,
    source: {
      id: 'source-1',
      title: 'GSMArena Detailed Review',
      type: 'article',
      url: 'https://example.com/review',
      author: null,
      channel: null,
      publishedAt: null,
    },
  };
}

describe('McpServer - Hybrid RAG and Claim-Level Validation Protocol', () => {
  const mockChunks: RetrievedChunk[] = [
    createMockChunk(
      'c1111111-1111-1111-1111-111111111111',
      'The battery capacity is 4900mAh and delivered 14 hours of active web browsing in standardized battery tests.',
    ),
    createMockChunk(
      'c2222222-2222-2222-2222-222222222222',
      'The primary camera features a 50MP sensor with optical image stabilization and excellent dynamic range in low light.',
    ),
  ];

  const mockRetrievalResult: RetrievalResult = {
    chunks: mockChunks,
    debug: {
      phoneId: 'test-phone-uuid',
      query: 'battery life test',
      embedding: { ms: 12 },
      vector: { ms: 8, count: 30 },
      fts: { ms: 6, count: 30 },
      rrf: { ms: 1.2, count: 60 },
      mmr: { ms: 0.8, count: 8 },
      totalMs: 28,
      sourceQuality: { ms: 0.1, excludedChunkIds: [] },
      coverage: { sourceCount: 1, relaxed: false },
    },
  };

  const mockRetriever = {
    search: vi.fn(async () => mockRetrievalResult),
  } as unknown as HybridRetriever;

  const mockLlm = {
    chat: vi.fn(async () => ({
      text: 'The battery has 4900mAh capacity [c:c1111111-1111-1111-1111-111111111111].',
      usage: { tokensIn: 120, tokensOut: 45 },
      model: 'gemini-2.5-flash',
      cached: false,
    })),
  } as unknown as LlmProvider;

  const mockFindPhone = vi.fn(async (slug: string) => {
    if (slug === 'samsung-galaxy-s25-plus') {
      return { id: 'test-phone-uuid', slug: 'samsung-galaxy-s25-plus' };
    }
    return null;
  });

  const server = new McpServer({
    retriever: mockRetriever,
    llm: mockLlm,
    findPhoneBySlug: mockFindPhone,
  });

  it('handles MCP initialize handshake conformant to 2024-11-05 spec', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    };

    const resp = await server.handleJsonRpcMessage(req);
    expect(resp).not.toBeNull();
    expect(resp?.id).toBe(1);
    expect(resp?.result?.protocolVersion).toBe('2024-11-05');
    expect(resp?.result?.serverInfo).toEqual({
      name: 'recsy-hybrid-rag',
      version: '2.0.0',
    });
  });

  it('exposes tools list including search_phone_chunks, ask_phone_knowledge, and validate_claim_citations', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    };

    const resp = await server.handleJsonRpcMessage(req);
    expect(resp).not.toBeNull();
    const tools = (resp?.result?.tools as Array<{ name: string }>) ?? [];
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('search_phone_chunks');
    expect(toolNames).toContain('ask_phone_knowledge');
    expect(toolNames).toContain('validate_claim_citations');
  });

  it('executes search_phone_chunks fusing 60 vector & keyword candidates to 8 chunks via RRF', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_phone_chunks',
        arguments: {
          phoneSlug: 'samsung-galaxy-s25-plus',
          query: 'battery life test',
          kPerRetriever: 30,
          targetResults: 8,
        },
      },
    };

    const resp = await server.handleJsonRpcMessage(req);
    expect(resp).not.toBeNull();
    expect(resp?.result?.isError).toBe(false);
    const content = (resp?.result?.content as Array<{ text: string }>)[0]?.text;
    expect(content).toBeDefined();

    const parsed = JSON.parse(content!);
    expect(parsed.candidatesFused.vectorCandidates).toBe(30);
    expect(parsed.candidatesFused.ftsCandidates).toBe(30);
    expect(parsed.candidatesFused.totalFusedCandidates).toBe(60);
    expect(parsed.latencyTelemetry.totalMs).toBe(28);
    expect(parsed.chunks.length).toBe(2);
  });

  it('executes validate_claim_citations and flags hallucinated citations and unsupported claims', async () => {
    // 1. Valid citation claim
    const validCall = await server.callTool('validate_claim_citations', {
      answer: 'The battery capacity is 4900mAh [c:c1111111-1111-1111-1111-111111111111].',
      query: 'What is the battery size?',
      chunks: [
        {
          chunkId: 'c1111111-1111-1111-1111-111111111111',
          text: 'The battery capacity is 4900mAh with long endurance.',
        },
      ],
    });
    expect(validCall.isError).toBeUndefined();
    const validReport = JSON.parse(validCall.content[0]!.text);
    expect(validReport.citationsValid).toBe(true);
    expect(validReport.hallucinationRisk).toBe('LOW');

    // 2. Hallucinated / orphaned citation tag
    const hallucinatedCall = await server.callTool('validate_claim_citations', {
      answer: 'It supports 150W ultra fast charging [c:99999999-9999-9999-9999-999999999999].',
      query: 'What is the charging speed?',
      chunks: [
        {
          chunkId: 'c1111111-1111-1111-1111-111111111111',
          text: 'The battery capacity is 4900mAh with standard 45W wired charging.',
        },
      ],
    });
    const halluReport = JSON.parse(hallucinatedCall.content[0]!.text);
    expect(halluReport.citationsValid).toBe(false);
    expect(halluReport.hallucinationRisk).toBe('HIGH');
    expect(halluReport.invalidTagIds).toContain('99999999-9999-9999-9999-999999999999');
  });

  it('returns graceful error when phone slug does not exist', async () => {
    const result = await server.callTool('search_phone_chunks', {
      phoneSlug: 'non-existent-device-xyz',
      query: 'camera quality',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('non-existent-device-xyz');
  });

  it('handles unknown JSON-RPC methods with error code -32601', async () => {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 99,
      method: 'unknown_method_test',
    };
    const resp = await server.handleJsonRpcMessage(req);
    expect(resp?.error?.code).toBe(-32601);
  });
});
