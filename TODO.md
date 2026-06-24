---
status: complete
---

# Simplify the review-process: drop `!!`/bang, gate feedback at the gtd edge

The reviewer wants the review feedback loop reduced to a single, mechanical
rule: **any change in the human-review working tree is feedback** — no marker
convention at all. The classification of feedback and the abort/finish/process
decision both move to the _edge_ (the resolver that runs when `gtd` is invoked),
so the agent prompt only ever has to turn a captured diff into a fresh
`TODO.md`.

## 1. Remove the `!!` / "bang" functionality entirely

There is no marker convention any more. Treat every kind of edit uniformly:

- Additions to `REVIEW.md` → **global** feedback.
- Code comments added in source files → **local** feedback.
- Code changes (non-comment edits) → **suggestions** that still must be
  independently verified and implemented properly (not applied verbatim).

Delete the bang plumbing:

- `hasBangAdded` in `src/Git.ts` — remove the `GitOperations` interface member
  (line ~22–23, incl. its doc comment), the implementation (the
  `hasBangAdded: (baseRef) => …` block, ~line 209–247, incl. the preceding
  comment), and the unused `baseRef`-since diff scan inside it. NOTE:
  `grepBangAdded` and `BangComment` do **not** exist as symbols — only
  `hasBangAdded`.
- The `bangPresent` signal in `src/Events.ts`: the local `let bangPresent`
  declaration + the harvest comment block above it (~line 248–252), the
  `bangPresent = … git.hasBangAdded(...)` assignment (~line 263–264), and the
  `bangPresent` key in the `payload` object literal (~line 336). Also drop the
  `readonly bangPresent: boolean` field on `ResolvePayload` in `src/Machine.ts`
  (~line 53–54).
- The `reviewApprovedClose` guard in `src/Machine.ts` (~line 117–119) currently
  reads `params.reviewApprovedNoChanges && !params.bangPresent`. It is rewritten
  by §2 (renamed to reflect "all boxes checked + no real feedback" and pointed
  at the new signals); dropping `&& !params.bangPresent` is part of that
  rewrite.
- The `!!` references in `src/prompts/review-process.md` (Steps 3, 4, 5 still
  mention `!!` as "ordinary feedback" — remove the mentions entirely; §3 also
  rewrites this prompt). The README references (table row, prose section
  `## "!!" follow-up comments`, the mermaid `|REVIEW.md ticks only, no !!|` edge
  labels).
