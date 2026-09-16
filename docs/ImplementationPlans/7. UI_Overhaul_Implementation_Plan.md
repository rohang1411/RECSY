# Detailed Implementation Plan: RECSY_v2 UI Overhaul ("Technical Editorial")

This document serves as the comprehensive engineering and design blueprint for the RECSY web UI overhaul. We will implement the "Technical Editorial" (Minimalist-Brutalist) aesthetic globally. This involves stripping out all soft UI paradigms (shadows, rounded corners) and replacing them with a strict 1px grid architecture, high-contrast dark mode palette, and "spec-sheet" typography.

## User Review Required

> [!IMPORTANT]
> **Strict 0px Border-Radius**: The "Technical Editorial" style mandates strictly sharp corners (`0px` border-radius) globally to maintain its brutalist/architectural feel. Please confirm if this strict `0px` radius should be applied uniformly across _all_ components (buttons, inputs, cards, dialogs).
> **Pure Dark Mode**: The provided designs operate on a pure dark theme (`#000000` / `#131313`). Should we remove the existing light mode toggle and lock the app to this dark theme to preserve the technical aesthetic?

## Open Questions

- **Typography Stack Selection**: The Stitch exports specify **Hanken Grotesk** (Headlines) and **JetBrains Mono** (Data/Metadata). Previous iterations used Be Vietnam Pro and Space Mono. This plan assumes we will install and use **Hanken Grotesk + JetBrains Mono**. Please confirm.
- **Orange Accent (`#FF4D00`) vs Pure B/W**: The primary Stitch design uses an orange accent for CTAs, but the exported B/W HTML uses pure white (`#ffffff`). Should we integrate the Digital Orange as the primary hover/active state color?

---

## 1. Global CSS & Tailwind Architecture

### 1.1 `tailwind.config.ts` Overrides

We will rewrite the Tailwind configuration to match the extracted design tokens precisely:

- **Colors**:
  - `background`: `#000000` (Pure Black)
  - `surface`: `#131313` (Deep Charcoal)
  - `surface-container`: `#1f1f1f`
  - `surface-container-high`: `#2a2a2a`
  - `primary`: `#ffffff` (Pure White)
  - `on-surface-variant`: `#c4c7c8` (Technical Gray)
  - `outline`: `#8e9192`
  - `outline-variant`: `#444748` (Used for the 1px grid lines)
- **Typography**:
  - `fontFamily.display`: `['Hanken Grotesk', 'sans-serif']`
  - `fontFamily.body`: `['Inter', 'sans-serif']`
  - `fontFamily.mono`: `['JetBrains Mono', 'monospace']`
- **Spacing Scale** (Custom for architectural layout):
  - `gutter`: `1px`
  - `stack-sm`: `8px`
  - `stack-md`: `24px`
  - `stack-lg`: `48px`
  - `section-gap`: `160px`
  - `grid-margin`: `4vw`
- **Border Radius**: Reset `DEFAULT`, `sm`, `md`, `lg` to `0px`.

### 1.2 `src/app/globals.css` Utilities

- **`.grid-bg`**: A fixed global background pattern utilizing `linear-gradient` to draw a subtle 20px/40px grid mesh representing a blueprint.
- **`.brutalist-border`**: Applies the standard 1px `outline-variant` border.
- **`.brutalist-hover`**: Standard interactive hover: changes border to pure white (`hover:border-primary`) and occasionally applies a `rgba(255,255,255,0.02)` fill with a fast `0.2s ease-out` transition.
- Remove all existing box-shadow and elevation variables.

---

## 2. Foundational UI Components

Currently, the project lacks a centralized UI component library (no `src/components/ui/` exists). We will build the following foundational components from scratch to enforce consistency:

### 2.1 `Button` Component

- **Style**: Transparent background, 1px solid border (`border-outline`), pure white text.
- **Typography**: `font-mono text-[12px] tracking-widest uppercase`.
- **Hover Micro-animation**: Instant or fast (0.15s) color inversion (White background, Black text: `hover:bg-primary hover:text-background`).

### 2.2 `TerminalInput` Component

- **Style**: Represents a command-line interface. Removes standard input box model.
- **Visuals**: Bottom border only (`border-b border-outline`).
- **Focus State**: `focus:outline-none focus:border-primary`.
- **Labels**: Rendered as a prefix (e.g., `<span class="text-primary">></span> SET.LOCATION = `) using mono typography.

### 2.3 `BrutalistCard` Component

- **Style**: Flat container defined strictly by 1px hairlines on all sides (`border border-outline-variant`).
- **Background**: Solid black or `bg-surface-container-lowest`.
- **Interactions**: No shadows. Hover states trigger border luminosity increases (`hover:border-primary`).

### 2.4 `StatusIndicator` Component

