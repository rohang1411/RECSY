#!/usr/bin/env tsx
/**
 * Capacity and LLM Budget Estimation Report.
 * Normative reference: Section 11.1 of plan 25.
 *
 * Usage:
 *   pnpm capacity:report
 */
import { KeyPoolRegistry } from '../src/services/llm/keys/key-pool';

function generateCapacityReport(): void {
  const pool = new KeyPoolRegistry();
  const providers = pool.getAllConfiguredProviders();

  console.log('='.repeat(70));
  console.log('           RECSY PLATFORM CAPACITY & BUDGET REPORT');
  console.log('='.repeat(70));
  console.log();

  let totalDailyPlatformLlmCalls = 0;

  console.log('Provider Key Inventory:');
  console.log('-'.repeat(70));

  for (const provider of providers) {
    const keys = pool.getKeysForProvider(provider);
    let providerDailyCalls = 0;
    for (const key of keys) {
      providerDailyCalls += key.rpdLimit;
    }
    totalDailyPlatformLlmCalls += providerDailyCalls;

    console.log(
      `  • ${provider.padEnd(12)}: ${keys.length} keys | ~${providerDailyCalls.toLocaleString()} calls/day`,
    );
  }

  console.log('-'.repeat(70));
  console.log(`Total Platform Daily LLM Calls : ${totalDailyPlatformLlmCalls.toLocaleString()}`);
  console.log();

  const callsPerDeliveredQuery = 3; // Median from Stage A extraction + ranking + summary
  const headroomFactor = 0.8; // 20% reserved for cache misses, retries, and non-billable turns
  const safeDailyQueries = Math.floor(
    (headroomFactor * totalDailyPlatformLlmCalls) / callsPerDeliveredQuery,
  );

  console.log('Throughput Model (Section 11.1):');
  console.log(`  • Estimated calls per delivered query : ${callsPerDeliveredQuery}`);
  console.log(`  • Safety headroom factor               : ${headroomFactor * 100}%`);
  console.log(`  • Max safe daily queries               : ${safeDailyQueries.toLocaleString()}`);
  console.log();
  console.log('Recommended Flag Configuration:');
  console.log(`  platform_flags.global_daily_platform_cap = ${safeDailyQueries}`);
  console.log(`  GLOBAL_DAILY_PLATFORM_CAP_DEFAULT        = ${safeDailyQueries}`);
  console.log('='.repeat(70));
}

generateCapacityReport();