- The `## What the human must do` step 3 in `src/prompts/await-review.md` tells
  the human to "drop `!!` follow-up comments" — drop the `!!` clause (keep "edit
  source files / leave notes").
- Bang-specific tests: the `describe("hasBangAdded", …)` block in
  `src/Git.test.ts` (~line 323 to its close); the `bangPresent` cases in
  `src/Machine.test.ts` (the `bangPresent: false` default in the shared payload
  fixture ~line 18, and the `"approved review with a !! comment diverts …"` case
  ~line 168–172); the entirety of
  `tests/integration/features/spec-harvest.feature` (rewrite — see §4).

## 2. Move feedback classification + decision to the gtd edge

**Architecture note (Resolved Q-routing):** routing stays in the pure machine.
The edge (`src/Events.ts`) computes richer signals; the machine
(`src/Machine.ts`) folds them into one of four leaves. New/changed
`ResolvePayload` signals (`src/Machine.ts` + populated in `src/Events.ts`):

- `reviewHasUncheckedBoxes: boolean` — working-tree `REVIEW.md` contains at
  least one `^- \[ \] ` line.
- `reviewHasRealFeedback: boolean` — there is a working-tree delta beyond
  checkbox ticks (non-tick REVIEW.md edits, dirty source, untracked files),
  computed via the normalize-and-compare algorithm below.

These two **replace** the existing `reviewApprovedNoChanges` field on
`ResolvePayload` and all the inline forward-tick machinery in `src/Events.ts`
(the `onlyReviewDirty` block, ~line 280–307: `committedLines`/`workingLines`
split, the `UNTICKED`/`TICKED`/`stripMarker` regexes, the equal-line-count loop,
`atLeastOneTick`, `allDiffsAreForwardTicks`).

**`reviewHasUncheckedBoxes`** (Resolved Q-box): a box is a line matching
`^- \[[ x]\] `; "unchecked present" = the **working-tree** `REVIEW.md`
(`reviewContent` already read at ~line 259–261) contains at least one
`^- \[ \] ` line (multiline test). Computed over working-tree content, not the
committed copy. If the human stripped all checkboxes entirely, no unchecked
boxes → falls through to the feedback decision.

**`reviewHasRealFeedback`** (Resolved Q-realfeedback): adopt
normalize-and-compare.

1. `otherDirtyPathsExist` = any dirty entry whose path is not `REVIEW.md` (i.e.
   `!entries.every((e) => e.path === REVIEW_FILE)` — the existing
   `onlyReviewDirty` negated). This already covers dirty source files; untracked
   files surface in `git status --porcelain` (`??`) so they are included.
2. If only `REVIEW.md` is dirty, compare normalized content: take the
   **committed** `REVIEW.md` (`git.showHead(REVIEW_FILE)`), string-replace every
   `- [ ]` → `- [x]`, run it through the new pure `formatString` (§4), and
   compare to the formatted working-tree `REVIEW.md`. Equal ⇒ only forward ticks
   ⇒ no real feedback.
3. `reviewHasRealFeedback = otherDirtyPathsExist || (normalized committed REVIEW.md !== formatted working REVIEW.md)`.

Because `formatString` returns `Effect<string, Error>` (prettier is async), this
classification runs inside the existing `Effect.gen` in `gatherEvents`; surface
errors via the same `Effect.mapError((e) => new Error(String(e)))` convention
used around the current REVIEW.md reads.

Machine routing when `reviewPresent`, in `src/Machine.ts`'s `RESOLVE` transition
array (ordered, Resolved Q-order/Q-separate). The existing order today is:
`errorsPresent → reviewApprovedClose → codeDirty → reviewModified → reviewUnmodified → …`.
New order for the review branch:

1. `reviewUnmodified` → **`await-review`** (untouched gate, unchanged). Must be
   checked **before** `review-incomplete` so a fresh untouched review
   (all-original, likely unchecked boxes) lands on `await-review`, not the new
   gate. (Today `reviewUnmodified` is checked AFTER `reviewModified`; since the
   two are mutually exclusive, relative order between them is safe, but
   `reviewUnmodified` must precede `reviewIncomplete`.)
2. `reviewModified && reviewHasUncheckedBoxes` → **`review-incomplete`** (NEW
   leaf, NEW guard `reviewIncomplete`): abort and tell the user to review
   everything and at least tick all the boxes first. No processing prompt.
   **Unchecked boxes gate first, before the feedback check** — even if real
   feedback is also present, always check all boxes first.
3. `reviewModified && !reviewHasUncheckedBoxes && !reviewHasRealFeedback` →
   **`close-review`** (the renamed `reviewApprovedClose` guard now reads
   `params.reviewModified && !params.reviewHasUncheckedBoxes && !params.reviewHasRealFeedback`):
   all boxes checked, nothing else changed — finish.
4. otherwise
   (`reviewModified && !reviewHasUncheckedBoxes && reviewHasRealFeedback`) →
   **`review-process`** (the existing `reviewModified` guard, now reachable only
   when there is real feedback and no unchecked boxes).

The `reviewPresent` suppression of `code-changes` stays **unchanged** (Resolved
Q-suppress): the `codeDirty` guard remains
`params.codeDirty && !params.reviewPresent`. While REVIEW.md is present, source
edits arrive uncommitted and are folded into the verbatim reference commit by
the edge (§3), not committed early by `code-changes`.

### The new `review-incomplete` leaf

A terminal, non-`auto-advance` leaf (like `await-review`) added to `LeafState`
in `src/Machine.ts`, with a `"review-incomplete": { type: "final" }` state entry
(no `auto-advance` tag), wired into the `SECTIONS` map in `src/Prompt.ts` with
its own prompt `src/prompts/review-incomplete.md` (imported alongside
`awaitReview`). "Abort" means: do **not** proceed with any operations — just
tell the human to review everything and at least tick all the boxes, then STOP.
Exit code stays **0** (a normal human gate, not an error, matching
`await-review`/`await-answers`); do NOT use `exit(1)`/stderr — that is reserved
for corruption. Kept **separate** from `await-review`: `await-review` = human
touched nothing; `review-incomplete` = human started but left unchecked boxes.
Different messages help the user.

## 3. Edge-driven process flow when real feedback exists

The commit / capture-diff-in-memory / revert / inject-diff-into-prompt happens
at the **edge** (the `gtd` process), within a single `gtd` execution — NOT via
the agent running git commands across prompt steps. The agent only receives a
diff and "turns it into TODO.md."

**(a) Home: `src/main.ts`, mirroring the `TEST_GATED_LEAVES` block (Resolved
Q-home).** `main.ts` already has `GitService` in scope (`GitService.Live` is
provided at the bottom). Add a `review-process` pre-render phase **parallel to**
the existing `TEST_GATED_LEAVES` block (~line 36–44): when
`result.value === "review-process"`, before `buildPrompt`, run a new write-side
`GitService` op (below), then build the prompt with a new `PromptOverride`.
`Events.ts` stays read-only — write ops live in `GitService` + `main.ts`.

**(b) New `GitService` op (`src/Git.ts`), e.g.
`recordAndRevertReview(base: string)`, returning the captured diff string.**
Within one execution:

- `git add -A` → `git commit -m "docs(review): record raw feedback for <base>"`
  (verbatim — annotated REVIEW.md, source edits, untracked files). `<base>` is
  the `reviewBaseRef` parsed from REVIEW.md's `<!-- base: … -->` (already on the
  context as `context.baseRef`; thread it into the op).
