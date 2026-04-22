# Compare (Phase 7 MVP slice)

[ADR 0009](../adr/0009-phone-ux-images-compare.md)

## URL

- `/compare` — short help + **GET form** (two slug fields → submit). Works on a
  direct visit without hand-editing the query string.
- `/compare?a=<slug>&b=<slug>` — two **active** phones. Invalid or missing slugs
  show an error message and the form again (no generic 404).

## Recommender shortcut

After results, use **Compare the top 2** to open the first two picks. Edit the
URL to compare other slugs from [`/browse`](../browse/README.md).
