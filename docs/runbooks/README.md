# RECSY Operations Runbooks

Operational runbooks for RECSY production incidents, alarms, and routine maintenance tasks.
Every runbook follows the standard structure: **Symptoms → Check → Action → Verify → Follow-up**.

---

## Index of Runbooks

| #   | Runbook                                   | Scope                                    | Document                                                                           |
| --- | ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **LLM budget burning fast**               | Model gateway / Quota abuse              | [01-llm-budget-burn.md](file:///docs/runbooks/01-llm-budget-burn.md)               |
| 2   | **Webhooks failing**                      | Billing / Stripe webhooks                | [02-webhooks-failing.md](file:///docs/runbooks/02-webhooks-failing.md)             |
| 3   | **"I was charged but got nothing"**       | User dispute / Missing delivery          | [03-charged-no-result.md](file:///docs/runbooks/03-charged-no-result.md)           |
| 4   | **Leases stuck / sweeper dead**           | Quota engine lease hygiene               | [04-leases-stuck-sweeper.md](file:///docs/runbooks/04-leases-stuck-sweeper.md)     |
| 5   | **Database near cap / paused**            | Postgres storage & connection ceiling    | [05-database-near-cap.md](file:///docs/runbooks/05-database-near-cap.md)           |
| 6   | **Secrets rotation**                      | Device/IP secrets, Stripe keys, Supabase | [06-secrets-rotation.md](file:///docs/runbooks/06-secrets-rotation.md)             |
| 7   | **Supabase Auth degraded**                | Authentication & OTP delivery            | [07-supabase-auth-degraded.md](file:///docs/runbooks/07-supabase-auth-degraded.md) |
| 8   | **Abuse wave**                            | Sybil / farm / scraper mitigation        | [08-abuse-wave.md](file:///docs/runbooks/08-abuse-wave.md)                         |
| 9   | **Duplicate subscription / wrong charge** | Stripe subscription sync & refunds       | [09-duplicate-subscription.md](file:///docs/runbooks/09-duplicate-subscription.md) |
| 10  | **Dispute received**                      | Chargeback evidence & account hold       | [10-dispute-received.md](file:///docs/runbooks/10-dispute-received.md)             |
| 11  | **Account deletion stuck**                | GDPR / CCPA 30-day deletion worker       | [11-account-deletion-stuck.md](file:///docs/runbooks/11-account-deletion-stuck.md) |
| 12  | **Rollback**                              | Reversible rollout stages & flag drops   | [12-rollback.md](file:///docs/runbooks/12-rollback.md)                             |

---

## Runbook Structure Template

When authoring or updating a runbook, maintain this exact outline:

1. **Symptoms**: How the issue is identified (alerts, error codes, metrics, user reports).
2. **Check**: Diagnostics commands, SQL queries, and logs to inspect root causes.
3. **Action**: Immediate remediation steps (kill switch, flags, manual reconcile, blocking).
4. **Verify**: Metrics and health checks confirming resolution.
5. **Follow-up**: Post-incident tasks (blameless review, test additions, refunds, balance corrections).
