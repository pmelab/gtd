---
version: 1
slug: "src-web"
primary_target: "src/web"
related_targets: []
---

Scope: every screen of `gtd workspace` (src/web). Mode: Operate. Phone first
(390px), desktop list-detail from 1024px.

Audience and job: one developer supervising AI-agent worktrees, mostly on a
phone; decide at gates, review hunks, proceed or retry, then leave.

## Direction contract

THESIS: The category standard, executed impeccably: a shadcn/ui product the way
Linear or Vercel would ship it, in gtd's base palette. Refuses: hairline-boxed
test-harness screens where every word has the same weight and status hides in a
glyph.

OWN-WORLD: Pale warm-grey ground (#F4F4F1) with white cards (#FAFAF7), 1px
#DCDDD9 borders, 8px card radius, 6px controls, one soft 1px shadow; dark:
charcoal ground #151A1D, cards #1B2125. Yellow #FFC328 means "act here" only:
the primary button and the needs-you badge. Red is error only. System sans,
13/14/15/16/20/24px scale, weights 400/500/600, tabular numbers for counts.
Lucide icons at 16px, stroke 2, never Unicode glyphs or emoji.

STORY: The visitor sees what needs them first, reads the one sentence that says
why, takes the one yellow action, and goes. Errors say what broke and offer
Retry. Gate pages say where you are (gate kind, project / worktree) and give the
question more weight than its prose.

FIRST VIEWPORT: Phone Now: top app bar (gtd mark + view title + attention
count), then a stack of cards, one per worktree that needs you or is in error: a
title line "Portal / plan" (project muted, slash, worktree 16px semibold; never
a separate label above the title), status badge (yellow needs-you / red error
with icon), the reason sentence, and a full-width yellow Proceed or outline
Retry. "N working" folds into one row below. Bottom tab bar (Now, Projects,
Inbox) with icons and count badges. Desktop: a 280px left sidebar with the three
views and per-project counts, list in the middle column, detail on the right
with top tabs.

FORM: canon (the standing exit: the category standard, played straight; craft
bar Linear and Vercel dashboards). seed: 0774e39804883853

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance

## Unresolved

- NoteSheet may stay a custom bottom sheet if a Radix Dialog cannot keep its
  motion stories green.
