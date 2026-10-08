import { and, desc, eq, sql } from 'drizzle-orm';
import {
  activeCatalogCandidateSql,
  isArchivedCatalogCandidate,
} from '@/services/catalog/eligibility';

import { getDb, type AppDb } from '@/services/db/client';
import { catalogCandidates, catalogQualityIssues, crawlQueue, phones } from '@/services/db/schema';

export type DeviceCategory =
  | 'promoted'
  | 'blocked'
  | 'pending'
  | 'pipeline'
  | 'queued'
  | 'archived';

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
  readonly archivedCount: number;
};

export type DatabaseDashboardData = {
  readonly dataWarning: string | null;
  readonly entryCount: number;
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
  archivedCount: 0,
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
      dataWarning:
        'Database inventory is temporarily unavailable. Refresh to retry; the counts below are not verified.',
      entryCount: 0,
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
    const summary = await loadDatabaseSummary(db, true);
    const activePhoneRows = await requireQuery(loadActivePhones(db), 'loadActivePhones');
    const [candidateRows, issuesRows] = await Promise.all([
      requireQuery(loadCandidates(db), 'loadCandidates'),
      requireQuery(loadRecentQualityIssues(db), 'loadRecentQualityIssues'),
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
    const promotedSlugs = new Set<string>();

    for (const candidate of candidateRows) {
      const candidateIssues = issuesByCandidateId.get(candidate.id) ?? [];
      const category =
        candidate.excluded ||
        isArchivedCatalogCandidate(candidate.issueCodes) ||
        candidate.matchedStatus === 'archived'
          ? 'archived'
          : categorizeCandidate(candidate.status, candidate.decision);
      const blockedReason = deriveBlockedReason(candidate, candidateIssues);
      if (category === 'promoted' && candidate.matchedSlug) {
        if (promotedSlugs.has(candidate.matchedSlug)) continue;
        promotedSlugs.add(candidate.matchedSlug);
      }

      if (category === 'blocked' && candidate.issueCodes) {
        const reasonCodes = new Set<string>();
        for (const code of candidate.issueCodes) {
          if (code) {
            reasonCodes.add(code);
          }
        }
        if (candidateIssues.length > 0) {
          for (const issue of candidateIssues) {
            reasonCodes.add(issue.code);
          }
        }
        if (
          candidate.lastError &&
          candidate.issueCodes.length === 0 &&
          candidateIssues.length === 0
        ) {
          const simplifiedError = simplifyError(candidate.lastError);
          reasonCodes.add(simplifiedError);
        }
        for (const code of reasonCodes)
          reasonCountMap.set(code, (reasonCountMap.get(code) ?? 0) + 1);
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
        phoneSlug: category === 'archived' ? null : candidate.matchedSlug,
        updatedAt: candidate.updatedAt
          ? candidate.updatedAt.toISOString()
          : new Date().toISOString(),
      });
    }

    const candidatePhoneSlugs = new Set(
      deviceItems
        .filter((d) => d.phoneSlug && d.category === 'promoted')
        .map((d) => d.phoneSlug as string),
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
      if (item.brand && item.category !== 'archived') brandSet.add(item.brand);
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
  let filteredDevices = deviceItems.filter((d) =>
    filters.status === 'archived' ? d.category === 'archived' : d.category !== 'archived',
  );

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
    dataWarning: null,
    entryCount: deviceItems.filter((d) => d.category !== 'archived').length,
    summary,
    blockedReasons,
    devices: filteredDevices,
    brands,
  };
}

async function requireQuery<T>(promise: Promise<T>, label: string): Promise<T> {
  const result = await safeQuery<T | undefined>(promise, undefined, label, 8000);
  if (result === undefined) throw new Error(`${label}: database query unavailable`);
  return result;
}

async function loadDatabaseSummary(db: AppDb, strict = false): Promise<DatabaseDashboardSummary> {
  try {
    const [activePhonesCount, candidateSummary, queueSummary] = await Promise.all([
      requireQuery(
        db
          .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
          .from(phones)
          .where(eq(phones.status, 'active')),
        'loadActivePhonesCount',
      ),
      requireQuery(
        db
          .select({
            total: sql<number>`count(*)::int`.mapWith(Number),
            promoted:
              sql<number>`count(*) filter (where ${catalogCandidates.status} = 'promoted')::int`.mapWith(
                Number,
              ),
            blocked:
              sql<number>`count(*) filter (where ${catalogCandidates.status} in ('quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted') or ${catalogCandidates.decision} = 'quarantine' or (${catalogCandidates.status} = 'skipped' and ${catalogCandidates.decision} = 'skip'))::int`.mapWith(
                Number,
              ),
            pending:
              sql<number>`count(*) filter (where (${catalogCandidates.decision} = 'pending_review' or (${catalogCandidates.status} = 'validated' and ${catalogCandidates.decision} is null)) and ${catalogCandidates.status} not in ('quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted', 'ready_to_promote') and ${catalogCandidates.decision} is distinct from 'quarantine')::int`.mapWith(
                Number,
              ),
            queued:
              sql<number>`count(*) filter (where ${catalogCandidates.status} = 'ready_to_promote')::int`.mapWith(
                Number,
              ),
            inPipeline:
              sql<number>`count(*) filter (where ${catalogCandidates.status} in ('discovered', 'fetched', 'extracted') and ${catalogCandidates.decision} is distinct from 'pending_review' and ${catalogCandidates.decision} is distinct from 'promote')::int`.mapWith(
                Number,
              ),
          })
          .from(catalogCandidates)
          .where(activeCatalogCandidateSql()),
        'loadCandidateSummary',
      ),
      requireQuery(
        db
          .select({
            queueCount:
              sql<number>`count(*) filter (where ${crawlQueue.status} in ('queued', 'in_progress'))::int`.mapWith(
                Number,
              ),
          })
          .from(crawlQueue)
          .innerJoin(phones, eq(crawlQueue.phoneId, phones.id))
          .where(eq(phones.status, 'active')),
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
      promotedCount: active,
      blockedCount: cand.blocked,
      pendingCount: cand.pending,
      queuedCount: cand.queued + queue,
      inPipelineCount: cand.inPipeline,
      archivedCount: Number(
        (
          await requireQuery(
            db
              .select({ count: sql<number>`count(*)::int` })
              .from(catalogCandidates)
              .where(sql`not (${activeCatalogCandidateSql()})`),
            'loadArchivedCount',
          )
        )[0]?.count ?? 0,
      ),
    };
  } catch (error) {
    console.warn('[database-dashboard] loadDatabaseSummary failed:', error);
    if (strict) throw error;
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
        and(
          activeCatalogCandidateSql(),
          sql`${catalogCandidates.status} in ('quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted') or ${catalogCandidates.decision} = 'quarantine'`,
        ),
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
    loadDatabaseSummary(db, true),
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
      matchedStatus: phones.status,
      excluded: sql<boolean>`not (${activeCatalogCandidateSql()})`,
    })
    .from(catalogCandidates)
    .leftJoin(phones, eq(catalogCandidates.matchedPhoneId, phones.id))
    .orderBy(desc(catalogCandidates.updatedAt));

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
    .orderBy(desc(phones.updatedAt));
}

function categorizeCandidate(status: string, decision: string | null): DeviceCategory {
  if (status === 'ready_to_promote') return 'queued';
  if (status === 'promoted' || decision === 'promote' || decision === 'matched_existing')
    return 'promoted';
  if (
    (status === 'skipped' && decision === 'skip') ||
    BLOCKED_STATUSES.includes(status as (typeof BLOCKED_STATUSES)[number]) ||
    decision === 'quarantine'
  ) {
    return 'blocked';
  }
  if (decision === 'pending_review' || (status === 'validated' && !decision)) return 'pending';
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
