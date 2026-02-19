# Plan Step: Remove In-Code TODO Comments After Incorporation

## Action Items

### Update Plan Prompt to Instruct Comment Removal

- [ ] Extend the plan prompt (`src/prompts/plan.md`) to instruct the planning
      agent to remove in-code `// TODO:`, `// FIXME:`, `// HACK:`, `// XXX:`
      comments from source files after incorporating them into plan action items
  - Add a new instruction block in the `## Instructions` section (under case 3 —
    feedback incorporation) telling the agent to: find all in-code TODO/FIXME
    markers that appear in the diff, create corresponding action items, then
    delete those comment lines from the source files
  - The agent already has file-editing tools available in plan mode; the prompt
    just needs to direct it to use them for comment removal
  - Only remove comments that were part of the current diff (newly added
    `// TODO:` lines), not pre-existing ones — pre-existing comments may be
    intentional and should be left untouched
  - Tests: Unit test in `src/commands/plan.test.ts` — verify the prompt passed
    to the agent contains the comment-removal instruction when the diff includes
    `// TODO:` markers

### Update E2E Test for Code TODO Removal

- [ ] Extend the existing e2e test "gtd commits code TODOs with 🤦 prefix" in
      `tests/integration/gtd-workflow.bats` to assert that in-code TODO comments
      are removed from source files after the plan step
  - After `run_gtd` completes, assert that `src/math.ts` no longer contains the
    `// TODO: never use magic numbers` comment line
  - Use `refute_output --partial "// TODO: never use magic numbers"` on the
    `repo_file src/math.ts` output
  - Tests: Run `bats tests/integration/gtd-workflow.bats` — the "gtd commits
    code TODOs with 🤦 prefix" test should pass with the new assertion

### Verify Plan Commit Includes Source File Changes

- [ ] Ensure the plan step's git commit (`🤖` prefix) includes the modified
      source files (not just `TODO.md`) when comments are removed
  - Currently `git.atomicCommit([config.file], planCommitMessage)` in `plan.ts`
    only stages `config.file` — change this to stage all changes (`"all"`) or
    also stage files modified by comment removal
  - The agent edits source files via its tools, so those changes will be in the
    working tree; they must be included in the plan commit
  - Tests: E2e test — after the plan step, `git diff` should be clean (no
    unstaged comment removals left behind); verify with `git status --porcelain`
    outputting empty in the bats test

## Learnings

- Always verify that `git.atomicCommit` scopes match the actual set of files the
  agent modifies — when the agent edits files beyond the plan file, the commit
  scope must expand accordingly
- Only remove TODO/FIXME comments that appear in the current diff (newly added
  lines) — pre-existing comments may be intentional and must not be touched
