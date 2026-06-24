# Replace `grepBang(pathspec)` with `grepBangAdded(baseRef)` in Git.ts

Change `!!` harvesting from "grep the provided pathspec" to "harvest only `!!`
tokens on lines the reviewer ADDED since a baseline ref". The baseline is the
`review(gtd): create review …` commit (resolved by the caller via
`lastReviewCommit()`); here we just diff the working tree against the given
`baseRef` and emit a `BangComment` for every `!!` on an added (`+`) line.

This task owns the entire contract of the old `grepBang` method, so it touches
BOTH `src/Git.ts` and its unit tests `src/Git.test.ts` (they must change
together — the old signature disappears).

## Files

- `src/Git.ts` — `GitOperations` interface decl (~line 24), the `BangComment`
  doc comment (~27-33 stays), the method impl + doc comment (~223-262).
- `src/Git.test.ts` — the `describe("grepBang", …)` block (~355-418).

## What to do — `src/Git.ts`

- Interface (line 24): replace
  `readonly grepBang: (pathspec: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<BangComment>, Error>`
  with
  `readonly grepBangAdded: (baseRef: string) => Effect.Effect<ReadonlyArray<BangComment>, Error>`.
- Keep the `BangComment` shape `{ file, line, text }` IDENTICAL. Update the
  `BangComment` doc comment wording from "found in tracked source" to "found on
  a line added since the review baseline" if helpful, but do NOT change fields.
- Replace the `grepBang` impl (and its doc comment ~223-229) with
  `grepBangAdded`:
  - Reuse the untracked intent-to-add trick from `diffHead` (~54-66): run
    `git ls-files --others --exclude-standard`; if there are untracked paths,
    `git add --intent-to-add -- …` them so new untracked reviewer files appear
    in the diff, then `git reset -- …` them afterward (wrap the reset in
    `Effect.catchAll(() => Effect.void)` exactly like `diffHead`).
  - Run `git diff <baseRef> -- ':!REVIEW.md' ':!TODO.md'` (NO second ref — this
    compares the ref to the WORKING TREE, picking up uncommitted edits). Keep the
    `:!REVIEW.md` / `:!TODO.md` exclusions.
  - Walk the unified-diff output line by line, tracking the new-file line number:
    - On a hunk header `@@ -a,b +c,d @@`, set the counter to `c` (the new-file
      start line). Parse `c` from the `+c[,d]` group.
    - For each `+` line (but NOT the `+++ ` file header) that matches the
      existing pattern `(//|#|<!--)\s*!!`, emit `{ file, line: String(counter), text }`
      using the SAME text-strip regex as the old impl:
      `raw.replace(/^.*?(?:\/\/|#|<!--)\s*!!\s*/, "").replace(/\s*-->\s*$/, "").trim()`.
      Then increment the counter.
    - For context lines (leading space) increment the counter; for `-` lines do
      NOT increment (they don't exist in the new file).
    - Track the current file from `+++ b/<path>` header lines (strip the `b/`
      prefix; handle `+++ /dev/null`). `file` is the new-file path.
  - `line` MUST be a string (the `BangComment.line` field is `string`), matching
    the old impl's `l.slice(i1 + 1, i2)` string value.
  - `git diff` exit 1 or any failure → `Effect.catchAll(() => Effect.succeed([]))`.

## What to do — `src/Git.test.ts`

Rewrite the `describe("grepBang", …)` block to the `baseRef` API. Each test
commits a baseline, captures its hash, then introduces the `!!` as a WORKING-TREE
edit (uncommitted) so it shows up as an added line in the diff. Cover:

- A `!!` added (uncommitted) after the baseline IS harvested — assert
  `file`, `line` (string), and `text` are parsed correctly (mirrors the old
  "parses line number and text correctly" assertions).
- A `!!` that already existed AT the baseline commit (committed, unchanged in the
  working tree) is NOT harvested (the false-positive guard — proves we only catch
  added lines, not pre-existing ones).
- `!!` is recognized across comment syntaxes (`//`, `#`, `<!--`).
- REVIEW.md / TODO.md are excluded even when they contain an added `!!`.
- No `!!` added → returns `[]`.
- A `!!` in a NEW untracked file added after the baseline IS harvested (verifies
  the intent-to-add path).

Use the existing `commit(...)` / `git(...)` / `run(...)` helpers in the file.
To get the baseline hash, capture `git("rev-parse HEAD")` after the baseline
commit and pass it to `grepBangAdded`.

## Acceptance criteria

- [ ] `GitOperations` no longer declares `grepBang`; it declares
      `grepBangAdded(baseRef: string)`.
- [ ] `grepBangAdded` diffs the working tree against `baseRef` (no second ref)
      and emits a `BangComment` per `!!` on an added line, with the line number
      computed from hunk headers.
- [ ] `:!REVIEW.md` / `:!TODO.md` exclusions retained; `git diff` failure → `[]`.
- [ ] Untracked files are intent-to-added before the diff and reset after.
- [ ] `src/Git.test.ts` grepBang block rewritten to the baseRef API with the
      pre-existing-vs-added guard and the REVIEW.md/TODO.md exclusion test.
- [ ] `npm run test` passes.

## Constraints / edge cases

- `BangComment` shape and `line` being a `string` are FROZEN — Events.ts and the
  prompt payload depend on them.
- Do NOT mutate source (no stripping) — harvest is read-only.
- This is paired with the Events.ts task in the SAME package: the old `grepBang`
  signature disappears, so Events.ts must switch to `grepBangAdded` in lockstep
  (different file, parallel task).
