import { test, expect } from '@playwright/test';

test('detect horizontal scroll on desktop and mobile across all public pages', async ({ page }) => {
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const urls = [
    '/',
    '/browse',
    '/recommend',
    '/compare',
    '/about',
    '/settings',
    '/p/apple-iphone-16-pro',
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    for (const url of urls) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const viewportWidth = window.innerWidth;
        const hasHorizontalScroll =
          doc.scrollWidth > doc.clientWidth || body.scrollWidth > body.clientWidth;

        const elements = Array.from(document.querySelectorAll('*'));
        const overflowing: Array<{
          tag: string;
          className: string;
          right: number;
          width: number;
          snippet: string;
        }> = [];
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (rect.right > viewportWidth + 1) {
            overflowing.push({
              tag: el.tagName,
              className: typeof el.className === 'string' ? el.className : '',
              right: rect.right,
              width: rect.width,
              snippet: el.outerHTML.slice(0, 150),
            });
          }
        }
        return {
          hasHorizontalScroll,
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          viewportWidth,
          overflowCount: overflowing.length,
          topOverflowing: overflowing.slice(0, 5),
        };
      });

      if (result.hasHorizontalScroll) {
        console.log(`[${vp.name}] ${url} OVERFLOW:`, JSON.stringify(result, null, 2));
      } else {
        console.log(`[${vp.name}] ${url} -> scroll: false`);
      }
      expect(result.hasHorizontalScroll).toBe(false);
    }
  }
});
