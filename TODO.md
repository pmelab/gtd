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

### #8 turns `review-process` from agent-driven git work into an edge operation. Where exactly does the commit→capture→revert happen?

Today the whole flow is **agent-driven**: `main.ts` emits ONE prompt and exits
0; `review-process.md` then instructs the agent to run `git add -A` /
`git commit` / `git show <x>` / `git revert`. Answer #8 says the edge (the `gtd`
process) should itself, within one execution, commit the dirty tree, capture its
diff in process memory, `git revert` it, and **print the captured diff into the
agent's prompt**. That means the IO edge gains write-side git operations it has
never had (today `Events.ts` only reads).

**Recommendation:** Add a dedicated `review-process` pre-render phase in
`main.ts` (parallel to the existing `TEST_GATED_LEAVES` block): when
`result.value === "review-process"`, run a new `GitService` op that does
`git add -A` → `git commit -m "docs(review): record raw feedback for <base>"` →
capture `git show <sha>` into a string → `git revert --no-edit <sha>` →
`git rm REVIEW.md` (if tracked) →
`git commit -m "chore(gtd): close approved review for <short-sha>"`, then inject
the captured diff string into the prompt via a new `PromptOverride` kind (like
`fix-tests`). The agent's only remaining job is "here is the review diff,
synthesize TODO.md from it." Keep `Events.ts` read-only; put the write ops in
`main.ts`/`GitService` so the pure machine and fact-gathering layer stay
side-effect-free.

Confirm: is `main.ts` the right home for this write-side phase, mirroring the
test-gate block? Or do you want a separate "executor" module so `main.ts`
doesn't grow a second special-case leaf?

<!-- user answers here -->

### If the edge commits+reverts BEFORE the agent runs, what happens to TODO.md synthesis on agent failure?

In the agent-driven flow, if the agent died mid-run the working tree was
untouched (nothing committed yet) and re-running `gtd` simply re-emitted the
same `review-process` prompt — idempotent and safe. In the edge-driven flow #8
describes, by the time the agent receives the diff the edge has **already**
committed-reverted-and-deleted REVIEW.md. If the agent then fails to write
TODO.md (or writes garbage), REVIEW.md is gone, the review is "closed", and the
only record of the feedback is the reverted `docs(review): record raw feedback`
commit deep in history.

**Recommendation:** Either (a) have the edge commit `record raw feedback` but
NOT revert/close until it can confirm TODO.md was produced — but the edge can't,
because the agent runs _after_ the prompt is emitted; or (b) accept that the
feedback is recoverable via `git show <record-sha>` and document that recovery
in the prompt so a re-run can resynthesize. Recommend (b): leave the reverted
`record raw feedback` commit as the durable artifact, and tell the agent "if you
lose this diff, recover it with `git show <record-sha>`" — injecting the
`<record-sha>` alongside the diff.

Which durability guarantee do you want: edge defers close until TODO.md exists
(needs a second `gtd` pass), or fire-and-document-recovery (single pass, diff
lives in reverted history)?

### On revert conflict, who handles it now — the edge or the agent?

Today the agent owns the revert and the FAILURE BRANCH in `review-process.md`
Step 7 (`git revert --abort`, STOP, escalate). If the edge now runs
`git revert --no-edit <sha>` itself, a revert conflict surfaces in the Effect
edge, before any prompt is built.

**Recommendation:** On a non-clean revert at the edge, run `git revert --abort`
in the same `GitService` op and `Effect.fail` with a clear message; `main.ts`'s
existing `catchAll` writes it to stderr and `exit(1)`. This matches the
"corruption ⇒ exit 1" convention (Resolved Q2/Q-abort). The agent never sees a
conflicted tree because the prompt is never emitted. Delete the Step-7 FAILURE
BRANCH from `review-process.md` since the agent no longer runs the revert.

Confirm exit 1 + abort at the edge is the desired conflict behavior (vs. exit 0
with an "escalate" prompt asking the human to resolve manually).

### Does `review-process` keep the `auto-advance` tag once it's edge-driven?

`review-process` is tagged `auto-advance` today so the loop chains into the next
step. If the edge does the commit/revert/close and only the TODO.md-synthesis
remains for the agent, the post-agent state is "fresh TODO.md, no REVIEW.md" —
which on the next `gtd` resolves to a TODO/plan leaf. The auto-advance semantics
may still be correct, but the leaf now does far less.

