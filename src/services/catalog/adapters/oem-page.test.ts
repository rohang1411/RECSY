/**
 * Unit tests for the generic OEM page extractor.
 */
import { describe, expect, it } from 'vitest';

import { buildPromotionPlan } from '../promote';
import { extractOemProductPage } from './oem-page';

describe('OEM product page extractor', () => {
  it('extracts a complete official product page into promotable claims', () => {
    const record = extractOemProductPage({
      url: 'https://example.com/phones/example-phone-pro',
      html: `<!doctype html>
        <html>
          <head>
            <meta property="og:title" content="Example Phone Pro">
            <meta property="og:image" content="/phone.jpg">
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Example Phone Pro",
                "brand": { "@type": "Brand", "name": "Example" },
                "description": "Example flagship with Android 16.",
                "image": "https://example.com/phone.jpg",
                "offers": { "@type": "Offer", "priceCurrency": "USD", "price": "799" }
              }
            </script>
          </head>
          <body>
            <h1>Example Phone Pro</h1>
            <section>
              Display 6.7 inch AMOLED 1290 x 2796 120Hz.
              Processor: Snapdragon 8 Elite.
              12GB RAM. Storage: 256GB / 512GB.
              Rear cameras: 50MP main, 12MP ultrawide, 10MP telephoto.
              Front camera: 12MP.
              Battery 5000 mAh. 45W wired charging. 15W wireless charging.
              Weight 198 g. Android 16.
              Wi-Fi 7, Bluetooth 5.4, NFC, USB-C. IP68.
              Colors: Black, Blue.
            </section>
          </body>
        </html>`,
    });

    expect(record).toMatchObject({
      sourceKey: 'oem_page',
      sourceTier: 'T0',
      brand: 'Example',
      model: 'Phone Pro',
      msrpUsd: '799.00',
      imageUrl: 'https://example.com/phone.jpg',
    });
    expect(record.spec.storageOptionsGb).toEqual([256, 512]);
    expect(record.spec.display).toMatchObject({
      size_in: 6.7,
      resolution: '1290x2796',
      refresh_rate_hz: 120,
      panel_type: 'AMOLED',
    });
    expect(record.spec.charging).toEqual({ wired_w: 45, wireless_w: 15 });

    const plan = buildPromotionPlan({
      sourceKey: record.sourceKey,
      externalId: record.externalId,
      sourceUrl: record.sourceUrl,
      canonicalKey: 'example:phone-pro:2026',
      claimsJson: { promotion: record },
    });
    expect(plan.ok).toBe(true);
  });

  it('leaves incomplete OEM pages blocked by normal promotion validation', () => {
    const record = extractOemProductPage({
      url: 'https://example.com/phones/basic',
      html: '<html><body><h1>Example Basic</h1><p>Simple phone.</p></body></html>',
      fallbackBrand: 'Example',
    });

    const plan = buildPromotionPlan({
      sourceKey: record.sourceKey,
      externalId: record.externalId,
      sourceUrl: record.sourceUrl,
      canonicalKey: 'example:basic',
      claimsJson: { promotion: record },
    });

    expect(plan.ok).toBe(false);
    expect(plan.issues.map((issue) => issue.code)).toContain('missing_spec_field');
  });
});
