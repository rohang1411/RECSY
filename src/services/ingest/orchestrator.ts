/**
 * Ingestion orchestrator.
 *
 * Wires adapters + embedder + writer into an end-to-end flow. A single
 * adapter's failure MUST NOT abort the whole phone run; failures are
 * captured into per-adapter summaries and logged structurally.
 *
 * Flow (per phone × adapter):
 *   1. discover  → candidates
 *   2. fetch     → raw sources (network; retried internally by adapters)
 *   3. chunk     → raw chunks (pure)
 *   4. embed     → vectors (batched, retried)
 *   5. write     → DB (idempotent, transactional)
 *
 * Concurrency:
 *   - Candidates within an adapter are fetched serially (to be a polite
 *     bot and avoid tripping per-host rate limits).
 *   - Embedding is batched inside `ChunkEmbedder`.
 *   - Different adapters for the same phone run serially too. Parallelising
 *     them would ~double peak network pressure for small gains.
 */
import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/errors';
import { phones } from '@/services/db/schema';
import { logger } from '@/services/logger';

import type { LlmProvider } from '../llm/types';
import { ChunkEmbedder, type EmbedderOptions } from './embedder';
import type {
  AdapterRunSummary,
  DiscoverOpts,
  PhoneRef,
  SourceAdapter,
  SourceCandidate,
  SourceType,
} from './types';
import { IngestionWriter, type Db } from './writer';

export interface OrchestratorOptions {
  readonly db: Db;
  readonly llm: LlmProvider;
  readonly adapters: readonly SourceAdapter[];
  readonly embedderOptions?: EmbedderOptions;
  readonly embeddingModel?: string;
}

export interface IngestPhoneOptions {
  /** Slugs of adapters to run. If omitted, runs all configured. */
  readonly adapterTypes?: readonly SourceType[];
  readonly discover?: DiscoverOpts;
  /** Skip discovery and use these candidates instead. */
  readonly candidatesByType?: Partial<Record<SourceType, SourceCandidate[]>>;
  readonly dryRun?: boolean;
}

export interface PhoneIngestSummary {
  readonly phoneId: string;
  readonly slug: string;
  readonly adapters: AdapterRunSummary[];
  readonly totals: {
    readonly discovered: number;
    readonly fetched: number;
    readonly skippedDuplicate: number;
    readonly chunksWritten: number;
    readonly sourcesWritten: number;
    readonly errors: number;
  };
}

const DEFAULT_DISCOVER: DiscoverOpts = { limit: 5 };

export class IngestOrchestrator {
  private readonly adaptersByType: Map<SourceType, SourceAdapter>;
  private readonly embedder: ChunkEmbedder;
  private readonly writer: IngestionWriter;
  private readonly log = logger.child({ component: 'ingest.orchestrator' });

  constructor(private readonly opts: OrchestratorOptions) {
    this.adaptersByType = new Map(opts.adapters.map((a) => [a.type, a]));
    this.embedder = new ChunkEmbedder(opts.llm, {
      ...opts.embedderOptions,
      model: opts.embeddingModel ?? opts.embedderOptions?.model,
    });
    this.writer = new IngestionWriter(opts.db);
  }

  async ingestPhoneBySlug(
    slug: string,
    options: IngestPhoneOptions = {},
  ): Promise<PhoneIngestSummary> {
    const phone = await loadPhone(this.opts.db, slug);
    return this.ingestPhone(phone, options);
  }

  async ingestPhone(
    phone: PhoneRef,
    options: IngestPhoneOptions = {},
  ): Promise<PhoneIngestSummary> {
    const selected = (options.adapterTypes ?? [...this.adaptersByType.keys()])
      .map((type) => this.adaptersByType.get(type))
      .filter((a): a is SourceAdapter => a !== undefined);

    const summaries: AdapterRunSummary[] = [];
    for (const adapter of selected) {
      const summary = await this.runAdapter(adapter, phone, options);
      summaries.push(summary);
    }

    return aggregate(phone, summaries);
  }

