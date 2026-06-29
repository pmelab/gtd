# Task: Delete dead Git/Config code + drop the `xstate` dependency

Remove the now-unused old-pipeline code from `src/Git.ts` and `src/Config.ts`,
and drop the `xstate` dependency. Part of the **atomic cutover** package: this
task only **deletes** code that the rewritten Machine/Events/Prompt/main no
longer reference. File-disjoint from the other cutover tasks (owns `Git.ts`,
`Git.test.ts`, `Config.ts`, `Config.test.ts`, `package.json`).

Spec pointers: `TODO.md` → "Throw away (no backcompat)" and "Modules to rewrite"
(the keep/delete lists for Git.ts and Config.ts).

## `src/Git.ts` — delete dead methods + their tests

Delete (interface + Live + tests in `Git.test.ts`):
`recordAndRevertReview`, `approveSpecReview`, `closeReview`,
`diffRefExcludingGtd`, `lastReviewCommit`, `lastCloseCommit`,
`deriveCommitMessage` (+ `CommitMessageInputs`, `CommitPendingOptions`), the
intent-aware `commitPending`, `lowestPackageDir` helper, and the
`import type { PendingCommitIntent } from "./Machine.js"` (that type is gone).
Also drop `lastCommitFiles`/`diffStatRef`/`resolveRef`/`isAncestor`/
`commitCount`/`commitSubjects`/`commitMessages`/`showHead` **only if** nothing in
the rewritten edge uses them — verify against the final `src/Events.ts` before
removing; keep any the new edge still calls. Keep the new primitives added in
package 01 and the kept set (`mergeBase`, `resolveDefaultBranch`,
`statusPorcelain`, `diffHead`, `diffRef`, `hasCommits`).

## `src/Config.ts` — remove the old model keys + dead field

- Remove the old `ModelState` keys `new-todo`, `modified-todo`, `execute`,
  `spec-review`, `spec-fix` from the union, `stateTier`, and `ModelStatesSchema`.
  Keep the new set: `grilling`, `decompose`, `building`, `fixing`,
  `agentic-review`, `clean`.
- Remove `agenticReviewMaxCycles` (replaced by `reviewThreshold`, added in
  package 01). Keep `agenticReview`, `testCommand`, `fixAttemptCap`,
  `reviewThreshold`, and the cosmiconfig walk-up/merge.
- Drop `MAX_NO_AGENT_HOPS` if referenced anywhere.
- Update `src/Config.test.ts` to drop assertions on the removed keys/field; keep
  the new-state + caps coverage from package 01.

## `package.json`

- Remove `"xstate"` from `dependencies`.

## Constraints

- **Deletions only** — do not change behaviour of the kept methods/fields.
- Coordinate via the shared contract: the rewritten `Events.ts` (sibling task)
  is the source of truth for which Git methods survive — remove a Git method only
  if the final edge does not call it. When unsure, keep it (a few extra kept
  methods do not fail the suite; a wrongly-deleted one does).
- This task may leave the tree red mid-package (e.g. while siblings are still
  rewriting); it must be consistent at package completion.

## Files

- Modify: `src/Git.ts`, `src/Git.test.ts`
- Modify: `src/Config.ts`, `src/Config.test.ts`
- Modify: `package.json`

## Acceptance criteria

- [ ] All listed dead Git methods/helpers and the `PendingCommitIntent` import
      are gone; the new primitives + kept set remain.
- [ ] Old `ModelState` keys and `agenticReviewMaxCycles` are removed; new states
      + `fixAttemptCap`/`reviewThreshold` remain.
- [ ] `xstate` is no longer in `package.json` dependencies and is imported
      nowhere.
- [ ] `npm run test` + `npm run test:e2e` pass at package completion.
