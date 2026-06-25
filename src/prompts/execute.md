## Task: Execute one work package

gtd has already selected the package to execute this run and inlined its task
contents below. You execute exactly this package — do not browse `.gtd/`, do not
choose a package, and do not loop over other packages. After this package is
committed, re-running gtd advances to the next one, and the next cycle verifies
what you just committed.

### Orchestration

You are running with a work model. You orchestrate the execution — you do not
implement the tasks yourself. Spawn subagents for all implementation work using
model `{{MODEL}}`.

### Step 1: Spawn task workers

Spawn **one subagent per task** — for each task in the task contents below,
launch a **parallel subagent** with:

- **Model**: `{{MODEL}}`
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

### Step 2: Leave the work uncommitted

After the workers complete, do **not** commit, do **not** delete the package
directory, and do **not** remove `.gtd/`. Leave all changes uncommitted.

The next gtd cycle's edge commits these changes (using the package's
`COMMIT_MSG.md`) and removes the consumed package directory from `.gtd/` — all
in one commit.

Verification is NOT performed here. The next cycle's edge runs the test suite
deterministically to verify what the edge just committed — do not run or
determine a test command in this step.

### Step 3: Re-run gtd

Re-run gtd. The next cycle commits this package, then continues to the next
remaining package (if any) and runs the tests that verify the commit.
