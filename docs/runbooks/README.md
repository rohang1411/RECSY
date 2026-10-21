# RECSY Operations Runbooks

Operational runbooks for RECSY production incidents, alarms, and routine maintenance tasks.
Every runbook follows the standard structure: **Symptoms → Check → Action → Verify → Follow-up**.

---

## Index of Runbooks

| #   | Runbook                             | Scope                                    | Document                                                                     |
| --- | ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | **LLM budget burning fast**         | Model gateway / Quota abuse              | [llm-budget-burn.md](file:///docs/runbooks/llm-budget-burn.md)               |
| 2   | **Webhooks failing**                | Billing / Stripe webhooks                | [webhooks-failing.md](file:///docs/runbooks/webhooks-failing.md)             |
| 3   | **"I was charged but got nothing"** | User dispute / Missing delivery          | [charged-no-result.md](file:///docs/runbooks/charged-no-result.md)           |
| 4   | **Leases stuck / sweeper dead**     | Quota engine lease hygiene               | [leases-stuck-sweeper.md](file:///docs/runbooks/leases-stuck-sweeper.md)     |
| 5   | **Database near cap / paused**      | Postgres storage & connection ceiling    | [database-near-cap.md](file:///docs/runbooks/database-near-cap.md)           |
| 6   | **Secrets rotation**                | Device/IP secrets, Stripe keys, Supabase | [secrets-rotation.md](file:///docs/runbooks/secrets-rotation.md)             |
| 7   | **Supabase Auth degraded**          | Authentication & OTP delivery            | [supabase-auth-degraded.md](file:///docs/runbooks/supabase-auth-degraded.md) |
| 8   | **Abuse wave**                      | Sybil / farm / scraper mitigation        | [abuse-wave.md](file:///docs/runbooks/abuse-wave.md)                         |

---

## Runbook Structure Template

When authoring or updating a runbook, maintain this exact outline:

1. **Symptoms**: How the issue is identified (alerts, error codes, metrics, user reports).
2. **Check**: Diagnostics commands, SQL queries, and logs to inspect root causes.
3. **Action**: Immediate remediation steps (kill switch, flags, manual reconcile, blocking).
4. **Verify**: Metrics and health checks confirming resolution.
5. **Follow-up**: Post-incident tasks (blameless review, test additions, refunds, balance corrections).
