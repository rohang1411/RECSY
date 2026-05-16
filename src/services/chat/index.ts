/**
 * Chat service barrel — phone-scoped Q&A pipeline.
 *
 * Re-exports the public surface of the chat subsystem:
 * - `answer.ts`: `runPhoneQna`, `persistChatQuery`, `chunkTextForStream`
 * - `citations.ts`: `extractCitationIds`, `resolveCitations`, `validateCitationTags`
 *
 * The chat pipeline takes `(phoneSlug, query)`, runs hybrid retrieval,
 * validates citations against retrieved chunk IDs, and streams a
 * grounded LLM answer. All I/O is logged with `traceId` bindings.
 *
 * Used by: `src/app/api/ask/route.ts`.
 */
export {
  chunkTextForStream,
  persistChatQuery,
  runPhoneQna,
  type PhoneQnaInput,
  type PhoneQnaResult,
} from './answer';
export {
  extractCitationIds,
  resolveCitations,
  validateCitationTags,
  type ResolvedCitation,
} from './citations';
