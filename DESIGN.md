---
name: gtd
description:
  The web UI where one developer answers gates and moves AI-agent worktrees on,
  mostly from a phone.
colors:
  background: "#f4f4f1"
  foreground: "#151a1d"
  card: "#fafaf7"
  primary: "#ffc328"
  primary-foreground: "#151a1d"
  primary-pressed: "#e6a800"
  accent: "#e8e8e4"
  muted: "#ebebe7"
  muted-foreground: "#596066"
  border: "#dcddd9"
  input: "#82888c"
  ring: "#151a1d"
  disabled: "#8d9397"
  destructive: "#c4283a"
  destructive-foreground: "#fafaf7"
  warning: "#8a5a00"
  success: "#1a7045"
  diff-add: "#d3f0da"
  diff-del: "#f8d4d8"
  code: "#6a3000"
  background-dark: "#151a1d"
  foreground-dark: "#fafaf7"
  card-dark: "#1b2125"
  primary-pressed-dark: "#d9a31a"
  accent-dark: "#262d32"
  muted-dark: "#21282c"
  muted-foreground-dark: "#a2a8ac"
  border-dark: "#2c3439"
  input-dark: "#646d73"
  ring-dark: "#fafaf7"
  disabled-dark: "#6e767b"
  destructive-dark: "#ff6b70"
  destructive-foreground-dark: "#151a1d"
  warning-dark: "#ffc328"
  success-dark: "#4cc38a"
  diff-add-dark: "#113b29"
  diff-del-dark: "#500f1c"
  code-dark: "#ffa057"
typography:
  headline:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  title-large:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  title-card:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.43
  label-small:
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI Variable, Segoe UI, Roboto,
      Helvetica Neue, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
    fontFeature: "tnum"
  code:
    fontFamily:
      "ui-monospace, SF Mono, Cascadia Code, JetBrains Mono, Menlo, Consolas,
      monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.85
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  touch: "44px"
  control-desktop: "36px"
  sidebar: "280px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.accent}"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.card}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.md}"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
  badge-needs-you:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-small}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-error:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    typography: "{typography.label-small}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-idle:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label-small}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  tabs-list:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.lg}"
    padding: "4px"
  tabs-trigger-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "44px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  sheet:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    width: "512px"
---

# Design System: gtd

## Overview

**Creative North Star: "The Quiet Control Room"**

A shadcn-style product UI played straight, at the craft bar of Linear and Vercel
dashboards, in gtd's own four-colour base: charcoal, yellow, warm white and a
muted grey. The ground is a pale warm grey; content sits on near-white cards
with one hairline border and a barely-there shadow. Almost everything is
neutral, so the one yellow thing on a screen is the thing to do.

Density is moderate: one card per worktree, one reason sentence, one action.
Status is always a badge with an icon and a word, never a glyph or colour alone.
The system replaces an earlier look of hairline-boxed screens where every word
had the same weight; hierarchy now comes from size, weight and the
muted/foreground split.

**Key Characteristics:**

- Neutral warm-grey surfaces; yellow and red are reserved signals.
- Cards (8px) hold content; controls (6px) act on it.
- System sans, three weights, tabular numbers for counts.
- Lucide line icons at 16px, stroke 2.
- Phone first with a 44px touch floor; a three-column split from 1024px.
- Light and dark follow the OS; every UI token has a dark value.

## Colors

Four base colours and tints of them, plus three status hues held to WCAG AA in
both themes.

### Primary

- **Signal Yellow** (`primary`): the "act here" colour. Fills the primary
  button, the needs-you badge and the attention count on the Now view and
  sidebar projects. Text on it is always charcoal. Same value in dark.
- **Pressed Yellow** (`primary-pressed`): the pressed and hover state of the
  primary button only.

### Neutral

- **Warm Paper** (`background`) / **Deep Charcoal** (`background-dark`): the
  page ground.
- **Card White** (`card`) / **Charcoal Card** (`card-dark`): cards, sidebar,
  bottom tab bar, sheets, inputs, secondary buttons.
- **Charcoal Ink** (`foreground`) / **Warm White Ink** (`foreground-dark`):
  primary text, worktree names, focus ring.
- **Slate Muted** (`muted-foreground`): project names before the slash,
  descriptions, inactive nav, idle badge text.
- **Stone Wash** (`accent`, `muted`): hover fills, the selected nav item, tab
  list track, skeletons, idle badge.
