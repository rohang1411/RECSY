#!/usr/bin/env tsx
import { getDb } from '@/services/db/client';
import { checkEvaluationReadiness, type EvaluationSuite } from '@/services/eval/preflight';
import { diagnoseEvaluationError } from '@/services/eval/errors';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suiteArg = args.find((a) => a.startsWith('--suite='))?.slice('--suite='.length) ?? 'recsys';
  const sampleArg =
    args.find((a) => a.startsWith('--sample='))?.slice('--sample='.length) ?? 'full';
  if (!['recsys', 'rag', 'load-stress', 'multi-turn', 'all'].includes(suiteArg))
    throw new Error(`Unknown suite: ${suiteArg}`);
  if (!['quick', 'full'].includes(sampleArg)) throw new Error(`Unknown sample: ${sampleArg}`);
  const report = await checkEvaluationReadiness(
    getDb(),
    suiteArg as EvaluationSuite,
    sampleArg as 'quick' | 'full',
  );
  console.log(
    JSON.stringify({ ready: true, suite: suiteArg, sampleScale: sampleArg, report }, null, 2),
  );
}

main().catch((error) => {
  console.error(`[eval:check] ${diagnoseEvaluationError(error)}`);
  process.exitCode = 1;
});
