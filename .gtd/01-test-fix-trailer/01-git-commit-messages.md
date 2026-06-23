# Add `commitMessages` full-message reader to GitService

Add a sibling to `commitSubjects` that reads the **full commit message**
(subject + body) so the verify-loop edge can detect a body trailer. Bodies
contain newlines, so split on a NUL delimiter, not `\n`.

## Files

- `src/Git.ts`

## Details

- Add `commitMessages: (base?: string) => Effect.Effect<ReadonlyArray<string>, Error>`
  to the `GitOperations` interface (line ~21, alongside `commitSubjects`).
- Implement it in the `GitService.Live` object (next to `commitSubjects`,
  lines ~186-202):
  - `git log --first-parent --reverse --format=%B%x00 <base>..HEAD` when `base`
    is defined, else the no-`base` whole-history variant
    (`git log --first-parent --reverse --format=%B%x00`).
  - Split the output on `"\0"` (NUL, from `%x00`), `.map((m) => m.trim())`,
    drop empties, return as `ReadonlyArray<string>`, oldest→newest.
  - Keep the same empty-repo `catchAll(() => [])` fallback as `commitSubjects`.
- Do NOT remove `commitSubjects` — leave it for any other callers; only add the
  sibling.

## Acceptance criteria

- [ ] `commitMessages` is declared in the `GitOperations` interface.
- [ ] `commitMessages` is implemented in `GitService.Live`, using
      `--format=%B%x00` and splitting on `"\0"`.
- [ ] Trim + drop-empties applied; returns oldest→newest.
- [ ] Empty-repo fallback returns `[]` (same `catchAll` as `commitSubjects`).
- [ ] `commitSubjects` is untouched.
- [ ] `npm run test` passes; `tsc`/build has no type errors for this file.

## Constraints / edge cases

- `%B` includes a trailing newline per commit; `.trim()` removes it. The NUL
  delimiter (not `\n`) is load-bearing because multi-line bodies otherwise split
  mid-message.
- File-disjoint with all other tasks in this package — only edit `src/Git.ts`.
