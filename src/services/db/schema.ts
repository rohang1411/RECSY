/**
 * Drizzle schema — single source of truth for the Postgres schema.
 *
 * Conventions (enforced by reviewers, not tooling):
 *   - Every table uses a `uuid` PK with `gen_random_uuid()`.
 *   - Every table has `createdAt` (and `updatedAt` where mutation matters).
 *   - Timestamps are `timestamptz`, defaulting to `now()`.
 *   - Enums are declared once here and reused everywhere; never use raw `text`
 *     for finite sets.
 *   - Foreign-key cascades default to `restrict`; only enable `cascade` when
 *     child rows are strictly owned by the parent.
 *
 * Migrations are generated via `pnpm db:generate` (drizzle-kit).
 * Do NOT hand-edit generated SQL unless adding RLS policies or extensions.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const phoneStatusEnum = pgEnum('phone_status', ['active', 'discontinued', 'upcoming']);

export const sourceTypeEnum = pgEnum('source_type', ['youtube', 'reddit', 'article']);
export const sourceStatusEnum = pgEnum('source_status', ['active', 'removed', 'stale']);

export const aspectEnum = pgEnum('aspect', [
  'camera',
  'battery',
  'performance',
  'display',
  'build',
  'software',
  'value',
]);

export const recommendationIntentEnum = pgEnum('recommendation_intent', [
  'recommend',
  'chat',
  'browse',
  'clarify',
]);

export const sessionStatusEnum = pgEnum('session_status', ['active', 'closed']);

export const feedbackEventEnum = pgEnum('feedback_event', [
  'click',
  'dismiss',
  'refine',
  'thumbs_up',
  'thumbs_down',
]);

export const ingestStatusEnum = pgEnum('ingest_status', [
  'started',
  'success',
  'failed',
  'skipped',
]);

// ---------------------------------------------------------------------------
// phones
// ---------------------------------------------------------------------------

export const phones = pgTable(
  'phones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    variant: text('variant'),
    tagline: text('tagline'),
    launchDate: timestamp('launch_date', { mode: 'date', withTimezone: true }),
    msrpUsd: numeric('msrp_usd', { precision: 10, scale: 2 }),
    imageUrl: text('image_url'),
    status: phoneStatusEnum('status').notNull().default('active'),
    // Normalized spec blob validated by Zod at the application layer.
    specJson: jsonb('spec_json').notNull().$type<Record<string, unknown>>().default({}),
    // Semantic embedding of the normalized spec description for the recommender.
    specEmbedding: vector('spec_embedding', { dimensions: 768 }),
    // e.g. ['US', 'IN', 'GB']. Used by future regional filtering.
    regionAvailability: text('region_availability')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('phones_brand_idx').on(t.brand),
    index('phones_status_idx').on(t.status),
    index('phones_spec_embedding_idx').using('hnsw', t.specEmbedding.op('vector_cosine_ops')),
  ],
);

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneId: uuid('phone_id')
      .notNull()
      .references(() => phones.id, { onDelete: 'cascade' }),
    type: sourceTypeEnum('type').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    author: text('author'),
    channel: text('channel'),
    language: text('language').notNull().default('en'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentHash: text('content_hash').notNull(),
    status: sourceStatusEnum('status').notNull().default('active'),
    rawJson: jsonb('raw_json').notNull().$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sources_phone_url_uniq').on(t.phoneId, t.url),
    index('sources_phone_id_idx').on(t.phoneId),
    index('sources_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// chunks
// ---------------------------------------------------------------------------

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    // Denormalized for fast phone-scoped retrieval without a join.
    phoneId: uuid('phone_id')
      .notNull()
      .references(() => phones.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    // YouTube-only: second offset within the video.
    startTs: integer('start_ts'),
    endTs: integer('end_ts'),
    // Anchor string appended to the source URL to deep-link into the chunk
    // (e.g. `?t=125` for YouTube or a Reddit comment permalink fragment).
    anchor: text('anchor'),
    tokens: integer('tokens').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    embeddingModel: text('embedding_model').notNull().default('text-embedding-004'),
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chunks_phone_id_idx').on(t.phoneId),
    index('chunks_source_id_idx').on(t.sourceId),
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// ---------------------------------------------------------------------------
// aspect_definitions — aspects are data, not code.
// ---------------------------------------------------------------------------

export const aspectDefinitions = pgTable(
  'aspect_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aspect: aspectEnum('aspect').notNull(),
    version: integer('version').notNull().default(1),
    description: text('description').notNull(),
    // Semantic query strings used by the scorecard agent to retrieve
    // aspect-relevant chunks (e.g. battery → ["battery life", "charging", ...]).
    queryPrompts: text('query_prompts')
      .array()
      .notNull()
      .default(sql`'{}'`),
    defaultWeight: numeric('default_weight', { precision: 4, scale: 3 }).notNull().default('0.15'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('aspect_definitions_aspect_version_uniq').on(t.aspect, t.version)],
);

// ---------------------------------------------------------------------------
// aspects — current calibrated score per phone × aspect.
// ---------------------------------------------------------------------------

export const aspects = pgTable(
  'aspects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneId: uuid('phone_id')
      .notNull()
      .references(() => phones.id, { onDelete: 'cascade' }),
    aspectDefinitionId: uuid('aspect_definition_id')
      .notNull()
      .references(() => aspectDefinitions.id, { onDelete: 'restrict' }),
    score: numeric('score', { precision: 3, scale: 1 }).notNull(),
    rawScore: numeric('raw_score', { precision: 3, scale: 1 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    nSources: integer('n_sources').notNull().default(0),
    nSupporting: integer('n_supporting').notNull().default(0),
    nDissenting: integer('n_dissenting').notNull().default(0),
    summary: text('summary').notNull().default(''),
    /** Array of `{ chunkId, excerpt, sentiment, anchor }`. */
    supportingQuotes: jsonb('supporting_quotes').notNull().$type<unknown[]>().default([]),
    dissentingQuotes: jsonb('dissenting_quotes').notNull().$type<unknown[]>().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('aspects_phone_aspect_uniq').on(t.phoneId, t.aspectDefinitionId),
    index('aspects_phone_id_idx').on(t.phoneId),
  ],
);

