---
name: Technical Editorial
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1b1b1b'
  surface-container: '#1f1f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e2e2e2'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e2e2e2'
  inverse-on-surface: '#303030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c8c6c5'
  on-secondary: '#313030'
  secondary-container: '#474746'
  on-secondary-container: '#b7b5b4'
  tertiary: '#ffffff'
  on-tertiary: '#303030'
  tertiary-container: '#e4e2e1'
  on-tertiary-container: '#656464'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e4e2e1'
  tertiary-fixed-dim: '#c8c6c6'
  on-tertiary-fixed: '#1b1c1c'
  on-tertiary-fixed-variant: '#474747'
  background: '#131313'
  on-background: '#e2e2e2'
  surface-variant: '#353535'
typography:
  display-xl:
    fontFamily: Hanken Grotesk
    fontSize: 120px
    fontWeight: '800'
    lineHeight: 110px
    letterSpacing: -0.04em
  display-xl-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 64px
    fontWeight: '800'
    lineHeight: 60px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  meta-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.05em
spacing:
  grid-margin: 4vw
  gutter: 1px
  section-gap: 160px
  stack-sm: 8px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The design system is a fusion of high-end editorial sophistication and raw technical precision. It is built for audiences who value clarity, intentionality, and a "spec-sheet" aesthetic. The brand personality is authoritative yet minimalist, evocative of a high-performance design studio or a technical white paper.

The visual style is a **Minimalist-Brutalist hybrid**. It relies on aggressive whitespace, oversized typography, and a strict adherence to a 1px structural grid. The emotional response is one of "calculated prestige"—it feels expensive, functional, and unapologetically digital.

## Colors

The palette is a high-contrast, "Absolute Dark" execution.

- **Core Surface:** Pure Black (#000000) provides the infinite depth required for large-scale imagery and interactive grids.
- **Luminance:** High-luminance off-whites and pure whites are reserved for typography to ensure maximum readability and impact.
- **Technical Grays:** Used strictly for borders, grid lines, and secondary metadata to maintain the "spec-sheet" feel without distracting from primary content.

## Typography

The typography strategy uses scale as a structural element.

- **Headlines:** Set in Hanken Grotesk, headlines should be oversized and tight-leading to create "blocks" of text that feel like architectural elements.
- **Body:** Inter provides a neutral, utilitarian reading experience that doesn't compete with the headlines.
- **Technical Metadata:** JetBrains Mono is used for labels, captions, and technical data points, reinforcing the tactical, engineering-led narrative.

## Layout & Spacing

The layout follows a **Fixed-Grid Spec Model**. Every element is aligned to a visible or invisible 12-column grid.

- **Grids:** Use 1px technical gray lines to define sections, evocative of blueprints or CAD software.
- **Whitespace:** Emphasize "Generous Intentionality." Large gaps (section-gap) should separate core narrative blocks to allow the "Display-XL" typography to breathe.
- **Mobile:** Transition to a 4-column grid. Remove vertical grid lines but maintain the 1px horizontal dividers between content blocks to preserve the technical structure.

## Elevation & Depth

Depth is created through **Flat Layering** rather than shadows.

- **Tonal Tiers:** Use pure black (#000000) for the base, and slightly lighter grays (#0A0A0A) for interactive containers or cards.
- **Borders:** All containers are defined by 1px solid borders in a mid-tone gray.
- **Interactive Grids:** Use background patterns of dots or thin lines that "light up" on hover, creating a sense of a digital, interactive surface without using skeuomorphic depth.

## Shapes

The shape language is strictly **Sharp (0px)**. Any rounding is avoided to maintain the brutalist, technical aesthetic. This applies to buttons, input fields, image containers, and cards. The only exception is for circular icon buttons, which must be perfectly geometric circles.

## Components

- **Buttons:** Rectangular, 1px border, no fill. On hover, invert the colors (white background, black text). Use the `meta-mono` style for button text.
- **Interactive Grids:** Content blocks should be housed in 1px bordered boxes. Use a "hover-active" state where the border color brightens to pure white.
- **Input Fields:** Bottom-border only (1px). The label should sit above the line in the `meta-mono` style.
- **Lists:** Data lists should look like a spreadsheet or manifest, with 1px dividers between every row and columns aligned to the global grid.
- **Large Scale Imagery:** Images should span multiple columns, often edge-to-edge within their grid container, using a slight "grain" filter to match the technical texture of the UI.
