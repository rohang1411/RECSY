import { desc, eq, sql } from 'drizzle-orm';

import { getDb, type AppDb } from '@/services/db/client';
import { catalogCandidates, catalogQualityIssues, crawlQueue, phones } from '@/services/db/schema';

export type DeviceCategory = 'promoted' | 'blocked' | 'pending' | 'pipeline' | 'queued';

export type BlockedReasonItem = {
  readonly code: string;
  readonly label: string;
  readonly count: number;
};

export type DeviceRowItem = {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly category: DeviceCategory;
  readonly status: string;
  readonly decision: string | null;
  readonly blockedReason: string | null;
  readonly issueCodes: readonly string[];
  readonly qualityIssues: readonly {
    readonly severity: string;
    readonly code: string;
    readonly message: string;
    readonly fieldPath: string | null;
  }[];
  readonly sourceKey: string;
  readonly sourceUrl: string | null;
  readonly confidence: string | null;
  readonly attempts: number;
  readonly retryAfter: string | null;
  readonly phoneSlug: string | null;
  readonly updatedAt: string;
};

export type DatabaseDashboardSummary = {
  readonly totalActivePhones: number;
  readonly totalCandidates: number;
  readonly promotedCount: number;
  readonly blockedCount: number;
  readonly pendingCount: number;
  readonly queuedCount: number;
  readonly inPipelineCount: number;
};

export type DatabaseDashboardData = {
  readonly summary: DatabaseDashboardSummary;
  readonly blockedReasons: readonly BlockedReasonItem[];
  readonly devices: readonly DeviceRowItem[];
  readonly brands: readonly string[];
};

export type DatabaseFilterParams = {
  readonly status?: string | null;
  readonly reason?: string | null;
  readonly brand?: string | null;
  readonly search?: string | null;
};

const BLOCKED_STATUSES = [
  'quarantined',
  'failed',
  'failed_transient',
  'rate_limited',
  'quota_exhausted',
] as const;

let cachedDashboardBase: {
  readonly summary: DatabaseDashboardSummary;
  readonly blockedReasons: readonly BlockedReasonItem[];
  readonly devices: readonly DeviceRowItem[];
  readonly brands: readonly string[];
  readonly expiresAtMs: number;
} | null = null;

const EMPTY_DASHBOARD_DATA: DatabaseDashboardSummary = {
  totalActivePhones: 0,
  totalCandidates: 0,
  promotedCount: 0,
  blockedCount: 0,
  pendingCount: 0,
  queuedCount: 0,
  inPipelineCount: 0,
};