// ---------------------------------------------------------------------------
// Recommender sessions, turns, feedback.
// ---------------------------------------------------------------------------

export const recommendationSessions = pgTable('recommendation_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionCookie: text('session_cookie').notNull().unique(),
  userAgent: text('user_agent'),
  /** sha256 of the client IP — we never store raw IPs. */
  ipHash: text('ip_hash'),
  status: sessionStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recommendationTurns = pgTable(
  'recommendation_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => recommendationSessions.id, { onDelete: 'cascade' }),
    turnIndex: integer('turn_index').notNull(),
    userMessage: text('user_message').notNull(),
    intent: recommendationIntentEnum('intent').notNull(),
    extractedRequirements: jsonb('extracted_requirements').$type<Record<string, unknown>>(),
    candidatePhoneIds: uuid('candidate_phone_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    picks: jsonb('picks').$type<unknown[]>(),
    clarifyingQuestion: text('clarifying_question'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('recommendation_turns_session_turn_uniq').on(t.sessionId, t.turnIndex)],
);

export const recommendationFeedback = pgTable(
  'recommendation_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => recommendationTurns.id, { onDelete: 'cascade' }),
    phoneId: uuid('phone_id').references(() => phones.id, { onDelete: 'set null' }),
    event: feedbackEventEnum('event').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recommendation_feedback_turn_id_idx').on(t.turnId)],
);

// ---------------------------------------------------------------------------
// Chat queries (analytics).
// ---------------------------------------------------------------------------

export const chatQueries = pgTable(
  'chat_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneId: uuid('phone_id')
      .notNull()
      .references(() => phones.id, { onDelete: 'cascade' }),
    sessionCookie: text('session_cookie'),
    query: text('query').notNull(),
    answer: text('answer').notNull(),
    citations: jsonb('citations').notNull().$type<unknown[]>().default([]),
    retrievedChunkIds: uuid('retrieved_chunk_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    latencyMs: integer('latency_ms').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_queries_phone_id_idx').on(t.phoneId)],
);

// ---------------------------------------------------------------------------
// LLM response cache — critical for zero-budget operation.
// ---------------------------------------------------------------------------

export const llmCache = pgTable(
  'llm_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promptHash: text('prompt_hash').notNull().unique(),
    promptRaw: text('prompt_raw').notNull(),
    model: text('model').notNull(),
    response: jsonb('response').notNull(),
    hits: integer('hits').notNull().default(0),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_cache_model_idx').on(t.model)],
);

// ---------------------------------------------------------------------------
// Ingestion telemetry.
// ---------------------------------------------------------------------------

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adapter: text('adapter').notNull(),
    phoneId: uuid('phone_id').references(() => phones.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url'),
    status: ingestStatusEnum('status').notNull(),
    chunksCreated: integer('chunks_created').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('ingest_runs_adapter_idx').on(t.adapter),
    index('ingest_runs_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Simple rate-limiter table. Cleaned by `pg_cron`.
// ---------------------------------------------------------------------------

export const rateLimits = pgTable(
  'rate_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
  },
  (t) => [index('rate_limits_key_window_idx').on(t.key, t.windowStart)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const phonesRelations = relations(phones, ({ many }) => ({
  sources: many(sources),
  chunks: many(chunks),
  aspects: many(aspects),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  phone: one(phones, { fields: [sources.phoneId], references: [phones.id] }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  source: one(sources, { fields: [chunks.sourceId], references: [sources.id] }),
  phone: one(phones, { fields: [chunks.phoneId], references: [phones.id] }),
}));

export const aspectsRelations = relations(aspects, ({ one }) => ({
  phone: one(phones, { fields: [aspects.phoneId], references: [phones.id] }),
  definition: one(aspectDefinitions, {
    fields: [aspects.aspectDefinitionId],
    references: [aspectDefinitions.id],
  }),
}));

export const recommendationSessionsRelations = relations(recommendationSessions, ({ many }) => ({
  turns: many(recommendationTurns),
}));

export const recommendationTurnsRelations = relations(recommendationTurns, ({ one, many }) => ({
  session: one(recommendationSessions, {
    fields: [recommendationTurns.sessionId],
    references: [recommendationSessions.id],
  }),
  feedback: many(recommendationFeedback),
}));

// Explicitly silence unused relations warnings while keeping them exported.
void boolean; // (placeholder import slot — retained for future flags)
