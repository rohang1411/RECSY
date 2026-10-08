#!/usr/bin/env tsx
import { getDb } from '@/services/db/client';
import { getBenchmarkRunById } from '@/services/eval/storage/benchmark-repository';
import { writeFile } from 'node:fs/promises';

async function main(): Promise<void> {
  const id =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith('--id='))
      ?.slice('--id='.length) ?? process.argv[2];
  if (!id || id.startsWith('--')) throw new Error('Usage: pnpm eval:report --id=<run-id>');
  const run = await getBenchmarkRunById(getDb(), id);
  if (!run) throw new Error(`Run ${id} not found`);
  const output = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
  if (output) {
    await writeFile(output, JSON.stringify(run, null, 2));
    console.log(
      `Saved ${run.id}: ${run.passedTests} passed, ${run.failedTests} failed -> ${output}`,
    );
  } else if (process.argv.includes('--failures-only'))
    console.log(
      JSON.stringify(
        { ...run, results: run.results?.filter((result) => result.status !== 'pass') },
        null,
        2,
      ),
    );
  else console.log(JSON.stringify(run, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
