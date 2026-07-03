# Review: 2a6372d

<!-- base: 2a6372d3eb3087e2d83731cf3e8ce086a7047e6d -->

## Hand squash commit off to edge

The squashing flow is redesigned: instead of the agent running
`git reset --soft` and `git commit` directly, it now writes the commit message
to `SQUASH_MSG.md`, re-runs gtd, and the edge performs the squash commit. This
avoids the agent touching git state and keeps the handoff pattern consistent
with other edge actions.

- [ ] ./src/prompts/squashing.md#1
- [ ] ./src/Machine.ts#618
- [ ] ./src/Machine.ts#203
- [ ] ./src/Events.ts#824

## Add squashMsgPresent/squashMsgContent to payload

`gatherEvents` now reads `SQUASH_MSG.md` from the repo root and emits
`squashMsgPresent` and `squashMsgContent` on the resolve payload.
`SQUASH_MSG.md` is added to `STEERING_FILES` so it is excluded from `codeDirty`
checks and diffs. `DEFAULT_PAYLOAD` defaults both fields to false/empty.

- [ ] ./src/Events.ts#49
- [ ] ./src/Events.ts#57
- [ ] ./src/Events.ts#608
- [ ] ./src/Machine.ts#157
- [ ] ./src/Machine.ts#327

## Add squashCommit edge action

Adds the `squashCommit` EdgeAction type (carries `squashBase` and
`commitMessage`) and its `perform` handler: removes `SQUASH_MSG.md`, soft-resets
to `squashBase`, then commits everything with the provided message. Adds
`softResetTo` to `GitOperations` and `GitService`.

- [ ] ./src/Machine.ts#205
- [ ] ./src/Git.ts#66
- [ ] ./src/Git.ts#322
- [ ] ./src/Events.ts#824

## Branch resolve on squashMsgPresent

The `resolve` squashing branch now forks: if `squashMsgPresent` is true, return
a `squashCommit` edge action so the edge performs the squash; otherwise return
no edge action so the agent is prompted to write the file. Both paths set
`autoAdvance: true`.

- [ ] ./src/Machine.ts#618

## Update squashing prompt

Rewrites `squashing.md` to a three-step procedure: extract decisions from
grilling rounds, draft the commit message, write it to `SQUASH_MSG.md` and
re-run gtd. Removes the `git reset --soft` / `git commit` instructions entirely
and adds an explicit prohibition on the agent running those commands.

- [ ] ./src/prompts/squashing.md#1

## Tests for SQUASH_MSG flow

Adds machine unit tests for `squashMsgPresent: true` (expects `squashCommit`
edge action) and `squashMsgPresent: false` (expects no edge action). Adds edge
unit tests for `squashMsgPresent`/`squashMsgContent` payload fields and a
`squashCommit` perform test verifying reset, commit, and file removal. Updates
the `{{MODEL}}` substitution test to remove `squashing` from planning states.

- [ ] ./src/Machine.test.ts#661
- [ ] ./src/Events.test.ts#829
- [ ] ./src/Events.test.ts#1364
- [ ] ./src/Prompt.test.ts#130

## Integration scenarios and step definitions

Adds two new squashing feature scenarios: `SQUASH_MSG.md` present triggers the
squash commit and is cleaned up; `SQUASH_MSG.md` alone does not cause
`codeDirty`. Updates existing happy-path and interleaved-commit scenarios to
assert the new prompt wording and absence of `git reset --soft`. Adds reusable
step definitions: `a file {string} with content:`,
`the HEAD commit subject is {string}`, `{string} exists`, and
`{string} does not exist`.

- [ ] ./tests/integration/features/squashing.feature#27
- [ ] ./tests/integration/features/squashing.feature#61
- [ ] ./tests/integration/support/steps/common.steps.ts#36
- [ ] ./tests/integration/support/steps/common.steps.ts#156
