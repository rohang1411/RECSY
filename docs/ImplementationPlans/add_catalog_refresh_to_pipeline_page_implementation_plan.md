# Add Catalog Refresh Runs and Scorecard Metrics to Pipeline Page

This plan describes the steps to add "automatic catalog refresh pipeline runs", catalog candidate statuses, and replace the "visible chunks" metric with "scorecards generated" on the internal pipeline page.

## User Review Required

Please review the proposed design for the "Catalog candidates statuses" section. Is a new 4-column metric grid right below the system metrics grid acceptable for this?
Also, for "Scorecards generated" metric, I am planning to replace the current "Visible chunks" card in the top section.
Is it fine if we fetch the aggregate candidate statuses live, or do you expect them to be cached? (It will be fetched live and optimized).

## Proposed Changes

### `src/app/internal/pipeline/page.tsx`

- **MODIFY** `loadPipelineData` function:
  - Add a DB query to fetch the count of phones where `lastScorecardAt` is not null.
  - Update the `metrics` array to replace "Visible chunks" with the new "Scorecards generated" metric (displaying `phonesWithScorecards` out of `totalActivePhones`).
  - Add a DB query to fetch the latest 8 rows from `catalogRuns` ordered by `startedAt` desc.
  - Add a DB query using `db.select({ count: count(), decision: catalogCandidates.decision, status: catalogCandidates.status }).from(catalogCandidates).groupBy(...)` to get the aggregate counts of candidates.
  - Parse the aggregation to extract "Total tried to add", "Pending review", "Approved (Promoted)", and "Other/Failed".
- **MODIFY** `PipelinePage` component:
  - Add a new grid section below the main metrics to display the `catalogMetrics`. It will use the same professional styling (e.g., `md:grid-cols-4`, `text-gradient-steel`, etc.) for consistency.
  - Pass the newly fetched `catalogRefreshRuns` to the `<WorkflowTables>` component.

### `src/app/internal/pipeline/_components/workflow-tables.tsx`

- **MODIFY** `WorkflowTablesProps`:
  - Add `catalogRefreshRuns: readonly RunRow[];` to the props interface.
- **MODIFY** `WorkflowTables` component:
  - Add a new section object to the `sections` array: `{ id: 'catalog', title: 'Catalog refresh runs', rows: catalogRefreshRuns }`.

## Verification Plan

### Manual Verification

1. Open the internal pipeline page (`/internal/pipeline`).
2. Verify that the "Visible chunks" metric at the top has been replaced by "Scorecards generated" and shows the correct proportion.
3. Verify that a new section for "Catalog Candidates" (or similar wording) appears and displays the correct counts for Total, Pending Review, Promoted, etc.
4. Verify that the "Pipeline runs" accordion component includes a new panel for "Catalog refresh runs", and it displays the data correctly with the correct status colors.
