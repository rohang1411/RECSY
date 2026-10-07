# Adding Gemini API Keys To RECSY

## Current Configuration And Limits

On October 7, 2026, a secret-safe inspection found six numbered key slots configured, six distinct quota-project IDs, and quota-monitoring credentials present. A read-only Google model-list check authenticated all six keys and listed the configured chat, reasoning, and embedding models. No generation or embedding requests were made. This does not establish remaining free quota or successful inference.

RECSY supports consecutive numbered variables through `GEMINI_API_KEY_6`, plus `GEMINI_API_KEYS_EXTRA` for further keys. The provider, quota monitor, and seven LLM-enabled workflows use the same configuration. The provider uses backups on quota errors, not round-robin on every call. Duplicate credential values are ignored. Publish the updated code before hosted workflows/deployments can use new slots.

The live quota fetch returned no rows and reported Cloud Monitoring disabled or uninitialized for all six configured projects. The locally signed-in Cloud user could not list services for the fifth project, so an owner/administrator of the relevant projects must complete the Cloud setup. Authentication of the Gemini keys is separate from Cloud Monitoring access.

Google applies rate limits per project, not per API key. Another key in the same project does not create more free quota. Check the project's actual model limits and tier in AI Studio; do not interpret local pacing settings as Google entitlements. See [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## 1. Create The Keys

