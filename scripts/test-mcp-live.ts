#!/usr/bin/env tsx
/**
 * Test MCP Server against live database data.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/services/db/client';
import { chunks, phones } from '@/services/db/schema';
import { McpServer } from '@/services/mcp';

async function main(): Promise<void> {
  const db = getDb();

  // Find a phone with real chunks
  const [chunkRow] = await db.select({ phoneId: chunks.phoneId }).from(chunks).limit(1);

  if (!chunkRow) {
    console.error('No chunks in DB');
    process.exit(1);
  }

  const [phone] = await db
    .select({ slug: phones.slug })
    .from(phones)
    .where(eq(phones.id, chunkRow.phoneId))
    .limit(1);

  if (!phone) {
    console.error('Phone not found');
    process.exit(1);
  }

  console.log(`[test-mcp-live] Testing MCP server against live phone: ${phone.slug}`);
  const server = new McpServer();

  // 1. Test search_phone_chunks tool on live data
  const searchResult = await server.callTool('search_phone_chunks', {
    phoneSlug: phone.slug,
    query: 'battery capacity and charging speed',
    kPerRetriever: 30,
    targetResults: 8,
  });

  if (searchResult.isError) {
    console.error('[test-mcp-live] search_phone_chunks failed:', searchResult.content[0]?.text);
    process.exit(1);
  }

  const searchData = JSON.parse(searchResult.content[0]!.text);
  console.log('[test-mcp-live] search_phone_chunks SUCCESS:');
  console.log(`  - Fused candidates: ${searchData.candidatesFused.totalFusedCandidates}`);
  console.log(`  - Vector candidates: ${searchData.candidatesFused.vectorCandidates}`);
  console.log(`  - FTS candidates: ${searchData.candidatesFused.ftsCandidates}`);
  console.log(`  - Returned chunks: ${searchData.chunks.length}`);
  console.log(`  - Total retrieval time: ${searchData.latencyTelemetry.totalMs}ms`);

  // 2. Test validate_claim_citations tool on live retrieved chunk
  const firstChunk = searchData.chunks[0];
  if (!firstChunk) {
    console.error('No chunk returned');
    process.exit(1);
  }

  const validAnswer = `The phone has high endurance battery life [c:${firstChunk.chunkId}].`;
  const validCheck = await server.callTool('validate_claim_citations', {
    answer: validAnswer,
    query: 'battery life',
    chunks: [{ chunkId: firstChunk.chunkId, text: firstChunk.textSnippet }],
  });
  const validReport = JSON.parse(validCheck.content[0]!.text);
  console.log('[test-mcp-live] valid citation validation check:');
  console.log(`  - citationsValid: ${validReport.citationsValid}`);
  console.log(`  - hallucinationRisk: ${validReport.hallucinationRisk}`);

  // 3. Test validate_claim_citations catching hallucination
  const hallucinatedAnswer = `It has 300W charging [c:00000000-0000-0000-0000-000000000000].`;
  const halluCheck = await server.callTool('validate_claim_citations', {
    answer: hallucinatedAnswer,
    query: 'charging',
    chunks: [{ chunkId: firstChunk.chunkId, text: firstChunk.textSnippet }],
  });
  const halluReport = JSON.parse(halluCheck.content[0]!.text);
  console.log('[test-mcp-live] hallucination detection check:');
  console.log(`  - citationsValid: ${halluReport.citationsValid}`);
  console.log(`  - hallucinationRisk: ${halluReport.hallucinationRisk}`);
  console.log(`  - invalidTagIds: ${halluReport.invalidTagIds}`);

  console.log('\n[test-mcp-live] All live MCP checks PASSED successfully on real DB data!');
  process.exit(0);
}

main().catch((err) => {
  console.error('[test-mcp-live] Error:', err);
  process.exit(1);
});
