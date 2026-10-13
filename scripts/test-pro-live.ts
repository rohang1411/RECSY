#!/usr/bin/env tsx
/**
 * Live test with gemini-2.5-pro (the reasoning model)
 */
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const PhoneSpecSchema = z.object({
  brand: z.string(),
  model: z.string(),
  msrpUsd: z.number().nullable(),
  batteryMah: z.number().nullable(),
  weightG: z.number().nullable(),
  screenSizeInches: z.number().nullable(),
  ramGb: z.number().nullable(),
  storageGb: z.number().nullable(),
  os: z.string().nullable(),
});

const complexInfobox = `
{{Infobox mobile phone
| name = Samsung Galaxy S25 Ultra
| brand = Samsung Electronics
| series = Galaxy S series
| released = {{Start date and age|2025|01|22}}
| introductory_price = $1,299 / €1,449 / £1,249
| dimensions = 162.8 x 77.6 x 8.2 mm (6.41 x 3.06 x 0.32 in)
| weight = 219 g (7.72 oz)
| build = Glass front (Corning Gorilla Armor 2), glass back (Corning Gorilla Armor 2), titanium frame (grade 5)
| os = Android 15, One UI 7.1 (7 major Android updates promised)
| soc = Qualcomm Snapdragon 8 Elite for Galaxy (3 nm)
| cpu = 8-core (2x4.32 GHz Oryon V2 Phoenix L + 6x3.53 GHz Oryon V2 Phoenix M)
| gpu = Adreno 830
| memory = 12 GB, 16 GB LPDDR5X
| storage = 256 GB, 512 GB, 1 TB UFS 4.0
| battery = 5,000 mAh Li-Ion, non-removable
| charging = 45W wired, PD3.0, 65% in 30 min (advertised), 15W wireless (Qi2), 4.5W reverse wireless
| display = 6.8 in (170 mm) Dynamic LTPO AMOLED 2X, 120Hz, HDR10+, 2600 nits (peak), 1440 x 3120 pixels, 19.5:9 ratio (~505 ppi density)
}}
`;

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) process.exit(1);

  const google = createGoogleGenerativeAI({ apiKey });
  const modelName = 'gemini-2.5-pro';

  console.log(`[test-pro-live] Testing reasoning model: ${modelName}`);

  // 1. With thinkingBudget: 0
  console.log('Testing with thinkingBudget: 0...');
  const t0 = performance.now();
  const resOpt = await generateObject({
    model: google(modelName),
    messages: [{ role: 'user', content: `Extract spec:\n${complexInfobox}` }],
    schema: PhoneSpecSchema,
    temperature: 0,
    maxOutputTokens: 2048,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  });
  const msOpt = performance.now() - t0;
  console.log(
    `thinkingBudget: 0 -> Latency: ${(msOpt / 1000).toFixed(2)}s, OutputTokens: ${resOpt.usage?.outputTokens}`,
  );

  // 2. Unconstrained reasoning
  console.log('Testing with unconstrained thinking (default reasoning)...');
  const t1 = performance.now();
  const resUnc = await generateObject({
    model: google(modelName),
    messages: [{ role: 'user', content: `Extract spec:\n${complexInfobox}` }],
    schema: PhoneSpecSchema,
    temperature: 0,
    maxOutputTokens: 2048,
  });
  const msUnc = performance.now() - t1;
  console.log(
    `Unconstrained -> Latency: ${(msUnc / 1000).toFixed(2)}s, OutputTokens: ${resUnc.usage?.outputTokens}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
