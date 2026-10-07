# Pilot review receipt and adjudication — 2026-10-07

The user submitted `docs/GPT Retrieval Reviews/recsy-review-bc98cc8a-f3a6-4f96-838a-72c666179c5a.json`. The version 2 import succeeded: run/result/corpus hashes and all six question IDs / three blinded outcome IDs match the frozen pilot. The original export and a content-hashed imported copy are preserved. Receipt: `output/eval/eval_20261007012955/review-receipt-2026-10-07.json`. No model calls were made during import.

## Submitted judgments

The user confirmed that AI drafted the judgments and they personally verified every judgment. Record this as AI-assisted, user-verified review. External independent adjudication and final gold labels have not been established.

| Variant, disclosed after submission | Execution                           | Submitted judgment                                                                    | Consequence                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vector-only, sp01                   | Completed answer                    | Factually correct and complete, but not all claims supported; citations incorrect     | Fails fully supported answer criterion. Notes distinguish a general Audio Mix passage from a Studio-specific claim, and an iPhone 16 Plus passage from base iPhone 16 evidence. Citation-ID membership is insufficient semantic validation.                  |
| FTS-only, sp01                      | Completed abstention                | Unsupported, factually incorrect, incomplete; incorrect citations                     | False refusal/false evidence-availability diagnosis. Frozen candidate evidence answers the question; this variant retrieved no matching chunks. The old message was already repaired locally after the pilot, but improved live behavior has not been rerun. |
| Hybrid, sp01                        | Provider 429, no substantive answer | Complete: no; other claim/citation checks yes because there are no substantive claims | Execution failure, not a correct answer. The importer requires completed execution and completeness, so vacuous support cannot create a success.                                                                                                             |

All six questions were marked answerable. Five candidate-fact sets were accepted; sp03 was rejected. The sp03 note nevertheless states that its candidate facts are accurate. The user clarified that the feature behavior has changed since the earlier excerpt. Treat the rejection as intentional: historical support does not establish current behavior. The submitted `no` remains unchanged; the clarification is recorded separately in the receipt. No specific rollout date or capability is inferred from the clarification. Repair the candidate's historical/current time scope before final gold acceptance.

The user confirmed the review method on 2026-10-07: AI drafted the judgments; the user personally verified every judgment. The portal summary records AI-assisted, user-verified review with one candidate rejected for time scope. It does not certify external independent adjudication.

## Interpretation and next gates

There are no fully supported successes among these three recorded variant outcomes, all for the same first question. This is not three independent product questions, a 0% quality headline, or an established hybrid answer-quality rate. Fifteen planned outcomes remain unexecuted. `fullySupportedAnswerRate` remains null; `resumeEligible` remains false.

The review supplies actionable failure analysis: separate exact-device/claim entailment from citation membership, distinguish retrieval miss from missing corpus, and retain quota failure in execution reporting. Preserve this pilot before changes; use a separate reviewed development cohort for repairs and a prospectively frozen held-out cohort for the final study. The earlier source/quota/load/release gates still apply.

Next inputs: verify provider quota/reset before any additional live call, and resolve the pending publication authorization before changing the remote deployment. The final benchmark additionally needs representative reviewed questions/evidence and complete paired live execution. See [the campaign report](PRODUCTION_CAMPAIGN_2026-10-06.md).
