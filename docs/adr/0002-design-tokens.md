# ADR 0002 — Design tokens & theming

Date: 2026-04-19
Status: Accepted

## Context

RECSY has a visual identity (orange primary + cyan accent from the 2020
incarnation). v2 must deliver:

1. Dark mode by default, seamless light-mode support.
2. WCAG AA contrast across both modes.
3. A theme primitive feature code can consume without knowing whether the
   current theme is dark or light.
4. Zero flash-of-unstyled-content (FOUC) on first paint.

## Decision

### 1. OKLCH everywhere

All colors are authored in OKLCH (lightness, chroma, hue). This gives:

- **Perceptual uniformity** — swapping dark/light by changing `L` keeps the
  same hue. Hex equivalents drift.
- **Predictable contrast** — we can target WCAG AA by nudging `L` without
  re-mixing RGB channels.
- **Native Tailwind v4 support** — OKLCH is a first-class color in v4.

### 2. Semantic tokens only

Feature code references `--primary`, `--muted-foreground`, `--accent` — never
`--orange-500`. This means:

- Swapping the palette is a one-file change (`src/styles/theme.css`).
- Light-mode colors can legitimately differ in chroma/lightness from their
  dark counterparts without breaking call sites.

The canonical token set (mirrored in `globals.css` `@theme inline`):

```
background / foreground
card        / card-foreground
popover     / popover-foreground
primary     / primary-foreground
secondary   / secondary-foreground
muted       / muted-foreground
accent      / accent-foreground
destructive / destructive-foreground
success     / success-foreground
warning     / warning-foreground
border · input · ring
chart-1 … chart-5
```

### 3. Brand colors

| Token       | Dark mode              | Light mode             | Notes                                             |
| ----------- | ---------------------- | ---------------------- | ------------------------------------------------- |
| `--primary` | `oklch(0.78 0.17 62)`  | `oklch(0.70 0.19 55)`  | Orange, tuned per-mode for AA contrast.           |
| `--accent`  | `oklch(0.80 0.14 195)` | `oklch(0.65 0.14 195)` | Cyan/turquoise reference to the original project. |

### 4. Theme control

- `next-themes` toggles `data-theme="dark"` or `data-theme="light"` on
  `<html>`.
- `defaultTheme="dark"`, `enableSystem`, `disableTransitionOnChange`.
- `html:not([data-theme]) { color-scheme: dark }` prevents the flash of
  light-mode scrollbars/inputs during the pre-hydration window.

### 5. Accessibility

- `:focus-visible` shows a 2px ring in `--ring`.
- `prefers-reduced-motion: reduce` collapses all animations in `globals.css`.
- `color-scheme` is explicitly set per mode so native form controls adopt the
  right palette.

## Consequences

- Adding a new accent or rebranding is a few lines.
- Light mode "just works" without per-component overrides.

* Contributors must resist the urge to hard-code hex values. The ESLint config
  does not yet enforce this; the code review checklist does.

## Alternatives considered

- **`class="dark"` toggle (shadcn default)** — works but prevents us from
  expressing a distinct `data-theme="light"` variant in CSS cleanly.
- **HSL tokens** — widely used but perceptually non-uniform; we'd need
  per-mode colors anyway, so OKLCH's extra expressiveness is free.
