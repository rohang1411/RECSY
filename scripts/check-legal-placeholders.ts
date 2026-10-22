import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI/Build verification script: detects unreviewed legal placeholder text.
 * Normative reference: Plan 25 Section 10.4, Section 16 (WP-16).
 *
 * Rule: When `BILLING_ENABLED=true` in `NODE_ENV=production` (or when `--strict`
 * is passed), finding any `LEGAL_PLACEHOLDER` marker MUST fail the build with code 1.
 */
const LEGAL_DIR = join(process.cwd(), 'src', 'content', 'legal');
const PLACEHOLDER_REGEX = /LEGAL_PLACEHOLDER[:\s]([^\n\r]+)/g;

interface PlaceholderMatch {
  file: string;
  line: number;
  text: string;
}

function scanDirectory(dir: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      matches.push(...scanDirectory(fullPath));
    } else if (entry.endsWith('.md')) {
      const content = readFileSync(fullPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        let match: RegExpExecArray | null;
        PLACEHOLDER_REGEX.lastIndex = 0;
        while ((match = PLACEHOLDER_REGEX.exec(line)) !== null) {
          matches.push({
            file: entry,
            line: i + 1,
            text: match[0],
          });
        }
      }
    }
  }

  return matches;
}

export function checkLegalPlaceholders(opts?: {
  strict?: boolean;
  billingEnabled?: boolean;
  isProduction?: boolean;
}): { success: boolean; matches: PlaceholderMatch[] } {
  const isStrict = opts?.strict ?? process.argv.includes('--strict');
  const isBillingEnabled = opts?.billingEnabled ?? process.env.BILLING_ENABLED === 'true';
  const isProduction = opts?.isProduction ?? process.env.NODE_ENV === 'production';

  const shouldBlock = isStrict || (isBillingEnabled && isProduction);
  const matches = scanDirectory(LEGAL_DIR);

  if (matches.length > 0) {
    if (shouldBlock) {
      console.error(
        '\n\x1b[31m[LEGAL_CHECK_ERROR] Unreviewed legal placeholders detected in production with billing enabled:\x1b[0m',
      );
      for (const m of matches) {
        console.error(`  - \x1b[33m${m.file}:${m.line}\x1b[0m: ${m.text}`);
      }
      console.error(
        '\nBefore enabling live billing in production, all legal text must be reviewed by counsel and placeholders replaced.\n',
      );
      return { success: false, matches };
    }

    console.warn(
      `\x1b[33m[LEGAL_CHECK_WARN] Found ${matches.length} legal placeholder(s) in src/content/legal/ (permitted in dev/pre-billing mode).\x1b[0m`,
    );
  } else {
    console.log(
      '\x1b[32m[LEGAL_CHECK_OK] All legal documents are verified clean (no placeholders).\x1b[0m',
    );
  }

  return { success: true, matches };
}

// Direct CLI invocation
const isMain =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isMain) {
  const result = checkLegalPlaceholders();
  if (!result.success) {
    process.exit(1);
  }
}
