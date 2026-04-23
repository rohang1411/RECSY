import { expect, test } from '@playwright/test';

test.describe('Chat panel (mocked /api/ask)', () => {
  test('streams NDJSON and renders citation chip', async ({ page }) => {
    const chunkId = '550e8400-e29b-41d4-a716-446655440000';

    await page.route('**/api/ask', async (route) => {
      const lines = [
        JSON.stringify({ type: 'delta', text: `Mock answer about battery [c:${chunkId}].` }),
        JSON.stringify({
          type: 'done',
          citations: [
            {
              chunkId,
              sourceUrl: 'https://example.com/citation',
              title: 'Mock source',
              type: 'article',
              anchor: null,
              startTs: null,
            },
          ],
          usage: { tokensIn: 1, tokensOut: 2 },
          model: 'mock',
          retrievalMs: 1,
        }),
      ];
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        body: `${lines.join('\n')}\n`,
      });
    });

    await page.goto('/p/apple-iphone-16-pro');
    await page.getByRole('textbox').fill('How is the battery?');
    await page.getByRole('button', { name: 'Ask' }).click();

    await expect(page.getByText('Mock answer about battery')).toBeVisible();
    await expect(page.getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      'https://example.com/citation',
    );
  });
});
