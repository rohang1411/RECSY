import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
  if?: string;
}

interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean } | string;
  steps?: WorkflowStep[];
}

interface WorkflowDoc {
  name?: string;
  on?: {
    schedule?: Array<{ cron: string }>;
    push?: { branches?: string[]; paths?: string[]; 'paths-ignore'?: string[] };
    pull_request?: { paths?: string[]; 'paths-ignore'?: string[] };
    workflow_dispatch?: unknown;
  };
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean } | string;
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = path.resolve('.github/workflows');
const workflowFiles = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort();

function readWorkflow(filename: string): { filename: string; raw: string; doc: WorkflowDoc } {
  const filePath = path.join(WORKFLOWS_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  const doc = YAML.parse(raw) as WorkflowDoc;
  return { filename, raw, doc };
}

const workflows = workflowFiles.map(readWorkflow);

describe('Workflow Infrastructure Invariant Guard Tests (Plan 30 D30-8)', () => {
  it('discovers all expected workflows (at least 18 workflows)', () => {
    expect(workflows.length).toBeGreaterThanOrEqual(18);
  });

  describe('Invariant 1: pnpm/action-setup must precede actions/setup-node with cache: pnpm', () => {
    for (const { filename, doc } of workflows) {
      it(`${filename}: cache: pnpm appears only after pnpm/action-setup in the same job`, () => {
        const jobs = doc.jobs ?? {};
        for (const [jobId, job] of Object.entries(jobs)) {
          const steps = job.steps ?? [];
          let pnpmSetupIndex = -1;
          let setupNodeCachePnpmIndex = -1;

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (!step) continue;
            if (step.uses && step.uses.startsWith('pnpm/action-setup')) {
              pnpmSetupIndex = i;
            }
            if (
              step.uses &&
              step.uses.startsWith('actions/setup-node') &&
              step.with &&
              step.with.cache === 'pnpm'
            ) {
              setupNodeCachePnpmIndex = i;
            }
          }

          if (setupNodeCachePnpmIndex !== -1) {
            expect(
              pnpmSetupIndex,
              `Job "${jobId}" in ${filename} uses "cache: pnpm" at step ${setupNodeCachePnpmIndex} but "pnpm/action-setup" is at step ${pnpmSetupIndex}`,
            ).toBeGreaterThan(-1);

            expect(
              pnpmSetupIndex,
              `Job "${jobId}" in ${filename} must run "pnpm/action-setup" before "actions/setup-node with cache: pnpm"`,
            ).toBeLessThan(setupNodeCachePnpmIndex);
          }
        }
      });
    }
  });

  describe('Invariant 2: All scheduled production workflows must contain a secrets check', () => {
    for (const { filename, doc, raw } of workflows) {
      const schedule = doc.on?.schedule;
      if (!schedule || schedule.length === 0) continue;
      // keepalive.yml uses only built-in GITHUB_TOKEN for repository commit activity heartbeat
      if (filename === 'keepalive.yml') continue;

      it(`${filename}: has a secrets probe (gate job or gate step)`, () => {
        const jobs = doc.jobs ?? {};
        const hasGateJob = 'secrets-gate' in jobs || 'gate' in jobs;

        let hasGateStep = false;
        for (const job of Object.values(jobs)) {
          for (const step of job.steps ?? []) {
            if (
              (step.id === 'gate' || step.id === 'check') &&
              step.run &&
              step.run.includes('configured=')
            ) {
              hasGateStep = true;
            }
          }
        }

        const hasSecretsCheck = hasGateJob || hasGateStep || raw.includes('secrets-gate');
        expect(
          hasSecretsCheck,
          `Scheduled workflow ${filename} must have a secrets gate job or step`,
        ).toBe(true);
      });
    }
  });

  describe('Invariant 3: ci.yml must not use trigger-level paths or paths-ignore', () => {
    it('ci.yml has no paths or paths-ignore filtering on pull_request or push', () => {
      const ciWorkflow = workflows.find((w) => w.filename === 'ci.yml');
      expect(ciWorkflow).toBeDefined();
      if (!ciWorkflow) return;

      const onPr = ciWorkflow.doc.on?.pull_request;
      if (onPr) {
        expect(onPr.paths).toBeUndefined();
        expect(onPr['paths-ignore']).toBeUndefined();
      }

      const onPush = ciWorkflow.doc.on?.push;
      if (onPush) {
        expect(onPush.paths).toBeUndefined();
        expect(onPush['paths-ignore']).toBeUndefined();
      }
    });
  });

  describe('Invariant 4: Concurrency groups of scheduled workflows must never contain run_id', () => {
    for (const { filename, doc, raw } of workflows) {
      const schedule = doc.on?.schedule;
      if (!schedule || schedule.length === 0) continue;

      it(`${filename}: concurrency group does not serialize per run_id`, () => {
        // Check top-level concurrency
        const topConcurrency = doc.concurrency;
        const topGroup =
          typeof topConcurrency === 'string' ? topConcurrency : topConcurrency?.group;
        if (topGroup) {
          expect(
            topGroup,
            `Scheduled workflow ${filename} top-level concurrency group contains run_id`,
          ).not.toMatch(/run_id/);
        }

        // Check job-level concurrency
        for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
          const jobConcurrency = job.concurrency;
          const jobGroup =
            typeof jobConcurrency === 'string' ? jobConcurrency : jobConcurrency?.group;
          if (jobGroup) {
            expect(
              jobGroup,
              `Job "${jobId}" in scheduled workflow ${filename} concurrency group contains run_id`,
            ).not.toMatch(/run_id/);
          }
        }

        // Raw check as backup
        expect(raw).not.toMatch(/concurrency:[\s\S]*?group:[\s\S]*?github\.run_id/);
      });
    }
  });

  describe('Invariant 5: All workflow cron expressions must be syntactically valid', () => {
    function isValidCron(cron: string): boolean {
      const parts = cron.trim().split(/\s+/);
      if (parts.length !== 5) return false;
      const [min, hour, dom, month, dow] = parts;
      if (!min || !hour || !dom || !month || !dow) return false;

      const validField = /^(\*|\*\/[0-9]+|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)$/;
      return (
        validField.test(min) &&
        validField.test(hour) &&
        validField.test(dom) &&
        validField.test(month) &&
        validField.test(dow)
      );
    }

    for (const { filename, doc } of workflows) {
      const schedule = doc.on?.schedule;
      if (!schedule || schedule.length === 0) continue;

      for (const entry of schedule) {
        it(`${filename}: cron "${entry.cron}" is valid 5-part syntax`, () => {
          expect(
            isValidCron(entry.cron),
            `Invalid cron expression in ${filename}: "${entry.cron}"`,
          ).toBe(true);
        });
      }
    }
  });
});
