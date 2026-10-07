import { describe, expect, it } from 'vitest';
import { readRequestJson } from './request-json';
describe('bounded JSON requests', () => {
  it('rejects malformed JSON as validation', async () => {
    await expect(
      readRequestJson(new Request('http://localhost', { method: 'POST', body: '{broken' }), 100),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 400 });
  });
  it('counts complete bytes including unknown fields', async () => {
    await expect(
      readRequestJson(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ message: 'ok', unknown: 'a'.repeat(200) }),
        }),
        100,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('counts UTF-8 bytes rather than characters', async () => {
    await expect(
      readRequestJson(new Request('http://localhost', { method: 'POST', body: '"💡💡"' }), 9),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
