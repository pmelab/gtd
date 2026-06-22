# Add `showHead(path)` git operation

Add a new git operation that reads the committed (HEAD) version of a tracked
file via `git show HEAD:<path>`. The close-review detection logic (task 02) uses
it to read the committed `REVIEW.md` and diff it against the working copy.

## Files

- `src/Git.ts`
  - `GitOperations` interface (`:4-21`) — add the method signature.
  - `GitService.Live` returned object (`:39-165`) — implement it using the
    existing `exec(...)` wrapper, mirroring siblings like `diffRef` (`:75`) and
    `lastCommitSubject` (`:56-57`).
- `src/Git.test.ts` — add a `describe("showHead", ...)` block (mirror the
  existing `describe` blocks, e.g. `diffRef` at `:48-64`). The test harness
  (`run`, `runEither`, `git`, `commit`, `beforeEach`/`afterEach`) is already set
  up at `:10-45`.

## Implementation notes

- Signature: `readonly showHead: (path: string) => Effect.Effect<string, Error>`.
- Implementation: `exec("git", "show", `HEAD:${path}`)`. Do NOT `.trim()` the
  result — the caller (task 02) needs the exact committed content including its
  trailing newline to compare line counts against the working copy. (Contrast
  with `lastCommitSubject`, which trims because it is a single subject line.)
- When the path does not exist at HEAD, `git show HEAD:<path>` exits non-zero;
  the existing `run`/`exec` wrapper maps that to a failed `Effect` (an `Error`).
  That is the desired "fails cleanly" behavior — no special handling needed.

## Acceptance criteria

- [ ] `showHead` is declared in the `GitOperations` interface and implemented in
      `GitService.Live`.
- [ ] `showHead("<path>")` returns the exact committed file content (including
      trailing newline) for a tracked file at HEAD.
- [ ] `showHead("<missing-path>")` fails with an `Error` (assert via `runEither`
      that `result._tag === "Left"`, mirroring the `resolveRef` invalid-ref test
      at `Git.test.ts:79-84`).
- [ ] New `Git.test.ts` cases cover both the present-path and absent-path
      behaviors; existing tests still pass.
