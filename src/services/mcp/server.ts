/**
 * Model Context Protocol (MCP) server exposing RECSY's Hybrid RAG pipeline.
 *
 * Implements:
 * - Hybrid RAG pipeline fusing 60 vector (pgvector HNSW) and keyword (tsvector)
 *   candidates to 8 chunks via Reciprocal Rank Fusion (RRF).
 * - Claim-level citation validation (ALCE / sentence-level entailment) to limit
 *   hallucinations and ensure factual grounding.
 * - JSON-RPC 2.0 stdio and programmatic interface compatible with AI agent tools.
 */

import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import { logger } from '@/services/logger';
import { runPhoneQna } from '@/services/chat/answer';
import { validateCitationTags } from '@/services/chat/citations';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import { evaluateAnswerHeuristics } from '@/services/eval/metrics/supported-answers';
import { getLlm } from '@/services/llm';
import type { LlmProvider } from '@/services/llm/types';
import { createHybridRetriever } from '@/services/retrieval/factory';
import type { HybridRetriever } from '@/services/retrieval/retriever';

import type { JsonRpcRequest, JsonRpcResponse, McpToolDefinition, McpToolResult } from './types';

export interface McpServerDeps {
  readonly retriever?: HybridRetriever;
  readonly llm?: LlmProvider;
  readonly log?: Logger;
  readonly findPhoneBySlug?: (slug: string) => Promise<{ id: string; slug: string } | null>;
}

export class McpServer {
  private readonly retriever: HybridRetriever;
  private readonly llm: LlmProvider;
  private readonly log: Logger;
  private readonly findPhoneBySlug: (slug: string) => Promise<{ id: string; slug: string } | null>;

  constructor(deps: McpServerDeps = {}) {
    this.log = deps.log ?? logger.child({ component: 'mcp-server' });
    this.retriever = deps.retriever ?? createHybridRetriever();
    this.llm = deps.llm ?? getLlm();
    this.findPhoneBySlug =
      deps.findPhoneBySlug ??
      (async (slug: string) => {
        const db = getDb();
        const [found] = await db
          .select({ id: phones.id, slug: phones.slug })
          .from(phones)
          .where(eq(phones.slug, slug))
          .limit(1);
        return found ?? null;
      });
  }