- Capture the diff of that commit (`git show <record-sha>`, or
  `git log -1 --format=%H` then show) into a string held in process memory; also
  keep `<record-sha>` for the recovery hint.
- `git revert --no-edit <record-sha>`. **On conflict / non-zero exit** (Resolved
  Q-conflict): run `git revert --abort` inside the same op and `Effect.fail`
  with a clear message. `main.ts`'s existing `catchAll` (~line 56–61) writes it
  to stderr and `process.exit(1)`. No prompt is ever emitted; the agent never
  sees a conflicted tree.
- On clean revert: `git rm REVIEW.md` if still tracked, then
  `git commit -m "chore(gtd): close approved review for <short-sha>"` where
  `<short-sha>` is the 7-char prefix of `<base>` (matches the existing
  `lastCloseCommit` grep `^chore\(gtd\): close approved review for`).
- Return the captured diff string (and `<record-sha>`).

**(c) New `PromptOverride` kind, e.g. `review-process`, carrying the diff +
record-sha.** `PromptOverride` is currently defined in BOTH places and must be
extended in both:

- `src/Prompt.ts` (~line 100–104, the canonical interface used by
  `buildPrompt`): add a second member of the union, e.g.
  `{ readonly kind: "review-process"; readonly reviewDiff: string; readonly recordSha: string }`.
- `src/State.ts` (~line 16, the `PromptOverride` type alias) — keep it in sync.

In `buildPrompt` (`src/Prompt.ts` ~line 148–171), the current
`if (override?.kind === "fix-tests")` branch SKIPS the normal section +
auto-advance entirely. The new `review-process` override must instead render
like a normal leaf: push `SECTIONS["review-process"]` (the slimmed prompt), then
the injected diff fenced via `fenceFor`, then still honor `result.autoAdvance`
(push the `autoAdvance` partial) — `review-process` keeps `auto-advance` (§
below). So branch on the kind rather than collapsing both overrides into the
fix-tests shape.

**(d) Durability on agent failure: fire-and-document-recovery (Resolved
Q-durability, single pass).** The edge commits → captures → reverts → closes
before the agent runs; if the agent then fails to write TODO.md, REVIEW.md is
gone and the only record of feedback is the reverted
`docs(review): record raw feedback` commit in history. Accept this: inject the
`<record-sha>` alongside the diff and have the slimmed
`src/prompts/review-process.md` state "if you lose this diff, recover it with
`git show <record-sha>`." No second `gtd` pass, no deferred close.