**Recommendation:** Keep `auto-advance` — after synthesis the natural next step
is grilling/planning the new TODO.md, exactly what auto-advance enables. No
change needed, but verify the loop driver (the gtd skill) doesn't assume
`review-process` left a dirty tree to commit.

Confirm auto-advance stays on `review-process`.

### Does edge-driven `review-process` interact with the test gate?

`main.ts` runs the test suite only for `human-review` and `execute`.
`review-process` is not test-gated today. With the edge now performing the
verbatim commit, should the suite run before that commit (to avoid committing a
broken tree as the reference) or not at all?

**Recommendation:** Do NOT test-gate `review-process`. The verbatim
`record raw feedback` commit is explicitly "preserve the reviewer's tree as-is,
even if broken"; the human's edits are feedback to triage, not code that must
pass. Running tests here would block synthesis on a tree the reviewer never
claimed was green. Leave `TEST_GATED_LEAVES` unchanged.

Confirm `review-process` stays out of the test gate.

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

**Architecture note (Resolved Q1):** routing stays in the pure machine. The edge
(`Events.ts`) computes richer signals; the machine folds them into one of four
leaves. New/changed `ResolvePayload` signals:

- `reviewHasUncheckedBoxes: boolean` — working-tree `REVIEW.md` contains a
  `^- \[ \] ` line.
- `reviewHasRealFeedback: boolean` — there is a working-tree delta beyond
  checkbox ticks (non-tick REVIEW.md edits, dirty source, untracked files),
  computed via the normalize-and-compare algorithm in Resolved Q5/Q6.

**`reviewHasUncheckedBoxes`** (Resolved Q4): a box is a line matching
`^- \[[ x]\] `; "unchecked present" = the **working-tree** `REVIEW.md` contains
at least one `^- \[ \] ` line. Computed over working-tree content, not the
committed copy. If the human stripped all checkboxes entirely, no unchecked
boxes → falls through to the feedback decision.

**`reviewHasRealFeedback`** (Resolved Q5/Q6): adopt normalize-and-compare. Take
the **committed** `REVIEW.md` (`git show HEAD:REVIEW.md`), string-replace every
`- [ ]` → `- [x]`, run it through a pure `formatString` (extracted from
`Format.ts`, see §4), and compare to the formatted working-tree `REVIEW.md`.
Equal AND the only dirty path is `REVIEW.md` ⇒ no real feedback. Any dirty
source file, any untracked file, or any non-tick edit to `REVIEW.md` ⇒ real
feedback. So
`reviewHasRealFeedback = (normalized REVIEW.md differs) OR (otherDirtyPathsExist)`.
This replaces the `reviewApprovedNoChanges` forward-tick machinery
(equal-line-count, `atLeastOneTick`, per-line UNTICKED/TICKED regex) in
`Events.ts`.

Machine routing when `reviewPresent` (ordered, Resolved Q3/Q10):

1. `reviewUnmodified` → **`await-review`** (untouched gate, unchanged). Checked
   **before** `review-incomplete` so a fresh untouched review (all-original,
   likely unchecked boxes) lands on `await-review`, not the new gate.
2. `reviewModified && reviewHasUncheckedBoxes` → **`review-incomplete`** (NEW
   leaf): abort and tell the user to review everything and at least tick all the
   boxes first. No processing prompt. **Unchecked boxes gate first, before the
   feedback check** — even if real feedback is also present, always check all
   boxes first.
3. `reviewModified && !reviewHasUncheckedBoxes && !reviewHasRealFeedback` →
   **`close-review`**: all boxes checked, nothing else changed — finish.
4. otherwise (real feedback exists, all boxes checked) → **`review-process`**.

The `reviewPresent` suppression of `code-changes` stays **unchanged** (Resolved
Q7): `codeDirty && !reviewPresent`. While REVIEW.md is present, source edits
arrive uncommitted and are folded into the verbatim reference commit, not
committed early by `code-changes`.

### The new `review-incomplete` leaf

A terminal, non-`auto-advance` leaf (like `await-review`) with its own prompt
`src/prompts/review-incomplete.md`. "Abort" means: do **not** proceed with any
operations — just tell the human to review everything and at least tick all the
boxes, then STOP. Exit code stays **0** (a normal human gate, not an error,
matching `await-review`/`await-answers`); do NOT use `exit(1)`/stderr — that is
reserved for corruption. Kept **separate** from `await-review`: `await-review` =
human touched nothing; `review-incomplete` = human started but left unchecked
boxes. Different messages help the user.

