# Unify Human Contributions Into a Single Commit

## Action Items

### Simplify commit-feedback to produce a single commit

- [ ] Remove multi-commit logic from `commit-feedback.ts`
  - Replace the `parts` array and loop in `commitFeedbackCommand` with a single
    `atomicCommit("all", msg)` call
  - The diff classifier result is still useful for choosing the commit prefix,
    but all changes go into one commit
  - Pick the prefix by priority: 🌱 (seed) > 💬 (feedback) > 🤦 (humanTodos) >
    👷 (fixes) — seed takes precedence because a new TODO.md is the strongest
    signal
  - Remove `stageByPatch` usage entirely from this command
  - Tests: Existing `commit-feedback.test.ts` tests that assert multiple commits
    must be updated to assert a single commit. Add a test with mixed changes
    (seed + code TODOs + fixes) verifying exactly one commit is produced

### Update plan command to read combined diff from last commit

- [ ] Make `plan.ts` read `git diff HEAD~1` when the working tree is clean
  - After commit-feedback runs and plan is dispatched, `git.getDiff()` returns
    empty because everything is committed
  - Add a fallback: when `diff.trim() === ""`, read `git.show("HEAD")` or
    `git diff HEAD~1..HEAD` to get the last commit's diff as context for the
    plan prompt
  - This ensures the plan sees all human input (TODO.md content, code TODOs,
    fixes) in one diff
  - Tests: Add a test where plan runs after commit-feedback with code TODOs —
    verify the plan prompt includes the code TODO diff content, not "No diff
    available."

### Simplify DiffClassifier usage

- [ ] Reduce `classifyDiff` return to a single prefix selection
  - The classifier still parses hunks to determine the dominant change type, but
    no longer needs to return separate reconstructed diffs per category
  - Add a `classifyPrefix(diff, todoFile): CommitPrefix` function that returns
    the single best prefix
  - Keep `classifyDiff` for backward compatibility in tests but mark internal
  - Tests: Unit test `classifyPrefix` with mixed diffs to verify priority order
    (🌱 > 💬 > 🤦 > 👷)

### Update InferStep and gatherState for single-commit model

- [ ] Verify `inferStep` handles the unified prefix correctly
  - With a single commit, `lastCommitPrefix` will be whichever prefix was chosen
    (e.g., 🌱 for new TODO.md with code changes)
  - Confirm that all chosen prefixes still route to `"plan"` as the next step:
    SEED→plan, FEEDBACK→plan, HUMAN→plan, FIX→plan (FIX currently goes to build
    — this may need adjustment if fixes are bundled with seed)
  - If FIX is bundled with SEED, the prefix is 🌱 which correctly routes to plan
  - Tests: Add `inferStep` test cases for the unified commit scenario — single
    🌱 commit containing both seed and fix changes should infer "plan"

### Update E2E and integration tests

- [ ] Update `cli.test.ts` integration tests for single-commit flow
  - Any test that asserts commit count after `commit-feedback` should expect 1
    commit instead of N
  - Tests that verify the plan step receives diff context should pass with the
    fallback diff reading
  - Tests: Run full test suite (`bun test`) and verify all pass

## Learnings

- When an automated pipeline chains commit → next-step, ensure the next step can
  access the full context of what was just committed — splitting into multiple
  commits loses context for downstream steps that only inspect `HEAD~1`
- Prefer a single atomic commit for all human input to preserve full context for
  AI planning — granular commit splitting is only valuable when each commit is
  independently actionable
- Prefer hardcoded priority orders for internal classification logic over
  user-configurable options — the 🌱 > 💬 > 🤦 > 👷 prefix priority is a domain
  invariant, not a user preference
