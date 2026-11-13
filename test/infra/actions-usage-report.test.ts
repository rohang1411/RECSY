import { describe, expect, it } from 'vitest';
import {
  calculateJobBilledMinutes,
  calculateMedianGapHours,
  calculateRunBilledMinutes,
  calculateScheduleDelayMinutes,
  findPrecedingCronSlot,
  matchCronField,
  matchesCron,
  percentile,
  type WorkflowJob,
} from '../../scripts/actions-usage-report';

describe('Actions Usage & Billing Math (WP-00)', () => {
  describe('calculateJobBilledMinutes', () => {
    it('rounds up sub-minute durations to 1 minute per GitHub Actions billing rules', () => {
      const job4s: WorkflowJob = {
        name: 'Check pipeline secrets',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-11-13T07:24:48Z',
        completed_at: '2026-11-13T07:24:52Z', // 4 seconds
      };
      expect(calculateJobBilledMinutes(job4s)).toBe(1);

      const job59s: WorkflowJob = {
        name: 'Quick check',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-11-13T07:00:00Z',
        completed_at: '2026-11-13T07:00:59Z', // 59 seconds
      };
      expect(calculateJobBilledMinutes(job59s)).toBe(1);
    });

    it('rounds 60 seconds exactly to 1 minute', () => {
      const job60s: WorkflowJob = {
        started_at: '2026-11-13T07:00:00Z',
        completed_at: '2026-11-13T07:01:00Z',
        conclusion: 'success',
      };
      expect(calculateJobBilledMinutes(job60s)).toBe(1);
    });

    it('rounds 61 seconds up to 2 minutes', () => {
      const job61s: WorkflowJob = {
        started_at: '2026-11-13T07:00:00Z',
        completed_at: '2026-11-13T07:01:01Z',
        conclusion: 'success',
      };
      expect(calculateJobBilledMinutes(job61s)).toBe(2);
    });

    it('returns 0 for skipped jobs', () => {
      const skippedJob: WorkflowJob = {
        name: 'Evaluate Operations Alert Rules',
        status: 'completed',
        conclusion: 'skipped',
        started_at: null,
        completed_at: null,
      };
      expect(calculateJobBilledMinutes(skippedJob)).toBe(0);

      const skippedJobWithTimestamps: WorkflowJob = {
        name: 'Evaluate Operations Alert Rules',
        status: 'completed',
        conclusion: 'skipped',
        started_at: '2026-11-13T07:00:00Z',
        completed_at: '2026-11-13T07:00:05Z',
      };
      expect(calculateJobBilledMinutes(skippedJobWithTimestamps)).toBe(0);
    });

    it('returns 0 if timestamps are missing or invalid', () => {
      expect(calculateJobBilledMinutes({ conclusion: 'success' })).toBe(0);
      expect(
        calculateJobBilledMinutes({
          conclusion: 'success',
          started_at: '2026-11-13T07:00:00Z',
          completed_at: '2026-11-13T07:00:00Z', // 0 duration
        }),
      ).toBe(0);
    });
  });

  describe('calculateRunBilledMinutes', () => {
    it('returns 0 for empty jobs list', () => {
      expect(calculateRunBilledMinutes([])).toBe(0);
    });

    it('demonstrates the 2-job secrets gate doubling penalty', () => {
      // 4s gate job + 14s sweep job = 2 minutes billed
      const twoJobWorkflow: WorkflowJob[] = [
        {
          name: 'Check pipeline secrets',
          conclusion: 'success',
          started_at: '2026-11-13T07:24:48Z',
          completed_at: '2026-11-13T07:24:52Z', // 4s -> 1 min
        },
        {
          name: 'Evaluate Operations Alert Rules',
          conclusion: 'success',
          started_at: '2026-11-13T07:25:16Z',
          completed_at: '2026-11-13T07:25:30Z', // 14s -> 1 min
        },
      ];
      expect(calculateRunBilledMinutes(twoJobWorkflow)).toBe(2);

      // Single-job merged pattern: 1 job taking 18s total -> 1 min billed (50% reduction!)
      const mergedJobWorkflow: WorkflowJob[] = [
        {
          name: 'Evaluate Operations Alert Rules',
          conclusion: 'success',
          started_at: '2026-11-13T07:24:48Z',
          completed_at: '2026-11-13T07:25:06Z', // 18s -> 1 min
        },
      ];
      expect(calculateRunBilledMinutes(mergedJobWorkflow)).toBe(1);
    });

    it('correctly aggregates matrix jobs and ignores skipped jobs', () => {
      const matrixWorkflow: WorkflowJob[] = [
        {
          name: 'gate',
          conclusion: 'success',
          started_at: '2026-11-13T03:20:00Z',
          completed_at: '2026-11-13T03:20:08Z', // 8s -> 1 min
        },
        {
          name: 'resume (0)',
          conclusion: 'success',
          started_at: '2026-11-13T03:20:10Z',
          completed_at: '2026-11-13T03:25:15Z', // 5m 5s -> 6 min
        },
        {
          name: 'resume (1)',
          conclusion: 'success',
          started_at: '2026-11-13T03:20:10Z',
          completed_at: '2026-11-13T03:24:30Z', // 4m 20s -> 5 min
        },
        {
          name: 'resume (2)',
          conclusion: 'skipped',
          started_at: null,
          completed_at: null, // skipped -> 0 min
        },
        {
          name: 'resume (3)',
          conclusion: 'skipped',
          started_at: null,
          completed_at: null, // skipped -> 0 min
        },
      ];
      // 1 + 6 + 5 + 0 + 0 = 12 minutes
      expect(calculateRunBilledMinutes(matrixWorkflow)).toBe(12);
    });
  });

  describe('percentile', () => {
    it('handles empty and singleton arrays', () => {
      expect(percentile([], 50)).toBe(0);
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([42], 90)).toBe(42);
    });

    it('calculates median (p50) and p90 correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(values, 50)).toBe(5);
      expect(percentile(values, 90)).toBe(9);
    });
  });

  describe('calculateMedianGapHours', () => {
    it('returns null for less than 2 runs', () => {
      expect(calculateMedianGapHours([])).toBeNull();
      expect(calculateMedianGapHours(['2026-11-13T00:00:00Z'])).toBeNull();
    });

    it('calculates median gap between runs accurately', () => {
      const hourly = [
        '2026-11-13T01:00:00Z',
        '2026-11-13T02:00:00Z',
        '2026-11-13T03:00:00Z',
        '2026-11-13T04:00:00Z',
      ];
      expect(calculateMedianGapHours(hourly)).toBe(1);

      const irregular = [
        '2026-11-13T00:00:00Z',
        '2026-11-13T04:00:00Z', // gap 4h
        '2026-11-13T10:00:00Z', // gap 6h
        '2026-11-13T18:00:00Z', // gap 8h
      ];
      // gaps: [4, 6, 8] -> median is 6
      expect(calculateMedianGapHours(irregular)).toBe(6);
    });
  });

  describe('Cron matching and delay calculations', () => {
    it('parses cron fields accurately', () => {
      expect(matchCronField('*', 15)).toBe(true);
      expect(matchCronField('*/5', 25)).toBe(true);
      expect(matchCronField('*/5', 26)).toBe(false);
      expect(matchCronField('4,10,16,22', 10)).toBe(true);
      expect(matchCronField('4,10,16,22', 11)).toBe(false);
      expect(matchCronField('1-5', 3)).toBe(true);
      expect(matchCronField('1-5', 6)).toBe(false);
    });

    it('matches complete cron expressions against dates in UTC', () => {
      // 0 2 * * * (daily at 02:00 UTC)
      expect(matchesCron('0 2 * * *', new Date('2026-11-12T02:00:00Z'))).toBe(true);
      expect(matchesCron('0 2 * * *', new Date('2026-11-12T02:01:00Z'))).toBe(false);

      // 17 4,10,16,22 * * *
      expect(matchesCron('17 4,10,16,22 * * *', new Date('2026-11-12T10:17:00Z'))).toBe(true);
      expect(matchesCron('17 4,10,16,22 * * *', new Date('2026-11-12T12:17:00Z'))).toBe(false);

      // 0 0 * * 0 (Sunday 00:00 UTC)
      expect(matchesCron('0 0 * * 0', new Date('2026-11-08T00:00:00Z'))).toBe(true); // 2026-11-08 is Sunday
      expect(matchesCron('0 0 * * 0', new Date('2026-11-09T00:00:00Z'))).toBe(false); // Monday
    });

    it('finds preceding cron slot and reproduces Plan 30 Section 3.2 delays', () => {
      // account-maintenance (0 2 * * *): slot 02:00, started 09:25 -> 7h 25m = 445 min
      const slotAcc = findPrecedingCronSlot('0 2 * * *', new Date('2026-11-12T09:25:00Z'));
      expect(slotAcc?.toISOString()).toBe('2026-11-12T02:00:00.000Z');
      expect(calculateScheduleDelayMinutes('0 2 * * *', '2026-11-12T09:25:00Z')).toBe(445);

      // ingest-tiered (17 2 * * *): slot 02:17, started 09:56 -> 7h 39m = 459 min
      expect(calculateScheduleDelayMinutes('17 2 * * *', '2026-11-12T09:56:00Z')).toBe(459);

      // scorecard-auto (17 4,10,16,22 * * *): slot 10:17, started 12:37 -> 2h 20m = 140 min
      expect(calculateScheduleDelayMinutes('17 4,10,16,22 * * *', '2026-11-12T12:37:00Z')).toBe(
        140,
      );

      // non-scheduled workflow returns null delay
      expect(calculateScheduleDelayMinutes(null, '2026-11-12T12:37:00Z')).toBeNull();
    });
  });
});
