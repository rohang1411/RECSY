import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * ESLint flat config. Extends Next's baseline and layers a small set of
 * project-specific rules.
 *
 * Note: process.env is forbidden outside `src/env.ts`. Feature code must import
 * typed values from `@/env`. The linter enforces this via `no-restricted-syntax`.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Import typed values from "@/env" instead of touching process.env directly.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // `src/env.ts`, config files, and scripts are allowed to read process.env.
    files: [
      'src/env.ts',
      '*.config.{ts,mjs,cjs,js}',
      'drizzle.config.ts',
      'next.config.ts',
      'scripts/**/*.{ts,mjs,cjs}',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'drizzle/migrations/**',
    'coverage/**',
    // Pre-rewrite Flutter project — read-only, never linted.
    'legacy/**',
  ]),
]);

export default eslintConfig;
