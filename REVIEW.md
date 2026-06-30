# Review: ae9c55a

<!-- base: ae9c55a2af13bae19b94d18e6978f2976cc41e16 -->

## Fix empty trunk merge-base range

Resolve `headHash` once up front, then discard the merge-base when it equals
HEAD (trunk-based workflow) so the empty `main..HEAD` range no longer zeroes the
loop budgets. Falls back to whole-history, which is safe because `foldCounters`
resets on every package boundary. The duplicate `resolveRef("HEAD")` in the
reviewBase block is removed and the hoisted `headHash` reused.

- [ ] ./src/Events.ts#204
- [ ] ./src/Events.ts#208
- [ ] ./src/Events.ts#211

## Cover base-fold counters (issue-7)

New `gatherEvents — COMMIT-stream base folds` describe: a trunk regression
asserting two `gtd: errors` after `gtd: planning` fold to `testFixCount === 2`
(not 0), plus a feature-branch control proving a pre-branch-point error is
excluded. Adds the `foldCounters` import.

- [ ] ./src/Events.test.ts#14
- [ ] ./src/Events.test.ts#490

## Add trunk integration scenarios

Trunk-mode mirrors of the cap-escalation and review-threshold scenarios (no
`Given a branch "feature"`), exercising the budgets engaging on the default
branch end to end.

- [ ] ./tests/integration/features/testing.feature#199
- [ ] ./tests/integration/features/agentic-review.feature#69

## Document default-branch budgets

README wording now notes the whole-history fallback also triggers when HEAD
equals the merge-base, so budgets engage on the default branch too.

- [ ] ./README.md#16