**(e) Slim `src/prompts/review-process.md`.** The agent's only remaining job:
synthesize a new `TODO.md` from the injected diff (the diff IS the feedback —
REVIEW.md prose = global feedback, source comments = local feedback, source code
changes = suggestions to verify, not apply verbatim), run
`node scripts/gtd.js format TODO.md`, and commit it. Strip Steps 2 and 5–7 (the
`git add` / commit / `git show` / `git revert` / `git rm` / close machinery and
the Step-7 FAILURE BRANCH — all moved to the edge) and all `!!` mentions. The
agent no longer runs any git work except committing the synthesized TODO.md.

**(f) Keep `auto-advance` on `review-process` (Resolved Q-autoadvance).** The
`review-process` state keeps its `tags: ["auto-advance"]`. After synthesis the
natural next step is grilling/planning the new TODO.md. The post-edge tree is
"fresh TODO.md, no REVIEW.md," which the next `gtd` resolves to a TODO/plan leaf
— the loop driver (gtd skill) must NOT assume `review-process` left a dirty tree
to commit, since the edge already committed/closed.

**(g) Keep `review-process` OUT of the test gate (Resolved Q-testgate).**
`TEST_GATED_LEAVES` in `src/main.ts` stays `{ "human-review", "execute" }`. The
verbatim `record raw feedback` commit deliberately preserves the reviewer's tree
as-is even if broken; the human's edits are feedback to triage, not code that
must pass.

Keep `lastReviewCommit()`, `lastCloseCommit()`, `computeReviewBase`, and the
`<!-- base: … -->` parsing (Resolved Q-baseref) — needed for `human-review`
generation, the `review-incomplete`/`close-review` baseline, and the close
anchor. Delete only `hasBangAdded`.

## 4. Tests + docs

- **`src/Machine.test.ts`**: update the shared payload fixture (drop
  `bangPresent`, drop `reviewApprovedNoChanges`, add `reviewHasUncheckedBoxes`
  and `reviewHasRealFeedback`). Delete the
  `"approved review with a !! comment diverts …"` case. Pin the four review
  outcomes: `reviewUnmodified` → `await-review`;
  `reviewModified + reviewHasUncheckedBoxes` → `review-incomplete`;
  `reviewModified + allChecked + !reviewHasRealFeedback` → `close-review`;
  `reviewModified + allChecked + reviewHasRealFeedback` → `review-process`. Add
  an ordering regression: unchecked-boxes wins over real-feedback (both true →
  `review-incomplete`).
- **`src/Events.test.ts`**: pin the new classifier — `reviewHasUncheckedBoxes`
  detector (working-tree `^- \[ \] ` present) and `reviewHasRealFeedback`
  (normalize-and-compare equal ⇒ false; non-tick REVIEW.md edit, dirty source,
  or untracked ⇒ true).
- **`src/Git.test.ts`**: delete the `describe("hasBangAdded", …)` block; add a
  `describe("recordAndRevertReview", …)` covering the
  commit→capture→revert→`git rm`→close sequence and the revert-conflict
  `--abort` + `Effect.fail` path.
- **e2e features** (`tests/integration/features/`):
  - Rewrite `spec-harvest.feature` → a markerless `spec-feedback.feature` (or
    fold into `review.feature`): assert any source edit / REVIEW.md note routes
    to `review-process`, and that a plain `// !!` line is now just ordinary
    feedback (no special harvesting / no divert distinct from any other edit).
  - `review.feature`: unchecked-box scenarios must now expect
    `review-incomplete`, not `review-process`/`await-review` as before; add a
    `review-incomplete` STOP scenario.
  - `spec-review-conclude.feature`: the "leftover note" / "human source edit"
    scenarios stay (real feedback → `review-process` loop); the
    all-checked-no-changes scenario stays (→ `close-review`). Add an
    unchecked-box → `review-incomplete` case.
  - `spec-verbatim-first.feature`: verify it still passes once the edge does the
    verbatim commit (the `codeDirty && !reviewPresent` suppression is unchanged,
    so its assertions should hold; adjust any `!!` mention).
