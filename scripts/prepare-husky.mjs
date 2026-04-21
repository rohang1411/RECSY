#!/usr/bin/env node
/**
 * Cross-platform wrapper around `husky` that tolerates the absence of a `.git`
 * directory (e.g. in CI caches, Docker image builds, or a tarball install).
 *
 * Husky hooks depend on a git repo; when none is present we silently skip
 * installation rather than failing the whole `pnpm install`.
 */
import { execSync } from 'node:child_process';

const isCi = process.env.CI === 'true' || process.env.CI === '1';
if (isCi) {
  console.log('[prepare-husky] CI detected; skipping hook installation.');
  process.exit(0);
}

try {
  execSync('husky', { stdio: 'inherit' });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[prepare-husky] husky install skipped: ${message}`);
}
