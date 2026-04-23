import { describe, expect, it } from 'vitest';

import { assertNever, cn, retry } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind utilities with the last one winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('retry', () => {
  it('returns the first success', async () => {
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient failures up to `attempts`', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('flaky');
        return 'recovered';
      },
      { attempts: 3, baseMs: 1 },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('surfaces the last error when all attempts fail', async () => {
    await expect(
      retry(
        async () => {
          throw new Error('boom');
        },
        { attempts: 2, baseMs: 1 },
      ),
    ).rejects.toThrow('boom');
  });
});

describe('assertNever', () => {
  it('throws at runtime', () => {
    expect(() => assertNever('x' as never)).toThrow();
  });
});
