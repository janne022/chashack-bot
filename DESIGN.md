---
name: ChasHack Admin
description: The organizer console for running a ChaS hackathon weekend, in the "Honeycomb playtech" world.
colors:
  comb-sky: "#55bbda"
  deep-comb-sky: "#2e8fb3"
  signal-coral: "#f08080"
  moss-teal: "#4e8780"
  orchid-lilac: "#c77fc7"
  powder-pink: "#f4a7b9"
  boundary-amber: "#f0b429"
  alert-red: "#ef4444"
  night-comb: "#0a0c10"
  comb-cell: "#11141b"
  raised-cell: "#191e28"
  cell-edge: "#262c3a"
  moonlight-ink: "#eef2f7"
  slate-mist: "#8e97ab"
  warm-paper: "#f7f5f0"
  paper-card: "#fffdf9"
  paper-shade: "#f0ede6"
  paper-line: "#ded9cf"
  graphite: "#1a1d24"
  pencil-grey: "#6b7280"
typography:
  display:
    fontFamily: "Nunito, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  caption:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
  micro:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    letterSpacing: "0.02em"
rounded:
  sm: "6px"
  md: "8px"
  hex: "10px"
  xl: "14px"
  badge: "26px"
spacing:
  cell: "4px"
  compact: "8px"
  card-sm: "12px"
  card: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.comb-sky}"
    textColor: "{colors.night-comb}"
    typography: "{typography.body}"
    rounded: "{rounded.hex}"
    height: "28px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.comb-sky}"
    textColor: "{colors.night-comb}"
    rounded: "{rounded.hex}"
  button-secondary:
    backgroundColor: "{colors.raised-cell}"
    textColor: "{colors.moonlight-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.hex}"
    height: "28px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.night-comb}"
    textColor: "{colors.moonlight-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.hex}"
    height: "28px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.alert-red}"
    typography: "{typography.body}"
    rounded: "{rounded.hex}"
    height: "28px"
    padding: "0 10px"
  badge-success:
    backgroundColor: "{colors.moss-teal}"
    textColor: "{colors.moss-teal}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    height: "20px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.comb-cell}"
    textColor: "{colors.moonlight-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.comb-cell}"
    textColor: "{colors.moonlight-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.hex}"
    height: "32px"
    padding: "0 10px"
---

# Design System: ChasHack Admin

## Overview

**Creative North Star: "Honeycomb playtech"**

The console is a comb of cells: each team is a hexagon in a hive, and the
organizer's job is to keep the hive organized while the weekend runs. The world
is near-black comb at night and warm paper by day — the same family, inverted, so
an organizer who works the event at 3am and reviews it the next morning never
feels like they changed tools. Sky blue leads everything interactive; coral,
teal, lilac and amber carry meaning rather than decoration.

Density is operational: this is an app an organizer drives under time pressure,
so the layout is scannable grids of compact cards, 28px control heights, and
status made visible as colour-coded pills rather than prose. Personality lives in
the flex — hexagon-clipped badges, a faint honeycomb weave behind hero surfaces,
chunky press-down feedback on buttons, pop-in for anything that appears — not in
illustration or ornament. Playful where it costs nothing, exact where an action
has consequences.

The system is deliberately dual-theme and deliberately one world: both themes
share the same token names, the same radius language and the same accent
hierarchy, so components never need theme-specific branches. New screens should
feel like a new cell in an existing comb — same edges, same light, no new
material.

**Key Characteristics:**
- Near-black comb (dark, default) and warm paper (light) as one inverted family.
- Sky-blue accent that marks what is interactive or live — and little else.
- Flat surfaces with hairline rings today; soft ambient shadow is the confirmed
  direction for anything that lifts (see Elevation & Depth).
- Hexagon motifs as the recurring signature: clipped badges, weave backgrounds,
  cell-shaped hero panels.
- Compact, tactile controls (28px default height, press-down feedback) over airy
  marketing spacing.
