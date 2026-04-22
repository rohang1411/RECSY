import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { summarizeErrorChainForLogs } from './summarize-error';

describe('summarizeErrorChainForLogs', () => {
  it('includes Zod issue paths and walks cause', () => {
    const inner = z.object({ a: z.number() }).safeParse({ a: 'x' });
    expect(inner.success).toBe(false);
    const zod = inner.error;
    const wrapped = new Error('outer', { cause: zod });
    const s = summarizeErrorChainForLogs(wrapped);
    expect(s).toContain('a');
    expect(s).toContain('outer');
  });
});
