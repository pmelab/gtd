# Plan: checking off REVIEW.md checkboxes approves (→ Done), not Accept Review

## Problem

In **Await Review** the contract is binary (`src/prompts/await-review.md`):

- re-run gtd with **no** pending changes → **Done** (`gtd: done`, REVIEW.md
  removed)
- **any** pending change → **Accept Review** (seed TODO.md, discard code edits,
  re-enter Grilling)

But REVIEW.md checkboxes (`- [ ]`) are documented as _navigational aids, not a
gate_ (`src/prompts/clean.md` lines 44-47). A user walking the review and
ticking boxes (`- [ ]` → `- [x]`) is **approving**, yet today that edit makes
REVIEW.md dirty → Accept Review fires → a spurious TODO.md / fresh plan.

## Root cause

- `src/Events.ts:208-210` —
  `reviewDirty = reviewTrackedAtHead && !workingTreeClean`. ANY pending entry
  (including a REVIEW.md edit) flips it.
- `src/Machine.ts:453-460` — `reviewDirty` → `accept-review` +
  `seedAcceptReview`.
- `src/Machine.ts:445-452` — `reviewCommitted` (committed + clean tree) →
  `done`.

## Approach

Add a new event flag distinguishing a **pure checkbox-only REVIEW.md edit** from
a real change-request, computed at the Effect edge (the only place with git diff
access) and consumed by a guard in the pure machine. This follows the project's
"pure-decision input → field on ResolvePayload" rule (AGENTS.md): the new flag
is a per-resolve guard input on a specific review event, not a cross-cutting IO
mode, so it travels as payload, not a Context tag.

### 1. Edge: compute `reviewCheckboxOnly` (src/Events.ts)

A pending change is "checkbox-only" when **both** hold:

1. The ONLY dirty path is `REVIEW.md` — no code changes, no other steering
   files. Reuse the existing `entries` parse: every entry's path is
   `REVIEW_FILE`. (`codeDirty` is already false in this case; also require no
   `.gtd`, no other steering files dirty — i.e. `entries` contains only
   `REVIEW.md`.)
2. The REVIEW.md diff is **purely checkbox state flips**. Get the working-tree
   diff of REVIEW.md (`git diff HEAD -- REVIEW.md`, via a new
   `git.diffPath(path)` on `GitService` — `Git.ts` already has `diffHead` /
   `diffRef`; add a path-scoped variant) and check that every changed line is a
   checkbox flip: each removed (`-`) line and its paired added (`+`) line are
   **identical except** the box marker `[ ]` ↔ `[x]` (case-insensitive `x`). Any
   added/removed line that is NOT such a flip → not checkbox-only.
   - Implement as a small pure helper
     `isCheckboxOnlyDiff(diff: string): boolean` in `src/Events.ts` (testable in
     isolation, like `seedTodo`).
   - Empty diff (no actual change, e.g. whitespace) → treat as not checkbox-only
     (falls through to existing dirty handling; an all-clean tree is already
     `reviewCommitted` → Done anyway).
   - Both `- [ ]` → `- [x]` (ticking) and `- [x]` → `- [ ]` (un-ticking) count
     as checkbox flips — un-ticking is still just navigation, not a content
     change.

   Set
   `reviewCheckboxOnly = (only REVIEW.md dirty) && isCheckboxOnlyDiff(diff of REVIEW.md)`.

### 2. Payload: add `reviewCheckboxOnly: boolean` (src/Machine.ts)

- Add to `ResolvePayload` (near `reviewDirty`, line ~113) with doc comment.
- Add to `defaultPayload` (line ~258) as `false`.
- No machine fold needed — it is a direct edge fact, like `reviewDirty`.

### 3. Machine guard: route checkbox-only to Done (src/Machine.ts ~444-460)

In the `p.reviewPresent` block, before the `p.reviewDirty` branch:

```
if (p.reviewCommitted) → done            // unchanged (clean tree)
if (p.reviewDirty && p.reviewCheckboxOnly) → done   // NEW: ticking = approval
if (p.reviewDirty) → accept-review        // unchanged
else → await-review                       // unchanged
```

The new branch emits `state: "done"`, `edgeAction: { kind: "done" }`,
`autoAdvance: true` — same as `reviewCommitted`. The existing `done` edge action
(`src/Events.ts:404-405`) removes REVIEW.md and commits `gtd: done`; this also
commits the ticked-off REVIEW.md edits in that same removal commit (they vanish
with the file, which is fine — the boxes were navigational).

### 4. Prompts / docs

- `src/prompts/await-review.md` — clarify step 2 (**To approve**): "re-run gtd
  with no changes **or after only checking off REVIEW.md checkboxes**"; step 3
  (**To request changes**) stays for code edits / inline comments / textual
  REVIEW.md annotations.
- `src/prompts/clean.md` lines 52-55 — update the closing note to match.
- `STATES.md` § Accept Review (lines 314-330) and § Done (332-341) — document
  that a committed REVIEW.md with **only checkbox-flip edits** routes to Done,
  not Accept Review; Accept Review now requires a _non-checkbox_ edit.
- `README.md` — mirror the change (per global instruction: every significant
  change reflected in README). Find the review-lifecycle / Await Review section
  and add the checkbox-approval rule.

### 5. Tests

**Unit (vitest):**

- `src/Events.test.ts` — `isCheckboxOnlyDiff` helper: pure `- [ ]`→`- [x]` diff
  → true; un-tick → true; a diff that also changes text/adds a comment → false;
  a diff adding a new non-checkbox line → false; empty diff → false. Plus a
  `runGather`-style case: committed REVIEW.md + only checkbox edits in tree →
  `reviewCheckboxOnly: true`, `reviewDirty: true`; committed REVIEW.md + text
  annotation → `reviewCheckboxOnly: false`.
- `src/Machine.test.ts` — add `reviewCheckboxOnly: false` to the test
  `defaultPayload` (line ~42); new case:
  `reviewPresent + reviewDirty + reviewCheckboxOnly` → `state: "done"`,
  `edgeAction { kind: "done" }`. Keep the existing `reviewDirty` (non-checkbox)
  → `accept-review` case.

**Integration (cucumber, per AGENTS.md):** add to
`tests/integration/features/review.feature`, using the existing composable Given
steps (`a commit … that adds REVIEW.md with:`, `"REVIEW.md" is modified to:`) —
expose the actual checkbox content in the scenario text:

- Scenario: "Checking off REVIEW.md checkboxes approves the review" — commit
  REVIEW.md with `- [ ]` boxes (`gtd: awaiting review`), then
  `"REVIEW.md" is modified to:` the same content with `- [x]`; run gtd → last
  commit `gtd: done`, REVIEW.md does not exist, TODO.md does not exist, stdout
  does NOT contain Grilling.
- Keep the existing "Editing the code under a committed REVIEW.md seeds a fresh
  plan" scenario as the negative case; optionally add a scenario where REVIEW.md
  is edited with a textual annotation (not a checkbox) → still Accept Review →
  `gtd: grilling`, to prove non-checkbox REVIEW.md edits remain change-requests.

## Trace checklist (no workflow step added/removed — guard only)

- [ ] `ResolvePayload` field + doc (Machine.ts)
- [ ] `defaultPayload` (Machine.ts) + test `defaultPayload` (Machine.test.ts)
- [ ] edge computation + `git.diffPath` (Events.ts, Git.ts)
- [ ] machine guard branch (Machine.ts)
- [ ] prompts: await-review.md, clean.md
- [ ] STATES.md (Accept Review / Done)
- [ ] README.md
- [ ] unit tests (Events.test.ts, Machine.test.ts)
- [ ] cucumber scenarios (review.feature)

no open questions — run gtd to plan
