/**
 * Ops Alert Checker Script.
 * Runs SQL-driven checks against the production database and posts
 * notifications to ALERT_WEBHOOK_URL if alerts fire.
 *
 * Usage: pnpm ops:alerts
 * Normative reference: Plan 25 Section 13.4, WP-19.
 */
import { getDb } from '@/services/db/client';
import { env } from '@/env';
import { evaluateAllAlertRules, type AlertResult } from '@/services/ops/alert-rules';

async function postAlertWebhook(webhookUrl: string, alerts: AlertResult[]): Promise<void> {
  const firedAlerts = alerts.filter((a) => a.fired);
  if (firedAlerts.length === 0) return;

  const content = firedAlerts
    .map((a) => `[${a.severity.toUpperCase()}] **${a.key}**: ${a.summary}`)
    .join('\n');

  const payload = {
    content: `🚨 **RECSY Ops Alert Triggered**:\n${content}\n\n*Review dashboard at /internal/usage*`,
    username: 'RECSY Ops Sentry',
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[ops:alerts] Webhook delivery failed: HTTP ${res.status}`);
    } else {
      console.log(`[ops:alerts] Dispatched webhook alert for ${firedAlerts.length} issue(s)`);
    }
  } catch (err) {
    console.error('[ops:alerts] Failed to deliver alert webhook:', err);
  }
}

async function main() {
  console.log('== RECSY Ops Alert Audit ==');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const db = getDb();
  const results = await evaluateAllAlertRules(db, {
    quotaMode: env.QUOTA_MODE,
    isProduction: process.env.NODE_ENV === 'production',
    launchActive: process.env.LAUNCH_ACTIVE === 'true',
    defaultCap: env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT,
  });

  let hasPageAlert = false;
  let hasWarnAlert = false;

  for (const res of results) {
    const icon = res.fired ? (res.severity === 'page' ? '🚨' : '⚠️') : '✅';
    const tag = res.fired ? `[${res.severity.toUpperCase()}]` : '[OK]';
    console.log(`${icon} ${tag.padEnd(8)} ${res.key.padEnd(24)} : ${res.summary}`);

    if (res.fired) {
      if (res.severity === 'page') hasPageAlert = true;
      if (res.severity === 'warn') hasWarnAlert = true;
    }
  }

  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl && (hasPageAlert || hasWarnAlert)) {
    await postAlertWebhook(webhookUrl, results);
  }

  if (hasPageAlert) {
    console.error('\n[FATAL] One or more critical (PAGE) alerts fired!');
    process.exit(1);
  }

  console.log('\n[PASS] Operations checks completed successfully.');
}

main().catch((err) => {
  console.error('[ops:alerts] Unhandled error during alert sweep:', err);
  process.exit(1);
});
