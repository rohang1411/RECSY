# Compare (Phase 7 MVP slice)

[ADR 0009](../adr/0009-phone-ux-images-compare.md) · [ADR 0010](../adr/0010-pwa-seo-analytics-compare.md) (picker UX)

## URL

- `/compare` — short help; **dropdown pickers** of active catalog phones + a
  second **GET form** (two slug text fields) for direct slug entry. Works on a
  direct visit without hand-editing the query string.
- `/compare?a=<slug>&b=<slug>` — two **active** phones. Invalid or missing slugs
  show an error message and the form again (no generic 404).

## Recommender shortcut

After results, use **Compare the top 2** to open the first two picks. Edit the
URL to compare other slugs from [`/browse`](../browse/README.md).
