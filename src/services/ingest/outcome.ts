export function classifyIngestOutcome(input: {
  readonly sourcesWritten: number;
  readonly chunksWritten: number;
  readonly errors: number;
  readonly hasActiveCorpus: boolean;
  readonly hasQuotaFailures: boolean;
}): 'success' | 'partial' | 'failed' | 'quota_exhausted' | 'empty' {
  const hasContent = input.sourcesWritten > 0 || input.chunksWritten > 0 || input.hasActiveCorpus;
  if (input.errors === 0) return hasContent ? 'success' : 'empty';
  if (input.hasQuotaFailures) return 'quota_exhausted';
  return hasContent ? 'partial' : 'failed';
}
