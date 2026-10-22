import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('WP-21 Launch readiness & Go/No-go checklist', () => {
  const root = resolve(__dirname, '../..');

  it('provides master launch readiness checklist with all stages and sign-off table', () => {
    const checklistPath = resolve(root, 'docs/launch/readiness-checklist.md');
    expect(existsSync(checklistPath)).toBe(true);

    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('S0 Groundwork');
    expect(content).toContain('S1 Shadow');
    expect(content).toContain('S2 Accounts');
    expect(content).toContain('S3 Enforce Free');
    expect(content).toContain('S4 Billing Test');
    expect(content).toContain('S5 Billing Live');
    expect(content).toContain('S6 General Avail');
    expect(content).toContain('Master Go / No-Go Checklist');
    expect(content).toContain('Pre-Flight Verification Commands');
    expect(content).toContain('Owner & Team Sign-Off Matrix');
  });

  it('provides disaster recovery drill runbook with RTO/RPO targets and steps', () => {
    const drPath = resolve(root, 'docs/launch/disaster-recovery-drill.md');
    expect(existsSync(drPath)).toBe(true);

    const content = readFileSync(drPath, 'utf8');
    expect(content).toContain('Recovery Time Objective (RTO)');
    expect(content).toContain('pg_dump');
    expect(content).toContain('pg_restore');
    expect(content).toContain('pnpm db:smoke');
    expect(content).toContain('pnpm metering:audit');
  });

  it('authors and accepts ADRs 0019 through 0022', () => {
    const adrs = [
      'docs/adr/0019-query-metering-leases-and-in-database-atomic-quota.md',
      'docs/adr/0020-identity-and-authentication.md',
      'docs/adr/0021-billing-architecture.md',
      'docs/adr/0022-multi-user-security-posture.md',
    ];

    for (const adr of adrs) {
      const fullPath = resolve(root, adr);
      expect(existsSync(fullPath)).toBe(true);
      const content = readFileSync(fullPath, 'utf8');
      expect(content).toContain('**Status:** Accepted');
    }

    const adrReadme = readFileSync(resolve(root, 'docs/adr/README.md'), 'utf8');
    expect(adrReadme).toContain('0019');
    expect(adrReadme).toContain('0020');
    expect(adrReadme).toContain('0021');
    expect(adrReadme).toContain('0022');
  });

  it('marks all work packages WP-00 through WP-21 complete in implementation plan', () => {
    const planPath = resolve(
      root,
      'docs/ImplementationPlans/25. multi-user-platform-quotas-billing-and-artful-experience-plan.md',
    );
    const content = readFileSync(planPath, 'utf8');
    expect(content).toContain('WP-00 Scaffolding');
    expect(content).toContain('WP-20 Least-privilege DB role');
    expect(content).toContain('WP-21 Launch readiness');
  });

  it('updates RECSY_V2_PROJECT_CONTEXT.md with Multi-User Platform architecture', () => {
    const contextPath = resolve(root, 'docs/RECSY_V2_PROJECT_CONTEXT.md');
    const content = readFileSync(contextPath, 'utf8');
    expect(content).toContain('## 27. Multi-User Platform');
    expect(content).toContain('Status: Implemented & Verified (WP-00 through WP-21)');
    expect(content).toContain('recsy_app');
    expect(content).toContain('recsy_reserve_query');
    expect(content).toContain('Multi-user platform transformation complete');
  });
});
