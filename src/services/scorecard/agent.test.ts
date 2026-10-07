import { describe, expect, it, vi } from 'vitest';
import { ASPECT_NAMES } from '@/lib/constants';
import { runScorecardForPhone } from './agent';

function context(hasCorpus: boolean) {
  const search = vi.fn();
  const structured = vi.fn();
  const values = vi.fn(async () => []);
  const execute = vi
    .fn()
    .mockResolvedValueOnce(hasCorpus ? [{ fingerprint: 'same-corpus' }] : [])
    .mockResolvedValue(ASPECT_NAMES.map((aspect) => ({ aspect })));
  const definitions = ASPECT_NAMES.map((aspect) => ({ id: `def-${aspect}`, aspect, version: 1 }));
  const db = {
    select: () => ({ from: async () => definitions }),
    execute,
    insert: () => ({ values }),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    ctx: {
      phoneId: 'phone',
      brand: 'Example',
      model: 'Phone Pro',
      db,
      retriever: { search },
      llm: { structured },
      log,
    },
    search,
    structured,
    execute,
  };
}

describe('shared scorecard guard', () => {
  it('automatically reuses completed aspects for manual callers without a fingerprint', async () => {
    const test = context(true);
    const result = await runScorecardForPhone(test.ctx as never);
    expect(result).toMatchObject({
      updated: 0,
      failed: 0,
      skipped: ASPECT_NAMES.length,
      fingerprint: 'same-corpus',
    });
    expect(test.search).not.toHaveBeenCalled();
    expect(test.structured).not.toHaveBeenCalled();
  });
  it('does not retrieve or extract when there is no active corpus', async () => {
    const test = context(false);
    const result = await runScorecardForPhone(test.ctx as never);
    expect(result.skipped).toBe(ASPECT_NAMES.length);
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.search).not.toHaveBeenCalled();
    expect(test.structured).not.toHaveBeenCalled();
  });
});
