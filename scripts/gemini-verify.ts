import { env } from '../src/env';
import { getConfiguredGeminiKeys } from '../src/services/llm/gemini-keys';
import { fetchGeminiQuotaFromGoogle } from '../src/services/internal/google-gemini-quota';

const keys = getConfiguredGeminiKeys(env);

function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [...keys.map((key) => key.apiKey), env.GOOGLE_SERVICE_ACCOUNT_JSON].filter(
    Boolean,
  )) {
    message = message.split(secret!).join('[redacted]');
  }
  return message.replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, '[redacted]').slice(0, 800);
}

async function main() {
  if (process.argv.includes('--keys')) {
    for (const key of keys) {
      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
          {
            headers: { 'x-goog-api-key': key.apiKey },
            signal: AbortSignal.timeout(10_000),
          },
        );
        const body = (await response.json()) as {
          models?: { name: string }[];
          error?: { status?: string; message?: string };
        };
        const models = new Set(body.models?.map((model) => model.name.replace(/^models\//, '')));
        console.log(
          JSON.stringify({
            key: key.name,
            httpStatus: response.status,
            authenticated: response.ok,
            configuredModelsListed: response.ok
              ? {
                  chat: models.has(env.LLM_CHAT_MODEL),
                  reasoning: models.has(env.LLM_REASONING_MODEL),
                  embedding: models.has(env.LLM_EMBEDDING_MODEL),
                }
              : null,
            error: response.ok
              ? null
              : safeError(
                  body.error?.message ?? body.error?.status ?? 'Model metadata request failed',
                ),
          }),
        );
        if (!response.ok) process.exitCode = 1;
      } catch (error) {
        console.log(
          JSON.stringify({ key: key.name, authenticated: false, error: safeError(error) }),
        );
        process.exitCode = 1;
      }
    }
  }
  if (process.argv.includes('--quota')) {
    const result = await fetchGeminiQuotaFromGoogle();
    console.log(
      JSON.stringify(
        {
          quotaStatus: result.status,
          fetchedAt: result.fetchedAt,
          configuredKeys: keys.length,
          mappedProjects: result.projects.length,
          quotaRows: result.rows.length,
          message: result.message ? safeError(result.message) : null,
          projects: result.projects.map((project) => ({
            apiKeyIndex: project.apiKeyIndex,
            rowCount: result.rows.filter((row) => row.apiKeyIndex === project.apiKeyIndex).length,
          })),
        },
        null,
        2,
      ),
    );
    if (result.status !== 'ok' || result.rows.length === 0) process.exitCode = 1;
  }
  console.log(
    'Read-only checks only: no text generation or embeddings requested; no credentials printed.',
  );
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
