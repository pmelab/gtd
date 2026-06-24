# Review: d4206e5

<!-- base: d4206e5e6b9479224135f78e90f7660efc553081 -->

Fixes the Part B human-review timing flaw: `human-review` was the lone producer
leaf declared `type: "final"` (a terminal STOP), so it left `REVIEW.md`
uncommitted + a `.gtd-commit-intent` marker and deferred the commit to the
user's next run — during which the human's edits polluted the
`review(gtd): create review …` commit, breaking the clean-baseline diff that
review detection relies on. The fix gives `human-review` the `auto-advance` tag
so the edge's `commit-pending` commits `REVIEW.md` CLEAN in the same session,
then settles on `await-review`. This makes review structurally identical to the
planning flow (`new-todo`/`modified-todo` → edge commit → gate).

## Machine: human-review auto-advances

Add `tags: ["auto-advance"]` to the `human-review` leaf (no new machine logic;
termination is via existing guards — post-commit resolves to `await-review`, not
a re-fired `human-review`). The unit test flips to expect `autoAdvance: true`.

- [x] ./src/Machine.ts#484
- [x] ./src/Machine.test.ts#233

## Prompt: re-run instead of STOP

`human-review.md`'s closing STOP paragraph is replaced with the precedent
re-run-gtd instruction (mirroring `new-todo.md`/`modified-todo.md`); steps 1–6
(generate + format + write marker) unchanged. "STOP" no longer appears.

- [x] ./src/prompts/human-review.md#70

## e2e + README

The `auto-advance.feature` human-review scenario is inverted (asserts the
re-run-gtd phrasing + no "STOP"). README leaf table, the test-gate note, the
mermaid `HumanReview` node/edges, and the walkthrough updated to the two-pass
(auto-advance → edge commit → `await-review`) flow.

- [x] ./tests/integration/features/auto-advance.feature#65
- [x] ./README.md#94
- [x] ./README.md#259

## !! Feedback: drop the redundant "re-run gtd" verb from all auto-advance prompts

The `auto-advance` tag already makes `buildPrompt` append the
`prompts/partials/auto-advance.md` block ("## Auto-advance — Re-run gtd
immediately after completing the steps above…") to the end of every
auto-advancing leaf's prompt (`src/Prompt.ts:155-156, 180-181`). So the body
sentence in each producer prompt that ALSO says "Re-run gtd — the next cycle
commits …" duplicates the re-run directive. The body sentence's real value is
the **marker/commit mechanics** the generic partial omits, not the re-run verb.

Align all THREE auto-advance producer prompts so the body states only the
mechanics and lets the appended partial own the "re-run gtd" directive:

- `src/prompts/human-review.md` (closing line, ~70): currently "After writing
  `REVIEW.md` and the marker, re-run gtd — the next cycle commits `REVIEW.md`
  and deletes the marker, then stops at the human-review gate …". Reword to drop
  "re-run gtd" and fix the gate name — it stops at **`await-review`**, not
  "human-review": e.g. "After writing `REVIEW.md` and the marker, the next
  cycle's edge commits `REVIEW.md` and deletes the marker, then stops at the
  `await-review` gate for the user to work through it."
- `src/prompts/new-todo.md` (~72): "Re-run gtd — the next cycle commits the
  developed `TODO.md` and deletes the marker." → drop the "Re-run gtd — "
  prefix, keep the mechanics ("The next cycle commits the developed `TODO.md`
  and deletes the marker.").
- `src/prompts/modified-todo.md` (~81): same trim ("The next cycle commits
  `TODO.md` and deletes the marker.").

Verify after: the appended `## Auto-advance` partial is still the single re-run
directive; no body sentence says "re-run gtd"; the `auto-advance.feature`
assertion (`stdout contains "the next cycle commits"`,
`does not contain "STOP"`) still holds since "the next cycle commits" survives
in the body. Wording-only change — no machine/behavior change; rebuild the
bundle.

- [x] ./src/prompts/human-review.md#70
- [x] ./src/prompts/new-todo.md#72
- [x] ./src/prompts/modified-todo.md#81