## 3. Process flow when real feedback exists (edge-driven — see Open Questions)

**This section is reshaped by Answer #8.** The reviewer wants the commit /
capture-diff-in-memory / revert / inject-diff-into-prompt to happen at the
**edge**, within a single `gtd` execution — NOT via the agent running git
commands across prompt steps. The agent should only receive a diff and "turn it
into TODO.md."

Today (agent-driven, for contrast): `main.ts` emits one `review-process` prompt
and exits; `review-process.md` instructs the agent to do `git add -A` / commit /
`git show <x>` / `git revert` / close itself.

Target (edge-driven, per #8 — exact home/durability/conflict handling pending
the Open Questions above):

1. When the machine resolves to `review-process`, the edge (a new write-side
   `GitService` op invoked from `main.ts`) runs:
   - `git add -A` → `git commit -m "docs(review): record raw feedback for
     <base>"` (verbatim, the whole dirty tree: annotated REVIEW.md, source
     edits, untracked files).
   - Capture `git show <record-sha>` into a string held in process memory.
   - `git revert --no-edit <record-sha>` (on conflict: `git revert --abort` +
     `Effect.fail` → exit 1; see Open Question on conflict handling).
   - `git rm REVIEW.md` if still tracked, then
     `git commit -m "chore(gtd): close approved review for <short-sha>"`.
2. The edge injects the captured diff (and the `<record-sha>` for recovery) into
   the emitted prompt via a new `PromptOverride` kind, analogous to `fix-tests`.
3. The agent's prompt (`review-process.md`, heavily slimmed) now only:
   synthesize a new `TODO.md` from the injected diff (the diff IS the feedback;
   REVIEW.md prose = global feedback, source comments = local feedback, source
   code changes = suggestions to verify, not apply verbatim),
   `node scripts/gtd.js format TODO.md`, and commit it. The agent no longer
   commits/reverts/closes — those moved to the edge. Strip Steps 5–8 (the
   commit/revert/close machinery) and the `!!` mentions from
   `review-process.md`.

Keep `lastReviewCommit()`, `computeReviewBase`, and `<!-- base: … -->` parsing
(Resolved Q9) — needed for `human-review` generation, the
`review-incomplete`/`close-review` baseline, and the close anchor. Delete only
`hasBangAdded`.

## 4. Tests + docs

- **Machine unit tests** (`src/Machine.test.ts`): pin the four review outcomes —
  `reviewUnmodified` → `await-review`; `reviewModified + uncheckedBoxes` →
  `review-incomplete`; `allChecked + noRealFeedback` → `close-review`;
  `realFeedback` → `review-process`. Delete the two `bangPresent` cases.
- **Events unit tests**: pin the normalize-and-compare classifier and the
  uncheckedBoxes detector.
- **Edge write-side op** (new): unit-test the commit→capture→revert→close
  sequence and the revert-conflict abort path (pending Open Question
  resolution).
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
- **Format.ts**: extract a pure `formatString(content): Effect<string>` (no disk
  write) for the close-review classifier's in-memory normalization; `formatFile`
  reuses it.

## Resolved

### Does "decision moves to the edge" mean leaving the routing in the pure machine, or actually moving branching out of `Machine.ts`?

**Recommendation:** Keep routing in the **pure machine** (`src/Machine.ts`);
"edge" here means the existing `Events.ts` fact-gathering layer, not a new
decision site. The whole architecture is "edge gathers git/fs facts → machine
folds them into one leaf via guards." Three outcomes map onto leaves:
abort-on-unchecked → a new leaf, finish → `close-review`, process →
`review-process`. So: edge computes richer boolean signals
(`reviewHasUncheckedBoxes`, `reviewHasRealFeedback`), machine routes on them.

**Answer:** agreed.

### The "abort on unchecked boxes" outcome is brand new — what is "abort" mechanically, given today every run emits a prompt and exits 0?

**Recommendation:** Introduce a new **terminal leaf `review-incomplete`**
(non-`auto-advance`, like `await-review`) with its own prompt
`src/prompts/review-incomplete.md` that tells the human "tick every box before
re-running" and **STOPs**. Exit code stays 0 (normal human gate, not an error).
Do NOT use `exit(1)`/stderr — reserved for corruption.

