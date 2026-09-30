import { expect, test } from '@playwright/test';

test.describe('RECSY Multi-Session Recommendation History & State Isolation', () => {
  test('navigates, switches sessions with isolation, renames, and deletes session', async ({
    page,
  }) => {
    const sessionAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const sessionBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const sessions = [
      {
        id: sessionAId,
        title: 'Flagship Android • $1,200',
        primaryIntent: 'recommend',
        isPinned: false,
        lastTurnIndex: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: sessionBId,
        title: 'Under $800 • Compact Camera',
        primaryIntent: 'recommend',
        isPinned: false,
        lastTurnIndex: 0,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      },
    ];

    // Mock sessions listing
    await page.route('**/api/recommend/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions }),
      });
    });

    // Mock session A hydration
    await page.route(`**/api/recommend/sessions/${sessionAId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: {
            id: sessionAId,
            title: 'Flagship Android • $1,200',
            isPinned: false,
            updatedAt: new Date().toISOString(),
          },
          turns: [
            {
              turnIndex: 0,
              userMessage: 'Flagship phone with Snapdragon 8 Elite and Android',
              assistantText: 'Here are the best Android flagships.',
              kind: 'results',
              picks: [
                {
                  phoneId: 'phone-s25',
                  slug: 'samsung-galaxy-s25-ultra',
                  brand: 'Samsung',
                  model: 'Galaxy S25 Ultra',
                  score: 9.4,
                  summary: 'Top tier Snapdragon Android flagship',
                  msrpUsd: '$1,299',
                  localPrice: '$1,299',
                  localCurrency: 'USD',
                  imageUrl: null,
                },
              ],
              relaxed: [],
              refined: false,
              scoresTied: false,
              scorecardMissing: false,
              topAspects: ['performance', 'camera'],
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    // Mock session B hydration
    await page.route(`**/api/recommend/sessions/${sessionBId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: {
            id: sessionBId,
            title: 'Under $800 • Compact Camera',
            isPinned: false,
            updatedAt: new Date(Date.now() - 3600000).toISOString(),
          },
          turns: [
            {
              turnIndex: 0,
              userMessage: 'Small phone with great camera under $800',
              assistantText: 'Here are compact phones with stellar cameras.',
              kind: 'results',
              picks: [
                {
                  phoneId: 'phone-ip16',
                  slug: 'apple-iphone-16',
                  brand: 'Apple',
                  model: 'iPhone 16',
                  score: 9.1,
                  summary: 'Compact flagship camera phone',
                  msrpUsd: '$799',
                  localPrice: '$799',
                  localCurrency: 'USD',
                  imageUrl: null,
                },
              ],
              relaxed: [],
              refined: false,
              scoresTied: false,
              scorecardMissing: false,
              topAspects: ['camera', 'battery'],
              createdAt: new Date(Date.now() - 3600000).toISOString(),
            },
          ],
        }),
      });
    });

    // Mock PATCH for rename
    await page.route(`**/api/recommend/sessions/${sessionAId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: {
              id: sessionAId,
              title: 'Flagship Android Powerhouse',
              isPinned: false,
              status: 'active',
            },
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // Mock DELETE
    await page.route(`**/api/recommend/sessions/${sessionBId}`, async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, id: sessionBId, status: 'deleted' }),
        });
      } else {
        await route.fallback();
      }
    });

    // 1. Visit Session A deep-link directly
    await page.goto(`/recommend/${sessionAId}`);

    // Verify Session A content renders with Samsung Galaxy S25 Ultra
    await expect(page.getByText('Galaxy S25 Ultra')).toBeVisible();
    await expect(
      page.getByText('Flagship phone with Snapdragon 8 Elite and Android'),
    ).toBeVisible();

    // 2. Open History sidebar drawer
    const historyButton = page.getByRole('button', { name: /History/i });
    await expect(historyButton).toBeVisible();
    await historyButton.click();

    // Verify both sessions appear in the sidebar
    await expect(page.getByText('Flagship Android • $1,200')).toBeVisible();
    await expect(page.getByText('Under $800 • Compact Camera')).toBeVisible();

    // 3. Switch to Session B
    await page.getByText('Under $800 • Compact Camera').click();

    // Verify URL updated to Session B
    await expect(page).toHaveURL(`/recommend/${sessionBId}`);

    // Verify Session B state renders Apple iPhone 16 and NO Samsung Galaxy S25 Ultra
    await expect(page.getByText('iPhone 16')).toBeVisible();
    await expect(page.getByText('Galaxy S25 Ultra')).not.toBeVisible();
    await expect(page.getByText('Small phone with great camera under $800')).toBeVisible();
  });
});
