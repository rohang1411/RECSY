import { env } from '../src/env';
import {
  getConfiguredGeminiKeys,
  GEMINI_NUMBERED_KEY_NAMES,
} from '../src/services/llm/gemini-keys';

const names = GEMINI_NUMBERED_KEY_NAMES;
const projectIds = (env.GOOGLE_CLOUD_QUOTA_PROJECT_IDS ?? '').split(',').map((p) => p.trim());
const configured = names.filter((name) => Boolean(env[name]?.trim()));
const keys = getConfiguredGeminiKeys(env);
const extra = (env.GEMINI_API_KEYS_EXTRA ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);
const duplicateKeys =
  new Set(configured.map((name) => env[name]?.trim())).size !== configured.length;
console.log(
  JSON.stringify(
    {
      slots: names.map((name, index) => ({
        name,
        configured: Boolean(env[name]?.trim()),
        quotaProjectConfigured: Boolean(projectIds[index]),
      })),
      extraKeyListSupported: true,
      configuredKeySlots: keys.length,
      extraKeys: keys
        .filter((key) => key.name.startsWith('GEMINI_API_KEYS_EXTRA'))
        .map((key) => ({ name: key.name, quotaProjectConfigured: Boolean(key.projectId) })),
      duplicateKeyValues: duplicateKeys || keys.length !== configured.length + extra.length,
      duplicateQuotaProjects:
        projectIds.filter(Boolean).length !== new Set(projectIds.filter(Boolean)).size,
      quotaMonitoringCredentialsConfigured: Boolean(
        env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_APPLICATION_CREDENTIALS,
      ),
      localPacing: {
        profile: env.GEMINI_RATE_LIMIT_PROFILE,
        rpm: env.GEMINI_FREE_RPM,
        inputTpm: env.GEMINI_FREE_TPM_INPUT,
        rpd: env.GEMINI_FREE_RPD,
      },
      models: {
        chat: env.LLM_CHAT_MODEL,
        reasoning: env.LLM_REASONING_MODEL,
        embedding: env.LLM_EMBEDDING_MODEL,
      },
    },
    null,
    2,
  ),
);
console.log(
  'No API requests made. Key values were not printed. Configured local caps are not verified Google quotas.',
);
