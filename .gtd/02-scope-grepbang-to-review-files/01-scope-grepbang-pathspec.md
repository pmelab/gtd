# Task: Scope `grepBang` to REVIEW.md-referenced files ∪ dirty paths

## Problem

`review-process` harvests `!!` follow-up comments via `grepBang`
(`src/Git.ts` ~208-237), but `grepBang` greps the WHOLE tracked tree, so it
matches `!!` occurrences in gtd's OWN docs/fixtures (`README.md`, `example.md`,
`src/Git.ts` doc comment, `src/prompts/review-process.md`,
`spec-harvest.feature`). Harvesting/stripping those corrupts the tool's own
files.

## Resolved design (firm — do NOT reopen)

Scope harvesting to the files the current `REVIEW.md` covers (its chunk
references ∪ dirty working-tree paths), and do NOT harvest when `REVIEW.md` is
absent. No `computeReviewBase` / `reviewBaseRef` / diff-range base resolution —
those return `none` / unresolvable on the harvest path (frontier-at-HEAD guard;
fixture base is a fake hash). See TODO.md "Resolved" for the full rationale.

This task owns BOTH coupled code files (signature + only caller) because they
must compile/land atomically — they are file-disjoint from every other task in
this package but cannot be split across parallel tasks.

## Changes

### `src/Git.ts`

- Change `grepBang` to accept a pathspec list (`ReadonlyArray<string>`) and pass
  it to `git grep -nE … -- <files…>`, appended AFTER the existing `:!REVIEW.md`
  / `:!TODO.md` exclusions (which STAY).
- Update the `GitOperations.grepBang` signature in the interface (~line 23) to
  match.
- Defensive: with an EMPTY pathspec list, scope to NOTHING (return empty), not
  the whole tree. (Caller already avoids calling it empty, but git grep with no
  pathspec after `--` would otherwise scan everything.)
- Update the `grepBang` doc comment (~lines 204-207) to state it scopes to the
  provided pathspec (REVIEW.md-referenced files ∪ dirty paths), not the whole
  tracked tree.

### `src/Events.ts` `gatherEvents`

- Move the `grepBang()` call (currently ~line 244, BEFORE REVIEW.md is read)
  into the `if (reviewExists)` block, AFTER `reviewContent` is read (~line 258),
  so harvesting is gated on REVIEW.md existing.
- Build the pathspec there as the UNION of:
  - **REVIEW.md-referenced files**: parse `reviewContent` for chunk reference
    lines of the form `- [ ] ./path/to/file#N` / `- [x] ./path/to/file#N`;
    collect the `./path` portion stripped of the leading `./` and trailing `#N`.
  - **dirty paths**: the `entries` already parsed (~line 204), excluding
    `REVIEW.md` / `TODO.md` (git grep's pathspec exclusions also drop them).
- Deduplicate the union before passing it.
- When `REVIEW.md` is absent, leave `bangComments` empty (`[]`) and
  `bangPresent` false — do NOT call `grepBang`.
- Keep `bangPresent` / `bangComments` populated from this scoped result so the
  existing `ResolvePayload` wiring (~lines 244-245, 344) is unchanged downstream.

## Acceptance criteria

- [ ] `GitOperations.grepBang` and its implementation accept a
      `ReadonlyArray<string>` pathspec and pass it after `--` (keeping
      `:!REVIEW.md` / `:!TODO.md`)
- [ ] Empty pathspec → empty result (never whole-tree)
- [ ] `grepBang` doc comment describes the pathspec scope
- [ ] `gatherEvents` calls `grepBang` ONLY inside `if (reviewExists)`, after
      `reviewContent` is read
- [ ] Pathspec = (REVIEW.md `./path#N` chunk refs, stripped) ∪ (dirty
      `entries` paths), deduplicated
- [ ] When `REVIEW.md` is absent, `bangComments` is empty and `grepBang` is not
      invoked
- [ ] `npm run test` (vitest) GREEN; `npm run test:e2e` GREEN including the
      existing `spec-harvest.feature` happy-path scenarios (the `!!` line lives
      in `src/app.ts` / `scripts/run.py`, each referenced by its REVIEW.md
      chunk, so it stays in scope)

## Files

- `src/Git.ts`
- `src/Events.ts`

## Constraints / edge cases

- These two files are owned by THIS single task (coupled signature + caller).
  No other task in this package may touch them.
- Do NOT introduce `computeReviewBase` / `reviewBaseRef` into the harvest scope
  — explicitly rejected in the plan.
- `refDiff` is undefined on the harvest path; do not rely on it for scope.
- Chunk-ref parsing: match both `- [ ]` and `- [x]`; tolerate a trailing `#N`
  with any digits. Strip leading `./`.
- Verify the existing `spec-harvest.feature` REVIEW.md chunk refs
  (`./src/app.ts#1`, `./scripts/run.py#1`) resolve to the file holding the `!!`
  line so those scenarios still harvest.
