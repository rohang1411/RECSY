/**
 * User data export service.
 * Normative reference: Plan 25 Section 10.5 (R10).
 *
 * Gathers user profile, sessions, turns, chat queries, orders, ledger, and consents.
 * Excludes other people's data, abuse flags, and internal security identifiers.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { accountRequests } from '@/services/db/schema';
import { getUserProfile } from '@/services/auth/profile';

export interface UserExportData {
  exportedAt: string;
  profile: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    country: string | null;
    locale: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  consents: {
    termsVersion: string | null;
    termsAcceptedAt: string | null;
    marketingOptIn: boolean;
  };
  sessions: Array<{
    id: string;
    title: string;
    titleSource?: string;
    status?: string;
    isPinned?: boolean;
    createdAt: string;
    updatedAt: string;
    lastTurnAt?: string;
    turns: Array<{
      turnIndex: number;
      userMessage: string;
      intent: string;
      clarifyingQuestion: string | null;
      picks: unknown;
      resultMeta?: unknown;
      createdAt: string;
    }>;
  }>;
  chatQueries: Array<{
    id: string;
    phoneId: string;
    query: string;
    createdAt: string;
  }>;
  creditLedger: Array<{
    id: string;
    at: string;
    delta: number;
    balanceAfter: number;
    kind: string;
  }>;
  orders: Array<{
    id: string;
    productCode: string;
    amountMinor: number;
    currency: string;
    status: string;
    createdAt: string;
    paidAt: string | null;
  }>;
  subscription: Array<{
    planCode: string;
    status: string;
    includedQueries: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  }>;
  usageSummary: Array<{
    date: string;
    freeUsed: number;
    totalUsed: number;
    byokUsed: number;
  }>;
}

export async function exportUserData(db: AppQueryDb, userId: string): Promise<UserExportData> {
  const profile = await getUserProfile(db, userId);

  // 1. Sessions and turns
  type SessionRow = {
    id: string;
    title: string;
    title_source: string;
    status: string;
    is_pinned: boolean;
    created_at: Date | string;
    updated_at: Date | string;
    last_turn_at: Date | string;
  };
  const sessionRows = await db.execute<SessionRow>(sql`
    SELECT s.id, s.title, s.title_source, s.status, s.is_pinned,
           s.created_at, s.updated_at, s.last_turn_at
      FROM recommendation_sessions s
      LEFT JOIN recommendation_clients c ON s.client_id = c.id
     WHERE s.user_id = ${userId}::uuid OR c.user_id = ${userId}::uuid
     ORDER BY s.created_at ASC;
  `);

  type TurnRow = {
    session_id: string;
    turn_index: number;
    user_message: string;
    intent: string;
    clarifying_question: string | null;
    picks: unknown;
    result_meta: unknown;
    created_at: Date | string;
  };
  const turnRows = await db.execute<TurnRow>(sql`
    SELECT t.session_id, t.turn_index, t.user_message, t.intent,
           t.clarifying_question, t.picks, t.result_meta, t.created_at
      FROM recommendation_turns t
      JOIN recommendation_sessions s ON t.session_id = s.id
      LEFT JOIN recommendation_clients c ON s.client_id = c.id
     WHERE s.user_id = ${userId}::uuid OR c.user_id = ${userId}::uuid
     ORDER BY t.session_id, t.turn_index ASC;
  `);

  const turnsBySession = new Map<string, TurnRow[]>();
  for (const t of turnRows) {
    const list = turnsBySession.get(t.session_id) ?? [];
    list.push(t);
    turnsBySession.set(t.session_id, list);
  }

  const sessions = sessionRows.map((s) => ({
    id: s.id,
    title: s.title,
    titleSource: s.title_source,
    status: s.status,
    isPinned: s.is_pinned,
    createdAt:
      s.created_at instanceof Date
        ? s.created_at.toISOString()
        : new Date(s.created_at).toISOString(),
    updatedAt:
      s.updated_at instanceof Date
        ? s.updated_at.toISOString()
        : new Date(s.updated_at).toISOString(),
    lastTurnAt:
      s.last_turn_at instanceof Date
        ? s.last_turn_at.toISOString()
        : s.last_turn_at
          ? new Date(s.last_turn_at).toISOString()
          : undefined,
    turns: (turnsBySession.get(s.id) ?? []).map((t) => ({
      turnIndex: t.turn_index,
      userMessage: t.user_message,
      intent: t.intent,
      clarifyingQuestion: t.clarifying_question,
      picks: t.picks,
      resultMeta: t.result_meta,
      createdAt:
        t.created_at instanceof Date
          ? t.created_at.toISOString()
          : new Date(t.created_at).toISOString(),
    })),
  }));

  // 2. Chat queries
  type ChatRow = {
    id: string;
    phone_id: string;
    query: string;
    created_at: Date | string;
  };
  const chatRows = await db.execute<ChatRow>(sql`
    SELECT id, phone_id, query, created_at
      FROM chat_queries
     WHERE user_id = ${userId}::uuid
     ORDER BY created_at ASC;
  `);

  const chatQueries = chatRows.map((c) => ({
    id: c.id,
    phoneId: c.phone_id,
    query: c.query,
    createdAt:
      c.created_at instanceof Date
        ? c.created_at.toISOString()
        : new Date(c.created_at).toISOString(),
  }));

  // 3. Credit ledger
  type LedgerRow = {
    id: string;
    created_at: Date | string;
    delta: number;
    balance_after: number;
    kind: string;
  };
  const ledgerRows = await db.execute<LedgerRow>(sql`
    SELECT id, created_at, delta, balance_after, kind
      FROM credit_ledger
     WHERE user_id = ${userId}::uuid
     ORDER BY created_at ASC;
  `);

  const creditLedger = ledgerRows.map((l) => ({
    id: l.id,
    at:
      l.created_at instanceof Date
        ? l.created_at.toISOString()
        : new Date(l.created_at).toISOString(),
    delta: Number(l.delta),
    balanceAfter: Number(l.balance_after),
    kind: l.kind,
  }));

  // 4. Orders
  type OrderRow = {
    id: string;
    product_code: string;
    amount_minor: number;
    currency: string;
    status: string;
    created_at: Date | string;
    paid_at: Date | string | null;
  };
  const orderRows = await db.execute<OrderRow>(sql`
    SELECT id, product_code, amount_minor, currency, status, created_at, paid_at
      FROM billing_orders
     WHERE user_id = ${userId}::uuid
     ORDER BY created_at ASC;
  `);

  const orders = orderRows.map((o) => ({
    id: o.id,
    productCode: o.product_code,
    amountMinor: Number(o.amount_minor),
    currency: o.currency,
    status: o.status,
    createdAt:
      o.created_at instanceof Date
        ? o.created_at.toISOString()
        : new Date(o.created_at).toISOString(),
    paidAt: o.paid_at
      ? o.paid_at instanceof Date
        ? o.paid_at.toISOString()
        : new Date(o.paid_at).toISOString()
      : null,
  }));

  // 5. Subscriptions
  type SubRow = {
    plan_code: string;
    status: string;
    included_queries: number;
    current_period_start: Date | string;
    current_period_end: Date | string;
    cancel_at_period_end: boolean;
  };
  const subRows = await db.execute<SubRow>(sql`
    SELECT plan_code, status, included_queries, current_period_start, current_period_end, cancel_at_period_end
      FROM subscriptions
     WHERE user_id = ${userId}::uuid
     ORDER BY current_period_start ASC;
  `);

  const subscription = subRows.map((s) => ({
    planCode: s.plan_code,
    status: s.status,
    includedQueries: Number(s.included_queries),
    currentPeriodStart:
      s.current_period_start instanceof Date
        ? s.current_period_start.toISOString()
        : new Date(s.current_period_start).toISOString(),
    currentPeriodEnd:
      s.current_period_end instanceof Date
        ? s.current_period_end.toISOString()
        : new Date(s.current_period_end).toISOString(),
    cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
  }));

  // 6. Usage summary
  type UsageRow = {
    usage_date: string;
    free_used: number;
    total_used: number;
    byok_used: number;
  };
  const usageRows = await db.execute<UsageRow>(sql`
    SELECT usage_date, free_used, total_used, byok_used
      FROM usage_counters
     WHERE subject_kind = 'user' AND subject_id = ${userId}::text
     ORDER BY usage_date ASC;
  `);

  const usageSummary = usageRows.map((u) => ({
    date: String(u.usage_date),
    freeUsed: Number(u.free_used ?? 0),
    totalUsed: Number(u.total_used ?? 0),
    byokUsed: Number(u.byok_used ?? 0),
  }));

  // Record audit row in account_requests
  await db.insert(accountRequests).values({
    userId,
    kind: 'export',
    status: 'completed',
    completedAt: new Date(),
  });

  return {
    exportedAt: new Date().toISOString(),
    profile: profile
      ? {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
          country: profile.country,
          locale: profile.locale,
          createdAt:
            profile.created_at instanceof Date
              ? profile.created_at.toISOString()
              : new Date(profile.created_at).toISOString(),
          updatedAt:
            profile.updated_at instanceof Date
              ? profile.updated_at.toISOString()
              : new Date(profile.updated_at).toISOString(),
        }
      : null,
    consents: {
      termsVersion: profile?.terms_version ?? null,
      termsAcceptedAt: profile?.terms_accepted_at
        ? new Date(profile.terms_accepted_at).toISOString()
        : null,
      marketingOptIn: Boolean(profile?.marketing_opt_in),
    },
    sessions,
    chatQueries,
    creditLedger,
    orders,
    subscription,
    usageSummary,
  };
}
