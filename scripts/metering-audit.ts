/**
 * Nightly & On-Demand Invariant Metering Audit Script.
 *
 * Runs core transactional invariant audits across credit wallets,
 * counters, leases, and delivered responses.
 *
 * Usage: pnpm metering:audit
 * Normative reference: Plan 25 Section 13.8, WP-19.
 */
import { getDb } from '@/services/db/client';
import { runAllMeteringAudits } from '@/services/ops/metering-audit';

async function main() {
  console.log('== RECSY Metering & Billing Invariant Audit ==');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const db = getDb();
  const results = await runAllMeteringAudits(db);

  let hasFailure = false;

  for (const r of results) {
    const icon = r.passed ? '✅' : '🚨';
    const status = r.passed ? '[PASS]' : '[FAIL]';
    console.log(`\n${icon} ${status} ${r.check}`);
    console.log(`   Message: ${r.message}`);

    if (!r.passed) {
      hasFailure = true;
      console.log(`   Violations count: ${r.violationsCount}`);
      console.log('   Sample rows:');
      console.dir(r.sampleViolations, { depth: null });
    }
  }

  if (hasFailure) {
    console.error('\n[FATAL] One or more invariant audit checks failed!');
    process.exit(1);
  }

  console.log('\n[PASS] All metering invariants verified successfully.');
}

main().catch((err) => {
  console.error('[metering:audit] Unhandled error during audit:', err);
  process.exit(1);
});