**Answer:** "abort" means to not proceed with any operations, but just tell the
user to review everything and at least tick all boxes.

### Is "unchecked boxes ⇒ abort" desired even when the human ALSO left real feedback (notes / source edits)?

**Recommendation:** Yes — gate on unchecked boxes **first**, before the feedback
check. An unchecked box means the human has not finished triaging that chunk.
Order in the machine: `review-incomplete` (unchecked) → `close-review`
(all-checked, no other change) → `review-process` (all-checked + real feedback).

**Answer:** yes, always check all boxes.

### What counts as a "box" and how do we detect "unchecked boxes present"?

**Recommendation:** A box is a line matching `^- \[[ x]\] `. "Unchecked present"
= the **working-tree** `REVIEW.md` contains at least one `^- \[ \] ` line.
Compute it in `Events.ts` over working-tree content. If the human stripped all
checkboxes, no unchecked boxes → falls through to the feedback decision.

**Answer:** agreed.

### How is "all boxes checked but no other changes" computed — keep today's strict forward-tick diff, or adopt the plan's "string-replace `- [ ]`→`- [x]` then compare formatted" approach?

**Recommendation:** Adopt normalize-and-compare. Take the **committed**
`REVIEW.md`, string-replace `- [ ]` → `- [x]`, run through a pure `formatString`
extracted from `Format.ts`, and compare to the formatted working-tree
`REVIEW.md`. Equal ⇒ no real feedback ⇒ `close-review`. Replaces the
forward-tick machinery in `Events.ts`. Requires extracting a pure `formatString`
from `Format.ts` (currently only `formatFile` writes to disk).

**Answer:** agreed.

### "No other changes" — does it include source-file edits and untracked files, or only REVIEW.md?

**Recommendation:** Include **everything**. `close-review` requires (a) the only
dirty path is `REVIEW.md` AND (b) the normalized-tick comparison matches. Any
dirty source file, any untracked file, or any non-tick REVIEW.md edit ⇒ real
feedback ⇒ `review-process`. So
`reviewHasRealFeedback = reviewModified-with- non-tick-content OR otherDirtyPathsExist`.

**Answer:** agreed.

### How does dropping `!!` interact with `reviewPresent` suppressing `code-changes`, and with the verbatim-commit step?

**Recommendation:** Keep the `reviewPresent` suppression of `code-changes`
**unchanged** — it is what makes "any source edit is feedback" work: while
REVIEW.md is present, source edits arrive uncommitted and are folded into the
verbatim reference commit, not committed early by `code-changes`. Removing
`bangPresent` only changes the `reviewApprovedClose` guard and the divert; it
does NOT touch the `codeDirty && !reviewPresent` guard.

**Answer:** agreed.

### Where should the captured commit diff be "stored in memory"?

**Recommendation:** Nowhere new — no scratch file, no `.gtd/REVIEW_DIFF`. The
synthesis prompt operates inside the same agent run that creates reference
commit "x"; `git show <x>` reads the diff back. It does not need to survive
across separate `gtd` invocations.

**Answer:** the agent does not even need the sha. it just executes `gtd`, and
within that one execution, the review diff is committed, stored in process
memory, reverted and then directly printed into the agent's prompt for
processing it into a TODO.md. (NOTE: this refinement moves the commit / capture
/ revert from the agent to the **edge** — it reshapes §3 and raised the new Open
Questions above.)

### Does the new `bangPresent`-free `Git.ts` still need a `baseRef`/`lastReviewCommit` at all for the review-process branch?

**Recommendation:** Yes — keep `lastReviewCommit()`, `computeReviewBase`, and
the `<!-- base: … -->` parsing. Only `hasBangAdded` (and its `baseRef`-since
diff scan) is bang-specific and gets deleted. `grepBangAdded`/`BangComment` do
not exist as symbols today — only `hasBangAdded`.

**Answer:** agreed.

### Should `await-review` (unmodified committed REVIEW.md) and the new `review-incomplete` be merged, since both are "human, do more" gates?

**Recommendation:** Keep them **separate**. `await-review` = human touched
nothing yet. `review-incomplete` = human started but left unchecked boxes. Guard
order: `await-review` fires on `reviewUnmodified` and is checked **before**
`review-incomplete` so a fresh untouched review lands on `await-review`.

**Answer:** agreed.
