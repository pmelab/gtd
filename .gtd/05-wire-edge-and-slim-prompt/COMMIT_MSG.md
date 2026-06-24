feat(gtd): edge-drive review-process; slim the agent prompt

Move the review-process git work to the gtd edge and reduce the agent prompt
to pure synthesis.

- main.ts: add a `review-process` pre-render phase (parallel to the
  TEST_GATED_LEAVES block) that runs `recordAndRevertReview(baseRef)` and
  injects the captured diff + record-sha via the `review-process` override
  before `buildPrompt`. Revert conflicts surface as exit 1 via the existing
  catchAll. `review-process` stays out of the test gate.
- review-process.md: slimmed to "turn the injected diff into TODO.md" with the
  global/local/suggestion taxonomy and a `git show <record-sha>` recovery hint;
  all git machinery, the FAILURE BRANCH, and every `!!` mention removed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
