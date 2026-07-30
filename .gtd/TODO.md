# Resolve PR #122 merge conflicts with `main`

PR #122 (`improve-visualizations` → `main`) is `CONFLICTING`. `main` advanced by
three commits since the merge base (`b2d3b0a`):

- `1de4699` feat(restore): add `gtd restore` (new `RetainedHistory.ts`)
- `144fb0f` feat(workflow): add `label` field + herdr loop reporting
- `2cc6311` chore(release): 7.2.0

A trial merge of `origin/main` conflicts in exactly **two files**, both **purely
additive** (each side adds a different declaration in the same import /interface
block — no logic overlaps). Everything else auto-merges. I dry-ran the full
resolution below: build, typecheck, lint, 542 unit tests and 206 e2e tests all
pass, then aborted the merge to leave the tree clean.

## Decision: merge `main` into the branch (not rebase)

Merge, not rebase — the branch's own commits include workflow/`gtd(...)` state
commits (`d2c6c5f`, `2e648ac`); a merge keeps history and the PR intact, a
rebase would rewrite it for no gain. One merge commit is the cheapest correct
resolution.

## Steps

1. `git fetch origin main` then `git merge origin/main`. Expect conflicts in
   `src/Git.ts` and `src/program.ts` only.

2. **`src/Git.ts`** — one conflict, the `GitReaderOperations` interface (~line
   16). Keep BOTH additions (union):
   - HEAD's ref-aware signature + doc:
     `/** The subject of ... */ readonly lastCommitSubject: (ref?: string) => Effect.Effect<string, Error>`
   - main's new member:
     `/** git log -1 --pretty=%B ... */ readonly lastCommitMessage: () => Effect.Effect<string, Error>`

     The implementation block lower in the file
     (`lastCommitSubject: (ref = "HEAD")` alongside `lastCommitMessage: ...`)
     auto-merges — no marker there.

3. **`src/program.ts`** — two conflicts, both in the import block:
   - The `effect` import: keep HEAD's line
     `import { Effect, Either, Option, Runtime } from "effect"` (superset — main
     just lacks `Runtime`).
   - The `ReviewWindow`/`RetainedHistory` imports: keep BOTH import statements —
     HEAD's multi-line `ReviewWindow.js` import (the one that includes
     `REVIEW_HEAD_REF`) followed by main's new
     `import { clearRetainedHistory, readRetainedHistory, restorability, retainHistory } from "./RetainedHistory.js"`.

   No other region of `program.ts` conflicts; the `restore` command body and the
   visualize additions coexist.

4. Regenerate the derived schema and format it — the build's `postbuild`
   rewrites `schema.json` (to pick up main's `label` field) and its raw output
   is not oxfmt-clean:
   - `npm run build`
   - `npx oxfmt --write schema.json`

5. Verify (must all pass — confirmed green in the dry run):
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test:unit`
   - `npm run test:e2e` (`npm test` runs all of these plus `format:check`; run
     it as the final gate.)

6. Stage the resolved files (`src/Git.ts`, `src/program.ts`, `schema.json`) and
   the auto-merged files, then conclude the merge with `git commit` (default
   merge message). Push to update the PR.

## Notes / non-goals

- No source logic changes beyond taking the union of both sides — the conflicts
  are declaration-list collisions, not behavioural.
- No README/docs change needed: both feature sets already documented their own
  additions on their respective branches; the merge introduces no new behaviour.
- No new cucumber scenarios — this is a merge, not a feature; both sides' e2e
  suites already cover their behaviour and pass together.
