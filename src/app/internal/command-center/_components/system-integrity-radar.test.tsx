import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemIntegrityRadar } from './system-integrity-radar';
import type { SystemIntegrityReport } from '@/services/internal/integrity-audit';

const nominalReport: SystemIntegrityReport = {
  missingAspectsCount: 0,
  emptyCorpusesCount: 0,
  corruptedPricingCount: 0,
  orphanChunksCount: 0,
  malformedYtChannelsCount: 0,
  malformedYtSourcesCount: 0,
  zombieIngestRunsCount: 0,
  executionMs: 4.2,
  status: 'pass',
  checkedAt: '2026-11-23T10:00:00.000Z',
  codeHygieneStatus: 'clean',
};

describe('SystemIntegrityRadar component', () => {
  it('renders nominal status and clean AST scan when report is pass', () => {
    const html = renderToStaticMarkup(<SystemIntegrityRadar report={nominalReport} />);
    expect(html).toContain('All Systems Nominal');
    expect(html).toContain('Audit latency: 4.2ms');
    expect(html).toContain('Missing aspect cards: 0');
    expect(html).toContain('Corrupted pricing: 0');
    expect(html).toContain('Codebase AST scan: Clean (0 dead)');
  });

  it('renders warning banner and highlighted warning items when warnings exist', () => {
    const warnReport: SystemIntegrityReport = {
      ...nominalReport,
      missingAspectsCount: 3,
      zombieIngestRunsCount: 1,
      status: 'warn',
    };
    const html = renderToStaticMarkup(<SystemIntegrityRadar report={warnReport} />);
    expect(html).toContain('Warnings Detected');
    expect(html).toContain('Missing aspect cards: 3');
    expect(html).toContain('Zombie pipeline runs: 1');
    expect(html).toContain('text-amber-600');
  });

  it('renders violation badge and highlighted failure items when failures exist', () => {
    const failReport: SystemIntegrityReport = {
      ...nominalReport,
      corruptedPricingCount: 2,
      orphanChunksCount: 5,
      status: 'fail',
      codeHygieneStatus: 'dead_code_detected',
    };
    const html = renderToStaticMarkup(<SystemIntegrityRadar report={failReport} />);
    expect(html).toContain('Integrity Violations');
    expect(html).toContain('Corrupted pricing: 2');
    expect(html).toContain('Orphan chunk rows: 5');
    expect(html).toContain('text-rose-600');
    expect(html).toContain('Codebase AST scan: Issues detected');
  });

  it('renders unknown AST scan status when code hygiene is unknown or unset', () => {
    const unknownHygieneReport: SystemIntegrityReport = {
      ...nominalReport,
      codeHygieneStatus: 'unknown',
    };
    const html = renderToStaticMarkup(<SystemIntegrityRadar report={unknownHygieneReport} />);
    expect(html).toContain('Codebase AST scan: Unknown / Not run');
  });
});
