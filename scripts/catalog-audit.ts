import assert from 'node:assert/strict';
import { getDb, getPostgres } from '../src/services/db/client';
import { isLikelyCatalogPhoneTitle } from '../src/services/catalog/candidate-policy';
import { loadDatabaseDashboardData } from '../src/services/internal/database-dashboard';
import { loadPhoneIngestionDashboardData } from '../src/services/internal/phone-ingestion-dashboard';
import { pickResumePhones } from '../src/services/ingest/scheduler/pick-resume-phones';
import { pickPhones } from '../src/services/ingest/scheduler/pick-phones';
import { pickScorecardPhones } from '../src/services/scorecard/scheduler';
import { getPipelineSnapshot } from '../src/services/internal/pipeline-snapshot';
import { loadRecommendationCatalog } from '../src/services/recommender/catalog';

async function main() {
  const db = getPostgres();
  try {
    console.log(
      'candidate_summary',
      JSON.stringify(
        await db`select status, decision, issue_codes, count(*)::int n from catalog_candidates group by 1,2,3 order by n desc limit 20`,
      ),
    );
    console.log(
      'phone_summary',
      JSON.stringify(await db`select status, count(*)::int n from phones group by status`),
    );
    console.log(
      'llm_last_7d',
      JSON.stringify(
        await db`select usage_area, usage_feature, operation, cached, error_code, count(*)::int n from llm_usage_events where created_at > now() - interval '7 days' group by 1,2,3,4,5 order by n desc`,
      ),
    );
    if (!process.argv.includes('--verify')) return;
    const appDb = getDb();
    console.log('checking dashboard and archive');
    const dashboard = await loadDatabaseDashboardData();
    const archive = await loadDatabaseDashboardData({ status: 'archived' });
    console.log('checking ingestion');
    const ingestion = await loadPhoneIngestionDashboardData();
    console.log('checking worker selection');
    const resume = await pickResumePhones(appDb, { limit: 1000 });
    const ingest = await pickPhones(appDb, { limit: 1000 });
    const scorecards = await pickScorecardPhones(appDb, { limit: 1000 });
    console.log('checking pipeline and recommendations');
    const snapshot = await getPipelineSnapshot();
    const recommendations = await loadRecommendationCatalog(appDb);
    assert(dashboard.summary.totalActivePhones > 0, 'live dashboard query returned no phones');
    assert(archive.devices.length > 0, 'archive reference filter returned no excluded rows');
    assert(
      dashboard.devices.every(
        (d) => d.category !== 'archived' && isLikelyCatalogPhoneTitle(d.name),
      ),
      'excluded candidate leaked into default dashboard',
    );
    assert.equal(
      dashboard.entryCount,
      dashboard.devices.length,
      'All Entries count differs from rendered rows',
    );
    assert.equal(
      dashboard.devices.filter((d) => d.category === 'promoted').length,
      dashboard.summary.totalActivePhones,
      'promoted rows are duplicated or missing',
    );
    const archivedIds = new Set(
      (await db`select id from phones where status = 'archived'`).map((p) => p.id),
    );
    assert(
      snapshot.phones.total === dashboard.summary.totalActivePhones,
      'pipeline metrics disagree with active catalog',
    );
    assert(
      recommendations.every((p) => !archivedIds.has(p.phoneId)),
      'archived phone leaked into recommendation catalog',
    );
    for (const [label, rows] of [
      ['resume', resume],
      ['ingest', ingest],
      ['scorecards', scorecards],
    ] as const) {
      assert(
        rows.every((p) => !archivedIds.has(p.id)),
        `${label} scheduled an archived phone`,
      );
    }
    console.log('verified_dashboard', JSON.stringify(dashboard.summary));
    console.log('verified_archive', JSON.stringify(archive.devices.map((d) => d.name)));
    console.log('verified_ingestion', JSON.stringify(ingestion.summary));
    console.log(
      'verified_workers',
      JSON.stringify({
        resume: resume.length,
        ingest: ingest.length,
        scorecards: scorecards.length,
        excluded: archivedIds.size,
      }),
    );
    console.log(
      'verified_pipeline_recommendations',
      JSON.stringify({
        pipelinePhones: snapshot.phones.total,
        recommendationPhones: recommendations.length,
      }),
    );
  } finally {
    await db.end({ timeout: 5 });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
