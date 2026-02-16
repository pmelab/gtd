# Improved Human Feedback Commits

## Action Items

### Progress Indication

- [ ] Show immediate progress feedback when `commit-feedback` starts
  - Add a console log or spinner at the top of `commitFeedbackCommand` in
    `src/commands/commit-feedback.ts` before any async work (diff retrieval,
    agent invocation)
  - Should appear before the `git.getDiff()` call so the user sees it instantly
  - Tests: Unit test that the progress message is logged before `getDiff` is
    called (spy on `console.log` and track call order relative to git/agent
    mocks)

### Classify Diff Hunks as Fixes vs Feedback

- [ ] Create a `DiffClassifier` service that splits a unified diff into "fix"
      hunks and "feedback" hunks
  - New file `src/services/DiffClassifier.ts`
  - A hunk is "feedback" if its added lines contain markers like `TODO:`,
    `FIX:`, `FIXME:`, `HACK:`, `XXX:` (case-insensitive)
  - All other hunks are "fixes" (regular manual code changes)
  - Return type: `{ fixes: string; feedback: string }` where each is a valid
    unified diff (or empty string if no hunks of that type)
  - Must reconstruct valid diffs from the classified hunks (preserve file
    headers)
  - Tests: Given a diff with mixed hunks (some adding `TODO:` lines, some adding
    plain code), verify correct classification; edge cases: all-feedback diff,
    all-fix diff, empty diff

### Two-Phase Commit in commit-feedback

- [ ] Refactor `commitFeedbackCommand` to perform two sequential commits when
      both fix and feedback changes exist

  - Use `DiffClassifier` to split the working tree changes
  - Phase 1 — Fixes: if fix hunks exist, `git add -p` or selectively stage fix
    files, then `atomicCommit` with emoji `👷` and an agent-generated summary of
    the fix diff
  - Phase 2 — Feedback: if feedback hunks exist, `atomicCommit` with emoji `🤦`
    and an agent-generated summary of the feedback diff
  - If only one type exists, make a single commit with the appropriate emoji
  - Tests: Mock `DiffClassifier` to return mixed/fix-only/feedback-only splits;
    verify correct number of commits, correct emojis, and correct ordering
    (fixes before feedback)

- [ ] Add selective staging support to `GitService`
  - Add a `addByPatch` or `addFiles` method that can stage specific files or
    hunks rather than `add -A`
  - Alternative: classify at the file level (simpler) — files containing only
    feedback markers go to feedback commit, rest go to fix commit
  - Tests: Integration-style test verifying that selective add stages only the
    intended files

## Open Questions

- Should classification be file-level (simpler, a file is either fix or
  feedback) or hunk-level (more precise but requires patch-level staging)?
- What exact set of marker prefixes should trigger "feedback" classification?
  Current candidates: `TODO:`, `FIX:`, `FIXME:`, `HACK:`, `XXX:`
- Should the progress indication be a simple log line or a proper spinner (e.g.,
  using `ora` or similar)?

## Learnings

- `commitFeedbackCommand` currently does a single `atomicCommit("all", ...)`
  with a `🤦` emoji — the refactor needs to split this into conditional
  two-phase commits
- `generateCommitMessage` already accepts an emoji prefix and diff, so it can be
  reused for both fix and feedback commits with different emojis
- `atomicCommit` in `GitService` is already `Effect.uninterruptible` with
  rollback on failure, which is good for multi-phase safety
