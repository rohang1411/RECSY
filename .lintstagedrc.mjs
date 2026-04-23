/**
 * Run the minimum viable quality gates on every commit. Anything slower
 * (typecheck, full test suite, build) belongs in CI — not the hook.
 */
/** @type {import('lint-staged').Configuration} */
const config = {
  '*.{ts,tsx,js,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{css,md,json,yml,yaml}': ['prettier --write'],
};

export default config;
