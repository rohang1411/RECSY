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
    NODE_ENV: z.enum(['development', 'preview', 'production', 'test']).default('development'),

    DATABASE_URL: z.string().url(),
    DATABASE_SCHEMA: z
      .string()
      .regex(/^(public|eval_[a-z0-9_]+)$/)
      .default('public'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    LLM_PROVIDER: z.enum(['gemini', 'groq', 'nvidia', 'controlled', 'gateway']).default('gemini'),
    EVAL_CONTROLLED_PROVIDER_URL: z.string().url().optional(),
    EVAL_CONTROLLED_PROVIDER_TOKEN: z.string().min(16).optional(),
    EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD: z.string().optional(),
    EVAL_CONTROLLED_STREAM_DELAY_MS: z.string().optional(),
    EVAL_CONTROLLED_TTFT_MS: z.string().optional(),
    GEMINI_API_KEY: z.string().min(1),
    /** Optional backup Google AI Studio keys (separate projects). Rotated when a prior key hits quota (429 / daily cap). */
    GEMINI_API_KEY_2: z.string().optional(),
    GEMINI_API_KEY_3: z.string().optional(),
    GEMINI_API_KEY_4: z.string().optional(),
    GEMINI_API_KEY_5: z.string().optional(),
    GEMINI_API_KEY_6: z.string().optional(),
    GEMINI_API_KEYS_EXTRA: z.string().optional(),
    /**
     * When `google_ai_studio_free`, the Gemini client paces requests per key using
     * GEMINI_FREE_RPM / GEMINI_FREE_TPM_INPUT / GEMINI_FREE_RPD (see Google AI Studio docs).
     * Use `off` for paid tiers or serverless fleets where in-process counters are misleading.
     */
    GEMINI_RATE_LIMIT_PROFILE: z.enum(['off', 'google_ai_studio_free']).default('off'),
    GEMINI_FREE_RPM: z.coerce.number().int().positive().default(5),
    GEMINI_FREE_TPM_INPUT: z.coerce.number().int().positive().default(250_000),
    GEMINI_FREE_RPD: z.coerce.number().int().positive().default(20),
    GOOGLE_CLOUD_QUOTA_PROJECT_IDS: z.string().optional(),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    GROQ_API_KEY_2: z.string().optional(),
    NVIDIA_NIM_API_KEY: z.string().optional(),
    NVIDIA_NIM_API_KEY_2: z.string().optional(),
    CEREBRAS_API_KEY: z.string().optional(),
    GITHUB_MODELS_TOKEN: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    GITHUB_PAT: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    LLM_ROUTER_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),
    LLM_FAST_MODEL: z.string().default('llama-3.1-8b-instant'),
    LLM_BALANCED_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_CHAT_MODEL: z.string().default('gemini-3-flash-preview'),
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
    IGNORE_ROBOTS: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    YOUTUBE_TRANSCRIPT_EXTERNAL_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),
    YOUTUBE_TRANSCRIPT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    YOUTUBE_TRANSCRIPT_EXTERNAL_MIN_GAP_MS: z.coerce.number().int().min(0).default(3000),
    YTDLP_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),
    YTDLP_PATH: z.string().default('yt-dlp'),
    YTDLP_COOKIES_FILE: z.string().optional(),
    YTDLP_COOKIES_BASE64: z.string().optional(),
    YTDLP_PROXY: z.string().optional(),
    YTDLP_EXTRACTOR_ARGS: z.string().optional(),
    YTDLP_SLEEP_REQUESTS_SECONDS: z.coerce.number().min(0).default(2),
    YOUTUBE_TRANSCRIPT_API_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),
    YOUTUBE_TRANSCRIPT_PYTHON: z.string().default('python'),
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),

    /**
     * When true, hybrid retrieval runs the optional Gemini structured rerank
     * after MMR (extra ~1 Flash call per query). Default off for cost/latency.
     */
    RETRIEVAL_LLM_RERANK: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    INTERNAL_DASHBOARD_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    INTERNAL_EVAL_TOKEN: z.string().min(16).optional().or(z.literal('')),
    INTERNAL_OPERATOR_TOKEN: z.string().min(16).optional().or(z.literal('')),
    EVAL_ALLOW_HOSTED_LOAD: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    EVAL_SMOKE: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    EVAL_EXTRA_LOCAL_DB_HOSTS: z.string().optional(),
    MOBILEAPI_API_KEY: z.string().optional(),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    SENTRY_DSN: z.string().url().optional().or(z.literal('')),

    // --- plan25: metering, auth, billing ---
    QUOTA_MODE: z.enum(['off', 'shadow', 'enforce']).default('off'),
    QUOTA_TEST_OVERRIDE: z.string().optional(),
    FREE_DAILY_QUERIES: z.coerce.number().int().min(0).default(2),
    ANON_DAILY_QUERIES: z.coerce.number().int().min(0).default(2),
    ANON_IP_DAILY_CAP: z.coerce.number().int().min(0).default(30),
    DEVICE_ACCOUNT_CAP: z.coerce.number().int().min(1).default(3),
    BYOK_DAILY_CAP: z.coerce.number().int().min(0).default(100),
    CLARIFY_FREE_CAP: z.coerce.number().int().min(0).default(10),
    MAX_INFLIGHT_FREE: z.coerce.number().int().min(1).default(1),
    MAX_INFLIGHT_PRO: z.coerce.number().int().min(1).default(2),
    LEASE_TTL_SECONDS: z.coerce.number().int().min(30).default(75),
    METERING_DB_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    AUTH_VERIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
    GLOBAL_DAILY_PLATFORM_CAP_DEFAULT: z.coerce.number().int().min(0).default(0),
    DEVICE_ID_SECRET: z.string().min(32).optional(),
    IP_HASH_SECRET: z.string().min(32).optional(),
    TRUST_PROXY_HEADER: z.string().optional(),
    SIGNUPS_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),
    AUTH_DRIVER: z.enum(['supabase', 'fake']).default('supabase'),
    MAINTENANCE_MODE: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    BILLING_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    BILLING_ALLOWLIST_EMAILS: z.string().optional(),
    BILLING_PROVIDER: z.enum(['stripe', 'fake']).default('stripe'),
    STRIPE_MODE: z.enum(['test', 'live']).optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_API_VERSION: z.string().default('2024-12-18.acacia'),
    STRIPE_PRICE_PACK_S: z.string().optional(),
    STRIPE_PRICE_PACK_M: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    PAST_DUE_GRACE_DAYS: z.coerce.number().int().min(0).default(3),
    EMAIL_PROVIDER: z.enum(['resend', 'postmark', 'fake']).optional(),
    EMAIL_PROVIDER_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    LLM_CACHE_STORE_RAW: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
    USER_RATE_RECOMMEND_PER_MIN: z.coerce.number().int().min(1).default(12),
    USER_RATE_ASK_PER_MIN: z.coerce.number().int().min(1).default(20),
    PERF_FLAGS_DEFAULT_JSON: z.string().optional(),
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

    // --- plan25: metering, auth, billing ---
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
    NEXT_PUBLIC_SUPPORT_EMAIL: z.string().email().default('support@recsy.com'),
  },

  /**
   * Manual mapping of `process.env` values. Required by Next.js because it
   * inlines `process.env.NEXT_PUBLIC_*` at build time and cannot destructure
   * dynamically.
   */
  runtimeEnv: {
    // Fallbacks mirror the Zod `.default(...)` so that `SKIP_ENV_VALIDATION`
    // builds (which short-circuit validation) still produce usable values
    // for server-side consumers like `logger` and LLM bootstrapping.
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SCHEMA: process.env.DATABASE_SCHEMA ?? 'public',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? 'gemini',
    EVAL_CONTROLLED_PROVIDER_URL: process.env.EVAL_CONTROLLED_PROVIDER_URL,
    EVAL_CONTROLLED_PROVIDER_TOKEN: process.env.EVAL_CONTROLLED_PROVIDER_TOKEN,
    EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD: process.env.EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD,
    EVAL_CONTROLLED_STREAM_DELAY_MS: process.env.EVAL_CONTROLLED_STREAM_DELAY_MS,
    EVAL_CONTROLLED_TTFT_MS: process.env.EVAL_CONTROLLED_TTFT_MS,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_API_KEY_2: process.env.GEMINI_API_KEY_2,
    GEMINI_API_KEY_3: process.env.GEMINI_API_KEY_3,
    GEMINI_API_KEY_4: process.env.GEMINI_API_KEY_4,
    GEMINI_API_KEY_5: process.env.GEMINI_API_KEY_5,
    GEMINI_API_KEY_6: process.env.GEMINI_API_KEY_6,
    GEMINI_API_KEYS_EXTRA: process.env.GEMINI_API_KEYS_EXTRA,
    GEMINI_RATE_LIMIT_PROFILE: process.env.GEMINI_RATE_LIMIT_PROFILE ?? 'off',
    GEMINI_FREE_RPM: process.env.GEMINI_FREE_RPM ?? '5',
    GEMINI_FREE_TPM_INPUT: process.env.GEMINI_FREE_TPM_INPUT ?? '250000',
    GEMINI_FREE_RPD: process.env.GEMINI_FREE_RPD ?? '20',
    GOOGLE_CLOUD_QUOTA_PROJECT_IDS: process.env.GOOGLE_CLOUD_QUOTA_PROJECT_IDS,
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_API_KEY_2: process.env.GROQ_API_KEY_2,
    NVIDIA_NIM_API_KEY: process.env.NVIDIA_NIM_API_KEY,
    NVIDIA_NIM_API_KEY_2: process.env.NVIDIA_NIM_API_KEY_2,
    CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    GITHUB_MODELS_TOKEN: process.env.GITHUB_MODELS_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_PAT: process.env.GITHUB_PAT,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    LLM_ROUTER_ENABLED: process.env.LLM_ROUTER_ENABLED ?? 'true',
    LLM_FAST_MODEL: process.env.LLM_FAST_MODEL ?? 'llama-3.1-8b-instant',
    LLM_BALANCED_MODEL: process.env.LLM_BALANCED_MODEL ?? 'gemini-3-flash-preview',
    LLM_CHAT_MODEL: process.env.LLM_CHAT_MODEL ?? 'gemini-3-flash-preview',
    LLM_REASONING_MODEL: process.env.LLM_REASONING_MODEL ?? 'gemini-2.5-pro',
    LLM_EMBEDDING_MODEL: process.env.LLM_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    LLM_CACHE_ENABLED: process.env.LLM_CACHE_ENABLED ?? 'true',
    IGNORE_ROBOTS: process.env.IGNORE_ROBOTS ?? 'false',
    YOUTUBE_TRANSCRIPT_EXTERNAL_ENABLED: process.env.YOUTUBE_TRANSCRIPT_EXTERNAL_ENABLED ?? 'true',
    YOUTUBE_TRANSCRIPT_TIMEOUT_MS: process.env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS ?? '20000',
    YOUTUBE_TRANSCRIPT_EXTERNAL_MIN_GAP_MS:
      process.env.YOUTUBE_TRANSCRIPT_EXTERNAL_MIN_GAP_MS ?? '3000',
    YTDLP_ENABLED: process.env.YTDLP_ENABLED ?? 'true',
    YTDLP_PATH: process.env.YTDLP_PATH ?? 'yt-dlp',
    YTDLP_COOKIES_FILE: process.env.YTDLP_COOKIES_FILE,
    YTDLP_COOKIES_BASE64: process.env.YTDLP_COOKIES_BASE64,
    YTDLP_PROXY: process.env.YTDLP_PROXY,
    YTDLP_EXTRACTOR_ARGS: process.env.YTDLP_EXTRACTOR_ARGS,
    YTDLP_SLEEP_REQUESTS_SECONDS: process.env.YTDLP_SLEEP_REQUESTS_SECONDS ?? '2',
    YOUTUBE_TRANSCRIPT_API_ENABLED: process.env.YOUTUBE_TRANSCRIPT_API_ENABLED ?? 'true',
    YOUTUBE_TRANSCRIPT_PYTHON: process.env.YOUTUBE_TRANSCRIPT_PYTHON ?? 'python',
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    RETRIEVAL_LLM_RERANK: process.env.RETRIEVAL_LLM_RERANK ?? 'false',
    INTERNAL_DASHBOARD_ENABLED: process.env.INTERNAL_DASHBOARD_ENABLED ?? 'false',
    INTERNAL_EVAL_TOKEN: process.env.INTERNAL_EVAL_TOKEN,
    INTERNAL_OPERATOR_TOKEN: process.env.INTERNAL_OPERATOR_TOKEN,
    EVAL_ALLOW_HOSTED_LOAD: process.env.EVAL_ALLOW_HOSTED_LOAD ?? 'false',
    EVAL_SMOKE: process.env.EVAL_SMOKE ?? 'false',
    EVAL_EXTRA_LOCAL_DB_HOSTS: process.env.EVAL_EXTRA_LOCAL_DB_HOSTS,
    MOBILEAPI_API_KEY: process.env.MOBILEAPI_API_KEY,
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    SENTRY_DSN: process.env.SENTRY_DSN ?? '',

    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
    // Public build-time fallbacks keep App Router metadata and health info
    // working even when the quality job intentionally skips full validation.
    NEXT_PUBLIC_COMMIT_SHA: process.env.NEXT_PUBLIC_COMMIT_SHA ?? 'dev',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',

    // --- plan25: metering, auth, billing ---
    QUOTA_MODE: process.env.QUOTA_MODE ?? 'off',
    QUOTA_TEST_OVERRIDE: process.env.QUOTA_TEST_OVERRIDE,
    FREE_DAILY_QUERIES: process.env.FREE_DAILY_QUERIES ? Number(process.env.FREE_DAILY_QUERIES) : 2,
    ANON_DAILY_QUERIES: process.env.ANON_DAILY_QUERIES ? Number(process.env.ANON_DAILY_QUERIES) : 2,
    ANON_IP_DAILY_CAP: process.env.ANON_IP_DAILY_CAP ? Number(process.env.ANON_IP_DAILY_CAP) : 30,
    DEVICE_ACCOUNT_CAP: process.env.DEVICE_ACCOUNT_CAP ? Number(process.env.DEVICE_ACCOUNT_CAP) : 3,
    BYOK_DAILY_CAP: process.env.BYOK_DAILY_CAP ? Number(process.env.BYOK_DAILY_CAP) : 100,
    CLARIFY_FREE_CAP: process.env.CLARIFY_FREE_CAP ? Number(process.env.CLARIFY_FREE_CAP) : 10,
    MAX_INFLIGHT_FREE: process.env.MAX_INFLIGHT_FREE ? Number(process.env.MAX_INFLIGHT_FREE) : 1,
    MAX_INFLIGHT_PRO: process.env.MAX_INFLIGHT_PRO ? Number(process.env.MAX_INFLIGHT_PRO) : 2,
    LEASE_TTL_SECONDS: process.env.LEASE_TTL_SECONDS ? Number(process.env.LEASE_TTL_SECONDS) : 75,
    METERING_DB_TIMEOUT_MS: process.env.METERING_DB_TIMEOUT_MS
      ? Number(process.env.METERING_DB_TIMEOUT_MS)
      : 3000,
    AUTH_VERIFY_TIMEOUT_MS: process.env.AUTH_VERIFY_TIMEOUT_MS
      ? Number(process.env.AUTH_VERIFY_TIMEOUT_MS)
      : 2000,
    GLOBAL_DAILY_PLATFORM_CAP_DEFAULT: process.env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT
      ? Number(process.env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT)
      : 0,
    DEVICE_ID_SECRET: process.env.DEVICE_ID_SECRET,
    IP_HASH_SECRET: process.env.IP_HASH_SECRET,
    TRUST_PROXY_HEADER: process.env.TRUST_PROXY_HEADER,
    SIGNUPS_ENABLED: process.env.SIGNUPS_ENABLED ?? 'true',
    AUTH_DRIVER: process.env.AUTH_DRIVER ?? 'supabase',
    MAINTENANCE_MODE: process.env.MAINTENANCE_MODE ?? 'false',
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    BILLING_ENABLED: process.env.BILLING_ENABLED ?? 'false',
    BILLING_ALLOWLIST_EMAILS: process.env.BILLING_ALLOWLIST_EMAILS,
    BILLING_PROVIDER: process.env.BILLING_PROVIDER ?? 'stripe',
    STRIPE_MODE: process.env.STRIPE_MODE,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_API_VERSION: process.env.STRIPE_API_VERSION ?? '2024-12-18.acacia',
    STRIPE_PRICE_PACK_S: process.env.STRIPE_PRICE_PACK_S,
    STRIPE_PRICE_PACK_M: process.env.STRIPE_PRICE_PACK_M,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    PAST_DUE_GRACE_DAYS: process.env.PAST_DUE_GRACE_DAYS ?? '3',
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_PROVIDER_API_KEY: process.env.EMAIL_PROVIDER_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    LLM_CACHE_STORE_RAW: process.env.LLM_CACHE_STORE_RAW ?? 'false',
    ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
    USER_RATE_RECOMMEND_PER_MIN: process.env.USER_RATE_RECOMMEND_PER_MIN ?? '12',
    USER_RATE_ASK_PER_MIN: process.env.USER_RATE_ASK_PER_MIN ?? '20',
    PERF_FLAGS_DEFAULT_JSON: process.env.PERF_FLAGS_DEFAULT_JSON,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@recsy.com',
  },

  /**
   * Skip validation only when `SKIP_ENV_VALIDATION=true`. Useful for Docker
   * image builds where env is injected at runtime. Treating any non-empty
   * string as truthy makes `SKIP_ENV_VALIDATION=false` skip validation too,
   * which also bypasses Zod defaults.
   */
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',

  /**
   * Treat empty strings as `undefined` so that unset optional variables
   * behave predictably.
   */
  emptyStringAsUndefined: true,
});
