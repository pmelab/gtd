# Commit Feedback & Formatting Improvements

## Action Items

### Human Feedback Flow

- [ ] Output confirmation message before triggering plan
  - In `commit-feedback.ts`, after the atomic commit succeeds, log a
    confirmation message (e.g., "Feedback committed. Triggering plan...")
  - Then invoke `makePlanCommand` to automatically run the planning step
  - This chains the commit-feedback → plan flow without requiring a second
    manual `gtd` invocation
  - Tests: Unit test in `commit-feedback.test.ts` that verifies (1) confirmation
    is logged after commit and (2) `makePlanCommand` is invoked after the commit
    succeeds

### LLM-Generated Commit Summaries

- [ ] Generate commit messages via agent instead of filename-based summaries
  - Replace the manual `diff`-line-parsing summary in `commit-feedback.ts` with
    an agent call that produces a concise commit message from the diff content
  - Use the existing `AgentService.invoke` with a short prompt like "Summarize
    this diff as a git commit message (max 72 chars)"
  - Apply the same approach in `build.ts` (`atomicCommit("all", ...)`) and
    `plan.ts` (`atomicCommit([config.file], ...)`) — extract a shared helper
    (e.g., `generateCommitMessage` in `services/Git.ts` or a new
    `services/CommitMessage.ts`)
  - Keep the emoji prefix convention (`🤦`, `🔨`, `🤖`) intact — the LLM
    generates only the descriptive part
  - Tests: Unit test the helper with a mock agent that returns a known summary;
    verify the commit message format is `<emoji> <llm-summary>`

### Prettier Formatting for TODO.md

- [ ] Run prettier on TODO.md after plan generation
  - After the agent writes the plan file and before the atomic commit in
    `plan.ts`, run `prettier --write <config.file>` using `@effect/platform`
    `Command`
  - Respect the existing `.prettierrc` config (which already sets
    `printWidth: 80` and `proseWrap: always` for `.md` files)
  - Handle prettier failures gracefully — log a warning but don't fail the plan
    command
  - Tests: Unit test in `plan.test.ts` that verifies prettier is invoked on the
    plan file path; integration test that the committed markdown is properly
    wrapped

## Open Questions

- Should LLM-generated summaries also apply to `cleanup.ts` and `learnAction`
  commits, or only the three main commands?
  > yes for learnAction, but not for cleanup. thats always just the TODO removal
- For the commit-feedback → plan chaining: should it re-read the diff (which is
  now empty post-commit) or pass context forward?
  > plan chaining should always read the last commit, which was comitted right
  > before in this case
