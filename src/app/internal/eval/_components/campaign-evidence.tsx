interface CampaignSummary {
  sourceQuality?: { status: string; issues?: { id: string; issue: string; action: string }[] };
  executedOutcomes?: number;
  plannedOutcomes?: number;
  unexecutedOutcomes?: number;
  generationRequests?: number;
  embeddingRequests?: number;
  quotaStopped?: boolean;
  independentReview?: string;
  httpFunctional?: { passed: number; failed: number };
  httpLoad?: {
    environment: string;
    provider: string;
    maxInflight?: number;
    sourceIntegrity?: { passed: boolean | null };
    phases: {
      name: string;
      offered?: number;
      started?: number;
      dropped?: number;
      failed?: number;
      p95Ms?: number;
      objectivePassed: boolean;
    }[];
    stageTimings?: { name: string; count: number; p95Ms: number }[];
    timingBoundary?: string;
  };
}
const ms = (value: number | undefined) =>
  value == null ? 'Unavailable' : `${Math.round(value)} ms`;

export function CampaignEvidence({ summary }: { summary: CampaignSummary }) {
  const load = summary.httpLoad;
  return (
    <div className="space-y-4" aria-label="Campaign results">
      {summary.sourceQuality && (
        <div>
          <h3 className="font-semibold">Source truth audit</h3>
          <p>{summary.sourceQuality.status}</p>
          {summary.sourceQuality.issues?.map((issue) => (
            <p key={issue.id}>
              {issue.issue} {issue.action}
            </p>
          ))}
        </div>
      )}
      <p className="font-semibold">
        Readiness: not established. Resume answer-quality percentage: unavailable.
      </p>
      <p>
        Live pilot: {summary.executedOutcomes ?? 'Unavailable'}/
        {summary.plannedOutcomes ?? 'Unavailable'} outcomes executed;{' '}
        {summary.unexecutedOutcomes ?? 'Unavailable'} unexecuted. Review:{' '}
        {summary.independentReview ?? 'Unavailable'}.
      </p>
      <p>
        Provider attempts: {summary.generationRequests ?? 'Unavailable'} generation,{' '}
        {summary.embeddingRequests ?? 'Unavailable'} embedding.{' '}
        {summary.quotaStopped
          ? 'Stopped on provider quota; verify the quota reset before resuming.'
          : 'Inspect the run manifest for the configured request budget.'}
      </p>
      {summary.httpFunctional && (
        <p>
          Controlled HTTP checks: {summary.httpFunctional.passed} passed,{' '}
          {summary.httpFunctional.failed} failed. These checks do not measure live answer quality.
        </p>
      )}
      {load && (
        <>
          <h3 className="font-semibold">Controlled HTTP load</h3>
          <p>
            {load.environment}. Provider: {load.provider}. This does not establish deployed
            capacity.
          </p>
          <p>
            Source integrity:{' '}
            {load.sourceIntegrity?.passed === true
              ? 'unchanged throughout the run'
              : load.sourceIntegrity?.passed === false
                ? 'FAILED — code changed during the run'
                : 'unverified; inspect the raw artifact'}
            .
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="text-left">
                Local objective: p95 ≤ 3,000 ms, admitted errors ≤ 1%, zero generator drops.
              </caption>
              <thead>
                <tr>
                  {[
                    'Phase',
                    'Offered',
                    'Started',
                    'Generator drops',
                    'Errors',
                    'p95',
                    'Objective',
                  ].map((h) => (
                    <th key={h} className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {load.phases
                  .filter((p) => p.offered != null)
                  .map((p) => (
                    <tr key={p.name}>
                      {[
                        p.name,
                        p.offered,
                        p.started,
                        p.dropped,
                        p.failed,
                        ms(p.p95Ms),
                        p.objectivePassed ? 'Pass' : 'FAIL',
                      ].map((v, i) => (
                        <td key={i} className="border-border border-t p-2">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p>
            Generator drops occur when the {load.maxInflight ?? 'recorded'} in-flight request cap is
            reached. Dropped arrivals never reached the server; they remain in the offered workload
            and fail the objective.
          </p>
          {load.stageTimings?.length ? (
            <>
              <h3 className="font-semibold">Observed Q&A stage timings</h3>
              <ul className="list-disc pl-5">
                {load.stageTimings.map((t) => (
                  <li key={t.name}>
                    {t.name}: p95 {ms(t.p95Ms)} across {t.count} successful requests
                  </li>
                ))}
              </ul>
              <p>
                Largest observed stage: {load.stageTimings[0]?.name}. This is an investigation lead.{' '}
                {load.timingBoundary}
              </p>
            </>
          ) : (
            <p>Stage timing evidence is unavailable.</p>
          )}
        </>
      )}
    </div>
  );
}