- Semantic colour trio (`ok` / `warn` / `danger`) reserved for state, never mood.

## Colors

A near-monochrome comb lit by one sky-blue accent, with a small semantic set
(coral, teal, lilac, amber) borrowed from the ChasHack marks.

### Primary
- **Comb Sky** (`#55bbda`): the interactive accent in dark mode — primary
  buttons, focus rings, active nav, link text, the live-event pulse, accent-soft
  washes behind selected rows. In light mode the role moves to **Deep Comb Sky**
  (`#2e8fb3`) so contrast holds on paper.
- **Deep Comb Sky** (`#2e8fb3`): light-mode accent, and the darker end of sky
  gradients on hero and login surfaces.

### Secondary
- **Signal Coral** (`#f08080`): event-ending / destructive-adjacent emphasis and
  chart series 2; paired with `danger` but warmer and less alarming.
- **Moss Teal** (`#4e8780`): the "good" state — success badges, locked teams,
  completion. Light mode darkens it to `#2f7a6d`.

### Tertiary
- **Orchid Lilac** (`#c77fc7`) and **Powder Pink** (`#f4a7b9`): team-identity and
  chart accents (series 4/5). They mark *variety* — different teams, different
  series — and never carry state.

### Neutral
- **Night Comb** (`#0a0c10`): app background in dark mode. The page floor.
- **Comb Cell** (`#11141b`): card and sidebar surface — one step up from the floor.
- **Raised Cell** (`#191e28`): nested/secondary surface (inputs, secondary
  buttons, muted blocks, popovers) — the third tonal step.
- **Cell Edge** (`#262c3a`): borders and dividers in dark mode; also the input
  stroke.
- **Moonlight Ink** (`#eef2f7`): primary text in dark mode.
- **Slate Mist** (`#8e97ab`): secondary text, hints, labels, "not set" values.
- **Warm Paper** (`#f7f5f0`) / **Paper Card** (`#fffdf9`) / **Paper Shade**
  (`#f0ede6`) / **Paper Line** (`#ded9cf`): the light-mode equivalents of floor,
  cell, raised cell and edge.
- **Graphite** (`#1a1d24`) / **Pencil Grey** (`#6b7280`): light-mode primary and
  secondary text.
- **Boundary Amber** (`#f0b429`) and **Alert Red** (`#ef4444`): warning and
  danger state (draft badge, destructive buttons, validation), on top of the
  semantic trio above.

### Named Rules
**The Sky Leads Rule.** Sky is reserved for what the organizer can act on or what
is currently live. If a surface is neither interactive nor live, it does not get
`accent` — it gets a neutral step of the comb. Its scarcity is what makes the
live pulse readable across the room.

**The Inverted Family Rule.** Light mode is not a second palette; it is the same
token names with paper values. Never introduce a token that only exists in one
theme, and never hard-code a hex in a component — reference the token so both
themes stay true.

**The Semantic Trio Rule.** `ok` / `warn` / `danger` mean state and nothing else.
Coral, lilac and pink are identity colours (teams, charts) and must never be used
where a state colour is expected.

## Typography

