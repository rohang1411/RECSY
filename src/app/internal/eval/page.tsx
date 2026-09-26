import type { Metadata } from 'next';
import { getDb } from '@/services/db/client';
import { listBenchmarkRuns } from '@/services/eval/storage/benchmark-repository';
import type { BenchmarkRunRecord } from '@/services/eval/types';
import { EvalClientView } from './_components/eval-client-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Evaluation & Benchmarks Hub | RECSY Command Center',
  description:
    'Research-grade offline ranking evaluation (NDCG, ILD), Stanford ALCE citation attribution, and multi-VU concurrency stress benchmarks.',
};

export default async function EvalPage() {
  const db = getDb();
  let initialRuns: BenchmarkRunRecord[] = [];

  try {
    initialRuns = await listBenchmarkRuns(db, 30);
  } catch {
    // Graceful fallback if migrations haven't run yet
    initialRuns = [];
  }

  return <EvalClientView initialRuns={initialRuns} />;
}
