# Task: Add `commitSubjects(base?)` to GitService

Add a first-parent commit-subject lister to `src/Git.ts` so the edge can build
the `COMMIT` event stream. Use the `tdd` skill.

## What to build

- Add `commitSubjects(base?: string)` to the `GitOperations` interface and the
  `Live` layer:
  - `git log --first-parent --format=%s` with the range
    `<base>..HEAD` when `base` is provided, or the **whole history** (no range)
    when `base` is omitted — see plan Open Question 2 (no default branch / no
    merge-base ⇒ whole history fallback).
  - Return subjects **oldest → newest** (i.e. reverse git log's default order, or
    pass `--reverse`).
  - Return `ReadonlyArray<string>`; empty array when there are no commits.

## Acceptance criteria

- [ ] `commitSubjects(base?)` on `GitOperations` + `Live`
- [ ] Omitted `base` ⇒ full first-parent history; given `base` ⇒ `base..HEAD`
- [ ] Order is oldest → newest
- [ ] `src/Git.test.ts` covers: no-base full history, with-base range, ordering,
      empty repo
- [ ] `npm test` + `npm run typecheck` pass

## Files

- `src/Git.ts` (interface lines 4–20; `Live` layer lines 30–149)
- `src/Git.test.ts` (extend)

## Constraints

- Match the existing Effect/`CommandExecutor` style of the other git methods.
- First-parent only (`--first-parent`) so merge bubbles don't pollute the stream.