1. Open [Google AI Studio](https://aistudio.google.com/) and sign in.
2. Open Dashboard, then Projects. If an existing project is missing, choose Import projects, select it, and import it.
3. Open API Keys, choose Create API key, and select the intended project. Keep the key private.
4. Record the associated **project ID**, not its display name or numeric project number. Use Project settings or Google Cloud project information.
5. Check the project's billing tier and model rate limits in AI Studio. Use an eligible Free Tier project if staying free; enabling billing changes its billing tier. New credentials do not guarantee additional free capacity.

Google's current AI Studio flow creates authorization keys restricted to the Gemini API by default. If key creation is unavailable, have the project's administrator grant the required key-creation permissions. See [official API key instructions](https://ai.google.dev/gemini-api/docs/api-key) and [billing](https://ai.google.dev/gemini-api/docs/billing).

## 2. Configure Local Development

Edit the existing `.env.local` in the repository root, keeping the current four key values and project IDs unchanged. Add the new keys in order:

```dotenv
# Replace these placeholders with private credentials; do not commit this file.
GEMINI_API_KEY_5=new_key_5
GEMINI_API_KEY_6=new_key_6
```

For quota monitoring, append their project IDs to the existing list in the same order:

```dotenv
GOOGLE_CLOUD_QUOTA_PROJECT_IDS=existing_project_1,existing_project_2,existing_project_3,existing_project_4,new_project_5,new_project_6
```

Positions 1-6 belong to `GEMINI_API_KEY`, `_2`, `_3`, `_4`, `_5`, `_6`. If keys belong to the same project, repeat its actual ID; they still share quota. Keep empty placeholders for unused numbered slots so later IDs are not shifted. Do not use a `NEXT_PUBLIC_` prefix.

For more keys, add `GEMINI_API_KEYS_EXTRA=key_7,key_8` and append their project IDs. The extra list starts after the highest configured numbered slot, with a minimum of four slots. Existing four-key-plus-extra configurations keep their original project-ID mapping; do not configure the same credential both as a numbered key and an extra.

Restart the development server after editing environment variables. Run this secret-safe check from the repository directory:

```powershell
pnpm exec tsx --env-file=.env.local scripts/gemini-config-check.ts
```

With six distinct numbered keys, it should report `configuredKeySlots: 6`. This configuration check never prints key values or calls Gemini. To verify authentication and quota access without model generation, use:

```powershell
pnpm exec tsx --env-file=.env.local scripts/gemini-verify.ts --keys --quota
```

## 3. Configure GitHub Pipelines

1. Open [RECSY repository secrets](https://github.com/rohang1411/RECSY/settings/secrets/actions).
2. Choose New repository secret. Add `GEMINI_API_KEY_5` and `GEMINI_API_KEY_6` separately, with the matching private key values. Use `GEMINI_API_KEYS_EXTRA` only if adding more keys as a list.
3. Keep existing `GEMINI_API_KEY` through `_4` secrets unchanged. If the quota-project list is configured there, extend `GOOGLE_CLOUD_QUOTA_PROJECT_IDS` with matching IDs.
4. Publish the updated workflow/provider code before running workflows. Ingestion, resume, tiered ingestion, new-phone ingestion, scorecards, catalog refresh, and the CI retrieval-evaluation job pass the numbered backups and extra list to their processes.

Read-only GitHub verification found all six numbered repository secrets present. Secret values cannot be read back from GitHub; this establishes names, not that their stored values match the locally tested credentials. `scripts/deployment-verify.ts` uses the existing Git credential to report secret names and deployment statuses without printing credentials.

Local `.env.local` values do not automatically reach GitHub Actions. Do not put credentials in workflow YAML, ordinary repository files, or logs.

## 4. Configure The Hosted Site

Open [RECSY Vercel settings](https://vercel.com/rohang1411-1491s-projects/recsy/settings/environment-variables). Add `GEMINI_API_KEY_5` and `GEMINI_API_KEY_6` separately for Production and Preview as appropriate. Extend `GOOGLE_CLOUD_QUOTA_PROJECT_IDS` in those same environments, then redeploy the updated code. Local values and GitHub secrets do not automatically reach Vercel. Add `GEMINI_API_KEYS_EXTRA` only for further list-based keys.

If `GOOGLE_SERVICE_ACCOUNT_JSON` is a local Windows file path, that path will not work on Vercel. Set its hosted value to the private JSON file's complete contents or base64 encoding instead. Never put a service-account private key in a public variable or repository file. The existing Vercel integration is unavailable to this session, so private hosted variable values were not inspected.

## 5. Enable Quota Monitoring For Added Projects

Project IDs are optional for using API keys, but needed for RECSY's verified Google quota monitor. For each newly monitored project:

1. Sign in as an owner/administrator of each project. Select that exact project in Google Cloud, open API Library, find Cloud Monitoring API, and click Enable. The API must be enabled for all six projects, not only the newest ones. [Official enabling instructions](https://docs.cloud.google.com/monitoring/api/enable-api).
2. In IAM, grant the existing monitoring service account the Monitoring Viewer role (`roles/monitoring.viewer`) for that project. The monitoring identity is configured through `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`; it is not another Gemini key.
3. Keep those monitoring credentials server-only and available in the deployment where the dashboard runs. A local credentials-file path will not exist automatically on Vercel.
4. Rerun `scripts/gemini-verify.ts --quota`, then reload `/internal/pipeline` after restart/redeployment. Google quota data may be unavailable or delayed; an absent row is not proof of zero usage or unlimited capacity. The monitor does not fabricate missing limits.

Configured projects, in key order:

- `gen-lang-client-0241492045`
- `gen-lang-client-0781254660`
- `gen-lang-client-0568900327`
- `gen-lang-client-0633393015`
- `gen-lang-client-0248993068`
- `gen-lang-client-0488531146`

See [Cloud Monitoring IAM](https://docs.cloud.google.com/monitoring/access-control). Presence checks do not establish these permissions; inspect the dashboard's quota-fetch diagnostics if it still reports an error.

## Troubleshooting

- Extra count stays zero: check the variable name, environment scope, published code, and restart/redeployment.
- Count is smaller than expected: empty or duplicate keys are ignored.
- More keys but unchanged limits: same-project keys share quota; inspect AI Studio's authoritative model limits.
- API authorization failure: verify the project's key restrictions and API access. Never paste credentials into support logs.
- Quota monitor lacks new rows: verify positional IDs, Cloud Monitoring API, service-account access, and whether Google exports the relevant metric.
- Hosted pipelines still see four keys: repository secrets and deployed workflow code must both be updated.
