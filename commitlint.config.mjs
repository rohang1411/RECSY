/**
 * Conventional Commits with RECSY-specific scopes.
 *
 * Structure: <type>(<scope>): <subject>
 *   types  — feat, fix, chore, docs, refactor, test, ci, perf, style, build, revert
 *   scopes — feature areas (recommend, chat, ingest, …) plus cross-cutting areas.
 *
 * Example: `feat(recommend): add multi-turn preference merging`
 */
/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'recommend',
        'chat',
        'phones',
        'aspects',
        'ingest',
        'ui',
        'theme',
        'db',
        'llm',
        'logger',
        'infra',
        'ci',
        'deps',
        'docs',
        'repo',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],

    // `@commitlint/config-conventional` caps body/footer lines at 100 chars,
    // which is routinely tripped by bullet lists that include package names,
    // URLs, or file paths. We disable those two rules; `header-max-length`
    // above still enforces the short, scannable subject line.
    'body-max-line-length': [0, 'always', Infinity],
    'footer-max-line-length': [0, 'always', Infinity],
  },
};

export default config;
