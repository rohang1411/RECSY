#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { env } from '../src/env';

function runCommand(command: string) {
  console.log(`\n======================================================`);
  console.log(`[catalog:auto] Running: ${command}`);
  console.log(`======================================================\n`);
  try {
    execSync(command, {
      stdio: 'inherit',
      env: { ...process.env, ...(env as unknown as Record<string, string>) },
    });
  } catch {
    console.error(`[catalog:auto] Command failed: ${command}`);
    // Don't throw, let the rest of the pipeline run
  }
}

async function main() {
  console.log(`[catalog:auto] Starting automated catalog refresh pipeline...`);

  // 1. Discover new phones from Wikidata
  runCommand('npx tsx scripts/catalog-refresh.ts --source wikidata --since-years 2 --limit 150');

  // 2. Enrich pending candidates via Wikipedia (primary) + GSMArena warm standby.
  //    Candidates are sorted by brand priority (Apple > Samsung > Nothing > ...).
  runCommand('npx tsx scripts/catalog-enrich-gsmarena.ts');

  // 3. Sync from MobileAPI for anything Wikipedia/GSMArena could not cover.
  runCommand(
    'npx tsx scripts/catalog-sync-mobileapi.ts --since-years 2 --promote --update-existing',
  );

  console.log(`\n[catalog:auto] Automated pipeline complete.`);
}

main().catch(console.error);
