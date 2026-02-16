# Improved Human Feedback Commits

## Action Items

### Progress Indication

- [x] Show immediate progress feedback when `commit-feedback` starts using a
      proper spinner
  - Add a spinner (e.g., `ora` or Effect-idiomatic equivalent) at the top of
    `commitFeedbackCommand` in `src/commands/commit-feedback.ts` before any
    async work (diff retrieval, agent invocation)
  - Should appear before the `git.getDiff()` call so the user sees it instantly
  - Update spinner text as phases progress (e.g., "Classifying changes…",
    "Committing fixes…", "Committing feedback…")
  - Tests: Unit test that the spinner is started before `getDiff` is called (spy
    on spinner creation and track call order relative to git/agent mocks);
    verify spinner is stopped on success and on error

### Classify Diff Hunks as Fixes vs Feedback

- [ ] Create a `DiffClassifier` service that splits a unified diff into "fix"
      hunks and "feedback" hunks at the hunk level

  - New file `src/services/DiffClassifier.ts`
  - Classification is hunk-level: each hunk is independently classified, and
    patch-level staging (`git add -p` or programmatic equivalent) is used to
    stage only the relevant hunks per commit
  - A hunk is "feedback" if its added lines contain markers like `TODO:`,
    `FIX:`, `FIXME:`, `HACK:`, `XXX:` (case-insensitive)
  - All changes in `TODO.md` are always considered feedback, regardless of
    content
  - All other hunks are "fixes" (regular manual code changes)
  - Return type: `{ fixes: string; feedback: string }` where each is a valid
    unified diff (or empty string if no hunks of that type)
  - Must reconstruct valid diffs from the classified hunks (preserve file
    headers)
  - Tests: Given a diff with mixed hunks (some adding `TODO:` lines, some adding
    plain code), verify correct classification; edge cases: all-feedback diff,
    all-fix diff, empty diff, diff with only `TODO.md` changes (should be
    all-feedback), diff with `TODO.md` changes mixed with other file changes

- [ ] Document feedback marker prefixes in the README
  - Add a section to `README.md` explaining that `commit-feedback` classifies
    hunks using marker prefixes: `TODO:`, `FIX:`, `FIXME:`, `HACK:`, `XXX:`
    (case-insensitive)
  - Document that all changes in `TODO.md` are always treated as feedback
  - Tests: Verify README contains the marker prefix documentation after the
    change

### Two-Phase Commit in commit-feedback

- [ ] Refactor `commitFeedbackCommand` to perform two sequential commits when
      both fix and feedback changes exist

  - Use `DiffClassifier` to split the working tree changes
  - Phase 1 — Fixes: if fix hunks exist, selectively stage fix hunks via
    patch-level staging, then `atomicCommit` with emoji `👷` and an
    agent-generated summary of the fix diff
  - Phase 2 — Feedback: if feedback hunks exist, `atomicCommit` with emoji `🤦`
    and an agent-generated summary of the feedback diff
  - If only one type exists, make a single commit with the appropriate emoji
  - Tests: Mock `DiffClassifier` to return mixed/fix-only/feedback-only splits;
    verify correct number of commits, correct emojis, and correct ordering
    (fixes before feedback)

- [ ] Add hunk-level selective staging support to `GitService`
  - Add a `stageByPatch` method that can stage specific hunks from a unified
    diff using `git apply --cached` or `git add -p` with scripted input
  - Must handle the case where a single file has both fix and feedback hunks
  - Tests: Integration-style test verifying that hunk-level staging stages only
    the intended hunks within a file, leaving other hunks unstaged

### Improve Learning Extraction Quality

- [ ] Filter learnings to only include actionable coding guidelines, not project
      state observations
  - Update the agent prompt (or post-processing logic) that extracts learnings
    from feedback hunks to only retain items that represent reusable rules or
    mistakes — e.g., statements containing "never", "always", or specific coding
    patterns to follow/avoid
  - Discard learnings that merely describe the current state of the project
    (e.g., "X currently does Y") since those become stale
  - Tests: Given a set of feedback hunks containing both actionable guidelines
    ("always use Effect.gen for async flows") and state observations
    ("commitFeedbackCommand currently does a single atomicCommit"), verify only
    the actionable guidelines are extracted as learnings

## Learnings

- `commitFeedbackCommand` currently does a single `atomicCommit("all", ...)`
  with a `🤦` emoji — the refactor needs to split this into conditional
  two-phase commits
- `generateCommitMessage` already accepts an emoji prefix and diff, so it can be
  reused for both fix and feedback commits with different emojis
- `atomicCommit` in `GitService` is already `Effect.uninterruptible` with
  rollback on failure, which is good for multi-phase safety
- Classification is hunk-level, not file-level — this is more precise but
  requires patch-level staging support in `GitService`
- All changes in `TODO.md` are always classified as feedback regardless of
  marker presence
- Progress indication should use a proper spinner library, not plain
  `console.log`
- Learnings must only contain actionable coding guidelines (e.g., "always do X",
  "never do Y"), not observations about current project state which go stale