  getToolDefinitions(): readonly McpToolDefinition[] {
    return [
      {
        name: 'search_phone_chunks',
        description:
          'Execute Hybrid RAG retrieval fusing 60 vector (pgvector HNSW) and keyword (tsvector) candidates to 8 chunks via Reciprocal Rank Fusion (RRF) and MMR.',
        inputSchema: {
          type: 'object',
          properties: {
            phoneSlug: {
              type: 'string',
              description:
                'The slug of the smartphone (e.g. samsung-galaxy-s25-plus, iphone-16-pro)',
            },
            query: {
              type: 'string',
              description: 'Search query for factual review chunks',
            },
            kPerRetriever: {
              type: 'number',
              description:
                'Number of candidates per retriever branch (default 30, yielding 60 total candidates)',
            },
            targetResults: {
              type: 'number',
              description: 'Final fused target chunk count after RRF and MMR (default 8)',
            },
          },
          required: ['phoneSlug', 'query'],
        },
      },
      {
        name: 'ask_phone_knowledge',
        description:
          'Query RECSY Hybrid RAG pipeline fusing 60 candidates to 8 chunks via RRF with claim-level citation validation to limit hallucinations.',
        inputSchema: {
          type: 'object',
          properties: {
            phoneSlug: {
              type: 'string',
              description: 'The smartphone slug (e.g. samsung-galaxy-s25-plus)',
            },
            question: {
              type: 'string',
              description:
                'Natural language question about device specs, battery, camera, or reviews',
            },
            validateClaims: {
              type: 'boolean',
              description:
                'Whether to enforce claim-level citation validation to detect and suppress hallucinations (default true)',
            },
          },
          required: ['phoneSlug', 'question'],
        },
      },
      {
        name: 'validate_claim_citations',
        description:
          'Perform claim-level citation validation on an answer against retrieved chunks to verify factual grounding and limit hallucinations.',
        inputSchema: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'Answer text containing citation tags like [c:<uuid>]',
            },
            query: {
              type: 'string',
              description: 'Original user question',
            },
            chunks: {
              type: 'array',
              description: 'Array of retrieved chunks against which claims should be grounded',
            },
          },
          required: ['answer', 'chunks'],
        },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      if (name === 'search_phone_chunks') {
        const phoneSlug = String(args.phoneSlug || '');
        const query = String(args.query || '');
        const kPerRetriever = typeof args.kPerRetriever === 'number' ? args.kPerRetriever : 30;
        const targetResults = typeof args.targetResults === 'number' ? args.targetResults : 8;

        const phone = await this.findPhoneBySlug(phoneSlug);
        if (!phone) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Phone with slug "${phoneSlug}" was not found.` }],
          };
        }

        const retrieval = await this.retriever.search({
          phoneId: phone.id,
          query,
          options: {
            kPerRetriever,
            targetResults,
            rrfK: 60,
          },
        });

        const output = {
          phone: phone.slug,
          query,
          candidatesFused: {
            vectorCandidates: retrieval.debug.vector.count,
            ftsCandidates: retrieval.debug.fts.count,
            totalFusedCandidates: retrieval.debug.vector.count + retrieval.debug.fts.count,
            targetResults: retrieval.chunks.length,
          },
          latencyTelemetry: {
            embeddingMs: Math.round(retrieval.debug.embedding?.ms ?? 0),
            vectorSearchMs: Math.round(retrieval.debug.vector.ms),
            ftsSearchMs: Math.round(retrieval.debug.fts.ms),
            rrfFusionMs: Math.round(retrieval.debug.rrf.ms),
            mmrMs: Math.round(retrieval.debug.mmr.ms),
            totalMs: Math.round(retrieval.debug.totalMs),
          },
          chunks: retrieval.chunks.map((c, i) => ({
            rank: i + 1,
            chunkId: c.chunkId,
            sourceTitle: c.source.title,
            sourceType: c.source.type,
            score: c.score ?? 0,
            textSnippet: c.text.slice(0, 200) + (c.text.length > 200 ? '...' : ''),
          })),
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      }

      if (name === 'ask_phone_knowledge') {
        const phoneSlug = String(args.phoneSlug || '');
        const question = String(args.question || '');
        const validateClaims = args.validateClaims !== false;

        const phone = await this.findPhoneBySlug(phoneSlug);
        if (!phone) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Phone with slug "${phoneSlug}" was not found.` }],
          };
        }

        const qnaResult = await runPhoneQna({
          phoneId: phone.id,
          query: question,
          retriever: this.retriever,
          llm: this.llm,
          log: this.log,
          retrievalOptions: {
            kPerRetriever: 30,
            targetResults: 8,
          },
        });

        let claimValidationReport = null;
        if (validateClaims && qnaResult.retrieval.chunks.length > 0) {
          const chunkMap = new Map(
            qnaResult.retrieval.chunks.map((c) => [c.chunkId.toLowerCase(), c.text]),
          );
          const evalResult = evaluateAnswerHeuristics({
            query: question,
            answerText: qnaResult.text,
            retrievedChunks: chunkMap,
            referenceFacts: [],
          });

          claimValidationReport = {
            lexicalCitationSupport: evalResult.lexicalCitationSupport,
            passesHeuristicChecks: evalResult.passesHeuristicChecks,
            hallucinationRisk: evalResult.violations.length > 0 ? 'HIGH' : 'LOW',
            violations: evalResult.violations,
            unmatchedSentences: evalResult.unmatchedSentences,
          };
        }

        const output = {
          phone: phone.slug,
          question,
          answer: qnaResult.text,
          citations: qnaResult.citations,
          retrieval: {
            totalChunksRetrieved: qnaResult.retrieval.chunks.length,
            vectorCandidates: qnaResult.retrieval.debug.vector.count,
            ftsCandidates: qnaResult.retrieval.debug.fts.count,
            totalCandidatesFused:
              qnaResult.retrieval.debug.vector.count + qnaResult.retrieval.debug.fts.count,
            retrievalLatencyMs: Math.round(qnaResult.retrieval.debug.totalMs),
          },
          claimValidation: claimValidationReport,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      }

      if (name === 'validate_claim_citations') {
        const answer = String(args.answer || '');
        const query = String(args.query || '');
        const rawChunks = Array.isArray(args.chunks) ? args.chunks : [];
        const chunkMap = new Map<string, string>();

        for (const item of rawChunks) {
          if (item && typeof item === 'object') {
            const id = String(
              (item as { chunkId?: string; id?: string }).chunkId ??
                (item as { id?: string }).id ??
                '',
            );
            const text = String((item as { text?: string }).text ?? '');
            if (id) {
              chunkMap.set(id.toLowerCase(), text);
            }
          }
        }

        const tagValidation = validateCitationTags(answer, new Set(chunkMap.keys()));
        const evalResult = evaluateAnswerHeuristics({
          query,
          answerText: answer,
          retrievedChunks: chunkMap,
          referenceFacts: [],
        });

        const output = {
          citationsValid: tagValidation.ok,
          invalidTagIds: tagValidation.ok ? [] : tagValidation.invalid,
          lexicalCitationSupport: evalResult.lexicalCitationSupport,
          passesHeuristicChecks: evalResult.passesHeuristicChecks,
          hallucinationRisk: !tagValidation.ok || evalResult.violations.length > 0 ? 'HIGH' : 'LOW',
          violations: [
            ...(tagValidation.ok
              ? []
              : tagValidation.invalid.map((id) => `Unknown citation ID tag [${id}]`)),
            ...evalResult.violations,
          ],
          unmatchedSentences: evalResult.unmatchedSentences,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      }

      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool execution failed: ${errorMsg}` }],
      };
    }
  }

  async handleJsonRpcMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'recsy-hybrid-rag',
            version: '2.0.0',
          },
        },
      };
    }

    if (req.method === 'notifications/initialized') {
      return null;
    }

    if (req.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    if (req.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.getToolDefinitions(),
        },
      };
    }

    if (req.method === 'tools/call') {
      const params = req.params ?? {};
      const name = String(params.name || '');
      const args = (params.arguments as Record<string, unknown>) ?? {};

      const toolResult = await this.callTool(name, args);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: toolResult.content,
          isError: toolResult.isError ?? false,
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${req.method}`,
      },
    };
  }

  /**
   * Starts a standard JSON-RPC 2.0 stdio server on stdin/stdout.
   */
  startStdio(): void {
    let buffer = '';
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', async (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as JsonRpcRequest;
          const resp = await this.handleJsonRpcMessage(parsed);
          if (resp) {
            process.stdout.write(JSON.stringify(resp) + '\n');
          }
        } catch (err) {
          const errResp: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            },
          };
          process.stdout.write(JSON.stringify(errResp) + '\n');
        }
      }
    });
  }
}
