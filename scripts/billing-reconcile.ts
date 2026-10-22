#!/usr/bin/env tsx
/**
 * Billing reconciliation sweeper.
 * Runs every 30 minutes to heal any dropped webhooks or desynchronised entitlements.
 * Normative reference: Section 9.8 of plan 25.
 *
 * Usage:
 *   pnpm billing:reconcile
 */
import { reconcileBilling } from '../src/services/billing/reconcile';
import { logger } from '../src/services/logger';

const log = logger.child({ script: 'billing-reconcile' });

async function main(): Promise<void> {
  log.info('starting billing reconciliation sweep');
  const result = await reconcileBilling();

  log.info(result, 'billing reconciliation finished');

  // If missing purchases were found and healed, exit code 1 to notify ops
  if (result.fixedPurchases > 0) {
    log.warn(
      { fixedPurchases: result.fixedPurchases },
      'alert: reconciliation healed dropped purchase events; investigate webhook latency/outage',
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, 'fatal error during billing reconciliation');
  process.exit(1);
});
