import { describe, expect, it } from 'vitest';

import { classifyPhoneIngestion } from './phone-ingestion-dashboard';

describe('classifyPhoneIngestion', () => {
  const baseRaw = {
    id: 'test-phone-1',
    slug: 'apple-iphone-16-pro',
    brand: 'Apple',
    model: 'iPhone 16 Pro',
    status: 'active',
    launch_date: '2024-09-20',
    last_ingest_at: '2026-09-01T12:00:00Z',
    next_ingest_at: '2026-10-01T12:00:00Z',
    last_ingest_status: 'success',
    has_spec_embedding: true,
    source_count: 5,
    chunk_count: 42,
    aspect_count: 7,
    queue_status: null,
    queue_adapter: null,
    queue_scheduled_for: null,
    queue_attempts: 0,
    queue_last_error: null,
    last_run_status: 'success',
    last_run_error: null,
    last_run_error_code: null,
    last_run_stage: 'write',
    last_run_started_at: '2026-09-01T12:00:00Z',
  };

  it('classifies complete phone when evidence, specs, and scorecards are present', () => {
    const result = classifyPhoneIngestion(baseRaw);
    expect(result.isComplete).toBe(true);
    expect(result.statusCategory).toBe('complete');
    expect(result.pendingReason).toBeNull();
    expect(result.isOverdue).toBe(false);
  });

  it('flags complete phone as overdue when next_ingest_at is in the past', () => {
    const overdue = {
      ...baseRaw,
      next_ingest_at: '2026-01-01T00:00:00Z',
    };
    const result = classifyPhoneIngestion(overdue, new Date('2026-09-20T00:00:00Z'));
    expect(result.isComplete).toBe(true);
    expect(result.isOverdue).toBe(true);
    expect(result.pendingReason?.code).toBe('overdue_refresh');
  });

  it('classifies as quota_exhausted when last ingest status or error indicates quota exhaustion', () => {
    const quotaTrip = {
      ...baseRaw,
      last_ingest_status: 'quota_exhausted',
      last_run_error_code: 'quota_exceeded',
      last_run_error: 'Resource has been exhausted (e.g. check quota)',
    };
    const result = classifyPhoneIngestion(quotaTrip);
    expect(result.isComplete).toBe(false);
    expect(result.statusCategory).toBe('quota_exhausted');
    expect(result.pendingReason?.code).toBe('quota_exhausted');
  });

  it('classifies as failed when ingest run crashed with an error', () => {
    const failedRun = {
      ...baseRaw,
      last_ingest_status: 'failed',
      last_run_status: 'failed',
      last_run_error: 'HTTP 403 Forbidden from reddit.com/r/Android',
      last_run_stage: 'fetch',
    };
    const result = classifyPhoneIngestion(failedRun);
    expect(result.isComplete).toBe(false);
    expect(result.statusCategory).toBe('failed');
    expect(result.pendingReason?.code).toBe('ingest_run_failed');
    expect(result.pendingReason?.errorDetail).toContain('HTTP 403');
  });

  it('classifies as queued when phone is actively waiting in crawl_queue', () => {
    const inQueue = {
      ...baseRaw,
      chunk_count: 0,
      source_count: 0,
      aspect_count: 0,
      queue_status: 'queued',
      queue_adapter: 'youtube',
      queue_attempts: 1,
    };
    const result = classifyPhoneIngestion(inQueue);
    expect(result.isComplete).toBe(false);
    expect(result.statusCategory).toBe('queued');
    expect(result.pendingReason?.code).toBe('in_crawl_queue');
  });

  it('classifies as empty_corpus when crawler ran but 0 chunks were extracted', () => {
    const emptyCorpus = {
      ...baseRaw,
      chunk_count: 0,
      source_count: 0,
      aspect_count: 0,
      last_ingest_at: '2026-09-10T12:00:00Z',
      queue_status: null,
    };
    const result = classifyPhoneIngestion(emptyCorpus);
    expect(result.isComplete).toBe(false);
    expect(result.statusCategory).toBe('empty_corpus');
    expect(result.pendingReason?.code).toBe('empty_corpus');
  });

  it('classifies as scorecard_missing when chunks exist but aspects are not scored', () => {
    const unscored = {
      ...baseRaw,
      chunk_count: 35,
      source_count: 4,
      aspect_count: 0,
    };
    const result = classifyPhoneIngestion(unscored);
    expect(result.isComplete).toBe(false);
    expect(result.statusCategory).toBe('scorecard_missing');
    expect(result.pendingReason?.code).toBe('scorecard_missing');
  });

  it('classifies as never_scheduled when newly active phone has no ingest runs or queue entries', () => {
    const fresh = {
      ...baseRaw,
      last_ingest_at: null,
      last_ingest_status: null,
      chunk_count: 0,
      source_count: 0,
      aspect_count: 0,
      queue_status: null,
      last_run_status: null,
    };
    const result = classifyPhoneIngestion(fresh);
    expect(result.isComplete).toBe(false);
    expect(result.statusCategory).toBe('never_scheduled');
    expect(result.pendingReason?.code).toBe('never_scheduled');
  });
});
