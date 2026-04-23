#!/usr/bin/env tsx
/**
 * Ingest CLI.
 *
 * Usage:
 *   pnpm ingest --phone <slug>
 *   pnpm ingest --phone <slug> --adapter youtube
 *   pnpm ingest --phone <slug> --adapter article --url https://...
 *   pnpm ingest --phone <slug> --limit 3 --dry-run
 *
 * Exits non-zero if any adapter produced at least one error. Successful
 * completion with zero errors exits zero.
 */
import { getDb } from '../src/services/db/client';
import {
  ArticleAdapter,
  IngestOrchestrator,
  RedditAdapter,
  YouTubeAdapter,
  type SourceCandidate,
  type SourceType,
} from '../src/services/ingest';
import { getLlm } from '../src/services/llm';
import { logger } from '../src/services/logger';

const VALID_ADAPTERS: readonly SourceType[] = ['youtube', 'reddit', 'article'];

interface CliArgs {
  phone: string;
  adapter?: SourceType;
  url?: string;
  limit: number;
  dryRun: boolean;
  hint?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: Partial<CliArgs> = { limit: 5, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--phone':
        args.phone = argv[++i];
        break;
      case '--adapter': {
        const v = argv[++i] as SourceType | undefined;
        if (!v || !VALID_ADAPTERS.includes(v)) {
          exitWithUsage(`Invalid --adapter: ${v}. Must be one of ${VALID_ADAPTERS.join(', ')}.`);
        }
        args.adapter = v;
        break;
      }
      case '--url':
        args.url = argv[++i];
        break;
      case '--limit':
        args.limit = Number(argv[++i]);
        if (!Number.isFinite(args.limit) || args.limit <= 0) {
          exitWithUsage(`Invalid --limit: must be a positive integer.`);
        }
        break;
      case '--hint':
        args.hint = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        exitWithUsage(`Unknown flag: ${a}`);
    }
  }
  if (!args.phone) exitWithUsage('Missing required --phone <slug>.');
  if (args.url && !args.adapter) {
    exitWithUsage('Cannot use --url without --adapter (which adapter should handle it?).');
  }
  return args as CliArgs;
}

function printUsage(): void {
  const lines = [
    'Usage: pnpm ingest --phone <slug> [options]',
    '',
    'Options:',
    '  --phone <slug>              Phone slug (required). e.g. pixel-9-pro-xl',
    '  --adapter <type>            One of: youtube | reddit | article',
    '  --url <url>                 Skip discovery; ingest this URL directly',
    '  --limit <N>                 Max candidates per adapter (default 5)',
    '  --hint <query>              Override discovery query',
    '  --dry-run                   Discover + fetch + chunk, but do not embed or write',
    '  --help                      Print this message',
  ];
  for (const l of lines) console.log(l);
}

function exitWithUsage(msg: string): never {
  console.error(`[ingest] ${msg}\n`);
  printUsage();
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const llm = getLlm();

  const orchestrator = new IngestOrchestrator({
    db,
    llm,
    adapters: [new YouTubeAdapter(), new ArticleAdapter(), new RedditAdapter()],
  });

  const adapterTypes = args.adapter ? [args.adapter] : VALID_ADAPTERS;

  const candidatesByType: Partial<Record<SourceType, SourceCandidate[]>> = {};
  if (args.url && args.adapter) {
    candidatesByType[args.adapter] = [
      {
        url: args.url,
        title: 'CLI-provided URL',
        author: null,
        channel: null,
        language: 'en',
        publishedAt: null,
        raw: { source: 'cli' },
      },
    ];
  }

  const summary = await orchestrator.ingestPhoneBySlug(args.phone, {
    adapterTypes,
    discover: { limit: args.limit, hint: args.hint },
    candidatesByType,
    dryRun: args.dryRun,
  });

  printSummary(summary);

  const anyErrors = summary.adapters.some((a) => a.errors.length > 0);
  process.exit(anyErrors ? 1 : 0);
}

type Summary = Awaited<ReturnType<IngestOrchestrator['ingestPhoneBySlug']>>;

function printSummary(summary: Summary): void {
  console.log('');
  console.log(`[ingest] phone: ${summary.slug}`);
  for (const a of summary.adapters) {
    console.log(
      `  ${pad(a.type, 8)} discovered=${a.discovered} fetched=${a.fetched} skipped=${a.skippedDuplicate} sources=${a.written.sources} chunks=${a.written.chunks} errors=${a.errors.length} (${a.durationMs}ms)`,
    );
    for (const e of a.errors) {
      console.log(`    ! ${e.url} → ${truncate(e.error, 140)}`);
    }
  }
  const t = summary.totals;
  console.log('');
  console.log(
    `[ingest] total sources=${t.sourcesWritten} chunks=${t.chunksWritten} skipped=${t.skippedDuplicate} errors=${t.errors}`,
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? (err.stack ?? err.message) : err }, 'ingest crashed');
  console.error('[ingest] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
