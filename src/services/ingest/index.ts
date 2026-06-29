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
  IngestErrorCode,
  IngestStage,
  PhoneRef,
  RawChunk,
  RawSource,
  SourceAdapter,
  SourceCandidate,
  SourceType,
} from './types';
export { classifyIngestError, computeRetryAfter } from './error-classify';
export { IngestionWriter } from './writer';

export { ArticleAdapter } from './adapters/article';
export { RedditAdapter, type SubredditProfile } from './adapters/reddit';
export { YouTubeAdapter } from './adapters/youtube';
export { GsmArenaAdapter } from './adapters/gsmarena';
export { YouTubeChannelAdapter, type CreatorChannel } from './adapters/youtube-channel';

export { CuratorAgent, type CuratorVerdict } from './agents/curator';
export { DisambiguatorAgent, type DisambiguatorResult } from './agents/disambiguator';
export { matchAliases, normaliseText, type AliasRow, type AliasMatch } from './agents/alias-match';
export { makeDbAliasLoader, makeDbPhoneLookup } from './agents/alias-loader';

export { makePoliteHttp, type PoliteHttp } from './http';

export { pickPhones, shardIndex, type PickedPhone } from './scheduler/pick-phones';
export {
  markCrawlQueueDone,
  markCrawlQueueFailed,
  markCrawlQueueStarted,
  pickQueuedCrawlItems,
  queuedItemsToCandidates,
  type QueuedCrawlItem,
} from './scheduler/crawl-queue';
export {
  getFailedCandidatesForPhone,
  pickPhonesEmptyCorpus,
  pickResumePhones,
  type FailedCandidate,
} from './scheduler/pick-resume-phones';
export { markIngested, bootstrapNextIngestAt } from './scheduler/enqueue';
export {
  classifyTier,
  computeNextIngestAt,
  HOT_MAX_AGE_DAYS,
  WARM_MAX_AGE_DAYS,
  REFRESH_INTERVAL_DAYS,
  type IngestTier,
} from './scheduler/tiers';
