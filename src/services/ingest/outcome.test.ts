import { describe, expect, it } from 'vitest';
import { classifyIngestOutcome } from './outcome';

const unchanged = {
  sourcesWritten: 0,
  chunksWritten: 0,
  errors: 0,
  hasActiveCorpus: true,
  hasQuotaFailures: false,
};
describe('ingest outcome', () => {
  it('counts a clean unchanged corpus check as success', () => {
    expect(classifyIngestOutcome(unchanged)).toBe('success');
  });
  it('distinguishes missing evidence from failed requests', () => {
    expect(classifyIngestOutcome({ ...unchanged, hasActiveCorpus: false })).toBe('empty');
    expect(classifyIngestOutcome({ ...unchanged, hasActiveCorpus: false, errors: 1 })).toBe(
      'failed',
    );
  });
  it('retains partial and quota failures even when existing evidence is available', () => {
    expect(classifyIngestOutcome({ ...unchanged, errors: 1 })).toBe('partial');
    expect(classifyIngestOutcome({ ...unchanged, errors: 1, hasQuotaFailures: true })).toBe(
      'quota_exhausted',
    );
  });
});
