import type { Metadata } from 'next';
import { getDb } from '@/services/db/client';
import { listBenchmarkRuns } from '@/services/eval/storage/benchmark-repository';
import type { BenchmarkRunRecord } from '@/services/eval/types';
import { EvalClientView } from './_components/eval-client-view';
import { env } from '@/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Evaluation & Benchmarks Hub | RECSY Command Center',
  description:
    'RECSY component evaluation with explicit fixture, provider and measurement boundaries.',
};

export default async function EvalPage() {
  let initialRuns: BenchmarkRunRecord[] = [];
  let initialError: string | null = null;

  if (env.NODE_ENV !== 'production') {
    try {
      initialRuns = await listBenchmarkRuns(getDb(), 30);
    } catch (error) {
      initialError = `Run history unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    initialError = 'Enter the evaluation access token to load run history.';
  }

  return <EvalClientView initialRuns={initialRuns} initialError={initialError} />;
}
