---
status: complete
---

# Fix two review-loop bugs in gtd

Two bugs surfaced while dogfooding the config-system review loop.

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
guard's input in `src/Events.ts` (lines 212-214) already excludes BOTH `TODO.md`
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

**Fix (firm — all questions resolved):** scope `grepBang` to the files
referenced by the current `REVIEW.md` (its chunk references ∪ dirty paths), and
do not harvest at all when `REVIEW.md` is absent. No `computeReviewBase` /
`reviewBaseRef` / diff-range base resolution is used — that base-selection
approach was rejected because `computeReviewBase` returns `none` on the harvest
path (the review commit is HEAD, frontier-at-HEAD guard at `src/Events.ts` lines
130-135), which would zero out harvesting in every `spec-harvest.feature`
scenario; and `reviewBaseRef` is a fixture hash that does not resolve to a real
commit. The chosen rule never depends on any base ref resolving and behaves
identically in the fixtures and the real repo.

- `src/Git.ts` — change `grepBang` (currently lines 208-237) to accept a
  pathspec list (`ReadonlyArray<string>`) and pass it to
  `git grep -nE … -- <files…>` (appended after the existing
  `:!REVIEW.md`/`:!TODO.md` exclusions, which stay). With an empty pathspec the
  caller must not invoke it (see below) — but defensively, an empty pathspec
  list should still scope to nothing rather than the whole tree.
- `src/Events.ts` `gatherEvents` — the `grepBang()` call currently sits at line
  244, _before_ `REVIEW.md` is read (line 252+). Move the bang harvest to run
  only inside the `if (reviewExists)` block (after `reviewContent` is read at
  line 258), so harvesting is gated on `REVIEW.md` existing. Build the pathspec
  there as the union of:
  - **files referenced by the current `REVIEW.md` chunks** — parse
    `reviewContent` for chunk reference lines of the form
    `- [ ] ./path/to/file#N` / `- [x] ./path/to/file#N` and collect the `./path`
    portion (strip the leading `./` and the trailing `#N`). This is the file set
    the review actually covers; in the fixtures the `!!` line lives in
    `src/app.ts` / `scripts/run.py`, each referenced by its REVIEW.md chunk
    (`./src/app.ts#1`, `./scripts/run.py#1`).
  - **dirty paths** — the `entries` already parsed at line 204 (excluding
    `REVIEW.md`/`TODO.md`, which `git grep`'s pathspec exclusions also drop).

  When `REVIEW.md` is absent, leave `bangComments` empty (no harvest). This
  satisfies the resolved "return empty (no harvest) when no review base
  resolves" decision: the only consumers of `bangPresent`/`bangComments` are the
  `close-review` vs `review-process` decision and the review-process prompt
  context, both review-scoped.

Note: `refDiff` (the human-review diff, computed at lines 310-317 from
`computeReviewBase`) is **not** used for harvest scope — it is `undefined` on
the harvest path for the same frontier-at-HEAD reason. Scope comes only from
REVIEW.md chunk references ∪ dirty paths.

**Docs:** update `README.md` and `src/prompts/review-process.md` / `SKILL.md`
wording if needed to state that `!!` harvesting is scoped to the files the
current `REVIEW.md` covers (its referenced files plus the dirty working tree),
not the whole tracked tree (per CLAUDE.md: significant changes reflected in
README). `src/Git.ts`'s doc comment on `grepBang` (line 204-207) must also be
updated to mention the pathspec scope.

**Test:** the existing `spec-harvest.feature` scenarios already exercise the
happy path inside isolated repos and must keep passing — the `!!` line lives in
`src/app.ts` / `scripts/run.py`, each referenced by that scenario's `REVIEW.md`
chunk (`./src/app.ts#1`, `./scripts/run.py#1`), so it stays in scope. Add a
scenario proving a `!!` comment in a file **not** referenced by `REVIEW.md` and
not dirty (committed before the review, untouched by the session) is NOT
harvested.

Repro: any `review-process` run in this repo lists `!!` hits from `README.md`,
`src/prompts/review-process.md`, and `spec-harvest.feature` alongside real
feedback.

## Resolved

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

**Answer:** agreed

### Bug 2: When grepBang is scoped to a diff range but no review base resolves, should it return empty or fall back to whole-tree?

**Recommendation:** Return empty (no harvest) when there is no resolvable review
base. The `!!`-harvest concept is defined relative to "the reviewed code", which
is meaningless without a baseline. Whole-tree fallback is exactly the current
buggy behaviour and would reintroduce the false positives whenever the base
can't be resolved. The only consumers of `bangPresent`/`bangComments` are the
`close-review` vs `review-process` decision and the review-process prompt
context, both of which are review-scoped — so empty-on-no-base is safe.

**Answer:** agreed

### Bug 2: Which base should scope `grepBang`'s diff range — `computeReviewBase(git)`, or the `<!-- base: … -->` ref in `REVIEW.md`?

**Recommendation:** Neither base resolution is needed; pick the simpler rule of
scoping `grepBang` to the files referenced by the current `REVIEW.md` chunks /
`refDiff` (∪ dirty paths) only, ignoring base-ref resolution entirely. The
base-resolution variants are both unworkable on the harvest path:

- `computeReviewBase(git)` (named in the original sketch) returns `none` in
  every `spec-harvest.feature` scenario: the `review(gtd): create review for …`
  commit **is HEAD** (REVIEW.md is only modified in the working tree), and
  `computeReviewBase` has a frontier-at-HEAD guard (`src/Events.ts` lines
  130-135) that returns `Option.none()` when the last review commit equals HEAD.
  Combined with "return empty on no base", that would harvest **nothing** in
  exactly the scenarios asserting a `!!` comment IS harvested.
- `reviewBaseRef` from `REVIEW.md` (parsed at `src/Events.ts` line 269) is, in
  the fixtures, a fake hash (`abc1234567890abcdef1234`) that does not resolve to
  a real commit, so `git diff <base>..HEAD` would fail to resolve the ref and
  (under "return empty") still harvest nothing.

The simpler rule never depends on a base ref resolving, behaves identically in
the fixtures and the real repo, and avoids reordering `computeReviewBase`.

**Answer:** Use the simpler rule. Scope `grepBang` to the files referenced by
the current `REVIEW.md` chunks (∪ dirty paths) only — no
`reviewBaseRef`/`computeReviewBase` base resolution at all. (`refDiff` is also
`undefined` on the harvest path for the same frontier-at-HEAD reason, so scope
comes from REVIEW.md chunk references ∪ dirty paths.) It never depends on a base
ref resolving, behaves identically in the fixtures and the real repo, and avoids
reordering `computeReviewBase`. Accepted trade-off: harvest is tied to
`REVIEW.md` existing, which is correct since `!!` harvest only runs on the
review path.
