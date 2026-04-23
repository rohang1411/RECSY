# ADR 0013 — Context-aware recommender summaries, tie/no-data honesty, and a client settings surface

## Status

Accepted (2026-04-22)

## Context

Two follow-up complaints emerged after ADR 0012 landed, and a related UX request came in at the same time:

1. **Refined turns still felt "dumb."** With ADR 0012's refine-over-prior-picks path enabled, a session with three picks followed by "which one should I choose if performance is my 2nd priority?" produced the right _shape_ — a re-ranked list of the three prior phones — but the three cards showed **identical scores (5.00)** and an **identical summary string** that still named the first turn's priority (`Strongest on camera …`). A user sees three phones, three 5.00s, and the word _camera_ everywhere, and correctly concludes "the recommender did not actually re-rank."

   Root cause, in two layers:
   - **Data layer**: the running instance had `phones` + `aspect_definitions` seeded but **no ingested chunks and therefore no `aspects` rows**. `match.ts::weightedAspectScore` substitutes a neutral `5` for any missing aspect, so `score = Σ wᵢ · 5 = 5` for **every** phone regardless of priority weighting. The ranker is mathematically correct; the inputs are empty.
   - **Presentation layer**: `pickSummaryLine(entry, weights)` only looked at the top-weighted aspect and emitted `Strongest on <aspect>…`. It could not distinguish "we have evidence this phone leads on camera" from "we have no evidence at all, but camera still has the highest weight so we say it anyway." Refined turns also never surfaced the **secondary** aspect the user had just introduced (performance), so two consecutive turns with different priorities produced the same summary.

2. **No user-visible controls for input behavior.** The recommend input used Enter-to-send; the phone-chat input did not. Users with a writing-heavy style wanted to be able to turn Enter-as-send off globally, and the existing ADR 0012 scope had explicitly deferred any settings UI.

## Decision

### 1. Rank result grows tie / data signals

`src/services/recommender/match.ts`:

- A new constant `SCORE_TIE_EPSILON = 0.05` defines when we treat the top picks as a tie (well below any real aspect-weighted delta, so the flag only fires on genuine ties like the 5.0/5.0/5.0 case).
- New helpers:
  - `hasRealAspectData(entry)` — `false` when `aspectScores.size === 0` **or** every recorded score equals the neutral 5, `true` otherwise.
  - `aspectsByWeight(weights)` — weights sorted descending, with deterministic tie-break on canonical `ASPECT_NAMES` order (for stable summaries across renders).
- `rankCandidates` now returns a richer `RankResult`:
  ```ts
  interface RankResult {
    picks: ScoredCandidate[];
    relaxed: string[];
    scoresTied: boolean; // top picks within SCORE_TIE_EPSILON
    scorecardMissing: boolean; // no pick has real aspect data
    weights: ReadonlyMap<AspectName, number>; // normalised
  }
  ```
  `scoresTied` is computed from the diversified top picks (the ones the user will actually see). `scorecardMissing` is computed at pick time, not corpus time, so a single ingested phone in a larger catalog still produces rich summaries for itself but a conservative flag across a tied set.

### 2. `pickSummaryLine` is now context-aware

`pickSummaryLine(entry, context)` takes a `SummaryContext { weights, refined, corpusScorecardMissing }` and emits one of four strings, in priority order:

| State                                   | Output                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No data anywhere + refined              | `No reviewer scorecard yet — ranked by stated priorities (top: <a>, then <b>) and specs only.`           |
| No data anywhere + fresh turn           | `No reviewer scorecard yet for this phone — ranking reflects your stated priorities and specs only.`     |
| Data present + refined + secondary axis | `<Primary> <value>/10, <secondary> <value>/10 among your earlier picks.` — names **both** priority axes. |
| Data present + otherwise                | `Strongest on <aspect> for what you said matters (aspect score <value>/10).` (existing behavior)         |

Refined turns now answer "what happens if I care about performance second?" by naming the secondary axis directly in the summary; fresh turns keep the single-axis line to avoid noise for first-time users.

### 3. API and UI surface the new signals

