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
import { eq, sql } from 'drizzle-orm';

import { NotFoundError } from '@/lib/errors';
import { phones, sources } from '@/services/db/schema';
import { logger } from '@/services/logger';

import type { LlmProvider } from '../llm/types';
import type { AliasMatch, AliasRow } from './agents/alias-match';
import { matchAliases } from './agents/alias-match';
import { CuratorAgent, type CuratorDecisionOptions } from './agents/curator';
import { DisambiguatorAgent } from './agents/disambiguator';
import { classifyIngestError, computeRetryAfter } from './error-classify';
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

/**
 * Pluggable alias loader. The orchestrator stays DB-agnostic; in production
 * this is wired to a DB query that loads `phone_aliases` joined with
 * `phones`. Tests can inject a static array.
 */
export type AliasLoader = () => Promise<readonly AliasRow[]>;

/**
 * Optional shape describing a discovered phone (by slug) so we can resolve
 * disambiguator primary slugs back to phone ids + names.
 */
export interface PhoneDirectoryEntry {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
}
export type PhoneLookupBySlug = (slug: string) => Promise<PhoneDirectoryEntry | null>;

export interface OrchestratorOptions {
  readonly db: Db;
  readonly llm: LlmProvider;
  readonly adapters: readonly SourceAdapter[];
  readonly embedderOptions?: EmbedderOptions;
  readonly embeddingModel?: string;
  /**
   * Per-run Curator configuration. When omitted, Curator runs with built-in
   * thresholds. To disable Curator entirely (integration tests, first-run
   * bootstrapping), pass `curator: null`.
   */
  readonly curator?: CuratorAgent | null;
  readonly curatorOptions?: CuratorDecisionOptions;
  /**
   * Disambiguator is only invoked when the heuristic matcher returns >=2
   * distinct phones. Passing `null` disables it (heuristic-only). When
   * omitted, a default agent is constructed around `opts.llm`.
   */
  readonly disambiguator?: DisambiguatorAgent | null;
  /** Loads rows from `phone_aliases` for heuristic matching. Required for disambiguation. */
  readonly aliasLoader?: AliasLoader;
  /** Resolves a slug to a phone row; required when the disambiguator can reassign primary. */
  readonly phoneLookup?: PhoneLookupBySlug;
}

export interface IngestPhoneOptions {
  /** Slugs of adapters to run. If omitted, runs all configured. */
  readonly adapterTypes?: readonly SourceType[];
  readonly discover?: DiscoverOpts;
  /** Skip discovery and use these candidates instead. */
  readonly candidatesByType?: Partial<Record<SourceType, SourceCandidate[]>>;
  readonly dryRun?: boolean;
  /** Freshness tier the caller scheduled this run under. Recorded in ingest_runs.tier. */
  readonly tier?: 'hot' | 'warm' | 'cold' | null;
  /** How candidates were discovered (e.g. 'rss','search','bootstrap'). */
  readonly discoveryStrategy?: string | null;
}

