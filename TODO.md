---
status: grilling
---

# Simplify the review-process: drop `!!`/bang, gate feedback at the gtd edge

The reviewer wants the review feedback loop reduced to a single, mechanical
rule: **any change in the human-review working tree is feedback** — no marker
convention at all. The classification of feedback and the abort/finish/process
decision both move to the _edge_ (the resolver that runs when `gtd` is invoked),
so the agent prompt only ever has to turn a captured diff into a fresh
`TODO.md`.

## Open Questions

### Does "decision moves to the edge" mean leaving the routing in the pure machine, or actually moving branching out of `Machine.ts`?

**Recommendation:** Keep routing in the **pure machine** (`src/Machine.ts`);
"edge" here means the existing `Events.ts` fact-gathering layer, not a new
decision site. The whole architecture (see the module docstrings in
`Machine.ts`/`Events.ts` and AGENTS.md) is "edge gathers git/fs facts → machine
folds them into one leaf via guards." The plan's three outcomes map cleanly onto
three existing/near-existing leaves: abort-on-unchecked → a new leaf (see next
question), finish → `close-review`, process → `review-process`. Moving branching
into `Events.ts` would fork the decision tree and break every `Machine.test.ts`
guard test. So: edge computes richer boolean signals (`reviewHasUncheckedBoxes`,
`reviewHasRealFeedback`), machine routes on them. Reword the plan's "edge
decides the outcome" to "edge computes the signals; the machine routes." If you
actually want the IO layer to short-circuit, say so — it's a much larger
refactor.

<!-- user answers here -->

### The "abort on unchecked boxes" outcome is brand new — what is "abort" mechanically, given today every run emits a prompt and exits 0?

**Recommendation:** Today there is **no abort path**: a modified `REVIEW.md`
with unchecked boxes routes to `review-process` and processes immediately;
`main.ts` only `exit(1)`s on an internal error. Introduce a new **terminal leaf
`review-incomplete`** (non-`auto-advance`, like `await-review`) with its own
prompt `src/prompts/review-incomplete.md` that tells the human "tick every box
before re-running" and **STOPs**. Exit code stays 0 (it is a normal human gate,
not an error), matching how `await-review`/`await-answers` behave. Do NOT use
`exit(1)`/stderr — that is reserved for corruption (e.g. missing base ref).
Confirm you want a true new leaf+prompt rather than overloading the existing
`await-review` gate text.

<!-- user answers here -->

### Is "unchecked boxes ⇒ abort" desired even when the human ALSO left real feedback (notes / source edits)?