- `POST /api/recommend` response gains three fields alongside `refined`:
  - `scoresTied: boolean`
  - `scorecardMissing: boolean`
  - `topAspects: string[]` — up to two aspect names driving this ranking.
- `src/app/recommend/recommend-client.tsx`:
  - A new `note`-role banner sits between the picks header and the pick list. When `scorecardMissing` is set the banner says so in one short sentence; when `scoresTied` is set (with more than one pick) it adds a second line that names it as a tie. A honest chat bubble is also appended to the assistant turn for users who scroll through the conversation rather than the list.
  - The picks header now appends `· by <primary> then <secondary>` when `topAspects` has at least one entry, so a user scanning the list sees which axes ranked the list before reading the cards.

### 4. A global client settings surface

- `src/lib/client-settings.ts` — a dependency-free `useClientSetting<T>(key, fallback)` hook backed by `localStorage` with a namespaced `recsy:setting:` prefix. Implemented via `useSyncExternalStore` (not `useEffect` + `setState`) so hydration returns the fallback synchronously and the committed client render transitions to the stored value without a hydration mismatch. A module-level emitter keeps all hooks on the same key in sync within a tab; a `storage` event listener keeps them in sync across tabs. A reference cache on the parsed snapshot keeps `useSyncExternalStore`'s identity requirement satisfied for object/array settings (forward-compatible with future settings).
- `CLIENT_SETTING_KEYS` + `CLIENT_SETTING_DEFAULTS` are exported as frozen objects so consumers cannot typo a key at a call-site.
- `src/app/settings/page.tsx` + `settings-client.tsx` — a new `/settings` route with one toggle today: **"Enter key sends message."** The toggle is a native `<button role="switch">` with `aria-checked`, `aria-labelledby`, and `aria-describedby`, wired to the shared hook.
- `AppHeader` gains a `Settings` link next to `Compare`.
- `src/app/recommend/recommend-client.tsx` and `src/app/p/[slug]/phone-chat.tsx` both read the `enterToSend` setting and gate their `Enter` → `send()` / `ask()` handler on it. Shift+Enter always inserts a newline regardless; disabling the setting means Enter inserts a newline as well.

Storage and not cookies/server state: these preferences are per-browser, not per-user identity, and RECSY v2 has no account system.

## Consequences

- **The "three identical scores, same camera line" pathology is resolved at the two layers that caused it.** Refined turns with real data surface both the primary and secondary priority axes in each card's summary; refined turns with _no_ data say so in English and stop pretending to differentiate. A separate banner and chat bubble explain the tie rather than leaving the user to reverse-engineer three 5.00s.
- **The chat feels more honest.** A fresh install without ingestion no longer misleads the user into thinking the recommender believes the camera on these phones is uniquely great — it says "no reviewer scorecard yet."
- **Back-pressure for ingestion.** The missing-scorecard banner names the exact remediation (ingest reviews or add a sharper constraint), so operators see the signal in the product rather than only in logs.
- **One knob, generic infrastructure.** `/settings` is wired for growth; adding a new toggle is one line in `CLIENT_SETTING_KEYS`, one default, and one hook call at the consumption site. `useSyncExternalStore` keeps the hook behavior correct across React 18/19 concurrent features.
- **No server-side storage.** Settings live in `localStorage`; clearing site data resets them. This is a deliberate tradeoff against the complexity of cookies + server persistence for a single toggle.
- **No DB migrations.** All signalling is derived from in-flight ranker state.
- **New tests**: `src/services/recommender/match-summary.test.ts` covers `hasRealAspectData`, deterministic `aspectsByWeight`, the four `pickSummaryLine` cases, and `rankCandidates` tie / missing-scorecard flag propagation. Existing `match.test.ts` continues to pass unchanged against the refactored `scoreEntry` internals.

## Related

- [ADR 0007 — recommender MVP](0007-recommender-mvp.md) — original extract → rank → diversify pipeline.
- [ADR 0012 — refine, rank UI, empty-corpus honesty](0012-recommender-refine-rank-ui-and-empty-corpus-honesty.md) — introduced the refine-over-prior-picks path whose summary strings this ADR completes.