- **`src/Format.ts`**: extract a pure
  `formatString(content: string): Effect<string, Error>` (runs prettier with the
  existing `PRETTIER_CONFIG`, no FileSystem dep, no disk write) for the
  `reviewHasRealFeedback` in-memory normalization in `Events.ts`. Refactor
  `formatFile` to read the file then delegate to `formatString` (keeping its
  not-found / skip-on-error behavior).
- **README**: update the state table (drop the `!!` clause from `close-review`,
  add a `review-incomplete` row), replace the `## "!!" follow-up comments` prose
  with "any change is feedback" + the global/local/suggestion taxonomy, and the
  mermaid diagram (relabel the review edges, add a `review-incomplete`
  node/edge, drop the `no !!` labels).

## Resolved

### #8 turns `review-process` from agent-driven git work into an edge operation. Where exactly does the commit→capture→revert happen? Is `main.ts` the right home (mirroring the test-gate block) or a separate executor module?

**Recommendation:** Add a dedicated `review-process` pre-render phase in
`main.ts` (parallel to the existing `TEST_GATED_LEAVES` block): when
`result.value === "review-process"`, run a new `GitService` op that does
`git add -A` → record-commit → capture `git show <sha>` → `git revert --no-edit`
→ `git rm REVIEW.md` → close-commit, then inject the captured diff into the
prompt via a new `PromptOverride` kind (like `fix-tests`). Keep `Events.ts`
read-only; put the write ops in `main.ts`/`GitService`.

**Answer:** agreed. `main.ts` is the home for the write-side review-process
phase, mirroring the test-gate block; new GitService op + new PromptOverride
kind.

### If the edge commits+reverts BEFORE the agent runs, what happens to TODO.md synthesis on agent failure — defer close until TODO.md exists (second pass), or fire-and-document-recovery (single pass)?

**Recommendation:** Recommend (b): leave the reverted `record raw feedback`
commit as the durable artifact, and tell the agent "if you lose this diff,
recover it with `git show <record-sha>`" — injecting the `<record-sha>`
alongside the diff. Single pass.

**Answer:** go with (b): fire-and-document-recovery; rely on git history. The
reverted `docs(review): record raw feedback` commit is the durable artifact;
inject `<record-sha>` alongside the diff so a re-run can recover via
`git show <record-sha>`. Single pass.

### On revert conflict, who handles it now — the edge or the agent? Exit 1 + abort at the edge, or exit 0 with an "escalate" prompt?

**Recommendation:** On a non-clean revert at the edge, run `git revert --abort`
in the same `GitService` op and `Effect.fail` with a clear message; `main.ts`'s
existing `catchAll` writes it to stderr and `exit(1)`. The agent never sees a
conflicted tree. Delete the Step-7 FAILURE BRANCH from `review-process.md`.

**Answer:** confirmed. Revert conflict handled at the edge: `git revert --abort`

- `Effect.fail` → exit 1; delete the Step-7 FAILURE BRANCH from
  `review-process.md`.

### Does `review-process` keep the `auto-advance` tag once it's edge-driven?

**Recommendation:** Keep `auto-advance` — after synthesis the natural next step
is grilling/planning the new TODO.md, exactly what auto-advance enables. Verify
the loop driver (gtd skill) doesn't assume `review-process` left a dirty tree to
commit.

**Answer:** yes, keep auto-advance on `review-process`.

### Does edge-driven `review-process` interact with the test gate — run the suite before the verbatim commit, or not at all?

**Recommendation:** Do NOT test-gate `review-process`. The verbatim
`record raw feedback` commit is explicitly "preserve the reviewer's tree as-is,
even if broken." Leave `TEST_GATED_LEAVES` unchanged.

**Answer:** agreed. Keep `review-process` OUT of the test gate
(`TEST_GATED_LEAVES` unchanged).

### Does "decision moves to the edge" mean leaving the routing in the pure machine, or actually moving branching out of `Machine.ts`?