**Recommendation:** Yes — gate on unchecked boxes **first**, before the feedback
check. Rationale: an unchecked box means the human has not finished triaging
that chunk, so processing now would synthesize a `TODO.md` from a half-worked
review. This is a behavior change: today notes/source-edits route straight to
`review-process` regardless of checkbox state (see `review.feature` "Ticking a
checkbox plus adding prose", and the unchecked-box scenarios). Those scenarios
must be **rewritten** to expect `review-incomplete`. Order in the machine:
`review-incomplete` (unchecked) → `close-review` (all-checked, no other change)
→ `review-process` (all-checked + real feedback). If instead you want feedback
to win over an unchecked box, say so and I will flip the order — but that makes
"unchecked box" nearly meaningless.

<!-- user answers here -->

### What counts as a "box" and how do we detect "unchecked boxes present"?

**Recommendation:** A box is a line matching `^- \[[ x]\] ` (the format
`human-review.md` emits). "Unchecked present" = the **working-tree** `REVIEW.md`
contains at least one `^- \[ \] ` line. Compute it in `Events.ts` over the
working-tree content (not the committed copy). Edge case: a `REVIEW.md` the
human stripped of all checkboxes entirely → no unchecked boxes → falls through
to the no-other-changes / feedback decision, which is the sensible result.

<!-- user answers here -->

### How is "all boxes checked but no other changes" computed — keep today's strict forward-tick diff, or adopt the plan's "string-replace `- [ ]`→`- [x]` then compare formatted" approach?

**Recommendation:** Adopt the plan's normalize-and-compare, it is simpler and
strictly more permissive in the right way. Algorithm in `Events.ts`: take the
**committed** `REVIEW.md` (`git show HEAD:REVIEW.md`), string-replace every
`- [ ]` → `- [x]`, run it through `Format.formatFile` semantics (the same
normalizer the prompt would apply via `node scripts/gtd.js format`), and compare
to the **formatted** working-tree `REVIEW.md`. Equal ⇒ "no real feedback" ⇒
`close-review`. This replaces the `reviewApprovedNoChanges` forward-tick
machinery (equal-line-count, `atLeastOneTick`, per-line UNTICKED/TICKED regex)
in `Events.ts`. Caveat to confirm: `Format` currently exposes `formatFile`
(writes to disk); we need a **pure** `formatString` to compare in-memory without
touching the tree. I will extract one from `Format.ts`. Confirm that's
acceptable, or we keep the cheaper raw forward-tick compare and just drop the
`!!` divert from it.

<!-- user answers here -->

### "No other changes" — does it include source-file edits and untracked files, or only REVIEW.md?

**Recommendation:** Include **everything**. "No real feedback" must mean: the
ONLY working-tree delta is checkbox ticks in `REVIEW.md`. Concretely:
`close-review` requires (a) the only dirty path is `REVIEW.md` AND (b) the
normalized-tick comparison above matches. Any dirty source file, any untracked
file, or any non-tick edit to `REVIEW.md` ⇒ real feedback ⇒ `review-process`.
This matches the current `onlyReviewDirty` guard and the
`spec-review-conclude.feature` "human source edit loops" scenario. So
`reviewHasRealFeedback = reviewModified-with-non-tick-content OR otherDirtyPathsExist`.

<!-- user answers here -->

### How does dropping `!!` interact with `reviewPresent` suppressing `code-changes`, and with the verbatim-commit step?

**Recommendation:** Keep the `reviewPresent` suppression of `code-changes`
**unchanged** — it is exactly what makes "any source edit is feedback" work:
while `REVIEW.md` is present, source edits arrive **uncommitted** and are folded
into the verbatim reference commit by `review-process` (Step 5: `git add -A`),
not committed early by `code-changes`. Removing `bangPresent` only changes the
`reviewApprovedClose` guard (drop `&& !params.bangPresent`) and the divert; it
does NOT touch the `codeDirty && !reviewPresent` guard. The verbatim
`git add -A` commit-then-revert teardown stays as-is.

<!-- user answers here -->

### [folded] Where should the captured commit diff be "stored in memory"?

**Recommendation:** **Nowhere new** — no scratch file, no `.gtd/REVIEW_DIFF`.
The synthesis prompt already operates _inside the same agent run_ that creates
reference commit "x": `review-process.md` Step 6 does `git show <x>` to read the
diff back. The diff is "in memory" only in the sense that the agent holds the
SHA across Steps 5→7 within one prompt execution. So the original two open
questions resolve to: (1) recover on demand via `git show <x>` (already the
case), and (2) it does **not** need to survive across separate `gtd` invocations
— it is consumed within the single `review-process` run that creates and reverts
"x". Recommend deleting the "Store the resulting commit diff in memory" bullet
from §3 as redundant; the existing revert-based prompt already satisfies the
intent. Confirm you don't want the diff pre-rendered into the emitted prompt
string (we can't — the edge hasn't created commit "x" yet when it emits; the
agent creates it).

<!-- user answers here -->

### Does the new `bangPresent`-free `Git.ts` still need a `baseRef`/`lastReviewCommit` at all for the review-process branch?

**Recommendation:** Yes — keep `lastReviewCommit()`, `computeReviewBase`, and
the `<!-- base: … -->` parsing. Only `hasBangAdded` (and its `baseRef`-since
diff scan) is bang-specific and gets deleted. The base ref is still needed for
`human-review` generation, the `review-incomplete`/`close-review` baseline, and
the `chore(gtd): close approved review for <short-sha>` anchor. The plan's
bullet "remove `grepBangAdded`/`hasBangAdded`/`BangComment`" is right but note:
grep shows **no** `grepBangAdded` or `BangComment` symbols exist in `src/Git.ts`
today — only `hasBangAdded`. Update the plan to delete `hasBangAdded` only.

<!-- user answers here -->

### Should `await-review` (unmodified committed REVIEW.md) and the new `review-incomplete` be merged, since both are "human, do more" gates?

**Recommendation:** Keep them **separate**. `await-review` = human has touched
nothing yet (no edits at all). `review-incomplete` = human started but left
unchecked boxes. Different messages help the user. But verify the guard order:
`await-review` fires on `reviewUnmodified`; `review-incomplete` fires on
`reviewModified && hasUncheckedBoxes`. An unmodified REVIEW.md has all-original
(likely unchecked) boxes — make sure `reviewUnmodified` is checked before
`review-incomplete` so a fresh untouched review still lands on `await-review`,
not the new gate. If you'd rather have ONE "finish the review" gate, say so and
I'll collapse them.

<!-- user answers here -->

## 1. Remove the `!!` / "bang" functionality entirely

There is no marker convention any more. Treat every kind of edit uniformly:

- Additions to `REVIEW.md` → **global** feedback.
- Code comments added in source files → **local** feedback.
- Code changes (non-comment edits) → **suggestions** that still must be
  independently verified and implemented properly (not applied verbatim).

Delete the bang plumbing:

- `hasBangAdded` in `src/Git.ts` (the `GitOperations` interface member, its
  implementation, and the doc comment). NOTE: `grepBangAdded` and `BangComment`
  do **not** exist as symbols today — only `hasBangAdded` — so only it is
  removed.
- The `bangPresent` signal in `src/Events.ts` (`ResolvePayload` field, the
  `git.hasBangAdded(...)` call, and the surrounding comment block) and the
  `bangPresent` field on `ResolvePayload` in `src/Machine.ts`.
- Drop `&& !params.bangPresent` from the `reviewApprovedClose` guard in
  `src/Machine.ts` (rename it to reflect "approved + no real feedback").
- The `!!` references in `src/prompts/review-process.md` (Steps 3, 4, 5 mention
  `!!` explicitly) and the README (table row, prose §"`!!` follow-up comments",
  the mermaid `|REVIEW.md ticks only, no !!|` edge labels).
- Bang-specific tests: `hasBangAdded` describe block in `src/Git.test.ts`; the
  `bangPresent` cases in `src/Machine.test.ts`; the entirety of
  `spec-harvest.feature` (rewrite — see §4).

## 2. Move feedback classification + decision to the gtd edge

**Architecture note (see Open Question 1):** routing stays in the pure machine.
The edge (`Events.ts`) computes richer signals; the machine folds them into one
of three leaves. New/changed `ResolvePayload` signals:

- `reviewHasUncheckedBoxes: boolean` — working-tree `REVIEW.md` contains a
  `^- \[ \] ` line.
- `reviewHasRealFeedback: boolean` — there is a working-tree delta beyond
  checkbox ticks (non-tick REVIEW.md edits, dirty source, untracked files),
  computed via the normalize-and-compare algorithm in Open Question 5/6.

Machine routing when `reviewPresent` (ordered):

1. `reviewUnmodified` → **`await-review`** (untouched gate, unchanged).
2. `reviewModified && reviewHasUncheckedBoxes` → **`review-incomplete`** (NEW
   leaf): abort and tell the user to check all the boxes first. No processing
   prompt. Terminal, non-auto-advance, exit 0.
3. `reviewModified && !reviewHasUncheckedBoxes && !reviewHasRealFeedback` →
   **`close-review`**: all boxes checked, nothing else changed — finish.
4. otherwise (real feedback exists) → **`review-process`**.

## 3. Process flow when real feedback exists

Unchanged from today's revert-based teardown (see
`src/prompts/review-process.md`):

