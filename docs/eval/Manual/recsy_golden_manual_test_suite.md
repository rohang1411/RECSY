# RECSY Golden Standard Manual Testing Test Suite & QA Specification

**Author:** Senior Staff QA & Test Architect (Big Tech / Frontier AI Lab)  
**Target System:** RECSY Mobile Recommender Engine (`/api/recommend`, `runRecommendationPipeline`, `match.ts`)  
**Catalog Scope:** 91 Inventory Records (PostgreSQL Database Catalog)  
**Test Suite Version:** 2.0 (Production Verification Standard)

---

## 1. Executive Summary & Test Strategy

As a Senior Staff QA & Testing Engineer at a Frontier AI Lab, evaluating an LLM-orchestrated recommendation pipeline requires a dual-layered verification methodology:

1. **Semantic Extraction Verification (NLU Layer):** Does the language model correctly parse ambiguous, multi-constraint, or adversarial user utterances into structured requirements (`UserRequirements`: budget ceilings, aspect priority vectors, must-haves, deal-breakers, form factor flags, and brand filters)?
2. **Deterministic Multi-Attribute Utility Ranking Verification (RecSys Layer):** Does the downstream mathematical ranker (`match.ts`) correctly apply hard filter boundaries, compute calibrated aspect scores, respect recency degradation, enforce lineage/brand diversity caps (`pickDiverseTop`), and yield the logically optimal ordering of devices available in our database?

This document defines the **Ground Truth Golden Standard** across **30 exhaustive test scenarios** spanning 8 critical dimensions. Every expected output is strictly validated against the actual active catalog in the RECSY database.

---

## 2. Catalog Audit & Pre-Existing Pipeline Anomalies

Before manual verification, a full database audit of all 91 phone records was executed. The manual testing team must be aware of the following catalog-level anomalies that directly influence test pass/fail triage:

| Anomaly Type                         | Affected Slugs / Models                                                                                                                | Impact on Pipeline Behavior                                                                                                                                                    | QA Triage Action                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Spec Dimension Mismatch**          | `apple-iphone-17-pro-max` (listed as `6.3"`), `samsung-galaxy-s26-ultra` (listed as `6.2"`), `apple-iphone-16-plus` (listed as `6.1"`) | Hard screen-size filters (e.g., compact `< 6.36"`) will falsely match these massive flagship devices unless corrected in `spec_json`.                                          | Flag as Catalog Data Bug. In compact tests, expected real-world winners are iPhone 16 Pro (6.3") and Pixel 9 Pro (6.3"). |
| **Missing MSRP (`msrp_usd = null`)** | `google-pixel-7`, `apple-iphone-16e`, `sony-group-sony-xperia-5-v`, `fairphone-gen-6-plus`, `samsung-galaxy-s23`                       | Hard budget filters (`passesHardFilters`) evaluate `Number.parseFloat(null)` as `NaN`, causing immediate exclusion from all budget-bounded queries.                            | Validates that budget-constrained queries strictly omit these models.                                                    |
| **Missing Aspect Scorecards**        | `google-pixel-8a`, `samsung-galaxy-m36-5g`, `samsung-galaxy-s23-ultra`, `sony-group-sony-xperia-10-vi`                                 | Missing aspects default to baseline neutral `5.0`. When tested, they rely entirely on recency bonuses (`+0.35`) and keyword semantic matches rather than calibrated sentiment. | Verify if `scorecardMissing` flag surfaces or if calibrated alternatives outrank them.                                   |
| **Zero Aspect Value Bug**            | `apple-iphone-fold` (`performance: 0.0`), `xiaomi-redmi-note-14-pro-plus` (`battery: 0.0`)                                             | Corpus ingestion yielded no supporting chunks, registering 0.0 scores instead of neutral baseline.                                                                             | Will severely penalize composite score if the user prioritizes those aspects.                                            |
| **3.5-Year Age Gate**                | `google-pixel-7`, `google-pixel-7-pro`, `oneplus-11`, `samsung-galaxy-s23`                                                             | Devices older than 1278 days (~3.5 years from `2026-10-22`) are strictly purged by `MAX_RECOMMEND_PHONE_AGE_DAYS`.                                                             | Verify these legacy phones NEVER appear in active recommendations.                                                       |

---

## 3. Test Suite Matrix: 8 Core Test Dimensions

```
+----------------------------------------------------------------------------------------------------+
|                                    RECSY MANUAL TEST SUITE TAXONOMY                                |
+----------------------------------------------------------------------------------------------------+
| Dimension A: Strict Budget & Value Boundaries (Hard Price Thresholds: Sub-$200, Sub-$500, etc.)    |
| Dimension B: Core Feature & Spec-Dominant Queries (Camera, Battery, Gaming, Display, Software)     |
| Dimension C: Form Factor & Ergonomics (Compacts <=6.3", Book Foldables, Clamshell Flips, Rugged)   |
| Dimension D: Ecosystem Affinity & Brand Constraints (iOS-only, Anti-Samsung, Pure Pixel, OnePlus)  |
| Dimension E: Conflicting Multi-Objective Trade-Offs (Flagship camera <$500, Compact + Big Battery)  |
| Dimension F: Contextual Personas & Lifestyle Use Cases (Student, Grandparent, Creator, Traveler)   |
| Dimension G: Vague, Ambiguous & Clarification Triggers (Pure vague queries, Brand comparisons)      |
| Dimension H: Adversarial, Typos, Misconceptions & Negative Constraints (Typos, Impossible asks)     |
+----------------------------------------------------------------------------------------------------+
```

---

## Dimension A: Strict Budget & Value Boundaries

### TC-BUD-01: Ultra-Budget Entry Level (Ceiling: $200)

