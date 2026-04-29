import { describe, expect, it } from 'vitest';

import { describeMissingSchema, hasMissingDbObjectError } from './schema-guard';

describe('describeMissingSchema', () => {
  it('formats an actionable operator message', () => {
    expect(describeMissingSchema('creator-watch', ['table phone_aliases'])).toContain(
      '[creator-watch] automated ingestion schema is incomplete: table phone_aliases.',
    );
  });
});

describe('hasMissingDbObjectError', () => {
  it('recognizes missing relation codes through error causes', () => {
    const err = new Error('wrapper', {
      cause: { code: '42P01', message: 'relation "phone_aliases" does not exist' },
    });

    expect(hasMissingDbObjectError(err)).toBe(true);
  });

  it('does not classify unrelated database errors as missing schema', () => {
    const err = new Error('wrapper', {
      cause: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    expect(hasMissingDbObjectError(err)).toBe(false);
  });
});
