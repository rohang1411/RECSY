import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../src/env';
import { getPostgres } from '../src/services/db/client';
import { GeminiProvider } from '../src/services/llm/gemini';
import { logger } from '../src/services/logger';
import {
  HybridRetriever,
  resetHybridRetrieverQueryEmbeddingCache,
} from '../src/services/retrieval/retriever';
import { VectorSearch } from '../src/services/retrieval/vector';
import { FtsSearch } from '../src/services/retrieval/fts';
import { runPhoneQna } from '../src/services/chat/answer';
import { diagnoseEvaluationError } from '../src/services/eval/errors';
import type { RetrievalResult, Retriever } from '../src/services/retrieval/types';

async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  if (process.argv.includes('--live') && !process.argv.includes('--after-quota-reset')) {
    const previous = await readFile(
      resolve(stage.outputDir, 'campaign-summary.json'),
      'utf8',
    ).catch(() => null);
    if (previous && JSON.parse(previous).quotaStopped)
      throw new Error(
        'Previous campaign stopped on provider quota. Verify the quota reset before explicitly using --after-quota-reset. Original results remain preserved.',
      );
  }
  if (env.DATABASE_SCHEMA !== stage.namespace || !env.DATABASE_SCHEMA.startsWith('eval_'))
    throw new Error('Set DATABASE_SCHEMA to the current isolated stage before quality evaluation');
  const snapshot = JSON.parse(await readFile(resolve(stage.outputDir, 'corpus.json'), 'utf8'));
  const fixtureRaw = await readFile('fixtures/eval/source-pilot.json', 'utf8');
  const fixture = JSON.parse(fixtureRaw) as {
    version: string;
    status: string;
    cases: Array<{
      id: string;
      phoneSlug: string;
      category: string;
      query: string;
      supportingChunkIds: string[];
      candidateFacts: string[];
    }>;
  };
  const unique = new Set<string>();
  for (const item of fixture.cases) {
    if (unique.has(item.id)) throw new Error(`Duplicate question ${item.id}`);
    unique.add(item.id);
    const phone = snapshot.phones.find(
      (p: { slug: string; id: string; status: string }) =>
        p.slug === item.phoneSlug && p.status === 'active',
    );
    if (!phone) throw new Error(`Missing active phone ${item.phoneSlug}`);
    for (const id of item.supportingChunkIds) {
      const chunk = snapshot.chunks.find(
        (c: { id: string; phone_id: string; status: string }) =>
          c.id === id && c.phone_id === phone.id && c.status === 'active',
      );
      if (!chunk)
        throw new Error(
          `${item.id}: supporting chunk ${id} missing, inactive or belongs to another phone`,
        );
    }
  }
  const sql = getPostgres();
  const [identity] = await sql`select current_schema() as schema`;
  if (identity?.schema !== stage.namespace) throw new Error('Database schema isolation failed');
  await sql.begin('isolation level repeatable read', async (tx) => {
    const phones = await tx`select id,slug,brand,model,status from phones order by id`;
    const rows =
      await tx`select c.id,c.phone_id,c.source_id,c.text,c.start_ts,c.anchor,s.title,s.url,s.type,s.status,s.content_hash,s.published_at from chunks c join sources s on s.id=c.source_id order by c.id`;
    const chunks = rows.map((c) => ({
      ...c,
      textHash: createHash('sha256').update(c.text).digest('hex'),
    }));
    const actualHash = createHash('sha256')
      .update(JSON.stringify({ phones, chunks }))
      .digest('hex');
    if (actualHash !== snapshot.sha256)
      throw new Error(
        'Corpus content/catalog/source provenance drift; freeze a new reviewed snapshot before making provider calls',
      );
  });
  const filePaths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((p) => p && !p.startsWith('.env') && !p.startsWith('output/'));
  const codeHashes: Record<string, string> = {};
  for (const path of filePaths.sort())
    codeHashes[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const manifest = {
    runId: randomUUID(),
    at: new Date().toISOString(),
    schema: stage.namespace,
    corpusSha256: snapshot.sha256,
    fixtureSha256: createHash('sha256').update(fixtureRaw).digest('hex'),
    codeSha256: createHash('sha256').update(JSON.stringify(codeHashes)).digest('hex'),
    codeHashes,
    model: env.LLM_CHAT_MODEL,
    embeddingModel: env.LLM_EMBEDDING_MODEL,
    cache: false,
    temperature: 0.35,
    independentReview: 'pending',
    benchmarkStatus: fixture.status,
    heldOutClaim: false,
    generationBudget: 20,
    embeddingBudget: 12,
    sdkRetries: 0,
    maxKeys: 2,
    stopOnFirstQuotaError: true,
  };
  const dir = resolve(stage.outputDir, 'quality', manifest.runId);
  await mkdir(dir, { recursive: true });
  // Freeze provenance and fixture before the first paid/free-provider request.
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(resolve(dir, 'questions.json'), fixtureRaw);
  if (!process.argv.includes('--live')) {
    console.log(
      `Prepared frozen candidate package: ${dir}. No provider calls made. Run with --live to execute the capped pilot.`,
    );
    await sql.end();
    return;
  }
  const llm = new GeminiProvider({
    budget: { maxGenerationRequests: 20, maxEmbeddingRequests: 12, stopOnQuota: true },
    maxKeys: 2,
    maxRetries: 0,
    timeoutMs: 40_000,
  });
  const none: Retriever = { name: 'disabled', search: async () => [] };
  const vector = new VectorSearch({ sql, log: logger }, { withEmbeddings: true });
  const fts = new FtsSearch({ sql, log: logger });
  resetHybridRetrieverQueryEmbeddingCache();
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const item of fixture.cases) {
      const phone = snapshot.phones.find(
        (p: { slug: string; id: string }) => p.slug === item.phoneSlug,
      );
      for (const variant of ['vector', 'fts', 'hybrid'] as const) {
        const start = performance.now();
        let retrieval: RetrievalResult | undefined;
        const retriever = new HybridRetriever({
          vector: variant === 'fts' ? none : vector,
          fts: variant === 'vector' ? none : fts,
          llm,
          log: logger,
          embeddingModel: env.LLM_EMBEDDING_MODEL,
        });
        const originalSearch = retriever.search.bind(retriever);
        retriever.search = async (input) => {
          retrieval = await originalSearch(input);
          return retrieval;
        };
        const base = { caseId: item.id, variant, phoneSlug: item.phoneSlug, query: item.query };
        try {
          const answer = await runPhoneQna({
            phoneId: phone.id,
            query: item.query,
            retriever,
            llm,
            log: logger,
            retrievalOptions: { rerank: 'off' },
          });
          results.push({
            ...base,
            status: 'completed',
            answer: answer.text,
            citations: answer.citations,
            generationAccounting: answer.generationAccounting,
            model: answer.model,
            retrieval: answer.retrieval,
            ms: performance.now() - start,
            providedEvidenceHit: answer.retrieval.chunks.some((c) =>
              item.supportingChunkIds.includes(c.chunkId),
            ),
            fullySupported: null,
          });
        } catch (error) {
          results.push({
            ...base,
            status: 'failed',
            error: diagnoseEvaluationError(error),
            retrieval,
            ms: performance.now() - start,
            fullySupported: null,
          });
        }
        await writeFile(
          resolve(dir, 'results.json'),
          JSON.stringify({ manifest, results, budget: llm.evaluationBudget!.snapshot() }, null, 2),
        );
        console.log(`${item.id}/${variant}: ${results.at(-1)!.status}`);
        if (llm.evaluationBudget!.snapshot().quotaStopped) {
          process.exitCode = 2;
          console.log(
            'Provider quota returned 429. Stopping outbound requests; remaining cases are unexecuted.',
          );
          return;
        }
      }
    }
  } finally {
    if (results.some((result) => result.status === 'failed') && !process.exitCode)
      process.exitCode = 1;
    await writeFile(
      resolve(dir, 'results.json'),
      JSON.stringify({ manifest, results, budget: llm.evaluationBudget!.snapshot() }, null, 2),
    );
    await writeFile(
      resolve(stage.outputDir, 'current-quality.json'),
      JSON.stringify({ dir, runId: manifest.runId }, null, 2),
    );
    await sql.end();
    console.log(
      `Raw quality artifacts: ${dir}; human labels pending; no supported-answer rate reported.`,
    );
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
