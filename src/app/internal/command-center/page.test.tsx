import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loaders = vi.hoisted(() => ({
  inventory: vi.fn(),
  usage: vi.fn(),
  runs: vi.fn(),
  ingestion: vi.fn(),
}));
vi.mock('@/services/internal/database-dashboard', () => ({
  loadCommandCenterDatabaseSummary: loaders.inventory,
}));
vi.mock('@/services/internal/llm-usage-monitor', () => ({
  loadLlmUsageMonitorData: loaders.usage,
}));
vi.mock('@/services/internal/pipeline-run-monitor', () => ({
  loadAllUnifiedPipelineRuns: loaders.runs,
}));
vi.mock('@/services/internal/phone-ingestion-dashboard', () => ({
  loadCommandCenterIngestionSummary: loaders.ingestion,
}));
vi.mock('@/app/internal/pipeline/_components/llm-usage-monitor', () => ({
  LlmUsageMonitor: () => null,
}));

import CommandCenterPage from './page';

const ingestion = {
  totalActivePhones: 74,
  completedCount: 45,
  pendingCount: 29,
  queuedCount: 0,
  quotaExhaustedCount: 0,
  emptyCorpusCount: 0,
  failedCount: 29,
  scorecardMissingCount: 0,
  overdueCount: 0,
  neverScheduledCount: 0,
  totalChunks: 4088,
  totalSources: 303,
  avgChunksPerPhone: 55.2,
  completionPercentage: 60.8,
};

describe('command center unavailable telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaders.inventory.mockRejectedValue(new Error('Catalog query timeout'));
    loaders.usage.mockRejectedValue(new Error('Usage unavailable'));
    loaders.runs.mockResolvedValue([]);
    loaders.ingestion.mockResolvedValue(ingestion);
  });

  it('uses verified ingestion inventory instead of reporting zero catalog phones', async () => {
    const html = renderToStaticMarkup(await CommandCenterPage());
    const phoneCard = html.split('Phones active')[1]?.split('Candidate queue')[0];
    expect(phoneCard).toContain('>74</p>');
    expect(html).toContain('Catalog summary unavailable');
    expect(html).toContain('Telemetry: Partial');
    expect(html).not.toContain('1500');
  });

  it('shows unknown inventory if both catalog and ingestion reads fail', async () => {
    loaders.ingestion.mockRejectedValue(new Error('Ingestion unavailable'));
    const html = renderToStaticMarkup(await CommandCenterPage());
    const phoneCard = html.split('Phones active')[1]?.split('Candidate queue')[0];
    expect(phoneCard).toContain('Unknown');
    expect(phoneCard).not.toContain('>0</p>');
    expect(html).toContain('Record count unavailable');
  });
});
