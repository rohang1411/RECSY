import { z } from 'zod';
import { MAX_RECOMMENDER_MESSAGE_BYTES } from '@/lib/constants';
import type { SessionOwner } from './owner';

export const RecommendRequestBodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .refine(
      (m) => new TextEncoder().encode(m).length <= MAX_RECOMMENDER_MESSAGE_BYTES,
      'message too long',
    ),
  sessionId: z.string().uuid().optional(),
});
export type RecommendRequestBody = z.infer<typeof RecommendRequestBodySchema>;

export const ListSessionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().max(80).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  includePinned: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val !== undefined ? val === 'true' : undefined)),
});
export type ListSessionsQueryParams = z.infer<typeof ListSessionsQuerySchema>;

export const CreateSessionSchema = z
  .object({
    id: z.string().uuid().optional(),
  })
  .optional();
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

export const UpdateSessionPatchSchema = z
  .object({
    title: z.string().optional(),
    isPinned: z.boolean().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.isPinned !== undefined || data.status !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export type SessionTitleSource = 'default' | 'heuristic' | 'llm' | 'user';
export type SessionStatus = 'active' | 'archived' | 'deleted' | 'closed';

export interface PickSummary {
  brand: string;
  model: string;
  slug: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  firstMessage: string | null;
  isPinned: boolean;
  status: SessionStatus;
  turnCount: number;
  topPick: PickSummary | null;
  createdAt: string;
  lastTurnAt: string;
  deviceMarker?: string;
}

export interface SessionResultMeta {
  v: number;
  relaxed?: string[];
  refined?: boolean;
  scoresTied?: boolean;
  scorecardMissing?: boolean;
  topAspects?: string[];
  regionCode?: string;
  currency?: string;
  [key: string]: unknown;
}

export interface SessionDetailTurn {
  id: string;
  turnIndex: number;
  userMessage: string;
  intent: string;
  clarifyingQuestion: string | null;
  picks: unknown[] | null;
  resultMeta: SessionResultMeta | null;
  createdAt: string;
}

export interface SessionDetail extends SessionSummary {
  turns: SessionDetailTurn[];
}

export interface ListSessionsOptions {
  cursor?: string | null;
  limit?: number;
  query?: string;
  status?: 'active' | 'archived' | 'all';
  includePinned?: boolean;
}

export interface ListSessionsResult {
  pinned?: SessionSummary[];
  sessions: SessionSummary[];
  nextCursor: string | null;
  guestImportAvailable?: number;
}

export interface UpdateSessionPatch {
  title?: string;
  isPinned?: boolean;
  status?: 'active' | 'archived';
}

export interface ResolveOrCreateSessionParams {
  id: string;
  owner: SessionOwner;
  ipHash?: string | null;
  userAgent?: string | null;
  regionCode?: string | null;
  currency?: string | null;
}

export interface ResolveOrCreateSessionResult {
  session: {
    id: string;
    title: string;
    titleSource: SessionTitleSource;
    turnCount: number;
    status: SessionStatus;
  };
  created: boolean;
}

export interface SettleTurnParams {
  sessionId: string;
  owner: SessionOwner;
  userMessage: string;
  intent: string;
  title?: string | null;
  hasPicks: boolean;
  picksSummary?: PickSummary[] | null;
  extractedRequirements?: Record<string, unknown> | null;
  candidatePhoneIds?: string[];
  picks?: unknown[] | null;
  clarifyingQuestion?: string | null;
  leaseId?: string | null;
  resultMeta?: SessionResultMeta | null;
}

export interface SettleTurnResult {
  turnIndex: number;
  session: {
    title: string;
    titleSource: SessionTitleSource;
    turnCount: number;
  };
}
