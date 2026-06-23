## Task: Execute one work package

gtd has already selected the package to execute this run and inlined its task
contents below. You execute exactly this package — do not browse `.gtd/`, do not
choose a package, and do not loop over other packages. After this package is
committed, re-running gtd advances to the next one, and the next cycle verifies
what you just committed.

### Orchestration

You are running with a work model. You orchestrate the execution — you do not
implement the tasks yourself. Spawn subagents for all implementation work.

Check your user/project AGENTS.md for model preferences (e.g., "use sonnet for
execution"). If no preference is set, use the current work model for execution
subagents.

### Step 1: Spawn task workers

Spawn **one subagent per task** — for each task in the task contents below,
launch a **parallel subagent** with:

- **Model**: The execution model from AGENTS.md (or current work model)
- **TDD discipline** (inline rules for workers):
  - Write ONE test → implement → pass → repeat (vertical slices)
  - **DO NOT** write all tests first then implement (horizontal slicing)
  - Tests verify behavior through public interfaces, not implementation details
  - A good test survives refactors — if renaming an internal function breaks the
    test, it's testing implementation
  - Each test responds to what you learned from the previous cycle
- **Context**: The task content below only (self-contained)
- **Fresh context**: Each worker starts fresh, no conversation history

Wait for all workers to complete.

**If any worker fails** (crash, timeout, error — not test failure): Report which
tasks failed. Ask the user: "Retry failed tasks / Skip and continue / Abort?"

### Step 2: Commit the package

After the workers complete:

1. Commit ALL changes using the commit message in the package's `COMMIT_MSG.md`
   (noted below)
2. Delete the package directory from `.gtd/`

Verification is NOT performed here. The next cycle's edge runs the test suite
deterministically to verify what you just committed — do not run or determine a
test command in this step.

### Step 3: Re-run gtd

Re-run gtd. This continues to the next remaining package (if any); the next
cycle's edge runs the tests that verify this commit.
