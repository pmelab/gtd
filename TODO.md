---
status: grilling
---

# Fix two review-loop bugs in gtd

Two bugs surfaced while dogfooding the config-system review loop.

## Open Questions

### Bug 2: How should `grepBang` be scoped so it stops matching gtd's own `!!` docs/fixtures — diff-range, exclude-list, or reviewer-touched files?

**Recommendation:** Scope `grepBang` to the files changed in the review diff
range, i.e. pass the name-only file set of `git diff <reviewBase>..HEAD` (plus
the dirty working tree) as the pathspec to `git grep`. Reasoning:

- This matches the prompt's own wording: review-process.md Step 4.3 says "scan
  **the reviewed code**" — the reviewed code is exactly the diff since the
  review base, not the whole tree.
- The root cause is conceptual: `grepBang` greps the **entire tracked tree**, so
  it surfaces every `!!` token anywhere — including gtd documenting its own
  feature (`README.md:109`, `example.md:61/100`, `src/Git.ts:205`,
  `src/prompts/review-process.md:43-44`) and its own fixtures
  (`spec-harvest.feature:14/47/79`). All of these are pre-existing committed
  lines, untouched by any review, so a diff-range scope drops every one of them
  while still catching a reviewer who drops a `// !! …` into a file they
  touched.
- The integration tests in `tests/` are unaffected by the scope change: each
  scenario runs gtd inside its own isolated test repo where the `!!` line lives
  in a file that _is_ in the review diff, so it still gets harvested. (The false
  positives only ever appear when gtd runs over the **gtd repo itself**.)
- An **exclude-list** (`:!src/prompts/` `:!README.md` `:!SKILL.md` `:!tests/`)
  is rejected: it is brittle (every new gtd doc/fixture must be remembered) and
  only papers over gtd's own repo — a _user_ repo that documents a `!!`
  convention would still get false positives. It does not address the root
  cause.
- "Only reviewer-touched files" (files dirty in the working tree, or files in
  `<lastReviewCommit>..HEAD`) is a narrower variant of the diff-range option; it
  would miss a `!!` that a previous build step committed into a reviewed file
  before the review session. The full review-diff range is the safest superset.

Implementation sketch: `computeReviewBase(git)` is already computed in
`gatherEvents` (Events.ts line 307), and `grepBang` is called at line 244.
Reorder so the base is available, then change `grepBang` to accept an optional
pathspec list and call `git grep … -- <files…>` where `<files…>` =
`git diff --name-only <base> HEAD` ∪ dirty paths. When no review base resolves
(no review in progress), fall back to **no `!!` harvest** (return empty) — a
`!!` scan only makes sense relative to a review baseline anyway, and
`grepBang`'s result (`bangPresent`/`bangComments`) is only consumed by the
review branches.

<!-- user answers here -->

### Bug 2: When grepBang is scoped to a diff range but no review base resolves, should it return empty or fall back to whole-tree?

**Recommendation:** Return empty (no harvest) when there is no resolvable review
base. The `!!`-harvest concept is defined relative to "the reviewed code", which
is meaningless without a baseline. Whole-tree fallback is exactly the current
buggy behaviour and would reintroduce the false positives whenever the base
can't be resolved. The only consumers of `bangPresent`/`bangComments` are the
`close-review` vs `review-process` decision and the review-process prompt
context, both of which are review-scoped — so empty-on-no-base is safe.

<!-- user answers here -->

## Plan

### Bug 1 — `code-changes` strands review feedback by committing `REVIEW.md`

When the working tree has BOTH review feedback (an edited `REVIEW.md` with notes
and/or ticks) AND an edit to some other source file, the `code-changes` leaf
fires first — the `codeDirty` guard sits **above** `reviewModified` in the guard
order (`src/Machine.ts` lines 192-200). Its prompt
(`src/prompts/code-changes.md`) says to stage everything with `git add -A` and
commit, excluding only `TODO.md`. That sweeps the modified `REVIEW.md` into the
commit, so on the next run `REVIEW.md` is committed-and-unmodified →
`reviewUnmodified` resolves to `await-review` instead of `review-process`. The
reviewer's notes are silently stranded.

This contradicts the `code-changes` state's own definition: the `codeDirty`
guard's input in `src/Events.ts` (lines 212-215) already excludes BOTH `TODO.md`
and `REVIEW.md` from `codeEntries`, but the prompt commits `REVIEW.md` anyway.

Expected: `code-changes` should commit the source edits verbatim while leaving
`REVIEW.md` dirty, so the next fold reaches `review-process` and folds the
feedback.

**Fix:** `src/prompts/code-changes.md` — after `git add -A`, unstage `REVIEW.md`
the same way it already handles `TODO.md`: `git restore --staged REVIEW.md`
(only if present), leaving it pending. Update the "Important" note to mention
both control files (`TODO.md` and `REVIEW.md`) are excluded and why (`REVIEW.md`
belongs to the review branch, not a code commit).

Repro: on a branch with a committed `REVIEW.md`, edit `REVIEW.md` (add a note)
AND edit any source file, then run gtd twice. Observed: lands on `await-review`;
the note never becomes a `TODO.md`.

**Test:** add a `code-changes.feature` (or extend the existing review/branches
feature) scenario via composable Given steps: a committed `REVIEW.md`, then a
Given that modifies `REVIEW.md` with a note AND a Given that modifies a source
file; When I run gtd twice; Then the source edit is committed but `REVIEW.md`
stays dirty and the second run reaches `# Process Review Feedback`
(review-process), not `await-review`.

### Bug 2 — `!!` harvesting (`grepBang`) matches gtd's own docs and test fixtures

`review-process` harvests `!!` follow-up comments from tracked source via
`grepBang` (`src/Git.ts` lines 208-237), then the prompt (Step 4.3) says to
strip them. But `grepBang` greps the **whole tracked tree**, so it matches `!!`
occurrences in gtd's OWN files that document or test the feature:

- `README.md:109`, `example.md:61`, `example.md:100`
- `src/Git.ts:205` (the doc comment), `src/prompts/review-process.md:43-44`
- `tests/integration/features/spec-harvest.feature:14/47/79`

Harvesting and stripping those would corrupt the tool's own docs and fixtures.

Expected: only genuine reviewer-added `!!` follow-up comments in the code under
review should be harvested — not the tool describing/testing the syntax.

**Fix (pending Open Question resolution — recommended diff-range scope):**
`src/Git.ts` — change `grepBang` to accept an optional pathspec list and pass it
to `git grep … -- <files>`. `src/Events.ts` `gatherEvents` — compute the review
base first, derive the changed-file set (`git diff --name-only <base> HEAD` ∪
dirty paths), and pass it to `grepBang`; return empty when no review base
resolves. Keep the existing `:!REVIEW.md`/`:!TODO.md` exclusions.

**Docs:** update `README.md` and `src/prompts/review-process.md` / `SKILL.md`
wording if needed to state that `!!` harvesting is scoped to the code changed
since the review base (per CLAUDE.md: significant changes reflected in README).

**Test:** the existing `spec-harvest.feature` scenarios already exercise the
happy path inside isolated repos and must keep passing (the `!!` line lives in a
reviewed/changed file). Add a scenario proving a `!!` comment in a file
**outside** the review diff range (committed before the base, untouched by the
session) is NOT harvested.

Repro: any `review-process` run in this repo lists `!!` hits from `README.md`,
`src/prompts/review-process.md`, and `spec-harvest.feature` alongside real
feedback.

## Resolved
