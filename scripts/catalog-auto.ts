#!/usr/bin/env tsx
/**
 * Run the end-to-end automated catalog refresh pipeline locally.
 *
 * Order matters:
 *   1. discovery/sync stages candidates,
 *   2. enrichment fetches fuller specs,
 *   3. promotion writes only valid candidates to `phones`.
 */
import { spawnSync } from 'node:child_process';

import { env } from '../src/env';

interface Step {
  readonly label: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly optional?: boolean;
}

const DEFAULT_LIMIT = '150';
const DEFAULT_ENRICH_LIMIT = '25';

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  console.log('[catalog:auto] Starting automated catalog refresh pipeline...');

  const steps: Step[] = [
    {
      label: 'Backfill legacy identities',
      script: 'scripts/backfill/canonical-keys.ts',
      args: [],
    },
    {
      label: 'Discover recent Wikidata candidates',
      script: 'scripts/catalog-refresh.ts',
      args: ['--source', 'wikidata', '--since-years', '2', '--limit', DEFAULT_LIMIT],
    },
    ...(env.MOBILEAPI_API_KEY
      ? [
          {
            label: 'Sync MobileAPI listing candidates',
            script: 'scripts/catalog-sync-mobileapi.ts',
            args: [
              '--since-years',
              '2',
              '--limit',
              DEFAULT_LIMIT,
              '--max-requests',
              '50',
              '--min-request-gap-ms',
              '12500',
              '--promote',
              '--update-existing',
            ],
            optional: true,
          } satisfies Step,
        ]
      : []),
    {
      label: 'Enrich from official OEM pages',
      script: 'scripts/catalog-enrich-oem.ts',
      args: [
        '--from-candidates',
        '--limit',
        DEFAULT_ENRICH_LIMIT,
        '--promote',
        '--update-existing',
      ],
      optional: true,
    },
    ...(env.GEMINI_API_KEY
      ? [
          {
            label: 'Enrich remaining candidates from Wikipedia/GSMArena',
            script: 'scripts/catalog-enrich-gsmarena.ts',
            args: ['--limit', DEFAULT_ENRICH_LIMIT],
            optional: true,
          } satisfies Step,
        ]
      : []),
    {
      label: 'Promote any ready candidates',
      script: 'scripts/catalog-promote.ts',
      args: ['--ready', '--limit', '50', '--update-existing'],
      optional: true,
    },
    {
      label: 'Backfill missing phone media',
      script: 'scripts/catalog-backfill-media.ts',
      args: ['--limit', '50', '--min-request-gap-ms', '1250'],
      optional: true,
    },
    {
      label: 'Catalog report',
      script: 'scripts/catalog-report.ts',
      args: ['--days', '35'],
    },
  ];

  if (!env.MOBILEAPI_API_KEY) {
    console.log('[catalog:auto] MOBILEAPI_API_KEY not configured; skipping MobileAPI step.');
  }
  if (!env.GEMINI_API_KEY) {
    console.log(
      '[catalog:auto] GEMINI_API_KEY not configured; skipping Wikipedia/GSMArena LLM enrichment.',
    );
  }

  for (const step of steps) {
    if (args.dryRun) {
      console.log(
        `[catalog:auto] dry-run: ${['pnpm', 'exec', 'tsx', step.script, ...step.args].join(' ')}`,
      );
      continue;
    }
    runStep(step);
  }

  console.log('\n[catalog:auto] Automated pipeline complete.');
}

function parseArgs(argv: readonly string[]): { readonly help: boolean; readonly dryRun: boolean } {
  let help = false;
  let dryRun = false;
  for (const flag of argv) {
    switch (flag) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return { help, dryRun };
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:auto [options]',
      '',
      'Options:',
      '  --dry-run   Print the planned commands without running them',
      '  --help      Print this message',
    ].join('\n'),
  );
}

function runStep(step: Step): void {
  const command = ['pnpm', 'exec', 'tsx', step.script, ...step.args];
  console.log(`\n======================================================`);
  console.log(`[catalog:auto] ${step.label}`);
  console.log(`[catalog:auto] Running: ${command.join(' ')}`);
  console.log(`======================================================\n`);

  const result = spawnSync(command[0]!, command.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status === 0) return;

  const code = result.status ?? 1;
  const message = `[catalog:auto] Step failed (${code}): ${step.label}`;
  if (step.optional) {
    console.warn(`${message}; continuing because this enrichment source is optional.`);
    return;
  }
  throw new Error(message);
}

main();
