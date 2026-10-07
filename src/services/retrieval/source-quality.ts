import issues from '../../../fixtures/eval/source-quality-issues.json';
/** Reviewed exclusions only. This is not an automatic source-truth classifier. */
export const quarantinedChunkIds: ReadonlySet<string> = new Set(
  issues.issues
    .filter((issue) => issue.kind === 'verified-specification-conflict')
    .flatMap((issue) => issue.chunkIds),
);
