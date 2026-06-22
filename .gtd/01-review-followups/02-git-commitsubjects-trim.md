# Fix: trim each line in `commitSubjects` (Git.ts)

## Description

In `src/Git.ts`, the `commitSubjects` operation splits `git log` output on `\n`
and filters out empty lines, but — unlike sibling operations such as
`lastCommitSubject`, `lastCommitFiles`, and the `untracked` parsing in
`diffHead` — it does NOT trim each line. On a CRLF checkout this leaves a
trailing `\r` on every subject, which then poisons the `/^fix\(gtd\):/` prefix
match in `gatherEvents` and any other subject comparison.

## What to build

Trim each line before filtering by length, in the `commitSubjects` mapper.

Current code (around lines 153-156):

```ts
return exec(...args).pipe(
  Effect.map(
    (out) => out.split("\n").filter((line) => line.length > 0) as ReadonlyArray<string>,
  ),
  // Empty repo (no HEAD) makes `git log` fail; treat as no commits.
  Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<string>)),
)
```

Target mapper:

```ts
out
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length) as ReadonlyArray<string>
```

i.e. `out.split("\n").map((l) => l.trim()).filter((l) => l.length)`.

## Files

- `/Users/pmelab/Code/gtd/gtd/src/Git.ts` (the `commitSubjects` operation, ~lines 148-160)

## Constraints / edge cases

- Keep the existing `Effect.catchAll` empty-repo fallback intact.
- Keep the `as ReadonlyArray<string>` cast so the return type is unchanged.
- Do not alter any other operation; only `commitSubjects`'s mapper changes.

## Acceptance criteria

- [ ] `commitSubjects` trims each line (`.map((l) => l.trim())`) before filtering by length.
- [ ] Empty/whitespace-only lines are still filtered out.
- [ ] The empty-repo `catchAll` fallback returning `[]` is unchanged.
- [ ] Subjects no longer carry a trailing `\r` on CRLF checkouts.
- [ ] `npm run build` / typecheck passes and the existing test suite stays green.
