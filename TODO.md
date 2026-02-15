# Commit Feedback & Formatting Improvements

## Action Items

### Human Feedback Flow

- [x] Output confirmation message before triggering plan
  - In `commit-feedback.ts`, after the atomic commit succeeds, log a
    confirmation message (e.g., "Feedback committed. Triggering plan...")
  - Then invoke `makePlanCommand` to automatically run the planning step
  - This chains the commit-feedback → plan flow without requiring a second
    manual `gtd` invocation
  - The plan step should read the last commit (just created by commit-feedback)
    rather than re-reading the diff (which is empty post-commit)
  - Tests: Unit test in `commit-feedback.test.ts` that verifies (1) confirmation
    is logged after commit and (2) `makePlanCommand` is invoked after the commit
    succeeds, passing context to read from the last commit

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
  - Also apply to `learnAction` commits — these benefit from LLM summaries
  - Do NOT apply to `cleanup.ts` — cleanup commits are always just TODO removal
    and don't need LLM summarization
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

## Learnings

- Cleanup commits are always simple TODO removals — no need for LLM-generated
  summaries there
- When chaining commit-feedback → plan, the plan step should read the last
  commit rather than the working tree diff (which is empty after the commit)