**Recommendation:** Keep routing in the **pure machine** (`src/Machine.ts`);
"edge" means the existing `Events.ts` fact-gathering layer. Edge computes richer
boolean signals (`reviewHasUncheckedBoxes`, `reviewHasRealFeedback`), machine
routes on them.

**Answer:** agreed.

### The "abort on unchecked boxes" outcome is brand new — what is "abort" mechanically, given today every run emits a prompt and exits 0?

**Recommendation:** Introduce a new **terminal leaf `review-incomplete`**
(non-`auto-advance`, like `await-review`) with its own prompt
`src/prompts/review-incomplete.md` that tells the human "tick every box before
re-running" and **STOPs**. Exit code stays 0. Do NOT use `exit(1)`/stderr.

**Answer:** "abort" means to not proceed with any operations, but just tell the
user to review everything and at least tick all boxes.

### Is "unchecked boxes ⇒ abort" desired even when the human ALSO left real feedback?

**Recommendation:** Yes — gate on unchecked boxes **first**, before the feedback
check. Order: `review-incomplete` (unchecked) → `close-review` (all-checked, no
other change) → `review-process` (all-checked + real feedback).

**Answer:** yes, always check all boxes.

### What counts as a "box" and how do we detect "unchecked boxes present"?

**Recommendation:** A box is a line matching `^- \[[ x]\] `. "Unchecked present"
= the **working-tree** `REVIEW.md` contains at least one `^- \[ \] ` line.
Compute in `Events.ts` over working-tree content. If the human stripped all
checkboxes, falls through to the feedback decision.

**Answer:** agreed.

### How is "all boxes checked but no other changes" computed — strict forward-tick diff, or "string-replace `- [ ]`→`- [x]` then compare formatted"?

**Recommendation:** Adopt normalize-and-compare. Committed `REVIEW.md`,
string-replace `- [ ]` → `- [x]`, run through a pure `formatString` extracted
from `Format.ts`, compare to formatted working-tree `REVIEW.md`. Equal ⇒
`close-review`. Replaces the forward-tick machinery in `Events.ts`.

**Answer:** agreed.

### "No other changes" — source-file edits and untracked files, or only REVIEW.md?

**Recommendation:** Include **everything**. `close-review` requires (a) the only
dirty path is `REVIEW.md` AND (b) the normalized-tick comparison matches. Any
dirty source file, untracked file, or non-tick REVIEW.md edit ⇒ real feedback ⇒
`review-process`.

**Answer:** agreed.

### How does dropping `!!` interact with `reviewPresent` suppressing `code-changes`, and with the verbatim-commit step?

**Recommendation:** Keep the `reviewPresent` suppression of `code-changes`
**unchanged** (`codeDirty && !reviewPresent`) — it is what makes "any source
edit is feedback" work. Removing `bangPresent` only changes the
`reviewApprovedClose` guard and the divert.

**Answer:** agreed.

### Where should the captured commit diff be "stored in memory"?

**Recommendation:** Nowhere new — no scratch file. `git show <x>` reads the diff
back within the same run; it need not survive across separate invocations.

**Answer:** the agent does not even need the sha. It just executes `gtd`, and
within that one execution the review diff is committed, stored in process
memory, reverted, then directly printed into the agent's prompt for processing
into a TODO.md. (This refinement moved the commit / capture / revert from the
agent to the **edge** — reshaping §3.)

### Does the `bangPresent`-free `Git.ts` still need `lastReviewCommit`/`computeReviewBase` for the review-process branch?

**Recommendation:** Yes — keep `lastReviewCommit()`, `lastCloseCommit()`,
`computeReviewBase`, and the `<!-- base: … -->` parsing. Only `hasBangAdded`
(and its `baseRef`-since diff scan) is bang-specific and gets deleted.
`grepBangAdded`/`BangComment` do not exist.

**Answer:** agreed.

### Should `await-review` and the new `review-incomplete` be merged, since both are "human, do more" gates?

**Recommendation:** Keep them **separate**. `await-review` = human touched
nothing yet. `review-incomplete` = human started but left unchecked boxes. Guard
order: `await-review` (`reviewUnmodified`) checked **before**
`review-incomplete` so a fresh untouched review lands on `await-review`.

**Answer:** agreed.