1. Commit the human-review feedback verbatim (whole dirty tree, `git add -A`) as
   reference commit "x".
2. Synthesize a new `TODO.md` from `git show <x>` (the diff IS the feedback; no
   `!!` harvesting). The prompt is self-contained because the agent holds "x"
   across the run — no separate on-disk diff artifact needed (Open Question 8).
3. `git revert --no-edit <x>` and remove `REVIEW.md`.
4. Close with the `chore(gtd): close approved review for <short-sha>` anchor.

Prompt edits to `review-process.md`: strip the `!!` mentions in Steps 3–5 so it
reads "every working-tree modification since the review commit is feedback;
REVIEW.md prose is global feedback, source comments are local feedback, source
code changes are suggestions to verify, not apply verbatim."

## 4. Tests + docs

- **Machine unit tests** (`src/Machine.test.ts`): pin the four review outcomes —
  `reviewUnmodified` → `await-review`; `reviewModified + uncheckedBoxes` →
  `review-incomplete`; `allChecked + noRealFeedback` → `close-review`;
  `realFeedback` → `review-process`. Delete the two `bangPresent` cases.
- **Events unit tests**: pin the normalize-and-compare classifier and the
  uncheckedBoxes detector.
- **e2e features**:
  - Rewrite `spec-harvest.feature` → a markerless `spec-feedback.feature` (or
    fold into `review.feature`): assert any source edit / REVIEW.md note routes
    to `review-process`, and that a plain `// !!` line is now just ordinary
    feedback (no special harvesting).
  - `review.feature`: the unchecked-box scenarios must now expect
    `review-incomplete`, not `review-process`. Update accordingly and add a
    `review-incomplete` STOP scenario.
  - `spec-review-conclude.feature`: the "leftover note" / "human source edit"
    scenarios stay (real feedback → loop); the all-checked-no-changes scenario
    stays (→ close). Add an unchecked-box → `review-incomplete` case.
- **README**: update the state table (drop the `!!` clause from `close-review`,
  add a `review-incomplete` row), the §"`!!` follow-up comments" prose (replace
  with "any change is feedback" + the global/local/suggestion taxonomy), and the
  mermaid diagram (relabel the review edges, add `review-incomplete`).
- **Format.ts**: extract a pure `formatString` if the close-review classifier
  needs in-memory normalization (Open Question 5).

## Resolved