- **Visuals**: A small `2px` to `4px` square or rectangle (never a circle) placed next to text.
- **Animation**: Continuous `animate-pulse` to signify "Operational" or "Active" systems.

---

## 3. Complex Layout Components

### 3.1 `TopNavBar` (AppHeader Redesign)

- **Position**: `sticky top-0 z-50` full-width bar.
- **Layout**: Flex container with `border-b border-outline-variant`.
- **Content**:
  - Left: Massive `display-xl-mobile` logo (`RECSY_v2`).
  - Center: Mono-spaced links (`RESEARCH`, `ARCHIVE`, `LABS`).
  - Right: `COMMAND` tactile button.

### 3.2 `SideNavBar` (Desktop Engine Sidebar)

- **Position**: `hidden lg:flex flex-col h-screen sticky top-0 left-0 w-64`.
- **Layout**: `border-r border-outline-variant` with internal vertical sections divided by 1px bottom borders.
- **Content**: Includes the `SYSTEM_STATUS` display, navigation links (`Engine`, `Specs`, `Compare`), and `NEW SEARCH` action. Active links receive inverted colors (`bg-primary text-background`).

---

## 4. Page-by-Page Overhaul

### 4.1 Homepage (`src/app/page.tsx`)

- **Hero Section**: Implement the massive `display-xl` typography ("ASK WHAT MATTERS. WE'LL FIND THE PHONE.").
- **Command Intake**: Add the central, floating terminal input component to catch user queries immediately.
- **Tri-Card Flow**: Implement a 3-column brutalist card grid explaining the core flows: Recommend (`01`), Browse (`02`), Compare (`03`). These cards will feature the oversized number watermarks and mono-spaced `EXECUTE` footers.

### 4.2 Recommendation Engine (`src/app/recommend/page.tsx`)

- **Layout**: Introduce the `SideNavBar` on the left and the main canvas on the right.
- **Chat Interface**: Redesign as a "Process Log / Expanded Manifest". Queries look like terminal commands (`> SET.LOCATION = '...'`).
- **Result Output (Bento Grid)**: Implement the complex "Manifest" grid.
  - The "Top Pick" spans 8 columns, features an edge-to-edge grayscale image that colorizes on hover (`filter grayscale contrast-125 group-hover:grayscale-0`), and a strict 2x2 technical data grid at the bottom.
  - "Runner Ups" span 4 columns stacked, with rank badges in the top-left (`RANK_02`, `RANK_03`).

### 4.3 Phone Details Page (`src/app/p/[slug]/page.tsx`)

- **Header**: Massive Hanken Grotesk typography for the phone name alongside a strict data table for MSRP and Release Date.
- **Hero Image**: Edge-to-edge aspect video box with grayscale-to-color hover interaction and a technical `FIG 01.` caption overlay.
- **Technical Data Grid (`SpecGrid`)**:
  - Render specifications in a strict 3-column data table where rows have 1px bottom borders (`border-b border-outline-variant`).
  - Columns highlight the attribute (e.g., `SOC`) and the value (e.g., `A18 Pro`). Hovering a row triggers a subtle background highlight (`hover:bg-surface-container-high`).
- **Analysis Log (Q&A)**: Replace standard accordions or rounded cards with rigid `border-outline-variant` boxes featuring `QUERY_001` metadata tags.

### 4.4 Compare Matrix (`src/app/compare/page.tsx`)

- **Structure**: Rebuild the comparison table to use edge-to-edge 1px gridlines across the entire viewport. Eliminate card boundaries. It should look like a raw spreadsheet.

### 4.5 Browse / Catalog (`src/app/browse/page.tsx`)

- **Structure**: Drop the traditional "product card" look. The grid will behave like a manifest, with 1px gutters separating devices.

---

## 5. Execution Workflow & Verification

1. **Phase 1: Foundation Setup**: Update `tailwind.config.ts`, `globals.css`, and install required fonts (Hanken Grotesk, JetBrains Mono).
2. **Phase 2: Base UI Components**: Create the `src/components/ui/` directory and build `Button`, `TerminalInput`, `BrutalistCard`, `TopNavBar`, and `SideNavBar`.
3. **Phase 3: Core Page Integration**: Sequentially overhaul `page.tsx` (Home), `p/[slug]/page.tsx` (Phone Details), and `recommend/page.tsx` (Engine).
4. **Phase 4: Micro-Interactions**: Pass over all interactive elements to ensure the snappy, tactile `<0.2s` hover inversions are functioning.

### Manual Verification Targets:

- **Grid Alignment Check**: Ensure the `.grid-bg` and 1px `border-outline-variant` borders do not double-up (using proper border collapse or single-side borders).
- **Typography Check**: Ensure `JetBrains Mono` is exclusively used for technical specs, labels, and numbers, while `Hanken Grotesk` is reserved strictly for display headers.
- **Hover Checks**: Ensure grayscale images correctly transition to full color on hover.
