import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';

const decision = z.enum(['yes', 'no', 'uncertain']);
export const blindedReviewSchema = z
  .object({
    reviewVersion: z.literal(2),
    runId: z.string().uuid(),
    resultSha256: z.string().regex(/^[a-f0-9]{64}$/),
    corpusSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reviewer: z.string().trim().min(1).max(200),
    reviewedAt: z.string().datetime(),
    questions: z.array(
      z
        .object({
          caseId: z.string(),
          answerability: z.enum(['answerable', 'unanswerable', 'ambiguous']),
          candidateFactsValid: decision,
          notes: z.string().max(20000),
        })
        .strict(),
    ),
    answers: z.array(
      z
        .object({
          blindId: z.string(),
          allClaimsSupported: decision,
          allClaimsFactuallyCorrect: decision,
          complete: decision,
          citationsCorrect: decision,
          phoneAttributionCorrect: decision,
          notes: z.string().max(20000),
        })
        .strict(),
    ),
  })
  .strict();

function within(parent: string, child: string) {
  const target = resolve(child);
  if (!target.startsWith(resolve(parent) + sep))
    throw new Error('Artifact path is outside the campaign directory');
  return target;
}
export async function readCampaignArtifacts() {
  const root = resolve('output/eval');
  const stage = JSON.parse(await readFile(resolve(root, 'current-stage.json'), 'utf8'));
  const stageDir = within(root, stage.outputDir);
  const quality = JSON.parse(await readFile(resolve(stageDir, 'current-quality.json'), 'utf8'));
  const qualityDir = within(stageDir, quality.dir);
  const summary = JSON.parse(await readFile(resolve(stageDir, 'campaign-summary.json'), 'utf8'));
  const sourceIssues = await readFile(
    resolve('fixtures/eval/source-quality-issues.json'),
    'utf8',
  ).catch(() => null);
  summary.sourceQuality = sourceIssues ? JSON.parse(sourceIssues) : { status: 'audit-unavailable' };
  const files = (await readdir(resolve(stageDir, 'http')).catch(() => []))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const functional = files.filter((f) => f.endsWith('-functional.json')).at(-1);
  const load = files.filter((f) => f.endsWith('-load.json')).at(-1);
  if (functional) {
    const report = JSON.parse(await readFile(resolve(stageDir, 'http', functional), 'utf8'));
    summary.httpFunctional = {
      at: report.at,
      passed: report.passed,
      failed: report.failed,
      provider: report.provider,
      failures: report.results.filter((r: { status: string }) => r.status === 'failed'),
    };
  }
  if (load) {
    const report = JSON.parse(await readFile(resolve(stageDir, 'http', load), 'utf8'));
    const observations = new Map<string, number[]>();
    for (const row of report.requests ?? []) {
      if (row.status !== 'successful' || row.route !== '/api/ask') continue;
      for (const timing of [
        ...(row.stages ?? []),
        { name: 'Answer persistence', ms: row.persistenceMs },
      ]) {
        if (typeof timing.ms !== 'number' || !Number.isFinite(timing.ms)) continue;
        const values = observations.get(timing.name) ?? [];
        values.push(timing.ms);
        observations.set(timing.name, values);
      }
    }
    const stageTimings = [...observations]
      .map(([name, values]) => ({
        name,
        count: values.length,
        p95Ms: values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!,
      }))
      .sort((a, b) => b.p95Ms - a.p95Ms);
    summary.httpLoad = {
      at: report.at,
      environment: report.environment,
      provider: report.provider,
      sourceIntegrity: report.sourceIntegrity ?? {
        passed: report.phases.some(
          (p: { name: string; objectivePassed: boolean }) =>
            p.name === 'source-integrity' && p.objectivePassed === false,
        )
          ? false
          : null,
        reason: 'Earlier campaign; inspect its source-integrity phase',
      },
      phases: report.phases,
      maxInflight: report.maxInflight,
      slo: report.slo,
      stageTimings,
      timingBoundary:
        'Successful Q&A requests across this campaign. Concurrent search stages overlap; do not add their percentiles. Includes client/DB round trips; database cause requires server telemetry.',
      failureExamples: (report.requests ?? [])
        .filter((r: { status: string }) => r.status !== 'successful')
        .slice(0, 20),
      productionCapacityClaim: false,
    };
  }
  return { stage, stageDir, qualityDir, summary };
}
export async function importBlindedReview(input: unknown) {
  const review = blindedReviewSchema.parse(input);
  const artifacts = await readCampaignArtifacts();
  const raw = await readFile(resolve(artifacts.qualityDir, 'results.json'), 'utf8');
  const run = JSON.parse(raw);
  if (
    review.runId !== run.manifest.runId ||
    review.resultSha256 !== createHash('sha256').update(raw).digest('hex') ||
    review.corpusSha256 !== run.manifest.corpusSha256
  )
    throw new Error('Review provenance does not match the immutable result/corpus');
  const questions = JSON.parse(
    await readFile(resolve(artifacts.qualityDir, 'questions.json'), 'utf8'),
  ).cases as { id: string }[];
  const mapping = JSON.parse(
    await readFile(resolve(artifacts.qualityDir, 'blind-map.private.json'), 'utf8'),
  ) as { blindId: string; caseId: string; variant: string; status: string }[];
  function exactIds(actual: string[], expected: string[]) {
    if (
      new Set(actual).size !== actual.length ||
      [...actual].sort().join('|') !== [...expected].sort().join('|')
    )
      throw new Error('Review has missing, duplicate or unknown labels');
  }
  exactIds(
    review.questions.map((q) => q.caseId),
    questions.map((q) => q.id),
  );
  exactIds(
    review.answers.map((a) => a.blindId),
    mapping.map((m) => m.blindId),
  );
  const unresolved =
    review.questions.filter(
      (q) => q.answerability === 'ambiguous' || q.candidateFactsValid !== 'yes',
    ).length +
    review.answers.filter((a) =>
      [
        a.allClaimsSupported,
        a.allClaimsFactuallyCorrect,
        a.complete,
        a.citationsCorrect,
        a.phoneAttributionCorrect,
      ].includes('uncertain'),
    ).length;
  const outcomes = mapping.map((m) => {
    const question = review.questions.find((q) => q.caseId === m.caseId)!;
    const answer = review.answers.find((a) => a.blindId === m.blindId)!;
    return {
      ...m,
      answerable: question.answerability === 'answerable',
      fullySupported:
        m.status === 'completed' &&
        question.answerability === 'answerable' &&
        question.candidateFactsValid === 'yes' &&
        [
          answer.allClaimsSupported,
          answer.complete,
          answer.citationsCorrect,
          answer.phoneAttributionCorrect,
        ].every((v) => v === 'yes'),
      factuallyCorrect: m.status === 'completed' && answer.allClaimsFactuallyCorrect === 'yes',
    };
  });
  const summary = {
    ...artifacts.summary,
    independentReview: unresolved ? 'received-with-unresolved-labels' : 'received',
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
    unresolvedLabels: unresolved,
    reviewedOutcomes: outcomes,
    fullySupportedAnswerRate: null,
    resumeEligible: false,
    reason:
      'Diagnostic candidate pilot; insufficient sample, incomplete execution and no representative held-out gold benchmark',
  };
  // Preserve each review; never overwrite another review or original result artifacts.
  const name = `review-${createHash('sha256').update(JSON.stringify(review)).digest('hex')}.json`;
  await writeFile(resolve(artifacts.qualityDir, name), JSON.stringify(review, null, 2), {
    flag: 'wx',
  }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  await writeFile(
    resolve(artifacts.stageDir, 'campaign-summary.json'),
    JSON.stringify(summary, null, 2),
  );
  return summary;
}