**Display Font:** Nunito (with `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Geist Variable (with `ui-sans-serif, system-ui, sans-serif`)

**Character:** Geist keeps the operational text — tables, labels, dense card
bodies — narrow and unshowy at 14px, while Nunito at 800 carries page titles and
card titles with a rounded, game-y weight that matches the hex motifs. The pairing
is deliberate: the numbers stay sober, the headings stay friendly.

### Hierarchy
- **Display** (Nunito 800, `text-2xl` = 24px, tracking `-0.02em`): page titles
  (`Events`, `Templates`) and card titles. Always uppercase-tracking for section
  eyebrows, never for the page title itself.
- **Headline** (Geist 500, `text-base`/16px, 1.375): card titles in dense lists,
  dialog titles, stat values.
- **Body** (Geist 400, `text-sm`/14px, 1.5): the default for everything
  operational — descriptions, list rows, hints at 12px in `Slate Mist`.
- **Label** (Geist 500, `text-xs`/12px, `uppercase tracking-wide` for section
  eyebrows): field labels, badges, status pills, and the small caps section
  headers that separate groups inside a card.
- **Caption** (Geist 500, 11px): the inline hints and field labels *inside* dense
  action editors (schedule-block cards, assignment briefs), where a 12px label
  would push the row over the control it describes.
- **Micro** (Geist 600, 10px, `+0.02em`): badge counts, the `Zap N` action
  counter, day pills and other metadata attached to a control. Never primary copy.

### Named Rules
**The Eyebrow Rule.** Section separation inside a page is expressed as an
uppercase 12px eyebrow in `muted-foreground` with a count badge — never as a
second font family, a rule line, or a heavier weight.

**The Micro Budget Rule.** 10-11px exists only for metadata attached to a control
(counts, chips, inline hints). Anything a reader must scan as prose — a
description, an empty state, a warning — is 12px or larger, and no screen uses
more than two micro sizes at once.

**The One Display Rule.** Nunito is for the top of a surface: page title and card
title. Body copy, labels, controls and data never use the display face.

## Layout

A fixed left sidebar (240px, hidden below `lg`) plus a fluid content column with
a 16-24px gutters, and — on mobile — a sticky top bar with the brand mark and a
fixed bottom tab bar. Pages follow one rhythm: header (title + one-line
subtitle + primary action on the right), then tabs when a surface has modes,
then content sections separated by eyebrows.

Content is grid-first: cards flow at one column on narrow screens, `md:grid-cols-2`
for list-style cards, `xl:grid-cols-3` for the event grid; detail surfaces use a
two-column split (`md:grid-cols-[auto_1fr_auto]`) for time + title + kind. Dialogs
are centred overlays on a 70% black scrim: creation modals are wide
(`max-w-[min(48rem,95vw)]`) with internal scroll, edit dialogs are `max-w-xl`,
confirmations are `max-w-md`.

Spacing runs on Tailwind's 4px step, but the documented rhythm is: `16px` inside
cards (`--card-spacing`, `12px` for `data-size="sm"` cards), `8px` between
related rows, `12px` between cards in a grid, `24px` between page sections. Never
pad a card with `24px` — that starts to read as marketing air.

Vertical rhythm inside a card is consistent: eyebrow → content → actions, with
actions last and the destructive action visually separated (right-aligned or in a
`danger` tint).

## Elevation & Depth

The incumbent implementation is **flat with hairline edges**: cards are one tonal
step above the floor and separated by a `1px` ring at 10% foreground opacity;
depth is communicated by the tonal ladder (`background` → `surface` → `surface-2`)
and by borders, not by shadow. The confirmed direction for surfaces that genuinely
lift — dialogs, popovers, the sticky action bar, hover-lifted cards — is **soft
ambient shadow** rather than heavier borders, so the comb keeps its flat cells at
rest and gains air only where something is floating above them.

### Shadow Vocabulary
- **ambient-low** (`box-shadow: 0 4px 24px rgba(0, 0, 0, 0.24)`): dialogs,
  popovers/selects, menus — anything over a scrim or detached from the grid.
- **ambient-high** (`box-shadow: 0 12px 40px rgba(0, 0, 0, 0.32)`): the sticky
  workspace action bar and full-screen overlays that need to read as above the
  card they sit in.
- **lift-hover** (`box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18)`): interactive cards
  on hover, paired with the existing border-colour shift.
- Light mode uses the same geometry with warm, low-opacity ink:
  `rgba(26, 29, 36, 0.12)` / `rgba(26, 29, 36, 0.18)`.

**Implementation.** The three steps are tokens in `index.css` (`--shadow-lift-hover`,
`--shadow-ambient-low`, `--shadow-ambient-high`), retuned for light mode in
`:root[data-theme='light']` (lift `rgba(26, 29, 36, 0.10)`). Interactive cards opt
in with the `.card-interactive` utility rather than repeating a shadow chain per
component, and that utility is inert under `prefers-reduced-motion`.

### Named Rules
**The Flat-At-Rest Rule.** Cells are flat when they are part of the grid. Shadow
is a state or a modality: floating (dialog, popover, sticky bar) or hovered — not
a default decoration on every card.

**The One Ring Rule.** Elevation never adds borders. A surface either has its
hairline ring (at rest) or an ambient shadow (lifting) — never both, never a
thicker border to fake height.

## Shapes

The base radius is the **hex radius, 10px** (`--radius-hex`), inherited by cards
(14px), buttons and inputs (10px, capped by size so small buttons don't look like
pills), popovers and dialogs (14-18px). Badges and status chips are near-pills
(26px) because they are capsules, not containers.

The signature geometry is the hexagon: `clip-path` hexes for count/status badges
(`.hex-badge`), a hexagon-quiffed card silhouette for hero panels (`.hex-card`),
and a faint honeycomb weave (`.hex-bg`, 7-8% stroke opacity) behind login and
empty-state surfaces. Hex motifs are corners-and-caps: they appear on small
elements and hero backdrops, never as the shape of a working surface — a form
field or a table never gets clipped.

Form language: soft-cornered rectangles with hairline edges, generous internal
padding relative to their height, and no inner shadows. Circular elements are
reserved for avatars, the live pulse and icon-only buttons.

## Components

### Buttons
- **Shape:** hex radius (10px), height 28px for the default `sm` console size,
  24px for inline `xs` actions inside cards, 32px for primary page actions.
- **Primary:** `accent` (Comb Sky) fill with `background`-coloured text; hover at
  80% accent; used once per surface — the one action you want taken.
- **Hover / Focus:** colour transitions on hover, `focus-visible` ring at 3px in
  `ring/50`; press feedback is a 1px downward translate (`active:translate-y-px`).
- **Secondary:** `surface-2` fill, `foreground` text — the workhorse for in-card
  actions. **Outline:** transparent fill, `border` stroke — for parallel choices.
  **Ghost:** no fill, `muted-foreground` text — for tertiary/icon actions and
  destructive confirms placed away from the main flow. **Destructive:** `danger`
  at 10% tint with `danger` text (never a solid red slab).
- Icons are lucide at 14-16px, always inside the label gap (`gap-1.5`), never
  replacing a label on a primary action.

### Chips
- **Style:** capsule (26px radius), 20px tall, 12px `font-medium` label, tinted
  background at 15% of the semantic colour (`bg-ok/15 text-ok`,
  `bg-warn/15 text-warn`) or `surface-2` for neutral.
- **State:** the status pill is the canonical chip — draft (warning), live
  (success), ended (neutral). Selected filters use `accent` fill with
  `background` text. A chip never carries an icon *and* a long label; count
  badges are the exception (hex-clipped, number only).

### Cards / Containers
- **Corner Style:** 14px radius (`rounded-xl`), clipped corners only for hero
  panels.
- **Background:** `card` (Comb Cell) on the `background` floor — exactly one step.
- **Shadow Strategy:** flat at rest (hairline ring at 10% foreground); ambient
  shadow only when lifting/hovered (see Elevation).
- **Border:** `1px` ring at 10% foreground; a semantic tint (`accent/40` for the
  managed event, `danger/30` for destructive panels) when the card carries state.
- **Internal Padding:** 16px (`--card-spacing`), 12px for compact cards; the
  header/body/footer stack keeps that gutter on all three.

### Inputs / Fields
- **Style:** 32px tall, 10px radius, transparent fill in dark (`input/30`) with a
  `border` stroke, 10px horizontal padding, 14px text.
- **Focus:** `ring` border shift plus a 3px `ring/50` glow — the same focus
  language as buttons and tabs.
- **Error / Disabled:** `danger` border + `danger/20` ring for validation;
  disabled drops to 50% opacity with a muted fill. Labels sit above the field in
  12px `muted-foreground`, never as placeholder-only.
- Selects, date pickers and popovers reuse the input shell; picker popovers open
  as popper-positioned panels with the ambient-low shadow.

### Cards
- **Interaction model (hybrid).** The whole card is a click target for its
  *primary* action — event card → open workspace, template card → edit — because
  a card-sized target beats a 28px button for pointer users and reads as the
  obvious affordance. The explicit button stays for keyboard, screen readers and
  discoverability. Secondary and destructive controls inside a card keep their own
  buttons and must `stopPropagation()`, so Delete can never open the editor behind
  its own confirmation.
- **Hover:** `.card-interactive` — flat at rest, rises 2px on hover with the
  lift-hover shadow and an accent border shift, 180ms ease-out. A card that is not
  interactive stays flat and does not lift.
- **Motion budget:** hover/press feedback is CSS (no re-render). framer-motion is
  reserved for entrance and view transitions — card stagger 300ms in 40ms steps
  (capped at six), page transition 200ms — and everything honours the OS setting
  through `MotionConfig reducedMotion="user"`.

### Navigation
- **Style:** 240px sidebar, quiet by default: label in `muted-foreground` at 14px
  with a 16px lucide icon; the active item gets `accent` text on an `accent-soft`
  wash with the icon in `accent`.
- **States:** hover lifts text to `foreground`; active adds the wash and a
  left-edge accent; counts ride as hex-clipped badges at the row end.
- **Mobile:** the sidebar collapses into a sticky top bar (brand mark + event
  switcher) and a fixed bottom bar of five icon+label tabs; the active tab is
  accent-coloured. Sticky surfaces inside pages must offset below the mobile top
  bar (`top-14`) so the two never overlap.

### Signature: Hex Motif
The honeycomb weave (`.hex-bg`) is the brand moment: it appears behind login,
empty states and hero panels at 7-8% stroke opacity, in sky on dark and deep sky
on light. `.hex-badge` clips small count/status elements, and `.hex-card` gives
hero panels their quenched corners. The motif is never applied to working
surfaces (forms, tables, schedule rows) and never competes with content: if you
can read the hexagons before the content, the opacity is wrong.

## Do's and Don'ts

### Do:
- **Do** reference tokens (`--color-accent`, `bg-surface-2`, `text-muted-foreground`)
  so dark and light stay true to each other.
- **Do** keep control heights compact: 28px buttons in console chrome, 32px for
  the primary page action, 32px inputs, 20px chips.
- **Do** give every interactive element the same focus treatment — 3px ring at
  50% accent, `focus-visible` only.
- **Do** express state with the semantic trio and tinted chips, and pair colour
  with a label (`live`, `locked`, `Not scheduled`) so state survives a glance and
  a colour-blind reading.
- **Do** keep press feedback tactile: `active:translate-y-px` on buttons and tabs.
- **Do** make a whole card the target for its primary action and keep an explicit
  button beside it for keyboard and assistive tech — hybrid beats either alone.
- **Do** place the destructive action away from the primary flow (ghost/danger
  tint, right-aligned, behind a confirm dialog with the consequence stated in
  hours).

### Don't:
- **Don't** add drop shadows to cards at rest — the comb is flat; lift only for
  modality or hover.
- **Don't** give a hover lift to a card that does nothing when clicked — a lift
  promises an action; leave static surfaces flat.
- **Don't** use the accent colour for decoration; if it isn't actionable or live,
  it's neutral.
- **Don't** introduce a new radius, a new surface step, or a second font to solve
  a one-screen problem.
- **Don't** clip working surfaces into hexagons or apply the weave behind content
  you have to read carefully.
- **Don't** ship a screen in one theme only, or hard-code a hex that exists as a
  token.
- **Don't** let colour alone carry meaning: coral/lilac/pink are identity, the
  trio is state, and every chip says what it means.
