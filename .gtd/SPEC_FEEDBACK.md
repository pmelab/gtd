# Spec feedback — 02 — Agents read a footnote as a comment on its anchor

Tasks 1, 2 and 4 conform. Task 3's fixtures and graders conform. Two defects
remain, both in `evals/promptfooconfig.yaml`.

## 1. `design-triage:footnote`'s `challenge` contradicts its own fixture

`evals/promptfooconfig.yaml`'s `design-triage:footnote` entry describes "a
footnote (`[^enterprise]`) commenting on the ticked line". Neither fact is true
of `evals/cases/design-triage.mjs`'s `footnote` variant: the marker is
`[^audit]`, and it is anchored inside the `## Add order refunds` concern prose
("request a refund on a past order[^audit]"), not on the ticked `- [x] 30 days`
line. The case file's own comment states the anchor is deliberately NOT the
settled question, which is the opposite of what the challenge claims.

Every other `challenge` in that file describes its fixture accurately — the
sibling `build-review-collecting:footnote` entry names `[^rounding]` and
`./src/checkout.ts#2` correctly — so this cell is the one entry a reader
debugging a failed trial would be misled by. Fix the challenge text to name
`[^audit]` and the concern-prose anchor.

## 2. The `tests:` header comment no longer covers the third variant class

The comment above `tests:` still reads: "Every `violation` entry carries the
tier-3 `llm-rubric` except `architecture-decompose`'s ... every `clean` entry is
the same way, graded on the deterministic tiers 1/2 only." Two `footnote` cells
now exist, both graded on tiers 1/2 with no `llm-rubric`, and neither sentence
accounts for them. The adjacent per-variant-count comment WAS updated in the
same change; this one was missed. Either extend it to name the `footnote` class
as tiers-1/2-only, or state the rule by tier rather than by variant name.