export interface PhoneIngestSummary {
  readonly phoneId: string;
  readonly slug: string;
  readonly adapters: AdapterRunSummary[];
  readonly totals: {
    readonly discovered: number;
    readonly fetched: number;
    readonly skippedUnusable: number;
    readonly skippedDuplicate: number;
    readonly skippedRejected: number;
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
  private readonly curator: CuratorAgent | null;
  private readonly disambiguator: DisambiguatorAgent | null;
  private aliasCache: readonly AliasRow[] | null = null;
  private readonly log = logger.child({ component: 'ingest.orchestrator' });

  constructor(private readonly opts: OrchestratorOptions) {
    this.adaptersByType = new Map(opts.adapters.map((a) => [a.type, a]));
    this.embedder = new ChunkEmbedder(opts.llm, {
      ...opts.embedderOptions,
      model: opts.embeddingModel ?? opts.embedderOptions?.model,
    });
    this.writer = new IngestionWriter(opts.db);
    this.curator =
      opts.curator === null
        ? null
        : (opts.curator ?? new CuratorAgent(opts.llm, opts.curatorOptions));
    this.disambiguator =
      opts.disambiguator === null ? null : (opts.disambiguator ?? new DisambiguatorAgent(opts.llm));
  }

  private async loadAliases(): Promise<readonly AliasRow[]> {
    if (this.aliasCache) return this.aliasCache;
    if (!this.opts.aliasLoader) {
      this.aliasCache = [];
      return this.aliasCache;
    }
    try {
      this.aliasCache = await this.opts.aliasLoader();
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'alias loader failed; proceeding without disambiguation',
      );
      this.aliasCache = [];
    }
    return this.aliasCache;
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
          0,
          0,
          [{ url: '(discover)', error: errMsg(err) }],
          startedAt,
        );
      }
    }

    let fetched = 0;
    let skippedUnusable = 0;
    let skippedDuplicate = 0;
    let skippedRejected = 0;
    let sourcesWritten = 0;
    let chunksWritten = 0;
    const errors: Array<{ url: string; error: string }> = [];

    for (const candidate of candidates) {
      try {
        const raw = await adapter.fetch(candidate);
        fetched += 1;

        if (options.dryRun) {
          const rawChunks = adapter.chunk(raw);
          log.info(
            { url: candidate.url, chunks: rawChunks.length, bytes: raw.body.length },
            'dry-run: would have embedded + written',
          );
          continue;
        }

        // Disambiguator: if the title/description mentions >=2 distinct
        // phones (alias match), pick the primary + secondaries. The primary
        // may differ from the ingesting phone — e.g. phone A's discovery
        // surfaced a comparison video where phone B is actually the subject.
        let primaryPhone: PhoneRef = phone;
        let secondaryLinks: Array<{ phoneId: string; relevance: number }> = [];
        let primaryRelevance: number | null = null;

        if (this.disambiguator) {
          try {
            const aliases = await this.loadAliases();
            const text = [
              candidate.title,
              (candidate.raw as Record<string, unknown>)?.description ?? '',
            ]
              .filter(Boolean)
              .join('\n');
            const matches: AliasMatch[] = aliases.length > 0 ? matchAliases(text, aliases) : [];
            if (matches.length >= 2) {
              const decision = await this.disambiguator.resolve({
                sourceType: adapter.type,
                title: candidate.title,
                description: (candidate.raw as Record<string, unknown>)?.description as
                  | string
                  | undefined,
                channel: candidate.channel,
                author: candidate.author,
                candidates: matches,
              });
              primaryRelevance = decision.primaryConfidence;
              if (decision.primary.slug !== phone.slug) {
                if (this.opts.phoneLookup) {
                  try {
                    const resolved = await this.opts.phoneLookup(decision.primary.slug);
                    if (resolved) {
                      log.info(
                        {
                          url: candidate.url,
                          from: phone.slug,
                          to: resolved.slug,
                          confidence: decision.primaryConfidence,
                        },
                        'disambiguator reassigned primary phone',
                      );
                      primaryPhone = {
                        id: resolved.id,
                        slug: resolved.slug,
                        brand: resolved.brand,
                        model: resolved.model,
                        launchDate: phone.launchDate,
                      };
                      secondaryLinks = [
                        { phoneId: phone.id, relevance: 0.5 },
                        ...decision.secondary
                          .filter((s) => s.match.slug !== resolved.slug)
                          .map((s) => ({ phoneId: s.match.phoneId, relevance: s.relevance })),
                      ];
                    } else {
                      secondaryLinks = decision.secondary.map((s) => ({
                        phoneId: s.match.phoneId,
                        relevance: s.relevance,
                      }));
                    }
                  } catch (err) {
                    log.warn(
                      { err: errMsg(err) },
                      'phoneLookup failed; keeping ingesting phone as primary',
                    );
                  }
                } else {
                  secondaryLinks = decision.secondary.map((s) => ({
                    phoneId: s.match.phoneId,
                    relevance: s.relevance,
                  }));
                }
              } else {
                secondaryLinks = decision.secondary.map((s) => ({
                  phoneId: s.match.phoneId,
                  relevance: s.relevance,
                }));
              }
            }
          } catch (disambigErr) {
            const code = classifyIngestError(disambigErr);
            await this.writer.recordFailedRun({
              adapterName: adapter.type,
              phoneId: phone.id,
              sourceUrl: candidate.url,
              candidateTitle: candidate.title,
              stage: 'fetch',
              errorCode: code,
              error: errMsg(disambigErr),
              retryAfter: computeRetryAfter(code),
              tier: options.tier ?? null,
              discoveryStrategy: options.discoveryStrategy ?? null,
            });
            errors.push({ url: candidate.url, error: errMsg(disambigErr) });
            log.error({ url: candidate.url, err: errMsg(disambigErr) }, 'disambiguator failed');
            continue;
          }
        }

        // Hash pre-check: skip chunking, curator, and embed when content is unchanged.
        const existingSource = await this.opts.db
          .select({ id: sources.id, contentHash: sources.contentHash })
          .from(sources)
          .where(sql`${sources.phoneId} = ${primaryPhone.id} and ${sources.url} = ${candidate.url}`)
          .limit(1);

        if (existingSource[0]?.contentHash === raw.contentHash) {
          const result = await this.writer.writeSource({
            phoneId: primaryPhone.id,
            type: adapter.type,
            raw,
            preparedChunks: [],
            embeddingModel: 'unchanged',
            adapterName: adapter.type,
            tier: options.tier ?? null,
            discoveryStrategy: options.discoveryStrategy ?? null,
            secondaryPhoneLinks: secondaryLinks,
            primaryRelevance,
          });
          skippedDuplicate += 1;
          log.debug(
            { url: candidate.url, skipped: result.skipped },
            'hash unchanged — skipped curator + embed',
          );
          continue;
        }

        const rawChunks = adapter.chunk(raw);
        if (rawChunks.length === 0) {
          log.warn({ url: candidate.url }, 'adapter produced 0 chunks; skipping');
          continue;
        }

        // Curator: gatekeeper before spending on embeddings.
        let enrichment:
          | {
              relevance?: number;
              quality?: number;
              sentimentSummary?: 'positive' | 'mixed' | 'negative' | 'neutral';
              aspectsCovered?: readonly string[];
            }
          | undefined;
        if (this.curator) {
          try {
            const decision = await this.curator.decide({
              phone: {
                slug: primaryPhone.slug,
                brand: primaryPhone.brand,
                model: primaryPhone.model,
              },
              sourceType: adapter.type,
              raw,
              sampleChunks: rawChunks.slice(0, 3),
            });
            enrichment = {
              relevance: decision.verdict.relevance,
              quality: decision.verdict.quality,
              sentimentSummary: decision.verdict.sentimentSummary,
              aspectsCovered: decision.verdict.aspectsCovered,
            };
            if (!decision.keep) {
              log.info(
                {
                  url: candidate.url,
                  rejectedReason: decision.rejectedReason,
                  relevance: decision.verdict.relevance,
                  quality: decision.verdict.quality,
                },
                'curator rejected source; skipping embed + write',
              );
              await this.writer.recordRejectedRun({
                adapterName: adapter.type,
                phoneId: primaryPhone.id,
                sourceUrl: candidate.url,
                candidateTitle: candidate.title,
                rejectedReason: decision.rejectedReason ?? 'curator-rejected',
                stage: 'curator',
                tier: options.tier ?? null,
                discoveryStrategy: options.discoveryStrategy ?? null,
              });
              skippedRejected += 1;
              continue;
            }
          } catch (curatorErr) {
            const code = classifyIngestError(curatorErr);
            await this.writer.recordFailedRun({
              adapterName: adapter.type,
              phoneId: primaryPhone.id,
              sourceUrl: candidate.url,
              candidateTitle: candidate.title,
              stage: 'curator',
              errorCode: code,
              error: errMsg(curatorErr),
              retryAfter: computeRetryAfter(code),
              tier: options.tier ?? null,
              discoveryStrategy: options.discoveryStrategy ?? null,
            });
            errors.push({ url: candidate.url, error: errMsg(curatorErr) });
            log.error({ url: candidate.url, err: errMsg(curatorErr) }, 'curator failed');
            continue;
          }
        }

        let embeddingModel: string;
        let embeddings: number[][];
        try {
          const embedResult = await this.embedder.embedAll(rawChunks.map((c) => c.text));
          embeddings = embedResult.embeddings;
          embeddingModel = embedResult.model;
        } catch (embedErr) {
          const code = classifyIngestError(embedErr);
          await this.writer.recordFailedRun({
            adapterName: adapter.type,
            phoneId: primaryPhone.id,
            sourceUrl: candidate.url,
            candidateTitle: candidate.title,
            stage: 'embed',
            errorCode: code,
            error: errMsg(embedErr),
            retryAfter: computeRetryAfter(code),
            tier: options.tier ?? null,
            discoveryStrategy: options.discoveryStrategy ?? null,
          });
          errors.push({ url: candidate.url, error: errMsg(embedErr) });
          log.error({ url: candidate.url, err: errMsg(embedErr) }, 'embed failed');
          continue;
        }

        const prepared = rawChunks.map((rc, i) => ({ raw: rc, embedding: embeddings[i]! }));
        const result = await this.writer.writeSource({
          phoneId: primaryPhone.id,
          type: adapter.type,
          raw,
          preparedChunks: prepared,
          embeddingModel,
          adapterName: adapter.type,
          enrichment,
          tier: options.tier ?? null,
          discoveryStrategy: options.discoveryStrategy ?? null,
          secondaryPhoneLinks: secondaryLinks,
          primaryRelevance,
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
        if (err instanceof NotFoundError) {
          skippedUnusable += 1;
          await this.writer.recordRejectedRun({
            adapterName: adapter.type,
            phoneId: phone.id,
            sourceUrl: candidate.url,
            candidateTitle: candidate.title,
            rejectedReason: `unusable:${message}`,
            stage: 'fetch',
            tier: options.tier ?? null,
            discoveryStrategy: options.discoveryStrategy ?? null,
          });
          log.info(
            { url: candidate.url, reason: message },
            'source skipped (not found / unusable)',
          );
        } else {
          const code = classifyIngestError(err);
          await this.writer.recordFailedRun({
            adapterName: adapter.type,
            phoneId: phone.id,
            sourceUrl: candidate.url,
            candidateTitle: candidate.title,
            stage: 'fetch',
            errorCode: code,
            error: message,
            retryAfter: computeRetryAfter(code),
            tier: options.tier ?? null,
            discoveryStrategy: options.discoveryStrategy ?? null,
          });
          errors.push({ url: candidate.url, error: message });
          log.error({ url: candidate.url, err: message }, 'source failed');
        }
      }
    }

    return makeSummary(
      adapter.type,
      candidates.length,
      fetched,
      skippedUnusable,
      skippedDuplicate,
      skippedRejected,
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
  skippedUnusable: number,
  skippedDuplicate: number,
  skippedRejected: number,
  sources: number,
  chunks: number,
  errors: AdapterRunSummary['errors'],
  startedAt: number,
): AdapterRunSummary {
  return {
    type,
    discovered,
    fetched,
    skippedUnusable,
    skippedDuplicate,
    skippedRejected,
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
      skippedUnusable: acc.skippedUnusable + s.skippedUnusable,
      skippedDuplicate: acc.skippedDuplicate + s.skippedDuplicate,
      skippedRejected: acc.skippedRejected + s.skippedRejected,
      chunksWritten: acc.chunksWritten + s.written.chunks,
      sourcesWritten: acc.sourcesWritten + s.written.sources,
      errors: acc.errors + s.errors.length,
    }),
    {
      discovered: 0,
      fetched: 0,
      skippedUnusable: 0,
      skippedDuplicate: 0,
      skippedRejected: 0,
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
