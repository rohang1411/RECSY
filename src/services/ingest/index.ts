/**
 * Barrel export for the ingest module.
 *
 * Prefer importing from `@/services/ingest` rather than reaching into the
 * internal file layout — this lets us reorganise the module without
 * touching consumers.
 */
export { chunkText, countTokens, splitSentences } from './chunking';
export { ChunkEmbedder, type EmbedderOptions } from './embedder';
export { hashContent } from './hashing';
export {
  IngestOrchestrator,
  type IngestPhoneOptions,
  type OrchestratorOptions,
  type PhoneIngestSummary,
} from './orchestrator';
export type {
  AdapterRunSummary,
  DiscoverOpts,
  PhoneRef,
  RawChunk,
  RawSource,
  SourceAdapter,
  SourceCandidate,
  SourceType,
} from './types';
export { IngestionWriter } from './writer';

export { ArticleAdapter } from './adapters/article';
export { RedditAdapter } from './adapters/reddit';
export { YouTubeAdapter } from './adapters/youtube';
