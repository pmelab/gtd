# Add `diffPath(path)` to GitService

Add a path-scoped working-tree diff method to `src/Git.ts`, mirroring the
existing `diffHead` / `diffRef` methods.

## Context

`src/Git.ts` already exposes `diffHead` and `diffRef`. We need a variant that
returns the working-tree diff of a single path against HEAD
(`git diff HEAD -- <path>`). This is the only place with git access; downstream
the edge will use it to inspect REVIEW.md changes.

## Implementation

- Add a `diffPath(path: string)` method to the `GitService` (same Effect-style
  signature/shape as the existing `diffHead`).
- It runs `git diff HEAD -- <path>` and returns the raw diff string.
- Keep it consistent with how `diffHead` shells out and handles errors.

## Acceptance criteria

- [ ] `GitService` exposes a `diffPath(path: string)` method returning the
      working-tree diff of that path vs HEAD (`git diff HEAD -- <path>`)
- [ ] Signature and error handling match the existing `diffHead` / `diffRef`
      style (no new error-handling pattern introduced)
- [ ] `npx tsc --noEmit` (or project typecheck) passes
- [ ] Full test suite is green
