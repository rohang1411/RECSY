#!/usr/bin/env tsx
/**
 * Live API Test: Measure actual Gemini token usage and latency
 * with thinkingBudget: 0 vs unconstrained thinking.
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
  cameraSummary: z.string().nullable(),
});

const sampleInfoboxWikitext = `
{{Infobox mobile phone
| name = Samsung Galaxy S25+
| brand = Samsung Electronics
| modelnumber = SM-S936B, SM-S936U
| series = Galaxy S series
| released = {{Start date and age|2025|01|22}}
| introductory_price = $999 / €1,149
| dimensions = {{convert|158.4|x|75.7|x|7.3|mm|in|abbr=on}}
| weight = {{convert|190|g|oz|abbr=on}}
| os = [[Android 15]] with [[One UI 7.1]]
| soc = [[Snapdragon 8 Elite]] for Galaxy (3 nm)
| cpu = Octa-core (2x4.32 GHz Oryon V2 Phoenix L + 6x3.53 GHz Oryon V2 Phoenix M)
| gpu = Adreno 830
| memory = 12 GB [[LPDDR5X]]
| storage = 256 GB, 512 GB [[UFS 4.0]]
| battery = 4,900 mAh Li-Ion, non-removable
| charging = 45W wired, 15W wireless (Qi2)
| display = 6.7 in (170 mm) Dynamic LTPO AMOLED 2X, 3120 x 1440 pixels (513 ppi), 1-120 Hz, 2600 nits peak
| rear_camera = 50 MP wide, 10 MP 3x telephoto, 12 MP ultrawide
| front_camera = 12 MP wide
}}
`;

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('No GEMINI_API_KEY found in environment');
    process.exit(1);
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const modelName = 'gemini-2.5-flash';

  console.log(`[test-thinking-budget-live] Testing model: ${modelName}`);

  // Test 1: Production configuration (thinkingBudget: 0)
  console.log('\n--- Running Call 1: Production Enforced (thinkingBudget: 0) ---');
  const t0 = performance.now();
  const resOptimized = await generateObject({
    model: google(modelName),
    messages: [
      {
        role: 'system',
        content:
          'You extract phone specifications from Wikipedia wikitext into strict structured JSON.',
      },
      {
        role: 'user',
        content: `Extract the phone specifications from this wikitext:\n${sampleInfoboxWikitext}`,
      },
    ],
    schema: PhoneSpecSchema,
    schemaName: 'PhoneSpec',
    temperature: 0,
    maxOutputTokens: 2048,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    },
  });
  const latencyOptimizedMs = performance.now() - t0;

  console.log(`Optimized Call Completed:`);
  console.log(
    `  - Latency: ${(latencyOptimizedMs / 1000).toFixed(2)}s (${Math.round(latencyOptimizedMs)}ms)`,
  );
  console.log(`  - Input Tokens: ${resOptimized.usage?.inputTokens ?? 'N/A'}`);
  console.log(`  - Output Tokens: ${resOptimized.usage?.outputTokens ?? 'N/A'}`);
  console.log(`  - Total Tokens: ${resOptimized.usage?.totalTokens ?? 'N/A'}`);
  console.log(`  - Finish Reason: ${resOptimized.finishReason}`);
  console.log(`  - Extracted Data:`, resOptimized.object);

  // Test 2: Unconstrained / Default Thinking (thinkingBudget not set to 0)
  console.log('\n--- Running Call 2: Unconstrained Thinking (default thinking) ---');
  let resUnconstrained: typeof resOptimized | null = null;
  let latencyUnconstrainedMs = 0;
  try {
    const t1 = performance.now();
    resUnconstrained = await generateObject({
      model: google(modelName),
      messages: [
        {
          role: 'system',
          content:
            'You extract phone specifications from Wikipedia wikitext into strict structured JSON.',
        },
        {
          role: 'user',
          content: `Extract the phone specifications from this wikitext:\n${sampleInfoboxWikitext}`,
        },
      ],
      schema: PhoneSpecSchema,
      schemaName: 'PhoneSpec',
      temperature: 0,
      maxOutputTokens: 2048,
    });
    latencyUnconstrainedMs = performance.now() - t1;

    console.log(`Unconstrained Call Completed:`);
    console.log(
      `  - Latency: ${(latencyUnconstrainedMs / 1000).toFixed(2)}s (${Math.round(latencyUnconstrainedMs)}ms)`,
    );
    console.log(`  - Input Tokens: ${resUnconstrained.usage?.inputTokens ?? 'N/A'}`);
    console.log(`  - Output Tokens: ${resUnconstrained.usage?.outputTokens ?? 'N/A'}`);
    console.log(`  - Total Tokens: ${resUnconstrained.usage?.totalTokens ?? 'N/A'}`);
    console.log(`  - Finish Reason: ${resUnconstrained.finishReason}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unconstrained call failed or truncated:`, message);
  }

  console.log('\n======================================================');
  console.log('LIVE MEASUREMENT COMPARISON');
  console.log('======================================================');
  console.log(`Optimized (thinkingBudget: 0):`);
  console.log(`  Latency: ${(latencyOptimizedMs / 1000).toFixed(2)}s`);
  console.log(`  Output Tokens: ${resOptimized.usage?.outputTokens}`);
  if (resUnconstrained) {
    console.log(`Default/Unconstrained Thinking:`);
    console.log(`  Latency: ${(latencyUnconstrainedMs / 1000).toFixed(2)}s`);
    console.log(`  Output Tokens: ${resUnconstrained.usage?.outputTokens}`);
  }
  console.log('======================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('[test-thinking-budget-live] Fatal Error:', err);
  process.exit(1);
});