- **Hairline Grey** (`border`): every card, divider and bar edge. **Field Grey**
  (`input`): input and checkbox strokes, the selected card's border, scrollbar
  thumb.

### Status

- **Error Red** (`destructive`): error badges, error alerts (8% tint fill, 40%
  border), danger buttons, failed exit codes. Dark uses a lighter coral.
- **Running Green** (`success`): a running service dot, a passed check, a ticked
  hunk, diff additions' marker.
- **Caution Amber** (`warning`): inline warning lines in the project list.
- **Diff and code**: add/delete line fills and an inline-code ink, plus five
  syntax hues; every token/background pair is held to AA.

### Named Rules

**The One Yellow Rule.** Yellow means "act here" and nothing else: the primary
button and the needs-you count. Never use it for decoration, headings, links,
info or warning. The wordmark's small yellow square is the one brand exception.

**The Red Is Broken Rule.** Red appears only when something failed: an error
status, an error alert, a destructive action. Never for emphasis or counts that
are not errors.

**The Never Colour Alone Rule.** Every status carries an icon and a word next to
its colour.

## Typography

**Body Font:** the system sans stack (San Francisco, Segoe UI Variable, Roboto)
**Mono Font:** the system mono stack (SF Mono, Cascadia Code, JetBrains Mono)

**Character:** native, quiet and fast to read on a phone; no web fonts.
Hierarchy is carried by size steps and three weights (400 / 500 / 600), never by
colour or caps.

### Hierarchy

- **Headline** (600, 24px): prose second-level headings on gate documents.
- **Title Large** (600, 20px): the worktree title in the detail pane and the
  gate document title.
- **Title** (600, 18px): the app bar and column header view title ("Now",
  "Projects"), sheet titles.
- **Card Title** (16px): "project / worktree", project muted at 400, worktree
  at 600.
- **Body** (400, 15px, 1.5): page default; reason sentences and gate prose,
  capped near 65ch.
- **Body Small / Label** (14px, 400 / 500): card descriptions, list rows,
  buttons, tabs, alerts.
- **Label Small** (500, 12px, tabular): badges, tab-bar labels, sidebar section
  headings.
- **Code** (13px mono, 24px line): diffs and code blocks; inline code at 0.875em
  on a muted fill.

### Named Rules

**The Title Line Rule.** A worktree is named "Project / worktree" on one line:
project muted, slash, worktree semibold. Never a separate label above the title,
never an uppercase kicker.

**The 16px Field Rule.** Every text field renders at 16px or larger so iOS does
not zoom on focus.

## Layout

Phone first at 390px. Below 1024px: a sticky top app bar (view title left,
wordmark right, translucent ground with blur), a single column of cards with
16px gutters and 12px gaps, and a fixed bottom tab bar (Now, Projects, Inbox)
with 20px icons, labels and count badges; the active tab sits on a pill.
Safe-area insets pad the top bar and tab bar.

From 1024px: a 280px card-coloured sidebar (wordmark, the three views, then the
projects with needs-you and error counts), a list column of 448px (512px from
1280px) with its own 56px header, and the detail pane filling the rest; an empty
detail shows a centred muted hint. Separation between columns is a single
border.

Spacing follows a 4px grid; 8, 12 and 16px do most of the work, 24px pads
desktop headers and the wide list.

**The Thumb Floor Rule.** Below 1024px every control is at least 44 by 44px.
From 1024px buttons and inputs drop to 36px, small buttons to 32px, tabs and
sidebar rows to 32-36px.

## Elevation & Depth

Flat and tonal. Depth comes from the ground/card value step and a hairline
border; shadows are soft and small.

### Shadow Vocabulary

- **Card rest** (`0 1px 2px rgb(21 26 29 / 0.05)`): cards and secondary buttons.
- **Active tab** (`0 1px 2px rgb(21 26 29 / 0.08)`): the selected tab trigger on
  its muted track.
- **Popover** (`0 4px 16px rgb(21 26 29 / 0.12)`): a floating refusal toast.
- **Sheet** (a large soft shadow over a 50% black scrim with 2px blur): the note
  and answer sheet.

**The One Soft Shadow Rule.** Surfaces at rest get at most the 1px card shadow.
Larger shadows belong only to things that float above the page.

## Shapes

Gently rounded, never pill-shaped except for counts and indicators. Cards,
alerts, tab tracks and diff blocks use 8px; buttons, inputs, badges, tab
triggers and nav rows use 6px; inline code and focus outlines on links 4px; the
sheet uses 12px (top corners only on a phone). Count badges, the tab-bar pill
and status dots are fully round. Borders are always 1px; a 2px left rule marks
dimmed diff context.

