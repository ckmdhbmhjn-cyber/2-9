# Stonebrook Design System

This document defines the standardized design language for the Stonebrook theme. It is grounded in the homepage visual system and the sealed/acrylic PDP polish, and applies across all key pages (Home, Product, Collection, About, FAQ, Contact, Shipping, and all policy pages).

## Principles
- Trust + collector-grade polish
- Premium but warm (ink + gold + parchment)
- Clear hierarchy for scanning (especially FAQ and policies)

## Tokens
Source of truth: `/Users/bschaffer/stonebrook/2-9-v2/2-9/assets/sb-global.css`

### Color Roles
- Ink: `--sb-ink`
- Gold (primary accent): `--sb-gold`, `--sb-gold-hover`, `--sb-gold-active`, `--sb-gold-focus`
- Parchment (soft background): `--sb-parchment`
- Card surface: `--sb-card`
- Lines/borders: `--sb-line`
- Shadows: `--sb-shadow-soft`, `--sb-shadow-strong`
- Success/Shipping: use `--sb-emerald`

### Type Scale
- H1: `--sb-h1-size-*`, `--sb-h1-lh-*`, `--sb-h1-ls`
- H2: `--sb-h2-size-*`, `--sb-h2-lh-*`, `--sb-h2-ls`
- Body: `--sb-body-size`, `--sb-body-lh`
- Small: `--sb-small-size`, `--sb-small-lh`, `--sb-small-ls`

### Spacing
- Section rhythm: `--sb-section-pad-*`, `--sb-section-gap-*`
- Hero spacing: `--sb-hero-pad-*`, `--sb-hero-gap-*`

### Radius + Shadow
- Default card radius: `--sb-radius`
- Card shadow: `--sb-shadow-soft` by default

## Layout System
- Page widths: `page-width`, `page-width--narrow`, `sb-max-900`, `sb-max-980`, `sb-max-1100`
- Section rhythm: use `sb-page-section` to enforce consistent top/bottom spacing
- Card system: `sb-card` + `sb-card--pad-*` + `sb-card--border-muted` + `sb-card--shadow-soft`

## Core Components
- Hero: `stonebrook-page-hero` with `hero_variant=policy` for policy pages; use `sb-policy-hero` class
- Section headings: use `sb-h2` where applicable; align with `section-header` styles
- CTA buttons:
  - Primary: `btn` + `sb-btn-gold` (gold)
  - Secondary: `btn btn--secondary`
  - Links: `sb-link-underline` or `sb-link-clean`
- Pills/Chips: FAQ hero pill styles are the reference
- Forms: `sb-form-fields`, `sb-btn-gold`, `sb-btn-rounded`, `sb-label-ink`
- Info blocks: `text-with-icons` with `sb-icon-gold`
- Accordion/FAQ: carded panels + consistent spacing

## Page Patterns
### Home
- Homepage is the visual benchmark. Prioritize clean card stacks, strong headlines, and trusted seller proof blocks.

### Product
- Sealed/Acrylic PDPs are the polished standard:
  - Carded meta area
  - Consistent sales-point pills
  - Sticky ATC on mobile
  - Sealed accordion group styling

### Collection
- Collection header should feel premium and consistent with PDP polish.
- Section headers align to homepage sizing and spacing.

### About
- Dark hero variant + stacked card blocks.

### FAQ
- Hero with chips + carded accordion sections.

### Contact
- Intro card + form card (same card system).

### Shipping / Policy Pages
- Uniform policy hero + single body card pattern.
- Keep high readability and clean hierarchy.

### Cart / Search
- Use consistent headings and card surfaces where possible.

## Do / Don’t
- Do use class-based hooks (`sb-*`) and global tokens.
- Do avoid template-ID-specific selectors.
- Do avoid inline CSS in sections if a shared class can solve it.
- Do keep fonts consistent; only standardize sizes/spacing.

## Implementation Notes
- Prefer updating `sb-global.css` and section classes over writing new inline styles.
- Any template-specific overrides should be moved to reusable classes when feasible.