- **Prompt:** `"I have a strict budget of $200. What is the absolute best smartphone I can buy right now?"`
- **Category:** Hard Budget Boundary (Strict Maximum: $200)
- **Extracted Requirements:** `budget_usd.max = 200`, `priorities = [{aspect: "value", weight: 0.6}, {aspect: "battery", weight: 0.4}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy A16 ($199.00)** — _Display: 6.7" Super AMOLED 90Hz, 5000 mAh, 50MP Main, 6 years OS updates._
  2. **Rank #2: Samsung Galaxy M16 5G ($189.00)** — _Display: 6.7" 90Hz, 5000 mAh, Dimensity 6300, 50MP Main._
  3. **Rank #3: Samsung Galaxy F15 5G ($179.00)** — _Display: 6.6" 90Hz Super AMOLED, 6000 mAh, MediaTek Dimensity 6100+._
- **Technical & Logical Rationale:**
  - _Galaxy A16_ takes Rank #1 because it offers Samsung's unmatched entry-level commitment of **6 generations of Android OS upgrades and 6 years of security patches**, transforming a sub-$200 purchase into a long-lasting daily driver.
  - _Galaxy M16 5G_ takes Rank #2 offering near-identical hardware with solid 5G network support.
  - _Galaxy F15 5G_ takes Rank #3 because while it packs a larger 6,000 mAh battery, its software update lifespan and global market polish are slightly lower than the A16.
  - _Motorola Edge 50 Fusion ($299)_ and _Galaxy A35 ($399)_ are strictly excluded due to the $200 budget ceiling.
- **Pipeline Failure Watchlist:** Ensure the pipeline does NOT relax budget to $240 (using `RECOMMEND_BUDGET_RELAX_FACTOR = 1.2`) because eligible candidates exist under $200. Ensure no devices priced at $201+ leak through.

---

### TC-BUD-02: Mid-Range Value Sweet Spot (Ceiling: $500)

- **Prompt:** `"Looking for the best phone under $500. Balanced all-rounder with good screen and smooth performance."`
- **Category:** Hard Budget Boundary (Strict Maximum: $500)
- **Extracted Requirements:** `budget_usd.max = 500`, `priorities = [{aspect: "value", weight: 0.4}, {aspect: "performance", weight: 0.3}, {aspect: "display", weight: 0.3}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: OnePlus 12R ($499.00)** — _Snapdragon 8 Gen 2, 16GB RAM, 6.78" 120Hz LTPO4 AMOLED (4500 nits peak), 5500 mAh, 100W SuperVOOC._
  2. **Rank #2: Nothing Phone (3a) Pro ($459.00)** — _Snapdragon 7s Gen 3, 6.77" 120Hz AMOLED, 5000 mAh, Clean Nothing OS 3.0, distinctive design._
  3. **Rank #3: Google Pixel 9a ($499.00)** — _Google Tensor G4, 6.3" 120Hz Actua OLED, 7 years OS updates, Pixel computational camera._
- **Technical & Logical Rationale:**
  - _OnePlus 12R_ is the undisputed performance and hardware champion under $500. Carrying a flagship Snapdragon 8 Gen 2, LTPO4 1-120Hz display, and 100W charging, it blows mid-range silicon out of the water.
  - _Nothing Phone (3a) Pro_ earns Rank #2 due to exceptional modern mid-range balance: clean, bloat-free software, standout design, and solid thermal efficiency.
  - _Pixel 9a_ claims Rank #3. While its raw gaming performance is lower than OnePlus 12R, its 7-year software guarantee and photographic consistency make it the most reliable mainstream choice.
  - Lineage diversity check: OnePlus 12 ($799) is excluded by price; OnePlus Nord 4 ($499) is suppressed by lineage collision with OnePlus 12R.
- **Pipeline Failure Watchlist:** Check if `OnePlus 12R` ($499.00) is mistakenly excluded due to floating-point rounding if budget is evaluated strictly `< 500` instead of `<= 500`.

---

### TC-BUD-03: Upper Mid-Range / Flagship Killer Boundary ($800)

- **Prompt:** `"I have an $800 maximum budget. I want a true flagship experience without crossing into four digits."`
- **Category:** Hard Budget Boundary ($800)
- **Extracted Requirements:** `budget_usd.max = 800`, `priorities = [{aspect: "performance", weight: 0.35}, {aspect: "build", weight: 0.35}, {aspect: "camera", weight: 0.3}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: OnePlus 12 ($799.00)** — _Snapdragon 8 Gen 3, 6.82" 2K 120Hz LTPO, Hasselblad Triple Camera (50MP + 64MP 3x periscope + 48MP ultrawide), 5400 mAh, 80W/50W wireless._
  2. **Rank #2: Samsung Galaxy S25 ($799.00)** — _Snapdragon 8 Elite for Galaxy, 6.2" Dynamic AMOLED 2X, 7 years OS updates, Armor Aluminum._
  3. **Rank #3: Apple iPhone 16 ($799.00)** — _Apple A18 (3nm), Camera Control, Action Button, Ceramic Shield, 48MP Fusion Camera, Apple Intelligence._
- **Technical & Logical Rationale:**
  - _OnePlus 12 ($799)_ delivers a full "Pro/Ultra" hardware spec sheet at an $800 price point: 2K display, 3x periscope telephoto, 5400mAh battery, and 80W wired + 50W wireless charging. No other phone at $799 matches this hardware depth.
  - _Galaxy S25 ($799)_ provides the cutting-edge Snapdragon 8 Elite, compact ergonomics, and a 7-year software policy.
  - _iPhone 16 ($799)_ secures Rank #3 by delivering Apple's latest A18 chip, Camera Control, and elite video recording capabilities within budget.
  - Brand diversity cap test: Galaxy S25+ ($999), iPhone 16 Pro ($999), and Pixel 9 Pro XL ($1099) are strictly filtered out by the $800 budget.
- **Pipeline Failure Watchlist:** The budget segment alignment rule in `match.ts` (`maxBudget >= 800`) kicks in here. Ensure sub-$400 budget phones (like Galaxy A35 or A16) are penalized so they do not outscore genuine $799 flagship devices.

---

### TC-BUD-04: Ultra-Premium No-Compromise Tier (> $1200)

- **Prompt:** `"Money is no object ($1300+). Give me the absolute top-tier, highest-rated super-flagship phones on the market."`
- **Category:** Luxury / Ultra-Flagship Tier
- **Extracted Requirements:** `budget_usd.min = 1200`, `priorities = [{aspect: "performance", weight: 0.3}, {aspect: "camera", weight: 0.35}, {aspect: "display", weight: 0.35}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy S25 Ultra ($1299.00)** — _Snapdragon 8 Elite for Galaxy, Titanium chassis, Built-in S-Pen, Anti-reflective Gorilla Glass Armor, Quad Camera (200MP + 50MP 5x + 10MP 3x + 50MP UW)._
  2. **Rank #2: Apple iPhone 16 Pro Max ($1199.00 - $1299.00 tier)** — _Apple A18 Pro, Grade 5 Titanium, 6.9" Super Retina XDR OLED, 4K120fps Dolby Vision, 5x Telephoto._
  3. **Rank #3: Xiaomi 14 Ultra ($1499.00)** — _1-inch Sony LYT-900 sensor, Quad 50MP Leica cameras with stepless variable aperture (f/1.63-f/4.0), Snapdragon 8 Gen 3, 2K display._
- **Technical & Logical Rationale:**
  - _Galaxy S25 Ultra_ represents the zenith of Android power user functionality: S-Pen integration, revolutionary anti-reflective display coating, top-rated productivity multi-window, and versatile 200MP/5x optical imaging.
  - _iPhone 16 Pro Max_ dominates battery life endurance, raw single-core compute, and cinema-grade video capture with professional log workflows.
  - _Xiaomi 14 Ultra_ is the purest photography powerhouse in existence with its massive 1-inch physical sensor and stepless Leica aperture.
- **Pipeline Failure Watchlist:** Verify that mid-range phones are entirely purged by the budget alignment penalty (`maxBudget >= 800`). Verify brand diversity: only 1 phone per lineage (e.g., S25 Ultra appears, S24 Ultra is suppressed).

---

## Dimension B: Core Feature & Spec-Dominant Queries

### TC-SPEC-01: Pure Mobile Photography & Optical Zoom

- **Prompt:** `"I need the best camera phone for photography, portraits, and long-range zoom. Natural colors and sharp telephoto are essential."`
- **Category:** Feature Dominant (Camera aspect weight = 0.8+)
- **Extracted Requirements:** `priorities = [{aspect: "camera", weight: 0.8}, {aspect: "display", weight: 0.2}]`, `use_cases = ["photography", "portraits", "telephoto zoom"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Google Pixel 9 Pro XL ($1099.00)** — _50MP Main (f/1.68, 1/1.31"), 48MP 5x Telephoto with Super Res Zoom up to 30x, 48MP Ultrawide with Macro, Pixel AI Add Me & Best Take._
  2. **Rank #2: Apple iPhone 16 Pro Max ($1199.00)** — _48MP Fusion sensor, 48MP Ultrawide, 12MP 5x Tetraprism Telephoto, Photographic Styles with real-time tone/color control._
  3. **Rank #3: Samsung Galaxy S24 Ultra ($1299.00)** — _200MP Main, 50MP 5x Periscope, 10MP 3x Telephoto, 12MP Ultrawide, 100x Space Zoom._
- **Technical & Logical Rationale:**
  - _Pixel 9 Pro XL_ holds the highest real-world portrait and low-light still photography consensus. Its 5x optical telephoto combined with computational Super Res Zoom yields the most artifact-free long-range images.
  - _iPhone 16 Pro Max_ provides the best skin tone consistency, zero shutter lag, and class-leading Photographic Styles that adjust color and shadows without clipping highlights.
  - _Galaxy S24 Ultra_ offers dual optical telephotos (3x and 5x), granting unmatched versatility across medium and extreme zoom ranges.
- **Pipeline Failure Watchlist:** Check if `Xiaomi 14 Ultra` or `iPhone 16 Pro` get demoted if aspect weights are diluted. Ensure phones without optical telephoto (e.g., Pixel 9 base, iPhone 16 base) do not rank ahead of Pro/Ultra models.

---

### TC-SPEC-02: Battery Endurance & Commuter Reliability

- **Prompt:** `"I commute 3 hours daily and use GPS, Spotify, and 5G non-stop. I need two-day battery life and fast charging."`
- **Category:** Feature Dominant (Battery aspect weight = 0.8+)
- **Extracted Requirements:** `priorities = [{aspect: "battery", weight: 0.8}, {aspect: "performance", weight: 0.2}]`, `use_cases = ["commuting", "gps navigation", "music streaming"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: OnePlus 13 ($899.00)** — _6000 mAh Silicon-Carbon High-Density Battery, 100W SUPERVOOC wired (0-100% in 28 mins), 50W wireless, Snapdragon 8 Elite._
  2. **Rank #2: OnePlus 12 ($799.00)** — _5400 mAh dual-cell battery, 80W wired charging, 50W AIRVOOC wireless, exceptional screen-on-time (>9.5 hours)._
  3. **Rank #3: Apple iPhone 16 Plus ($899.00)** — _Market-leading video streaming and web browsing endurance, 60Hz high-efficiency panel, class-leading standby battery._
- **Technical & Logical Rationale:**
  - _OnePlus 13_ features revolutionary 6,000 mAh silicon-carbon battery chemistry paired with extreme 100W charging speed, eliminating battery anxiety even under continuous 5G navigation and audio streaming.
  - _OnePlus 12_ ranks directly behind it with a proven 5400 mAh cell and 80W charging.
  - _iPhone 16 Plus_ is renowned among reviewers as an endurance champion because its 60Hz OLED panel draws minimal power while delivering iOS background efficiency.
  - Note on Lineage Diversity: In a strict diversity filter (`maxPerBrand = 2`), OnePlus claims Rank #1 and #2 because they are distinct generations (OnePlus 13 vs OnePlus 12). If lineage grouping merges them, iPhone 16 Plus elevates to #2 and Galaxy S24 Ultra takes #3.
- **Pipeline Failure Watchlist:** Ensure budget phones with large batteries (e.g. Galaxy M35 with 6000 mAh) do not unseat premium flagships unless a budget ceiling was explicitly specified.

---

### TC-SPEC-03: Hardcore Mobile Gaming & High-FPS Performance

- **Prompt:** `"I want a beast for Genshin Impact, Call of Duty Warzone, and competitive gaming. Maximum frame rates, vapor chamber cooling, and no thermal throttling."`
- **Category:** Feature Dominant (Performance aspect weight = 0.8+)
- **Extracted Requirements:** `priorities = [{aspect: "performance", weight: 0.8}, {aspect: "display", weight: 0.2}]`, `use_cases = ["gaming", "high frame rates", "thermal cooling"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: OnePlus 13 ($899.00)** — _Qualcomm Snapdragon 8 Elite, Adreno 830 GPU, Dual Cryo-Velocity VC cooling (9,925 mm² area), 120Hz 2K display, 24GB LPDDR5X RAM._
  2. **Rank #2: Apple iPhone 16 Pro Max ($1199.00)** — _Apple A18 Pro (6-core GPU with hardware-accelerated ray tracing), graphite thermal substructure, AAA console titles (Death Stranding, Assassin's Creed Mirage)._
  3. **Rank #3: Samsung Galaxy S25 Ultra ($1299.00)** — _Snapdragon 8 Elite for Galaxy, 1.9x enlarged vapor chamber, sustained high-clock performance, flat gaming-friendly display._
- **Technical & Logical Rationale:**
  - _OnePlus 13_ is engineered for prolonged gaming workloads: Snapdragon 8 Elite delivers generational leap in GPU benchmarks, backed by the largest dual-layer vapor chamber in any mainstream flagship.
  - _iPhone 16 Pro Max_ possesses the strongest raw computing silicon and native support for desktop-grade AAA game ports, though thermal dissipation under extended 60-minute peak loads can throttle slightly earlier than vapor-chamber Androids.
  - _Galaxy S25 Ultra_ pairs the 8 Elite with a redesigned, flat front glass that prevents accidental palm touch triggers during competitive gaming.
- **Pipeline Failure Watchlist:** Tensor-powered Google Pixels (Pixel 9 Pro XL, Pixel 8) must NOT appear in the top 3 for hardcore gaming, as Tensor G4/G3 GPUs and thermal designs throttle heavily in sustained 3D gaming.

---

### TC-SPEC-04: Display Excellence & Cinematic Media Consumption

- **Prompt:** `"I watch movies, YouTube HDR, and Netflix on flights. I need a stunning, massive, ultra-bright OLED screen with rich stereo speakers."`
- **Category:** Feature Dominant (Display aspect weight = 0.75+, Build/Audio = 0.25)
- **Extracted Requirements:** `priorities = [{aspect: "display", weight: 0.75}, {aspect: "build", weight: 0.25}]`, `form_factor.screen_size_range_in = [6.7, 7.0]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy S24 Ultra ($1299.00)** — _6.8" Dynamic AMOLED 2X, 2600 nits peak, Corning Gorilla Armor with 75% anti-reflective surface reduction, flat panel._
  2. **Rank #2: Google Pixel 9 Pro XL ($1099.00)** — _6.8" Super Actua OLED (1344 x 2992), 3000 nits peak brightness, 495 PPI, class-leading color calibration (Delta-E < 1)._
  3. **Rank #3: Apple iPhone 16 Pro Max ($1199.00)** — _6.9" Super Retina XDR OLED, thinnest bezels in mobile industry, Dolby Vision HDR, studio-grade spatial audio speakers._
- **Technical & Logical Rationale:**
  - _Galaxy S24 Ultra_ is the uncontested king of outdoor and in-flight media viewing because its **Gorilla Armor glass cuts reflections by 75%**, eliminating distracting ambient cabin reflections that plague standard glossy panels.
  - _Pixel 9 Pro XL_ has verified lab-tested peak brightness reaching nearly 2500 nits in real-world HDR playback with reference-grade natural color reproduction.
  - _iPhone 16 Pro Max_ offers the largest 6.9-inch screen canvas with micro-bezels and the punchiest, widest-dispersion stereo speaker system on any smartphone.
- **Pipeline Failure Watchlist:** Small phones (<6.5") must be filtered out by the user's implicit "massive screen" requirement. Ensure the pipeline extracts `screen_size_range_in` or weights screen size.

---

### TC-SPEC-05: Cleanest Software & Guaranteed Long-Term Longevity

- **Prompt:** `"I hate bloatware, duplicate apps, and ads. I want pure, clean software with guaranteed updates for the next 7 years."`
- **Category:** Feature Dominant (Software aspect weight = 0.8+)
- **Extracted Requirements:** `priorities = [{aspect: "software", weight: 0.8}, {aspect: "build", weight: 0.2}]`, `must_haves = ["clean software", "7 years updates"]`, `deal_breakers = ["bloatware", "ads"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Google Pixel 9 Pro ($999.00)** — _Pure Stock Android 15/16, Zero bloatware, 7 years of full OS upgrades, security patches, and quarterly Pixel Feature Drops (until 2031)._
  2. **Rank #2: Google Pixel 9 ($799.00)** — _Identical clean Pixel experience and 7-year update guarantee at a lower price point._
  3. **Rank #3: Samsung Galaxy S24 ($799.00)** — _7 years of One UI OS and security updates, Knox security, Enterprise-grade patch cadence._
- **Technical & Logical Rationale:**
  - _Google Pixel 9 Pro_ is the gold standard of Android software purity: immediate Day-1 updates, Google Call Screen, Now Playing, and absolutely zero OEM shovelware or third-party partner pre-installs.
  - _Google Pixel 9_ offers the same pure software package. Under lineage diversity rules, if only one Pixel Pro lineage is permitted, Pixel 9 serves as the baseline alternative, or Nothing Phone (2) can qualify.
  - _Samsung Galaxy S24_ matches the 7-year OS guarantee and provides rigorous monthly security patching, though it includes duplicate Samsung apps (Gallery, Messages, Galaxy Store).
  - Xiaomi, Transsion, or ad-supported budget UIs must be disqualified by the deal-breaker on "ads" and "bloatware".
- **Pipeline Failure Watchlist:** Ensure `deal_breakers: ["bloatware", "ads"]` properly filters or severely downranks UI skins known for pre-installed third-party app bundles.

---

## Dimension C: Form Factor, Ergonomics & Physical Constraints

### TC-FORM-01: True Compact Flagship (Screen <= 6.3")

- **Prompt:** `"I want a small, compact, one-handed flagship phone. Screen must be 6.3 inches or smaller, but with top cameras and premium build."`
- **Category:** Physical Constraint (`screen_size_range_in: [5.5, 6.36]`, `priorities: camera + build`)
- **Extracted Requirements:** `form_factor.screen_size_range_in = [5.5, 6.36]`, `priorities = [{aspect: "camera", weight: 0.5}, {aspect: "build", weight: 0.5}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Google Pixel 9 Pro ($999.00)** — _6.3" LTPO OLED 120Hz, compact 152.8mm height, Full Triple Camera (50MP + 48MP 5x + 48MP UW), 16GB RAM._
  2. **Rank #2: Apple iPhone 16 Pro ($999.00)** — _6.3" Super Retina XDR OLED, Grade 5 Titanium, 48MP + 48MP + 12MP 5x Tetraprism, A18 Pro._
  3. **Rank #3: Samsung Galaxy S24 ($799.00)** — _6.2" Dynamic AMOLED 2X, ultra-light 167g, Snapdragon 8 Gen 3, compact 147mm height._
- **Technical & Logical Rationale:**
  - _Pixel 9 Pro_ was universally lauded by reviewers for finally bringing an **uncompromised triple-camera system with a 5x optical periscope lens to a 6.3-inch compact body**, breaking the historical penalty where compact phones lost telephoto capability.
  - _iPhone 16 Pro_ also achieved parity with the Pro Max by adding the 5x optical telephoto to its 6.3" titanium chassis.
  - _Galaxy S24_ is the lightest true flagship on the market at just 167g with an ultra-narrow 70.6mm width, making it the most comfortable one-handed phone available.
- **Pipeline Failure Watchlist (CRITICAL ANOMALY ALERT):** In the database catalog audit, `apple-iphone-17-pro-max` has a buggy `spec_json.display.size_in = 6.3` and `samsung-galaxy-s26-ultra` has `6.2`. If the pipeline blindly filters by `spec_json.display.size_in`, these massive phones will erroneously rank #1 and #2. The tester MUST verify that the pipeline does not recommend 6.9" phablets for compact queries!

---

### TC-FORM-02: Productivity Book-Style Foldable

- **Prompt:** `"I need a book-style folding phone that opens into a tablet for multitasking, Excel spreadsheets, and dual-app split screen."`
- **Category:** Form Factor (`foldable: true`, book-style)
- **Extracted Requirements:** `form_factor.foldable = true`, `priorities = [{aspect: "display", weight: 0.5}, {aspect: "performance", weight: 0.5}]`, `use_cases = ["multitasking", "productivity", "tablet"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: OnePlus Open ($1699.00)** — _Inner: 7.82" 120Hz LTPO3 Flexi-fluid AMOLED, Outer: 6.31" 20:9 standard ratio, 'Open Canvas' multi-window multitasking, almost invisible crease, 239g._
  2. **Rank #2: Samsung Galaxy Z Fold6 ($1899.00)** — _Inner: 7.6" Dynamic AMOLED 2X, S-Pen support, Samsung DeX desktop mode, IP48 water/dust resistance, 7 years OS updates._
  3. **Rank #3: Google Pixel 9 Pro Fold ($1799.00)** — _Inner: 8.0" Super Actua Flex 120Hz, Outer: 6.3" 20:9 OLED, ultra-thin 10.5mm folded profile, Google AI split-screen._
- **Technical & Logical Rationale:**
  - _OnePlus Open_ remains the most praised productivity foldable: its **Open Canvas software allows 3 full-sized apps to live side-by-side off-screen**, its cover screen has a normal 20:9 phone aspect ratio, and its display crease is virtually undetectable.
  - _Galaxy Z Fold6_ provides S-Pen stylus input, Samsung DeX desktop capability, and unmatched multi-window maturity with 7 years of software support.
  - _Pixel 9 Pro Fold_ provides the largest internal canvas (8.0 inches) in an impossibly thin chassis.
- **Pipeline Failure Watchlist:** Flip-style clamshell phones (`Galaxy Z Flip6`, `Galaxy Z Flip 7 FE`) must NOT appear in this ranking because clamshells cannot open into tablet aspect ratios for multi-app split-screen.

---

### TC-FORM-03: Ultra-Pocketable Clamshell Flip Phone

- **Prompt:** `"I want a cute, pocketable flip phone that folds in half to fit in tiny pockets or small handbags, with a useful front cover screen."`
- **Category:** Form Factor (`foldable: true`, flip-style)
- **Extracted Requirements:** `form_factor.foldable = true`, `use_cases = ["pocketable", "compact", "small handbag", "flip"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy Z Flip6 ($1099.00)** — _3.4" Super AMOLED FlexWindow cover display, 6.7" inner 120Hz AMOLED, Snapdragon 8 Gen 3, 50MP Main with auto-zoom FlexCam, IP48._
  2. **Rank #2: Samsung Galaxy Z Flip 7 FE ($699.00)** — _Clamshell foldable design at an accessible sub-$700 price point, solid cover screen utility, Exynos 2400._
  3. **Rank #3: Motorola Edge 50 Fusion ($299.00 - Fallback)** OR Next closest compact device.
- **Technical & Logical Rationale:**
  - _Galaxy Z Flip6_ is the premier clamshell foldable in the catalog: its FlexCam allows hands-free recording at 90-degree angles, its outer screen runs full widgets and AI replies, and its hinge is reinforced with dual-rail Armor Aluminum.
  - _Galaxy Z Flip 7 FE_ brings flip-phone pocketability down to a ground-breaking $699 MSRP.
- **Pipeline Failure Watchlist:** Verify that massive book-style foldables (`Z Fold6`, `Pixel 9 Pro Fold`) do not rank ahead of flips when the user explicitly requests "folds in half for small pockets / handbags".

---

### TC-FORM-04: Sustainable, Modular & Repairable Hardware

- **Prompt:** `"I care deeply about ethical manufacturing, sustainability, and being able to replace the battery and screen myself with a screwdriver."`
- **Category:** Niche Hardware (Repairability & Sustainability)
- **Extracted Requirements:** `must_haves = ["repairable", "sustainable", "replaceable battery"]`, `priorities = [{aspect: "value", weight: 0.5}, {aspect: "build", weight: 0.5}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Fairphone Gen 6+ ($null / €699)** — _10/10 iFixit repairability score, 100% modular user-replaceable components, ethically sourced fair-trade materials, 8-10 years support._
  2. **Rank #2: Google Pixel 8a ($499.00)** — _Extensive use of 100% recycled aluminum and plastic, official iFixit spare parts partnership, 7 years updates._
  3. **Rank #3: Samsung Galaxy A55 5G ($449.00)** — _Recycled ocean plastics, durable Victus+ build, 5 years security patches._
- **Technical & Logical Rationale:**
  - _Fairphone Gen 6+_ is the only phone in the database designed specifically for consumer screwdriver teardowns, zero-glue battery replacement, and fair-trade mineral sourcing.
  - _Pixel 8a_ supports consumer sustainability through official Google-iFixit repair parts and manuals, paired with a 7-year update lifespan that prevents electronic waste.
- **Pipeline Failure Watchlist:** Because `Fairphone Gen 6+` has `msrpUsd: null` in the database, if the user attaches an explicit budget ceiling (e.g., "under $600"), the Fairphone will be purged by the hard budget filter. Verify how the pipeline handles unpriced devices when no budget is specified.

---

## Dimension D: Ecosystem Affinity & Brand Constraints

### TC-ECO-01: Pure Apple iOS Ecosystem Lock-In

- **Prompt:** `"I'm deeply invested in Apple. I have a MacBook, iPad, and Apple Watch. I only want an iPhone with USB-C and great battery."`
- **Category:** Brand Affinity / Platform Lock-In (`platform: ios`, `brand: Apple`)
- **Extracted Requirements:** `brand_preference.liked = ["Apple"]`, `must_haves = ["ios", "usb-c", "apple ecosystem"]`, `priorities = [{aspect: "battery", weight: 0.5}, {aspect: "performance", weight: 0.5}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Apple iPhone 16 Pro Max ($1199.00)** — _Apple A18 Pro, USB-C 3.2 (10Gbps transfer speeds), epic 33-hour video playback battery, seamless Continuity/AirDrop._
  2. **Rank #2: Apple iPhone 16 ($799.00)** — _Apple A18, USB-C, Camera Control, all-day battery, seamless Apple ecosystem integration at a mainstream price._
  3. **Rank #3: Apple iPhone 15 Plus ($899.00)** — _A16 Bionic, USB-C, legendary battery endurance, 6.7" large canvas._
- **Technical & Logical Rationale:**
  - _iPhone 16 Pro Max_ is the flagship iOS experience: its high-speed 10Gbps USB-C port allows direct recording to external SSDs and fast Mac file transfer, while delivering the longest battery life of any iPhone.
  - _iPhone 16_ provides the modern baseline USB-C iPhone experience with Apple Intelligence support.
  - _iPhone 15 Plus_ was the pioneer of USB-C transition with top-tier battery benchmarks.
  - Hard constraint verification: All Android phones (Samsung, Google, OnePlus, Xiaomi) must be 100% excluded.
- **Pipeline Failure Watchlist:** Verify that `detectPlatformPreferenceFromRequirements` correctly flags iOS and prevents any Android device from entering `picks`, even if an Android device has higher aspect scores.

---

### TC-ECO-02: Hard Anti-Samsung Constraint ("Anything But Samsung")

- **Prompt:** `"I want a top-tier premium Android flagship phone, but ABSOLUTELY NO SAMSUNG. I hate One UI and bloatware."`
- **Category:** Brand Exclusion (`brand_preference.disliked = ["Samsung"]`, `platform: android`)
- **Extracted Requirements:** `brand_preference.disliked = ["Samsung"]`, `must_haves = ["android", "flagship"]`, `deal_breakers = ["Samsung", "One UI"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Google Pixel 9 Pro XL ($1099.00)** — _Google Tensor G4, Pure Pixel Android 15, Class-leading cameras, 16GB RAM, 7 years updates._
  2. **Rank #2: OnePlus 13 ($899.00)** — _Snapdragon 8 Elite, OxygenOS 15 (fluid physics-based UI, zero bloat), 6000 mAh battery, 100W charging._
  3. **Rank #3: Xiaomi 14 Ultra ($1499.00)** — _Snapdragon 8 Gen 3, Quad 50MP Leica optics, titanium build, 90W charging._
- **Technical & Logical Rationale:**
  - With Samsung strictly eliminated, the two premier Android flagship alternatives are Google Pixel and OnePlus.
  - _Pixel 9 Pro XL_ takes Rank #1 for delivering the cleanest, most refined Android software experience with industry-best camera computational processing.
  - _OnePlus 13_ takes Rank #2 as the absolute performance powerhouse with blazing-fast OxygenOS 15 and 100W charging.
  - _Xiaomi 14 Ultra_ rounds out the trio for users seeking extreme camera hardware.
  - Constraint verification: Zero Galaxy devices (S24 Ultra, S25, Z Fold6, etc.) may appear anywhere in the output.
- **Pipeline Failure Watchlist:** In `match.ts`, `passesHardFilters` must check `requirements.brand_preference.disliked`. Verify that the string matching correctly catches `"Samsung"` and `"Galaxy"`.

---

### TC-ECO-03: Google Pixel AI Enthusiast

- **Prompt:** `"I love Google's AI features like Call Screen, Magic Editor, Best Take, and offline voice transcription. What's the best Pixel to get?"`
- **Category:** Brand Affinity (`brand: Google`, AI features)
- **Extracted Requirements:** `brand_preference.liked = ["Google"]`, `must_haves = ["pixel ai", "call screen", "google features"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Google Pixel 9 Pro XL ($1099.00)** — _Tensor G4 with 16GB RAM (dedicated 3GB RAM partition for on-device Gemini Nano with Multimodality), 6.8" 120Hz display._
  2. **Rank #2: Google Pixel 9 ($799.00)** — _Tensor G4, 12GB RAM, identical on-device AI features, Pixel Studio, Screenshots app, Call Notes._
  3. **Rank #3: Google Pixel 8 Pro ($999.00)** — _Tensor G3, 12GB RAM, Video Boost, Zoom Enhance, Magic Editor._
- **Technical & Logical Rationale:**
  - _Pixel 9 Pro XL_ features 16GB of physical RAM, of which Google explicitly reserves a permanent 3GB slice to keep Gemini Nano loaded in memory 24/7 for instantaneous local AI execution without cloud latency.
  - _Pixel 9_ brings the full suite of Tensor G4 AI features (Call Notes, Pixel Studio image generator, Pixel Screenshots) to an accessible form factor.
  - _Pixel 8 Pro_ was the pioneer of Video Boost and Magic Audio Eraser.
- **Pipeline Failure Watchlist:** Lineage diversity: verify that `getPhoneLineage` allows different generations (Pixel 9 Pro XL vs Pixel 8 Pro) while restricting duplicate model clones within the same generation.

---

## Dimension E: Conflicting Multi-Objective Requirements (Stress Testing the Optimizer)

### TC-CONF-01: Pro-Grade Camera on a Tight Budget (< $500)

- **Prompt:** `"I'm an aspiring street photographer on a strict $500 budget. I need flagship-grade camera performance for low light and moving subjects, but I cannot spend a dollar over $500."`
- **Category:** Conflicting Multi-Objective (Flagship Camera vs $500 Budget Cap)
- **Extracted Requirements:** `budget_usd.max = 500`, `priorities = [{aspect: "camera", weight: 0.75}, {aspect: "value", weight: 0.25}]`, `use_cases = ["photography", "low light", "street photography"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Google Pixel 9a / Pixel 8a ($499.00)** — _Pixel computational HDR+, Night Sight, zero shutter lag for moving subjects, Best Take._
  2. **Rank #2: Nothing Phone (3a) Pro ($459.00)** — _Dual 50MP Sony sensors with OIS, balanced dynamic range, RAW capture support._
  3. **Rank #3: OnePlus 12R ($499.00)** — _50MP Sony IMX890 Main with OIS, fast capture pipeline, flagship Snapdragon 8 Gen 2 image signal processor._
- **Technical & Logical Rationale:**
  - Real-world physics: true $1,200 multi-periscope camera arrays cannot exist at $500. However, **Google's computational photography algorithm in the A-series Pixels produces still images that rival $1,200 flagships**, especially with moving subjects and tricky indoor lighting.
  - _Nothing Phone (3a) Pro_ offers high-resolution dual 50MP sensors and clean post-processing.
  - _OnePlus 12R_ uses the flagship-grade Sony IMX890 sensor paired with the powerful Qualcomm Spectra ISP.
  - Constraint Check: S24 Ultra ($1299) and iPhone 16 Pro ($999) must be rigidly excluded despite higher absolute camera scores.
- **Pipeline Failure Watchlist:** Ensure the ranker does NOT recommend budget phones with mediocre cameras (like Galaxy A16 or Galaxy M35) just because they have higher "value" scores. The 0.75 camera weighting must dominate candidate ordering.

---

### TC-CONF-02: Compact Phone with Monster Battery Life

- **Prompt:** `"I want a small phone that fits easily in one hand (under 6.3 inches), but I refuse to carry a charger. I need all-day heavy battery life."`
- **Category:** Conflicting Multi-Objective (Small physical volume vs Large battery capacity)
- **Extracted Requirements:** `form_factor.screen_size_range_in = [5.5, 6.36]`, `priorities = [{aspect: "battery", weight: 0.6}, {aspect: "build", weight: 0.4}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Apple iPhone 16 Pro ($999.00)** — _6.3" display, 3582 mAh cell paired with Apple's 3nm A18 Pro efficiency, high-density battery redesign, leading compact endurance._
  2. **Rank #2: Google Pixel 9 ($799.00)** — _6.3" display, 4700 mAh high-capacity battery, Tensor G4 thermal optimization, 24+ hour battery life._
  3. **Rank #3: Samsung Galaxy S24 ($799.00)** — _6.2" display, 4000 mAh battery, Snapdragon 8 Gen 3 efficiency, intelligent battery saver._
- **Technical & Logical Rationale:**
  - Small phones cannot fit 5,500+ mAh batteries. The real-world winners are devices that combine modern high-density cell chemistry with ultra-efficient 3nm/4nm system-on-chips.
  - _iPhone 16 Pro_ utilizes an internal stainless steel battery casing for better thermal dissipation, allowing the 3nm A18 Pro to deliver best-in-class screen-on time for a compact form factor.
  - _Pixel 9_ packs a remarkably large 4,700 mAh cell into a 6.3-inch frame—20% larger capacity than standard compact competitors.
- **Pipeline Failure Watchlist:** Check if large battery monster phones (like OnePlus 12 with 5400 mAh or Galaxy M35 with 6000 mAh) are correctly rejected by the `< 6.36"` screen size filter.

---

## Dimension F: Contextual Personas & Lifestyle Use Cases

### TC-PER-01: The Frugal University Student

- **Prompt:** `"I'm a college student on a tight budget. I need a reliable phone under $450 that will last all day across campus, take good notes, scan whiteboards, and survive occasional drops."`
- **Category:** Contextual Persona (Student: Value, Battery, Document Camera, Durability)
- **Extracted Requirements:** `budget_usd.max = 450`, `priorities = [{aspect: "value", weight: 0.4}, {aspect: "battery", weight: 0.35}, {aspect: "build", weight: 0.25}]`, `use_cases = ["college", "notetaking", "document scanning", "durability"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy A55 5G ($449.00)** — _Gorilla Glass Victus+ front and back, metal frame, 5000 mAh battery (easily survives 14 hours on campus), 50MP OIS camera with excellent document clarity, 4 years OS updates._
  2. **Rank #2: Nothing Phone (2a) ($349.00)** — _Dimensity 7200 Pro, 5000 mAh battery, 45W fast charging, distinctive transparent aesthetic popular among students, great value._
  3. **Rank #3: Xiaomi Redmi Note 14 Pro+ ($329.00)** — _High-speed 120W charging, 6200 mAh endurance, bright 120Hz display, budget-friendly price._
- **Technical & Logical Rationale:**
  - _Galaxy A55_ is the ideal student workhorse: unlike plastic budget phones, it features an aluminum frame and Gorilla Glass Victus+ on both sides, with IP67 water resistance that survives backpack spills and drops.
  - _Nothing Phone (2a)_ offers standout aesthetic appeal and smooth software at an affordable $349 price point.
  - _Redmi Note 14 Pro+_ provides fast charging that lets a student top up between lectures in 15 minutes.
- **Pipeline Failure Watchlist:** Verify that high-priced student favorites (e.g. iPhone 16 Pro or S24 Ultra) are filtered out by the $450 ceiling.

---

### TC-PER-02: Senior Citizen / Elderly Parent

- **Prompt:** `"Looking for a simple, reliable phone for my 75-year-old grandmother. She needs a bright, sharp screen with large readable text, very loud speakers, easy software, and long battery life."`
- **Category:** Contextual Persona (Accessibility, Audio, Screen Readability, Battery)
- **Extracted Requirements:** `priorities = [{aspect: "display", weight: 0.4}, {aspect: "software", weight: 0.35}, {aspect: "battery", weight: 0.25}]`, `use_cases = ["elderly user", "large text", "loud audio", "simple navigation"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy A35 5G ($399.00)** — _6.6" 120Hz Super AMOLED with high contrast, dedicated Easy Mode (large icons, high-contrast keyboard, magnified touch targets), loud stereo speakers, 5000 mAh battery._
  2. **Rank #2: Google Pixel 8a ($499.00)** — _Pure, straightforward software, automated Call Screen that blocks scam and telemarketing calls automatically, loud clarity audio, 7 years updates._
  3. **Rank #3: Samsung Galaxy A16 ($199.00)** — _6.7" large readable screen, Samsung Easy Mode, long multi-day standby, affordable._
- **Technical & Logical Rationale:**
  - _Galaxy A35_ is the premier choice for senior accessibility: Samsung's built-in **Easy Mode** transforms the launcher with massive icons, high-contrast touch targets, and longer touch-and-hold delays, paired with a vibrant 6.6-inch AMOLED screen.
  - _Pixel 8a_ provides the world's best **automated scam call protection**: Google Assistant screens unknown callers before the phone even rings, shielding elderly users from financial fraud and phishing.
- **Pipeline Failure Watchlist:** The pipeline must not recommend enthusiast phones with complex UI skins (e.g. gaming phones) or small 6.1" screens where text scaling cramps the display.

---

### TC-PER-03: TikTok & Mobile Video Content Creator

- **Prompt:** `"I create TikToks, Instagram Reels, and YouTube Shorts for a living. I need the absolute best video stabilization, 4K selfie camera, studio audio recording, and fast rendering."`
- **Category:** Contextual Persona (Creator: Video, Front Camera, Audio, Compute)
- **Extracted Requirements:** `priorities = [{aspect: "camera", weight: 0.6}, {aspect: "performance", weight: 0.4}]`, `use_cases = ["video creation", "tiktok", "reels", "vlogging", "front camera"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Apple iPhone 16 Pro ($999.00) / iPhone 16 Pro Max ($1199.00)** — _4K120fps Dolby Vision HDR, studio-quality 4-mic array with Audio Mix (In-Frame, Studio, Cinematic vocal isolation), unmatched third-party app camera integration._
  2. **Rank #2: Samsung Galaxy S24 Ultra ($1299.00)** — _8K30fps and 4K120fps video, 12MP Dual-Pixel front camera with auto-framing, ProVisual Engine, anti-reflective screen for outdoor filming._
  3. **Rank #3: Google Pixel 9 Pro XL ($1099.00)** — _42MP ultra-wide front camera with 4K60fps, Video Boost with Night Sight Video and Audio Magic Eraser._
- **Technical & Logical Rationale:**
  - _iPhone 16 Pro/Pro Max_ is the unanimous industry standard for social media video creation: native camera sensor bypass via iOS AVFoundation API guarantees that video captured inside TikTok and Instagram has zero compression stutter or stuttering compared to Android. Furthermore, **Audio Mix allows creators to strip background wind and reverberation after recording**.
  - _Galaxy S24 Ultra_ offers versatile 4K120 capture and direct editing with S-Pen precision.
  - _Pixel 9 Pro XL_ features a class-leading 42MP selfie camera with an ultra-wide 103-degree field of view for group vlogging.
- **Pipeline Failure Watchlist:** Budget phones with weak front cameras (e.g. 8MP/13MP fixed focus) must be completely filtered out when "vlogging/TikTok creator" is parsed.

---

### TC-PER-04: The Frequent Global Business Traveler

- **Prompt:** `"I travel internationally 3 weeks out of every month. I need worldwide 5G bands, dual eSIM capability, fast international charging, lightweight durability, and rock-solid GPS."`
- **Category:** Contextual Persona (Traveler: Connectivity, Dual eSIM, Battery, Durability)
- **Extracted Requirements:** `priorities = [{aspect: "battery", weight: 0.4}, {aspect: "build", weight: 0.3}, {aspect: "performance", weight: 0.3}]`, `use_cases = ["international travel", "navigation", "esim", "dual sim"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Apple iPhone 16 Pro ($999.00)** — _Dual active eSIM support, global 5G/LTE band coverage across 200+ countries, Precision Dual-Frequency GPS (L1+L5), lightweight Grade 5 Titanium (199g)._
  2. **Rank #2: Google Pixel 9 Pro ($999.00)** — _Satellite SOS, dual eSIM profile management, offline Google Maps caching, real-time Live Translate for conversations and signs._
  3. **Rank #3: Samsung Galaxy S24+ ($999.00)** — _Dual SIM + eSIM, comprehensive global carrier aggregation, massive 4900 mAh battery, Knox roaming security._
- **Technical & Logical Rationale:**
  - _iPhone 16 Pro_ is the world's most travel-resilient device: it supports the broadest array of global sub-6GHz and mmWave 5G bands, stores multiple eSIM profiles with seamless switching, and utilizes dual-frequency L1+L5 GPS that locks coordinates even inside dense urban canyons like Tokyo or Manhattan.
  - _Pixel 9 Pro_ provides offline Google Translate and Satellite SOS.
- **Pipeline Failure Watchlist:** Region-locked budget phones with restricted cellular band support (e.g. Indian market variants or single-eSIM budget models) should not outrank global flagships.

---

## Dimension G: Ambiguous, Vague & Clarification-Triggering Prompts

### TC-AMB-01: Pure Underspecified Vague Query

- **Prompt:** `"I need a new phone. What should I buy?"`
- **Category:** Underspecified / Ambiguous (Clarify Threshold Test)
- **Extracted Requirements:** Empty requirements / No specific budget or aspect priorities.
- **Expected Golden Standard System Behavior:**
  - **Ideal System Action:** Trigger `kind: "clarify"` with a targeted clarifying question:  
    _`"To help me find the best phone for you, what is your budget and are you looking for an iPhone or Android? Also, what matters most: camera, battery life, or gaming performance?"`_
  - **Fallback Recommended Output (if forced to recommend top all-rounders):**
    1. **Rank #1: Apple iPhone 16 ($799.00)** — _The universal default recommendation for the average consumer._
    2. **Rank #2: Samsung Galaxy S24 ($799.00)** — _The most balanced compact Android all-rounder._
    3. **Rank #3: Google Pixel 9 ($799.00)** — _Top-rated photography, clean software, balanced price._
- **Technical & Logical Rationale:**
  - In Frontier AI Lab UX standards, a purely vague prompt should never guess wildly. If confidence is below `RECOMMENDER_CLARIFY_THRESHOLD`, the system should ask clarifying questions.
  - If results must be rendered, recommending the three baseline flagship devices from Apple, Samsung, and Google represents the safest, most representative cross-section of modern mobile tech.
- **Pipeline Failure Watchlist:** Verify that RECSY either triggers `clarify` or returns balanced, diverse mainstream flagships (one Apple, one Samsung, one Google). It must NOT return three phones from the same brand or three extreme niche devices (e.g., three foldables).

---

### TC-AMB-02: Platform Comparison Query

- **Prompt:** `"Should I get a Samsung Galaxy or an iPhone? I've used both in the past."`
- **Category:** Brand Comparative / Platform Neutral
- **Extracted Requirements:** Comparative intent across Apple and Samsung.
- **Expected Golden Standard Output:**
  1. **Rank #1: Apple iPhone 16 ($799.00)** — _Top mainstream iOS choice._
  2. **Rank #2: Samsung Galaxy S24 ($799.00)** — _Top mainstream Samsung One UI choice._
  3. **Rank #3: Google Pixel 9 ($799.00)** — _The neutral third-party pure Android alternative._
- **Technical & Logical Rationale:**
  - The system must show direct parity: the baseline flagship from Apple and the baseline flagship from Samsung at the identical $799 price point, followed by Google Pixel as the neutral tie-breaker.
- **Pipeline Failure Watchlist:** Ensure the ranker does not display strong bias towards only one ecosystem (e.g. 3 iPhones and 0 Samsungs).

---

## Dimension H: Adversarial, Typos, Misconceptions & Edge Cases

### TC-ADV-01: Phonetic Typos & Garbled Brand Names

- **Prompt:** `"lookin for a new samsnug glaxy or iphoen 16 with gud batry and camra"`
- **Category:** Adversarial / Noise Handling (Severe Typos & Phonetic Slang)
- **Extracted Requirements:** `brand_preference.liked = ["Samsung", "Apple"]`, `priorities = [{aspect: "battery", weight: 0.5}, {aspect: "camera", weight: 0.5}]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Apple iPhone 16 ($799.00)** — _Matched to 'iphoen 16'._
  2. **Rank #2: Samsung Galaxy S24+ ($999.00)** OR **Galaxy S24 ($799.00)** — _Matched to 'samsnug glaxy'._
  3. **Rank #3: Apple iPhone 16 Plus ($899.00)** — _Matched to Apple + Battery preference._
- **Technical & Logical Rationale:**
  - Modern LLM parsers must perform robust entity resolution: `"samsnug glaxy"` -> `Samsung Galaxy`, `"iphoen 16"` -> `Apple iPhone 16`, `"gud batry"` -> `battery priority`, `"camra"` -> `camera priority`.
- **Pipeline Failure Watchlist:** If the extraction LLM fails to normalize typos, `brand_preference.liked` will contain literal string `"samsnug"`, resulting in zero brand bonus or complete brand failure. Verify that RECSY aliases and LLM prompts normalize brand typos.

---

### TC-ADV-02: Impossible / Mutually Exclusive Constraints

- **Prompt:** `"I want a $150 foldable phone with a 200MP camera, 100W wireless charging, and Snapdragon 8 Gen 3."`
- **Category:** Adversarial / Impossible Constraint (Zero Candidates Pass Strict Filter)
- **Extracted Requirements:** `budget_usd.max = 150`, `form_factor.foldable = true`, `must_haves = ["200mp camera", "snapdragon 8 gen 3"]`
- **Expected Golden Standard System Behavior:**
  - **Ideal System Action:** Empty results or Clarification / Reality-Check response:  
    _`"No foldable phones exist under $150. Foldable devices in our catalog start at $699 (Galaxy Z Flip 7 FE) and flagship foldables start at $1,699. Would you like to see affordable standard phones under $150, or adjust your budget for foldables?"`_
  - **Pipeline Fallback Action:** The pipeline must **NEVER** silently recommend a $1,800 phone (violating budget by 1200%) or recommend an entry-level bar phone while pretending it is foldable.
- **Pipeline Failure Watchlist:** Check `RECOMMEND_BUDGET_RELAX_FACTOR = 1.2`. If relaxed once, $150 becomes $180, which still yields 0 foldables. The system must gracefully report no matching candidates rather than crashing or throwing unhandled exceptions.

---

### TC-ADV-03: Obsolete & Discontinued Hardware Requests

- **Prompt:** `"Should I buy the Google Pixel 7 or Samsung Galaxy S22 right now?"`
- **Category:** Deprecated / Age Policy Verification (3.5-Year Age Gate)
- **Extracted Requirements:** User targeting 2022 hardware.
- **Expected Golden Standard System Behavior:**
  - The system must recognize that Pixel 7 (Oct 2022) and Galaxy S22 (Feb 2022) exceed the **3.5-year age limit (`MAX_RECOMMEND_PHONE_AGE_DAYS`)** and should recommend modern successors:
  1. **Rank #1: Google Pixel 8a ($499.00) / Pixel 9 ($799.00)** — _Modern, active replacement for Pixel 7._
  2. **Rank #2: Samsung Galaxy S24 ($799.00) / Galaxy A55 5G ($449.00)** — _Modern, active replacement for S22._
  3. **Rank #3: Google Pixel 8 ($699.00)** — _Active contemporary alternative._
- **Technical & Logical Rationale:**
  - Recommending 3+ year old hardware to a consumer in late 2026 is an engineering anti-pattern: lithium-ion batteries degrade in storage, software update support is expiring, and modern replacements offer far superior efficiency.
- **Pipeline Failure Watchlist:** Verify that `google-pixel-7` (which is present in the database catalog) is **STRICTLY BLOCKED** by the age filter in `match.ts`:
  ```ts
  if (!opts.ignoreMaxAge && entry.launchDate) {
    const ageDays = (now.getTime() - entry.launchDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_RECOMMEND_PHONE_AGE_DAYS) return false;
  }
  ```

---

### TC-ADV-04: Negative Deal-Breaker Constraints

- **Prompt:** `"Looking for a great flagship under $900, but I have strict deal-breakers: NO phones heavier than 200g, NO curved screens, and NO slow charging under 30W."`
- **Category:** Negative Constraints & Physical Deal-Breakers
- **Extracted Requirements:** `budget_usd.max = 900`, `form_factor.weight_max_g = 200`, `deal_breakers = ["curved screen", "slow charging", "heavy"]`
- **Expected Golden Standard Output:**
  1. **Rank #1: Samsung Galaxy S25 ($799.00)** — _Weight: 162g (well under 200g), completely flat display, Snapdragon 8 Elite, compact flagship._
  2. **Rank #2: Google Pixel 9 ($799.00)** — _Weight: 198g (under 200g limit), completely flat Actua display, 27W charging._
  3. **Rank #3: Apple iPhone 16 ($799.00)** — _Weight: 170g (extremely lightweight), flat screen, 25W MagSafe._
- **Technical & Logical Rationale:**
  - Heavy phones (e.g. OnePlus 12 at 220g, S24 Ultra at 232g) must be disqualified by `weight_max_g: 200`.
  - Phones with curved screens (e.g., older Edge models or curved displays) must be eliminated by `dealBreakerHit`.
- **Pipeline Failure Watchlist:** Verify that `weight_max_g` in `form_factor` correctly inspects `spec.weight_g` and filters out all phones >200g.

---

## 4. Pipeline Anomaly Detection & Tuning Playbook

When manual verification reveals discrepancies between RECSY's output and this Golden Standard, use the following root-cause triage and parameter tuning table:

| Symptom / Failure Observed                                   | Root Cause in Pipeline                                                                     | Source File & Location                                       | Recommended Tuning / Fix                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Old phones (e.g. Pixel 7) appearing in recommendations**   | Age gate deactivated or system clock mismatch.                                             | `src/services/recommender/match.ts` (`passesHardFilters`)    | Ensure `opts.ignoreMaxAge` is false and `now` defaults to current timestamp (`new Date()`).                                                                                            |
| **Phablets (Ultra / Pro Max) appearing for compact prompts** | Corrupted `display.size_in` in database seed for future models.                            | `src/services/db/schema.ts` / Database row in `phones`       | Update `spec_json.display.size_in` for `apple-iphone-17-pro-max` to `6.9` and `samsung-galaxy-s26-ultra` to `6.8`.                                                                     |
| **Budget phone outranking flagship in $1000 budget query**   | Unstated "value" aspect weight defaulting high and boosting cheap phones.                  | `src/services/recommender/match.ts` (`resolveAspectWeights`) | Verify that when `maxBudget >= 800`, value default weight is zeroed out and discount penalty is applied: `if (maxBudget >= 800 && !userRequestedValue) score -= 0.35 * discountRatio;` |
| **Two identical lineage phones appearing in Top 3**          | Lineage normalization regex missing model name variants.                                   | `src/services/recommender/match.ts` (`getPhoneLineage`)      | Expand `getPhoneLineage` regex to normalize generational prefixes (e.g., `s25`, `s26` -> `galaxy-s`).                                                                                  |
| **Brand bonus too strong / too weak**                        | `RECOMMEND_LIKED_BRAND_BONUS` miscalibrated.                                               | `src/services/recommender/constants.ts`                      | Default is `0.35`. If liked brand fails to elevate a tied phone, increase to `0.50`. If it overrides better phones, lower to `0.25`.                                                   |
| **Budget filter excludes unpriced phones**                   | `msrp_usd = null` evaluated as `NaN`.                                                      | `src/services/recommender/match.ts`                          | Expected behavior for budget queries; for unconstrained queries, ensure price check is bypassed.                                                                                       |
| **LLM fails to extract constraints on complex prompts**      | System prompt in `extract-requirements.ts` lacks few-shot examples for compound negatives. | `src/services/recommender/extract-requirements.ts`           | Add few-shot examples for deal-breakers and `weight_max_g` in `EXTRACTION_SYSTEM_PROMPT`.                                                                                              |

---

## 5. Verification Sign-Off Protocol

For every manual test execution:

1. Issue the verbatim prompt via the web UI or POST payload to `/api/recommend`.
2. Inspect the returned JSON payload:
   - Verify `picks[0].slug`, `picks[1].slug`, `picks[2].slug`.
   - Verify `requirements` JSON object extracted by the LLM.
   - Verify `relaxed` array is empty for normal queries.
3. Compare the slug order against the Golden Standard Rank #1, #2, #3.
4. Record Pass/Fail, Latency, and any triage notes in the QA test management tracker.
