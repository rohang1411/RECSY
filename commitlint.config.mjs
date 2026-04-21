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
  },
};

export default config;