## Components

### Buttons

Confident and plain; one primary per card.

- **Primary:** yellow fill, charcoal 14px medium text, 16px icon left of the
  label. Full width in a phone card.
- **Secondary (default):** card fill, hairline border, card shadow; hover and
  press fill with the accent grey. Used for Retry, Open, New worktree.
- **Ghost:** no fill until hover. **Link:** underlined text, muted underline
  that darkens on hover.
- **Danger:** card fill, red text and half-strength red border; fills solid red
  on hover and press.
- **Press:** scales to 96% over 150ms ease-out as a transition; the pressed
  colour lands on the first frame. **Disabled:** 50% opacity, no pointer.
- **Focus:** 2px outline in the ring colour, 2px offset, on every interactive
  element.

### Status Badges

- 12px medium label, 6px radius, 14px icon, tabular numbers.
- **Needs you:** yellow fill, alert-circle icon. **Error:** red fill, x-circle
  icon. **Working:** outline only, spinning loader (static with reduced motion).
  **Idle:** muted fill, dashed circle.
- The badge word includes the reason in brackets ("needs you (question)", "error
  (crashed)").

### Cards / Containers

- 8px radius, card fill, hairline border, card-rest shadow, 16px padding, 12px
  internal gap.
- A selected card swaps its border to the field grey. An unavailable worktree
  drops to 60% opacity.
- "N working" folds into a single collapsible card row below the cards that need
  you.
- Loading uses skeleton cards in the same shape with a muted pulse.

### Tabs

Segmented: a muted 8px track with 4px padding; the active trigger is a
card-coloured 6px chip with the active-tab shadow. 44px tall on a phone, 32px on
desktop. Used for the detail pane's Gate / Actions.

### Alerts / Notices

- 8px radius, 16px by 12px padding, 20px icon in a left column, 14px text.
- **Default (info):** card fill, hairline border, muted info icon.
- **Error:** red 8% tint fill, 40% red border, red icon; foreground text. Says
  what broke and offers Retry.

### Inputs / Fields

- 6px radius, field-grey 1px stroke, card fill, 12px side padding, 16px text;
  44px tall on a phone, 36px on desktop. Textareas start at 96px.
- **Focus:** border goes to foreground plus the 2px ring outline. **Disabled:**
  50% opacity.
- Checkboxes are 20px with a 5px radius; a ticked hunk turns success green.

### Navigation

- **Phone:** bottom tab bar on the card fill with a top border; selected tab has
  semibold label and an accent pill behind its icon; counts float top-right of
  the icon.
- **Desktop:** sidebar rows with 16px icons, 14px labels and right-aligned
  counts; selected row has the accent fill and semibold text, others are muted
  and fill on hover.
- **Counts:** 20px round badges; yellow when they mean "needs you", muted
  otherwise, red for project error counts.

### Sheet / Dialog

A bottom sheet on a phone (full width, 12px top corners, grab handle, slides up
220ms on a decelerating curve, leaves in 160ms), a centred 512px dialog on
desktop (fades and scales from 96% in 180ms, out in 140ms). Footer actions sit
right, separated by a top border.

### Motion

Short and functional. Control feedback is a CSS transition (150ms); keyframes
are only for one-shot entrances: scrim fade, sheet and dialog in/out, and a list
item fading in from 20% opacity, never sliding. Reduced motion shortens every
transition and animation to near zero.

### Iconography

Lucide line icons, 16px in buttons, badges at 14px, nav and alerts at 20px,
stroke 2, always `aria-hidden` next to a word. Never Unicode glyphs or emoji.

## Do's and Don'ts

### Do:

- **Do** give each card at most one yellow action; make every other action
  secondary or ghost.
- **Do** pair every status colour with a Lucide icon and a word.
- **Do** keep controls at 44px below 1024px.
- **Do** write errors as what broke plus a Retry.
- **Do** define every new colour for both light and dark and check it against
  AA.
- **Do** use tabular numbers for every count.

### Don't:

- **Don't** use yellow for warnings, info, headings, links or decoration.
- **Don't** use red for anything but failure.
- **Don't** put a separate label, eyebrow or uppercase kicker above a title.
- **Don't** box every line in its own hairline; group content on cards and let
  type weight carry hierarchy.
- **Don't** use Unicode glyphs or emoji as icons.
- **Don't** animate a control with a keyframe or slide content under a reaching
  thumb.
