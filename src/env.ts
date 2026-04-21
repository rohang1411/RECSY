/**
 * Type-safe environment variables.
 *
 * Validates `process.env` at build time using Zod schemas so that missing or
 * malformed configuration fails fast instead of surfacing as runtime errors
 * deep in a request handler.
 *
 * Import from `@/env` anywhere; never touch `process.env` directly.
 */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  /**
   * Server-only variables. Never exposed to the browser bundle.
   * Accessible in route handlers, server components, and server actions.
   */
  server: {
    NODE_ENV: z.enum(['development', 'preview', 'production']).default('development'),

    DATABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    LLM_PROVIDER: z.enum(['gemini', 'groq']).default('gemini'),
    GEMINI_API_KEY: z.string().min(1),
    GROQ_API_KEY: z.string().optional(),
    LLM_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
    LLM_REASONING_MODEL: z.string().default('gemini-2.5-pro'),
    // `gemini-embedding-001` is Google's current GA embedding model; the
    // former `text-embedding-004` was retired on the v1beta endpoint in
    // early 2026. Truncated to 768 dims via Matryoshka (see
    // `EMBEDDING_DIMENSIONS` constant in gemini.ts) to match the DB
    // `vector(768)` column.
    LLM_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
    LLM_CACHE_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  },

  /**
   * Client-exposed variables. Must be prefixed with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
    NEXT_PUBLIC_COMMIT_SHA: z.string().default('dev'),
    NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  },

  /**
   * Manual mapping of `process.env` values. Required by Next.js because it
   * inlines `process.env.NEXT_PUBLIC_*` at build time and cannot destructure
   * dynamically.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    LLM_CHAT_MODEL: process.env.LLM_CHAT_MODEL,
    LLM_REASONING_MODEL: process.env.LLM_REASONING_MODEL,
    LLM_EMBEDDING_MODEL: process.env.LLM_EMBEDDING_MODEL,
    LLM_CACHE_ENABLED: process.env.LLM_CACHE_ENABLED,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SENTRY_DSN: process.env.SENTRY_DSN,

    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Fallbacks mirror the Zod `.default(...)` so that `SKIP_ENV_VALIDATION`
    // builds (which short-circuit validation) still produce usable values
    // for build-time consumers like `metadataBase`.
    NEXT_PUBLIC_COMMIT_SHA: process.env.NEXT_PUBLIC_COMMIT_SHA ?? 'dev',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  },

  /**
   * Skip validation when `SKIP_ENV_VALIDATION` is set. Useful for Docker
   * image builds where env is injected at runtime.
   */
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),

  /**
   * Treat empty strings as `undefined` so that unset optional variables
   * behave predictably.
   */
  emptyStringAsUndefined: true,
});