async function safeQuery<T>(
  promise: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[database-dashboard] ${label} query timed out after ${timeoutMs}ms`);
        resolve(fallback);
      }, timeoutMs);
    });

    const guarded = promise.catch((error) => {
      console.warn(
        `[database-dashboard] ${label} query failed:`,
        error instanceof Error ? error.message : String(error),
      );
      return fallback;
    });

    return await Promise.race([guarded, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadDatabaseDashboardData(
  filters: DatabaseFilterParams = {},
): Promise<DatabaseDashboardData> {
  try {
    return await loadDatabaseDashboardDataInternal(filters);
  } catch (error) {
    console.warn(
      '[database-dashboard] loadDatabaseDashboardData error:',
      error instanceof Error ? error.message : String(error),
    );
    return {
      summary: EMPTY_DASHBOARD_DATA,
      blockedReasons: [],
      devices: [],
      brands: [],
    };
  }
}

async function loadDatabaseDashboardDataInternal(
  filters: DatabaseFilterParams = {},
): Promise<DatabaseDashboardData> {
  const now = Date.now();
  let baseData: {
    readonly summary: DatabaseDashboardSummary;
    readonly blockedReasons: readonly BlockedReasonItem[];
    readonly devices: readonly DeviceRowItem[];
    readonly brands: readonly string[];
  };

  if (cachedDashboardBase && now < cachedDashboardBase.expiresAtMs) {
    baseData = cachedDashboardBase;
  } else {
    const db = getDb();
    const [summary, candidateRows, issuesRows, activePhoneRows] = await Promise.all([
      loadDatabaseSummary(db),
      safeQuery(loadCandidates(db), [], 'loadCandidates', 3500),
      safeQuery(loadRecentQualityIssues(db), [], 'loadRecentQualityIssues', 3500),
      safeQuery(loadActivePhones(db), [], 'loadActivePhones', 3500),
    ]);

    const issuesByCandidateId = new Map<string, typeof issuesRows>();
    for (const issue of issuesRows) {
      if (!issue.candidateId) continue;
      const existing = issuesByCandidateId.get(issue.candidateId) ?? [];
      existing.push(issue);
      issuesByCandidateId.set(issue.candidateId, existing);
    }

    const reasonCountMap = new Map<string, number>();
    const deviceItems: DeviceRowItem[] = [];

    for (const candidate of candidateRows) {
      const candidateIssues = issuesByCandidateId.get(candidate.id) ?? [];
      const category = categorizeCandidate(candidate.status, candidate.decision);
      const blockedReason = deriveBlockedReason(candidate, candidateIssues);

      if (category === 'blocked' && candidate.issueCodes) {
        for (const code of candidate.issueCodes) {
          if (code) {
            reasonCountMap.set(code, (reasonCountMap.get(code) ?? 0) + 1);
          }
        }
        if (candidateIssues.length > 0) {
          for (const issue of candidateIssues) {
            reasonCountMap.set(issue.code, (reasonCountMap.get(issue.code) ?? 0) + 1);
          }
        }
        if (
          candidate.lastError &&
          candidate.issueCodes.length === 0 &&
          candidateIssues.length === 0
        ) {
          const simplifiedError = simplifyError(candidate.lastError);
          reasonCountMap.set(simplifiedError, (reasonCountMap.get(simplifiedError) ?? 0) + 1);
        }
      }

      deviceItems.push({
        id: candidate.id,
        name: candidate.candidateTitle,
        brand: candidate.matchedBrand ?? inferBrand(candidate.candidateTitle),
        model: candidate.matchedModel ?? null,
        category,
        status: candidate.status,
        decision: candidate.decision,
        blockedReason,
        issueCodes: candidate.issueCodes ?? [],
        qualityIssues: candidateIssues.map((issue) => ({
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          fieldPath: issue.fieldPath,
        })),
        sourceKey: candidate.sourceKey,
        sourceUrl: candidate.sourceUrl,
        confidence: candidate.confidence,
        attempts: candidate.attempts,
        retryAfter: candidate.retryAfter ? candidate.retryAfter.toISOString() : null,
        phoneSlug: candidate.matchedSlug,
        updatedAt: candidate.updatedAt
          ? candidate.updatedAt.toISOString()
          : new Date().toISOString(),
      });
    }

    const candidatePhoneSlugs = new Set(
      deviceItems.filter((d) => d.phoneSlug).map((d) => d.phoneSlug as string),
    );

    for (const phone of activePhoneRows) {
      if (!candidatePhoneSlugs.has(phone.slug)) {
        deviceItems.push({
          id: phone.id,
          name: `${phone.brand} ${phone.model}`,
          brand: phone.brand,
          model: phone.model,
          category: 'promoted',
          status: 'promoted',
          decision: 'promote',
          blockedReason: null,
          issueCodes: [],
          qualityIssues: [],
          sourceKey: 'recsy_catalog',
          sourceUrl: `/phones/${phone.slug}`,
          confidence: '1.00',
          attempts: 0,
          retryAfter: null,
          phoneSlug: phone.slug,
          updatedAt: phone.updatedAt ? phone.updatedAt.toISOString() : new Date().toISOString(),
        });
      }
    }

    const blockedReasons: BlockedReasonItem[] = Array.from(reasonCountMap.entries())
      .map(([code, count]) => ({
        code,
        label: humanizeReason(code),
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const brandSet = new Set<string>();
    for (const item of deviceItems) {
      if (item.brand) brandSet.add(item.brand);
    }
    const brands = Array.from(brandSet).sort();

    baseData = {
      summary,
      blockedReasons,
      devices: deviceItems,
      brands,
    };
    cachedDashboardBase = { ...baseData, expiresAtMs: now + 60_000 };
  }

  const { summary, blockedReasons, devices: deviceItems, brands } = baseData;

  // Apply filters
  let filteredDevices = deviceItems;

  if (filters.status && filters.status !== 'all') {
    filteredDevices = filteredDevices.filter((d) => d.category === filters.status);
  }

  if (filters.brand && filters.brand !== 'all') {
    filteredDevices = filteredDevices.filter(
      (d) => d.brand?.toLowerCase() === filters.brand?.toLowerCase(),
    );
  }

  if (filters.reason && filters.reason !== 'all') {
    const targetReason = filters.reason.toLowerCase();
    filteredDevices = filteredDevices.filter(
      (d) =>
        d.blockedReason?.toLowerCase().includes(targetReason) ||
        d.issueCodes.some((c) => c.toLowerCase() === targetReason) ||
        d.qualityIssues.some((q) => q.code.toLowerCase() === targetReason),
    );
  }

  if (filters.search && filters.search.trim().length > 0) {
    const query = filters.search.toLowerCase().trim();
    filteredDevices = filteredDevices.filter(
      (d) =>
        d.name.toLowerCase().includes(query) ||
        (d.brand && d.brand.toLowerCase().includes(query)) ||
        (d.model && d.model.toLowerCase().includes(query)) ||
        d.sourceKey.toLowerCase().includes(query) ||
        (d.blockedReason && d.blockedReason.toLowerCase().includes(query)),
    );
  }

  return {
    summary,
    blockedReasons,
    devices: filteredDevices,
    brands,
  };
}

async function loadDatabaseSummary(db: AppDb): Promise<DatabaseDashboardSummary> {
  try {
    const [activePhonesCount, candidateSummary, queueSummary] = await Promise.all([
      safeQuery(
        db
          .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
          .from(phones)
          .where(eq(phones.status, 'active')),
        [{ count: 0 }],
        'loadActivePhonesCount',
      ),
      safeQuery(
        db
          .select({
            total: sql<number>`count(*)::int`.mapWith(Number),
            promoted:
              sql<number>`count(*) filter (where ${catalogCandidates.status} = 'promoted')::int`.mapWith(
                Number,
              ),
            blocked:
              sql<number>`count(*) filter (where ${catalogCandidates.status} in ('quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted') or ${catalogCandidates.decision} = 'quarantine')::int`.mapWith(
                Number,
              ),
            pending:
              sql<number>`count(*) filter (where ${catalogCandidates.decision} = 'pending_review' or (${catalogCandidates.status} = 'validated' and ${catalogCandidates.decision} is null))::int`.mapWith(
                Number,
              ),
            queued:
              sql<number>`count(*) filter (where ${catalogCandidates.status} = 'ready_to_promote')::int`.mapWith(
                Number,
              ),
            inPipeline:
              sql<number>`count(*) filter (where ${catalogCandidates.status} in ('discovered', 'fetched', 'extracted'))::int`.mapWith(
                Number,
              ),
          })
          .from(catalogCandidates),
        [{ total: 0, promoted: 0, blocked: 0, pending: 0, queued: 0, inPipeline: 0 }],
        'loadCandidateSummary',
      ),
      safeQuery(
        db
          .select({
            queueCount:
              sql<number>`count(*) filter (where ${crawlQueue.status} in ('queued', 'in_progress'))::int`.mapWith(
                Number,
              ),
          })
          .from(crawlQueue),
        [{ queueCount: 0 }],
        'loadQueueSummary',
      ),
    ]);

    const active = activePhonesCount[0]?.count ?? 0;
    const cand = candidateSummary[0] ?? {
      total: 0,
      promoted: 0,
      blocked: 0,
      pending: 0,
      queued: 0,
      inPipeline: 0,
    };
    const queue = queueSummary[0]?.queueCount ?? 0;

    return {
      totalActivePhones: active,
      totalCandidates: cand.total,
      promotedCount: cand.promoted > 0 ? cand.promoted : active,
      blockedCount: cand.blocked,
      pendingCount: cand.pending,
      queuedCount: cand.queued + queue,
      inPipelineCount: cand.inPipeline,
    };
  } catch (error) {
    console.warn('[database-dashboard] loadDatabaseSummary failed:', error);
    return EMPTY_DASHBOARD_DATA;
  }
}

export type CommandCenterDatabaseSummary = {
  readonly summary: DatabaseDashboardSummary;
  readonly topBlockedReason: string;
};

let cachedCommandCenterDb: {
  readonly data: CommandCenterDatabaseSummary;
  readonly expiresAtMs: number;
} | null = null;

async function loadTopBlockedReason(db: AppDb): Promise<string> {
  const row = await safeQuery(
    db
      .select({
        code: sql<string>`coalesce(nullif(${catalogCandidates.issueCodes}[1], ''), 'quarantined')`,
        count: sql<number>`count(*)::int`.mapWith(Number),
      })
      .from(catalogCandidates)
      .where(
        sql`${catalogCandidates.status} in ('quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted') or ${catalogCandidates.decision} = 'quarantine'`,
      )
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(1),
    [],
    'loadTopBlockedReason',
    2000,
  );

  return row[0]?.code ? humanizeReason(row[0].code) : 'None';
}

export async function loadCommandCenterDatabaseSummary(): Promise<CommandCenterDatabaseSummary> {
  const now = Date.now();
  if (cachedCommandCenterDb && now < cachedCommandCenterDb.expiresAtMs) {
    return cachedCommandCenterDb.data;
  }

  const db = getDb();
  const [summary, topBlockedReason] = await Promise.all([
    loadDatabaseSummary(db),
    loadTopBlockedReason(db),
  ]);

  const result: CommandCenterDatabaseSummary = {
    summary,
    topBlockedReason,
  };

  cachedCommandCenterDb = { data: result, expiresAtMs: now + 60_000 };
  return result;
}

async function loadCandidates(db: AppDb) {
  const rows = await db
    .select({
      id: catalogCandidates.id,
      candidateTitle: catalogCandidates.candidateTitle,
      status: catalogCandidates.status,
      decision: catalogCandidates.decision,
      sourceKey: catalogCandidates.sourceKey,
      sourceType: catalogCandidates.sourceType,
      sourceUrl: catalogCandidates.sourceUrl,
      confidence: catalogCandidates.confidence,
      issueCodes: catalogCandidates.issueCodes,
      lastError: catalogCandidates.lastError,
      retryAfter: catalogCandidates.retryAfter,
      attempts: catalogCandidates.attempts,
      updatedAt: catalogCandidates.updatedAt,
      matchedSlug: phones.slug,
      matchedBrand: phones.brand,
      matchedModel: phones.model,
    })
    .from(catalogCandidates)
    .leftJoin(phones, eq(catalogCandidates.matchedPhoneId, phones.id))
    .limit(300);

  return rows.sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
}

async function loadRecentQualityIssues(db: AppDb) {
  return db
    .select({
      candidateId: catalogQualityIssues.candidateId,
      severity: catalogQualityIssues.severity,
      code: catalogQualityIssues.code,
      message: catalogQualityIssues.message,
      fieldPath: catalogQualityIssues.fieldPath,
    })
    .from(catalogQualityIssues)
    .limit(300);
}

async function loadActivePhones(db: AppDb) {
  return db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      updatedAt: phones.updatedAt,
    })
    .from(phones)
    .where(eq(phones.status, 'active'))
    .orderBy(desc(phones.updatedAt))
    .limit(100);
}

function categorizeCandidate(status: string, decision: string | null): DeviceCategory {
  if (status === 'promoted' || decision === 'promote') return 'promoted';
  if (
    BLOCKED_STATUSES.includes(status as (typeof BLOCKED_STATUSES)[number]) ||
    decision === 'quarantine'
  ) {
    return 'blocked';
  }
  if (decision === 'pending_review' || (status === 'validated' && !decision)) return 'pending';
  if (status === 'ready_to_promote') return 'queued';
  return 'pipeline';
}

function deriveBlockedReason(
  candidate: {
    readonly lastError: string | null;
    readonly issueCodes: readonly string[];
  },
  issues: readonly {
    readonly code: string;
    readonly message: string;
    readonly fieldPath: string | null;
  }[],
): string | null {
  if (candidate.lastError) {
    return candidate.lastError;
  }
  if (issues.length > 0) {
    const first = issues[0]!;
    return first.fieldPath
      ? `${first.code}: ${first.message} (${first.fieldPath})`
      : `${first.code}: ${first.message}`;
  }
  if (candidate.issueCodes.length > 0) {
    return candidate.issueCodes.join(', ');
  }
  return null;
}

function simplifyError(error: string): string {
  if (error.includes('duplicate key')) return 'DUPLICATE_KEY';
  if (error.includes('timeout') || error.includes('TIMEDOUT')) return 'TIMEOUT';
  if (error.includes('429') || error.includes('rate limit')) return 'RATE_LIMITED';
  if (error.includes('404')) return 'NOT_FOUND_404';
  if (error.includes('parse') || error.includes('SyntaxError')) return 'PARSE_ERROR';
  return error.slice(0, 30).trim();
}

function humanizeReason(code: string): string {
  return code
    .replace(/[_-]/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferBrand(title: string): string | null {
  const lower = title.toLowerCase();
  if (lower.includes('iphone') || lower.includes('apple')) return 'Apple';
  if (lower.includes('galaxy') || lower.includes('samsung')) return 'Samsung';
  if (lower.includes('pixel') || lower.includes('google')) return 'Google';
  if (lower.includes('oneplus')) return 'OnePlus';
  if (lower.includes('xiaomi') || lower.includes('redmi') || lower.includes('poco'))
    return 'Xiaomi';
  if (lower.includes('motorola') || lower.includes('moto')) return 'Motorola';
  if (lower.includes('sony') || lower.includes('xperia')) return 'Sony';
  if (lower.includes('asus') || lower.includes('rog')) return 'Asus';
  if (lower.includes('nothing')) return 'Nothing';
  const firstWord = title.split(' ')[0];
  return firstWord && firstWord.length > 2 ? firstWord : null;
}
