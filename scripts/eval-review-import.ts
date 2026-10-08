import { readFile } from 'node:fs/promises';
import { importBlindedReview } from '../src/services/eval/campaign-artifacts';
async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: pnpm eval:review:import <exported-review.json>');
  console.log(
    JSON.stringify(await importBlindedReview(JSON.parse(await readFile(path, 'utf8'))), null, 2),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
