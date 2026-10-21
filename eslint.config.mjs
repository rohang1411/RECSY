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
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden to prevent XSS vulnerabilities.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // Prevent client bundles from importing server SDKs like Supabase direct client or Stripe
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*client*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@supabase/*', 'stripe'],
              message: 'Server SDKs (@supabase/*, stripe) cannot be imported in client components.',
            },
          ],
        },
      ],
    },
  },
  {
    // Restrict admin-client.ts to account lifecycle services only
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/account/**/*.{ts,tsx}', 'src/services/auth/admin-client.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/services/auth/admin-client',
              message: 'admin-client.ts may only be imported by account lifecycle services.',
            },
          ],
        },
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
    files: ['e2e/**/*.ts'],
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
    'orchestration/**',
    '**/.venv/**',
    '.claude/**',
    // Pre-rewrite Flutter project — read-only, never linted.
    'legacy/**',
  ]),
]);

export default eslintConfig;
