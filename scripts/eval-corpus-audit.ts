import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  if (!/^eval_[a-z0-9_]+$/.test(stage.namespace)) throw new Error('Invalid isolated schema');
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connection: { search_path: `${stage.namespace},extensions` },
  });
  try {
    const embeddings =
      await sql`select id,embedding_model,md5(embedding::text) as vector_hash from chunks order by id`;
    const modelCounts =
      await sql`select embedding_model,count(*)::int as chunks from chunks group by embedding_model order by embedding_model`;
    const metadata =
      await sql`select count(*)::int as sources,count(*) filter(where published_at is null)::int as undated_sources from sources`;
    const mismatches =
      await sql`select count(*)::int as n from chunks c join sources s on s.id=c.source_id where c.phone_id<>s.phone_id`;
    const stats =
      await sql`select relname,n_live_tup,n_dead_tup,last_analyze,last_autoanalyze from pg_stat_all_tables where schemaname=${stage.namespace} and relname in ('chunks','sources','phones') order by relname`;
    const coverage =
      await sql`select p.slug,count(c.id) filter(where s.status='active')::int as chunks from phones p left join chunks c on c.phone_id=p.id left join sources s on s.id=c.source_id where p.status='active' group by p.slug order by p.slug`;
    const report = {
      at: new Date().toISOString(),
      schema: stage.namespace,
      embeddingFingerprintSha256: createHash('sha256')
        .update(JSON.stringify(embeddings))
        .digest('hex'),
      modelCounts,
      metadata,
      sourcePhoneMismatches: mismatches[0]?.n,
      plannerStatistics: stats,
      coveredPhones: coverage.filter((r) => r.chunks > 0).length,
      phonesWithoutActiveCorpus: coverage.filter((r) => r.chunks === 0).map((r) => r.slug),
      note: 'Source text truth, dated claims and multi-model passages still require independent review; vector hashes preserve bytes, not embedding correctness.',
    };
    await writeFile(resolve(stage.outputDir, 'corpus-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