  private async runAdapter(
    adapter: SourceAdapter,
    phone: PhoneRef,
    options: IngestPhoneOptions,
  ): Promise<AdapterRunSummary> {
    const log = this.log.child({ adapter: adapter.type, phone: phone.slug });
    const startedAt = Date.now();

    const injectedCandidates = options.candidatesByType?.[adapter.type];
    let candidates: SourceCandidate[];

    if (injectedCandidates && injectedCandidates.length > 0) {
      candidates = [...injectedCandidates];
      log.info({ count: candidates.length }, 'using injected candidates; skipping discovery');
    } else {
      try {
        candidates = await adapter.discover(phone, options.discover ?? DEFAULT_DISCOVER);
        log.info({ count: candidates.length }, 'discovered candidates');
      } catch (err) {
        log.error({ err: errMsg(err) }, 'discover failed');
        return makeSummary(
          adapter.type,
          0,
          0,
          0,
          0,
          0,
          [{ url: '(discover)', error: errMsg(err) }],
          startedAt,
        );
      }
    }

    let fetched = 0;
    let skippedDuplicate = 0;
    let sourcesWritten = 0;
    let chunksWritten = 0;
    const errors: Array<{ url: string; error: string }> = [];

    for (const candidate of candidates) {
      try {
        const raw = await adapter.fetch(candidate);
        fetched += 1;

        const rawChunks = adapter.chunk(raw);
        if (rawChunks.length === 0) {
          log.warn({ url: candidate.url }, 'adapter produced 0 chunks; skipping');
          continue;
        }

        if (options.dryRun) {
          log.info(
            { url: candidate.url, chunks: rawChunks.length, bytes: raw.body.length },
            'dry-run: would have embedded + written',
          );
          continue;
        }

        const { embeddings, model: embeddingModel } = await this.embedder.embedAll(
          rawChunks.map((c) => c.text),
        );

        const prepared = rawChunks.map((rc, i) => ({ raw: rc, embedding: embeddings[i]! }));
        const result = await this.writer.writeSource({
          phoneId: phone.id,
          type: adapter.type,
          raw,
          preparedChunks: prepared,
          embeddingModel,
          adapterName: adapter.type,
        });

        if (result.skipped) {
          skippedDuplicate += 1;
          log.info(
            { url: candidate.url, reason: result.reason },
            'source unchanged; skipped re-embed',
          );
        } else {
          sourcesWritten += 1;
          chunksWritten += result.chunkCount;
          log.info({ url: candidate.url, chunks: result.chunkCount }, 'source written');
        }
      } catch (err) {
        const message = errMsg(err);
        errors.push({ url: candidate.url, error: message });
        if (err instanceof NotFoundError) {
          log.info(
            { url: candidate.url, reason: message },
            'source skipped (not found / unusable)',
          );
        } else {
          log.error({ url: candidate.url, err: message }, 'source failed');
        }
      }
    }

    return makeSummary(
      adapter.type,
      candidates.length,
      fetched,
      skippedDuplicate,
      sourcesWritten,
      chunksWritten,
      errors,
      startedAt,
    );
  }
}

async function loadPhone(db: Db, slug: string): Promise<PhoneRef> {
  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
    })
    .from(phones)
    .where(eq(phones.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`phone not found: ${slug}`);
  }
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand,
    model: row.model,
    launchDate: row.launchDate ? row.launchDate.toISOString().slice(0, 10) : null,
  };
}

function makeSummary(
  type: SourceType,
  discovered: number,
  fetched: number,
  skippedDuplicate: number,
  sources: number,
  chunks: number,
  errors: AdapterRunSummary['errors'],
  startedAt: number,
): AdapterRunSummary {
  return {
    type,
    discovered,
    fetched,
    skippedDuplicate,
    written: { sources, chunks },
    errors,
    durationMs: Date.now() - startedAt,
  };
}

function aggregate(phone: PhoneRef, summaries: AdapterRunSummary[]): PhoneIngestSummary {
  const totals = summaries.reduce(
    (acc, s) => ({
      discovered: acc.discovered + s.discovered,
      fetched: acc.fetched + s.fetched,
      skippedDuplicate: acc.skippedDuplicate + s.skippedDuplicate,
      chunksWritten: acc.chunksWritten + s.written.chunks,
      sourcesWritten: acc.sourcesWritten + s.written.sources,
      errors: acc.errors + s.errors.length,
    }),
    {
      discovered: 0,
      fetched: 0,
      skippedDuplicate: 0,
      chunksWritten: 0,
      sourcesWritten: 0,
      errors: 0,
    },
  );
  return {
    phoneId: phone.id,
    slug: phone.slug,
    adapters: summaries,
    totals,
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
