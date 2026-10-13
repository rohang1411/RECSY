#!/usr/bin/env tsx
/**
 * RECSY Model Context Protocol (MCP) Server CLI.
 *
 * Runs the standard stdio JSON-RPC 2.0 MCP server exposing:
 * - `ask_phone_knowledge`: Hybrid RAG with claim-level citation validation
 * - `search_phone_chunks`: Fusing 60 vector & keyword candidates to 8 chunks via RRF
 * - `validate_claim_citations`: Claim-level citation validation to limit hallucinations
 *
 * Usage:
 *   pnpm mcp:server
 */
import { McpServer } from '@/services/mcp';

function main(): void {
  const server = new McpServer();
  server.startStdio();
}

main();
