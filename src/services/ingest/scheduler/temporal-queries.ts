/**
 * Milestone-gated temporal query generator.
 *
 * Ensures age-specific and generational queries are run only once per
 * milestone threshold, preventing runner quota exhaustion and scraping bans.
 */
import { eq, sql } from 'drizzle-orm';
import { phones } from '@/services/db/schema';
import type { Db } from '../writer';

export interface TemporalMilestoneQuery {
  readonly milestone: 'launch' | '6m' | '1y' | 'successor';
  readonly query: string;
  readonly temporalCategory:
    | 'launch'
    | 'long_term_6m'
    | 'long_term_1y'
    | 'comparison'
    | 'reliability';
}

export function getDueMilestones(
  phone: {
    brand: string;
    model: string;
    launchDate: Date | string | null;
    milestonesScouted?: string[] | null;
  },
  successorModel?: string | null,
  now = new Date(),
): TemporalMilestoneQuery[] {
  const scouted = new Set(phone.milestonesScouted ?? []);
  const parsedLaunchDate = phone.launchDate
    ? typeof phone.launchDate === 'string'
      ? new Date(phone.launchDate)
      : phone.launchDate
    : null;

  const ageDays =
    parsedLaunchDate && !isNaN(parsedLaunchDate.getTime())
      ? Math.max(0, (now.getTime() - parsedLaunchDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

  const due: TemporalMilestoneQuery[] = [];

  // 1. Launch milestone (if never scouted)
  if (!scouted.has('launch')) {
    due.push(
      {
        milestone: 'launch',
        query: `${phone.brand} ${phone.model} review`,
        temporalCategory: 'launch',
      },
      {
        milestone: 'launch',
        query: `${phone.brand} ${phone.model} camera test`,
        temporalCategory: 'launch',
      },
      {
        milestone: 'launch',
        query: `${phone.brand} ${phone.model} battery test`,
        temporalCategory: 'launch',
      },
    );
  }

  // 2. 6-Month milestone (triggered once at 150+ days)
  if (ageDays >= 150 && !scouted.has('6m')) {
    due.push(
      {
        milestone: '6m',
        query: `${phone.brand} ${phone.model} 6 months later`,
        temporalCategory: 'long_term_6m',
      },
      {
        milestone: '6m',
        query: `${phone.brand} ${phone.model} long term review`,
        temporalCategory: 'long_term_6m',
      },
      {
        milestone: '6m',
        query: `${phone.brand} ${phone.model} battery drain test`,
        temporalCategory: 'reliability',
      },
      {
        milestone: '6m',
        query: `${phone.brand} ${phone.model} update problems`,
        temporalCategory: 'reliability',
      },
    );
  }

  // 3. 1-Year milestone (triggered once at 330+ days)
  if (ageDays >= 330 && !scouted.has('1y')) {
    due.push(
      {
        milestone: '1y',
        query: `${phone.brand} ${phone.model} 1 year later`,
        temporalCategory: 'long_term_1y',
      },
      {
        milestone: '1y',
        query: `${phone.brand} ${phone.model} revisited`,
        temporalCategory: 'long_term_1y',
      },
      {
        milestone: '1y',
        query: `${phone.brand} ${phone.model} still worth it`,
        temporalCategory: 'long_term_1y',
      },
    );
  }

  // 4. Successor milestone (triggered once when newer flagship is in catalog)
  if (successorModel && !scouted.has(`successor:${successorModel}`)) {
    due.push(
      {
        milestone: 'successor',
        query: `${successorModel} vs ${phone.model}`,
        temporalCategory: 'comparison',
      },
      {
        milestone: 'successor',
        query: `${phone.model} vs ${successorModel} upgrade`,
        temporalCategory: 'comparison',
      },
    );
  }

  return due;
}

/**
 * Record milestones as scouted in the DB so that queries are not re-run.
 */
export async function recordScoutedMilestones(
  db: Db,
  phoneId: string,
  milestones: readonly string[],
): Promise<void> {
  if (milestones.length === 0) return;
  await db
    .update(phones)
    .set({
      milestonesScouted: sql`array(select distinct unnest(coalesce(${phones.milestonesScouted}, '{}'::text[]) || ${milestones}::text[]))`,
      updatedAt: sql`now()`,
    })
    .where(eq(phones.id, phoneId));
}
