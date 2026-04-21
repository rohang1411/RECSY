/**
 * Ingestion types and the `SourceAdapter` protocol.
 *
 * Adapters are the only place that knows how to talk to an external content
 * source (YouTube, Reddit, articles, …). Everything downstream of an adapter
 * — chunking, embedding, writing — is source-agnostic.
 *
 * Each stage is split into a small, testable method so adapter authors can
 * unit-test discovery / fetch / chunking against fixtures without going
 * anywhere near the live network or DB.
 */
import { z } from 'zod';

import type { sourceTypeEnum } from '@/services/db/schema';

/** The set of source kinds the DB schema accepts. */
export type SourceType = (typeof sourceTypeEnum.enumValues)[number];

/** A handle to a phone, supplied to discovery/fetch by the orchestrator. */
export interface PhoneRef {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  /** ISO date string (YYYY-MM-DD) or null. Used to scope discovery by recency. */
  readonly launchDate: string | null;
}

/** A discovered candidate, before fetch. Cheap to compute, no body yet. */
export const SourceCandidateSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  author: z.string().nullable().default(null),
  channel: z.string().nullable().default(null),
  language: z.string().default('en'),
  publishedAt: z.string().datetime().nullable().default(null),
  /** Provider-specific opaque payload, persisted into `sources.raw_json`. */
  raw: z.record(z.string(), z.unknown()).default({}),
});
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;

/**
 * The fetched content of a candidate. The orchestrator computes the content
 * hash from `body` (not the URL) so semantically identical re-fetches are
 * recognised as no-ops even if the URL gained tracking params.
 */
export interface RawSource {
  readonly candidate: SourceCandidate;
  readonly contentHash: string;
  readonly body: string;
  /** Adapter-specific payload merged into `sources.raw_json` on write. */
  readonly raw: Readonly<Record<string, unknown>>;
  /**
   * Non-persisted scratch pad carried from `fetch()` → `chunk()`. The writer
   * MUST NOT serialise this to the DB. Use for bulky intermediates (e.g.
   * timestamped caption segments) that the chunker needs but shouldn't bloat
   * `sources.raw_json`.
   */
  readonly transient?: Readonly<Record<string, unknown>>;
}

/**
 * A pre-embedding chunk produced by an adapter. Embeddings are added by the
 * embedder, not the adapter.
 */
export interface RawChunk {
  readonly chunkIndex: number;
  readonly text: string;
  readonly tokens: number;
  /** YouTube-only: second offset within the video. */
  readonly startTs?: number;
  readonly endTs?: number;
  /** Anchor appended to the source URL to deep-link into the chunk. */
  readonly anchor?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The narrow contract every adapter implements. */
export interface SourceAdapter {
  readonly type: SourceType;

  /**
   * Discover candidate sources for the phone. Adapters MAY return the empty
   * array (e.g. if discovery isn't supported and the user must supply URLs).
   */
  discover(phone: PhoneRef, opts: DiscoverOpts): Promise<SourceCandidate[]>;

  /**
   * Fetch a single candidate's full body. Throws `IntegrationError` for
   * transient failures (the orchestrator will retry); throws `NotFoundError`
   * for permanent ones (the orchestrator will skip and record).
   */
  fetch(candidate: SourceCandidate): Promise<RawSource>;

  /**
   * Chunk the raw source. Pure function: same `RawSource` ⇒ same chunks.
   * (No network, no LLM, no DB.)
   */
  chunk(raw: RawSource): RawChunk[];
}

export interface DiscoverOpts {
  /** Max candidates to return. Adapters MAY return fewer. */
  readonly limit: number;
  /** Optional natural-language hint to refine discovery (e.g. "camera test"). */
  readonly hint?: string;
}

/** Per-adapter, per-phone telemetry returned to the orchestrator. */
export interface AdapterRunSummary {
  readonly type: SourceType;
  readonly discovered: number;
  readonly fetched: number;
  readonly skippedDuplicate: number;
  readonly written: { sources: number; chunks: number };
  readonly errors: Array<{ url: string; error: string }>;
  readonly durationMs: number;
}
